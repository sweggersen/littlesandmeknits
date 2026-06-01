import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createNotification } from '../notify';
import { restoreStatus, validateDecideInput } from './moderation-helpers';

async function getProfileRole(ctx: ServiceContext): Promise<string | null> {
  const { data } = await ctx.admin
    .from('profiles').select('role').eq('id', ctx.user.id).maybeSingle();
  return data?.role ?? null;
}

function isModerator(role: string | null): boolean {
  return role === 'admin' || role === 'moderator';
}

interface TargetMeta {
  recipientId: string;
  itemTitle: string | null;
  itemUrl: string | null;
}

async function resolveTarget(ctx: ServiceContext, targetType: string, targetId: string): Promise<TargetMeta | null> {
  if (targetType === 'listing') {
    const { data: l } = await ctx.admin.from('listings')
      .select('id, title, seller_id').eq('id', targetId).maybeSingle();
    if (!l) return null;
    return { recipientId: l.seller_id, itemTitle: l.title, itemUrl: `/market/listing/${l.id}` };
  }
  if (targetType === 'store') {
    const { data: s } = await ctx.admin.from('stores')
      .select('id, slug, name, created_by').eq('id', targetId).maybeSingle();
    if (!s) return null;
    return { recipientId: s.created_by, itemTitle: s.name, itemUrl: `/market/store/${s.slug}` };
  }
  if (targetType === 'commission_request') {
    const { data: c } = await ctx.admin.from('commission_requests')
      .select('id, title, buyer_id').eq('id', targetId).maybeSingle();
    if (!c) return null;
    return { recipientId: c.buyer_id, itemTitle: c.title, itemUrl: `/market/commissions/${c.id}` };
  }
  return null;
}

/** Step 1 of the new report flow: decide if the report is valid.
 *  - 'freeze': valid → freeze the listing/store/commission AND open an
 *    in-app moderator thread with the owner. The first moderator message
 *    is required (this is how we contact the owner now — no more email).
 *  - 'dismiss': not valid → close the report(s). No item effect, no thread.
 *  applyToAll closes/handles all sibling open reports at once.
 */
export async function decideReport(
  ctx: ServiceContext,
  input: { reportId: string; action: string; firstMessage?: string; notes?: string; applyToAll?: boolean },
): Promise<ServiceResult<{ redirect: string }>> {
  const guard = validateDecideInput(input);
  if (!guard.ok) return fail('bad_input', guard.reason);

  const role = await getProfileRole(ctx);
  if (!isModerator(role)) return fail('forbidden', 'Moderator access required');

  const { data: report } = await ctx.admin
    .from('reports').select('id, target_type, target_id, reporter_id, status').eq('id', input.reportId).maybeSingle();
  if (!report) return fail('not_found', 'Report not found');
  if (report.status !== 'open') return fail('conflict', 'Report already handled');

  const now = new Date().toISOString();

  // Collect all open sibling reports on the same target.
  const idsToUpdate: string[] = [input.reportId];
  if (input.applyToAll !== false) {
    const { data: siblings } = await ctx.admin
      .from('reports')
      .select('id')
      .eq('target_type', report.target_type)
      .eq('target_id', report.target_id)
      .eq('status', 'open');
    for (const s of siblings ?? []) {
      if (!idsToUpdate.includes(s.id)) idsToUpdate.push(s.id);
    }
  }

  if (input.action === 'dismiss') {
    await ctx.admin.from('reports').update({
      status: 'dismissed',
      resolved_by: ctx.user.id, resolved_at: now,
      resolution_notes: input.notes || null,
    }).in('id', idsToUpdate);

    await ctx.admin.from('moderation_audit_log').insert({
      actor_id: ctx.user.id, action: 'report_dismiss',
      target_type: 'report', target_id: input.reportId,
      details: { notes: input.notes, applied_to_count: idsToUpdate.length },
    });

    return ok({ redirect: `/admin/reports?dismiss=1&count=${idsToUpdate.length}` });
  }

  // action === 'freeze' → require a first message to the owner.
  const firstMessage = (input.firstMessage ?? '').trim();
  if (!firstMessage) return fail('bad_input', 'En melding til eieren kreves når du fryser');

  const meta = await resolveTarget(ctx, report.target_type, report.target_id);
  if (!meta) return fail('not_found', 'Target item not found');
  if (meta.recipientId === ctx.user.id) return fail('forbidden', 'Du eier dette elementet');

  // Create the thread FIRST. If this fails (e.g. migration not applied),
  // we want to bail out before changing any other state.
  const { data: thread, error: tErr } = await ctx.admin.from('moderation_threads').insert({
    report_id: input.reportId,
    target_type: report.target_type,
    target_id: report.target_id,
    recipient_id: meta.recipientId,
  }).select('id').single();
  if (tErr || !thread) {
    console.error('moderation_threads insert failed', tErr);
    return fail('server_error', `Kunne ikke opprette tråd: ${tErr?.message ?? 'ukjent feil'}`);
  }

  // Initial moderator message. If this fails, undo the thread.
  const { error: mErr } = await ctx.admin.from('moderation_messages').insert({
    thread_id: thread.id,
    sender_id: ctx.user.id,
    is_moderator: true,
    body: firstMessage,
  });
  if (mErr) {
    await ctx.admin.from('moderation_threads').delete().eq('id', thread.id);
    return fail('server_error', `Kunne ikke sende melding: ${mErr.message}`);
  }

  // Freeze the item. Stash the previous status so we can restore on unfreeze.
  if (report.target_type === 'listing') {
    const { data: l } = await ctx.admin.from('listings')
      .select('status, pre_freeze_status').eq('id', report.target_id).maybeSingle();
    if (l && l.status !== 'frozen') {
      await ctx.admin.from('listings').update({
        status: 'frozen',
        pre_freeze_status: l.pre_freeze_status ?? l.status,
        frozen_at: now, frozen_by: ctx.user.id,
        frozen_reason: input.notes || null,
      }).eq('id', report.target_id);
    }
  } else if (report.target_type === 'store') {
    await ctx.admin.from('stores').update({
      status: 'suspended', reviewed_at: now, reviewed_by: ctx.user.id,
    }).eq('id', report.target_id);
  } else if (report.target_type === 'commission_request') {
    await ctx.admin.from('commission_requests').update({
      status: 'frozen', reviewed_at: now, reviewed_by: ctx.user.id,
      moderation_notes: input.notes || null,
    }).eq('id', report.target_id);
  }

  // Mark the report(s) as in-progress — under active moderation. They
  // become 'resolved'/'dismissed' only when the thread closes.
  await ctx.admin.from('reports').update({
    resolution_notes: input.notes || null,
  }).in('id', idsToUpdate);

  // Notify the recipient.
  await createNotification(ctx.admin, {
    userId: meta.recipientId,
    type: 'moderation_message',
    title: 'Viktig: melding fra moderator',
    body: `Moderator har frosset ${meta.itemTitle ? `«${meta.itemTitle}»` : 'et av elementene dine'} og venter på svar.`,
    url: `/market/moderasjon/${thread.id}`,
    actorId: ctx.user.id,
  }, ctx.env);

  await ctx.admin.from('moderation_audit_log').insert({
    actor_id: ctx.user.id, action: 'report_freeze',
    target_type: 'report', target_id: input.reportId,
    details: { thread_id: thread.id, applied_to_count: idsToUpdate.length, target_type: report.target_type, target_id: report.target_id },
  });

  return ok({ redirect: `/admin/moderation-threads/${thread.id}` });
}

export async function sendThreadMessage(
  ctx: ServiceContext,
  input: { threadId: string; body: string },
): Promise<ServiceResult<{ redirect: string }>> {
  const body = (input.body ?? '').trim();
  if (!input.threadId || !body) return fail('bad_input', 'Skriv en melding');
  if (body.length > 4000) return fail('bad_input', 'Meldingen er for lang');

  const role = await getProfileRole(ctx);
  const mod = isModerator(role);

  const { data: thread } = await ctx.admin
    .from('moderation_threads').select('*').eq('id', input.threadId).maybeSingle();
  if (!thread) return fail('not_found', 'Tråd ikke funnet');
  if (thread.status !== 'open') return fail('conflict', 'Tråden er lukket');
  if (!mod && thread.recipient_id !== ctx.user.id) return fail('forbidden', 'Ingen tilgang');

  await ctx.admin.from('moderation_messages').insert({
    thread_id: thread.id,
    sender_id: ctx.user.id,
    is_moderator: mod,
    body,
  });

  // Notify the other party.
  if (mod) {
    await createNotification(ctx.admin, {
      userId: thread.recipient_id,
      type: 'moderation_message',
      title: 'Viktig: ny melding fra moderator',
      body: body.slice(0, 140),
      url: `/market/moderasjon/${thread.id}`,
      actorId: ctx.user.id,
    }, ctx.env);
  } else {
    // Owner replied — notify every moderator and admin.
    const { data: mods } = await ctx.admin
      .from('profiles').select('id').in('role', ['admin', 'moderator']);
    for (const m of mods ?? []) {
      if (m.id === ctx.user.id) continue;
      await createNotification(ctx.admin, {
        userId: m.id,
        type: 'moderation_message',
        title: 'Svar fra eier på moderasjon-sak',
        body: body.slice(0, 140),
        url: `/admin/moderation-threads/${thread.id}`,
        actorId: ctx.user.id,
        referenceId: thread.id,
      }, ctx.env);
    }
  }

  const redirect = mod ? `/admin/moderation-threads/${thread.id}` : `/market/moderasjon/${thread.id}`;
  return ok({ redirect });
}

export async function closeThread(
  ctx: ServiceContext,
  input: { threadId: string; unfreeze: boolean; notes?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.threadId) return fail('bad_input', 'Invalid input');
  const role = await getProfileRole(ctx);
  if (!isModerator(role)) return fail('forbidden', 'Moderator access required');

  const { data: thread } = await ctx.admin
    .from('moderation_threads').select('*').eq('id', input.threadId).maybeSingle();
  if (!thread) return fail('not_found', 'Tråd ikke funnet');

  const now = new Date().toISOString();

  if (input.unfreeze) {
    if (thread.target_type === 'listing') {
      const { data: l } = await ctx.admin.from('listings')
        .select('pre_freeze_status').eq('id', thread.target_id).maybeSingle();
      const restoreTo = restoreStatus(l?.pre_freeze_status);
      await ctx.admin.from('listings').update({
        status: restoreTo,
        frozen_at: null, frozen_by: null, frozen_reason: null, pre_freeze_status: null,
      }).eq('id', thread.target_id);
    } else if (thread.target_type === 'store') {
      await ctx.admin.from('stores').update({
        status: 'active', reviewed_at: now, reviewed_by: ctx.user.id,
      }).eq('id', thread.target_id);
    } else if (thread.target_type === 'commission_request') {
      await ctx.admin.from('commission_requests').update({
        status: 'open', reviewed_at: now, reviewed_by: ctx.user.id,
      }).eq('id', thread.target_id);
    }
  }

  await ctx.admin.from('moderation_threads').update({
    status: 'closed', closed_at: now,
  }).eq('id', thread.id);

  // Mark all still-open reports on this target as resolved.
  await ctx.admin.from('reports').update({
    status: 'resolved',
    resolved_by: ctx.user.id, resolved_at: now,
  }).eq('target_type', thread.target_type)
    .eq('target_id', thread.target_id)
    .eq('status', 'open');

  await createNotification(ctx.admin, {
    userId: thread.recipient_id,
    type: 'moderation_message',
    title: input.unfreeze ? 'Saken er løst og elementet er gjenåpnet' : 'Saken er avsluttet',
    body: input.unfreeze ? 'Moderator har avsluttet saken og gjenåpnet elementet ditt.' : 'Moderator har avsluttet saken.',
    url: `/market/moderasjon/${thread.id}`,
    actorId: ctx.user.id,
  }, ctx.env);

  await ctx.admin.from('moderation_audit_log').insert({
    actor_id: ctx.user.id, action: input.unfreeze ? 'thread_close_unfreeze' : 'thread_close_keep_frozen',
    target_type: 'moderation_thread', target_id: thread.id,
    details: { target_type: thread.target_type, target_id: thread.target_id, notes: input.notes ?? null },
  });

  return ok({ redirect: `/admin/moderation-threads/${thread.id}` });
}
