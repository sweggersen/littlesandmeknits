import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createNotification } from '../notify';
import { createStripe } from '../stripe';
import { hasConflict, applyApproval, applyRejection } from '../moderation';

async function getProfileRole(ctx: ServiceContext): Promise<string | null> {
  const { data } = await ctx.admin
    .from('profiles').select('role').eq('id', ctx.user.id).maybeSingle();
  return data?.role ?? null;
}

function requireRole(role: string | null, allowed: string[]): ServiceResult<never> | null {
  if (!role || !allowed.includes(role)) return fail('forbidden', 'Moderator access required');
  return null;
}

export async function claimItem(
  ctx: ServiceContext,
  _input: Record<string, never>,
): Promise<ServiceResult<{ redirect: string }>> {
  const role = await getProfileRole(ctx);
  const denied = requireRole(role, ['admin', 'moderator']);
  if (denied) return denied;

  const { data: next } = await ctx.admin
    .from('moderation_queue')
    .select('id, submitter_id')
    .in('status', ['pending', 'escalated'])
    .neq('submitter_id', ctx.user.id)
    .order('created_at', { ascending: true })
    .limit(10);

  if (!next?.length) return ok({ redirect: '/admin/moderering' });

  for (const item of next) {
    const conflict = await hasConflict(ctx.admin, ctx.user.id, item.submitter_id);
    if (conflict) continue;

    const { count: updated } = await ctx.admin
      .from('moderation_queue')
      .update({ assigned_to: ctx.user.id, status: 'assigned' }, { count: 'exact' })
      .eq('id', item.id)
      .in('status', ['pending', 'escalated']);

    if (updated !== 1) continue;
    return ok({ redirect: `/admin/moderering/${item.id}` });
  }

  return ok({ redirect: '/admin/moderering' });
}

export async function reviewItem(
  ctx: ServiceContext,
  input: { queueId: string; decision: string; rejectionReason?: string; internalNotes?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.queueId || !input.decision || !['approve', 'reject', 'escalate'].includes(input.decision)) {
    return fail('bad_input', 'Invalid input');
  }

  const role = await getProfileRole(ctx);
  const denied = requireRole(role, ['admin', 'moderator']);
  if (denied) return denied;

  const { data: qi } = await ctx.admin
    .from('moderation_queue').select('*').eq('id', input.queueId).maybeSingle();

  if (!qi || !['pending', 'assigned', 'escalated'].includes(qi.status)) {
    return fail('not_found', 'Queue item not available');
  }
  if (qi.submitter_id === ctx.user.id) return fail('forbidden', 'Cannot review your own submission');
  if (qi.assigned_to && qi.assigned_to !== ctx.user.id) return fail('forbidden', 'Not assigned to you');

  const { data: modStats } = await ctx.admin
    .from('moderator_stats').select('total_reviews, shadow_overrides')
    .eq('user_id', ctx.user.id).maybeSingle();

  const totalReviews = modStats?.total_reviews ?? 0;
  const isShadow = role === 'moderator' && totalReviews < 50;
  const isSpotCheck = role === 'moderator' && !isShadow && Math.random() < 0.10;

  const now = new Date().toISOString();
  const status = input.decision === 'escalate' ? 'escalated' : input.decision === 'approve' ? 'approved' : 'rejected';

  await ctx.admin.from('moderation_queue').update({
    status, decision_by: ctx.user.id, decision_at: now,
    rejection_reason: input.rejectionReason || null,
    internal_notes: input.internalNotes || null,
    shadow_review: isShadow, spot_check: isSpotCheck,
  }).eq('id', input.queueId);

  await ctx.admin.from('moderation_audit_log').insert({
    actor_id: ctx.user.id,
    action: input.decision === 'escalate' ? 'escalate' : input.decision,
    target_type: qi.item_type, target_id: qi.item_id,
    queue_item_id: input.queueId,
    details: { rejection_reason: input.rejectionReason, notes: input.internalNotes, shadow: isShadow, spot_check: isSpotCheck },
  });

  if (input.decision !== 'escalate') {
    const rate = totalReviews >= 50 && (modStats?.shadow_overrides ?? 0) < 3 ? 2.0 : 1.0;
    await ctx.admin.rpc('upsert_moderator_review', {
      p_user_id: ctx.user.id, p_decision: input.decision, p_rate: rate,
    });
  }

  if (isShadow) return ok({ redirect: '/admin/moderering' });

  const stripeOpts = { stripeSecretKey: ctx.env.STRIPE_SECRET_KEY, createStripe };
  const qiWithReason = { ...qi, rejection_reason: input.rejectionReason || null };
  if (input.decision === 'approve') {
    await applyApproval(ctx.admin, qiWithReason, ctx.user.id, ctx.env, createNotification);
  } else if (input.decision === 'reject') {
    await applyRejection(ctx.admin, qiWithReason, ctx.user.id, ctx.env, createNotification, stripeOpts);
  }

  return ok({ redirect: '/admin/moderering' });
}

export async function shadowConfirm(
  ctx: ServiceContext,
  input: { queueId: string; action: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.queueId || !input.action || !['confirm', 'override'].includes(input.action)) {
    return fail('bad_input', 'Invalid input');
  }

  const role = await getProfileRole(ctx);
  const denied = requireRole(role, ['admin']);
  if (denied) return denied;

  const now = new Date().toISOString();
  const stripeOpts = { stripeSecretKey: ctx.env.STRIPE_SECRET_KEY, createStripe };

  const { data: qi } = await ctx.admin
    .from('moderation_queue').select('*').eq('id', input.queueId)
    .eq('shadow_review', true).is('shadow_confirmed_at', null).maybeSingle();

  if (!qi) return fail('not_found', 'Not found');

  if (input.action === 'confirm') {
    await ctx.admin.from('moderation_queue').update({
      shadow_confirmed_at: now, shadow_confirmed_by: ctx.user.id,
    }).eq('id', input.queueId);

    if (qi.status === 'approved') {
      await applyApproval(ctx.admin, qi, qi.decision_by ?? ctx.user.id, ctx.env, createNotification);
    } else if (qi.status === 'rejected') {
      await applyRejection(ctx.admin, qi, ctx.user.id, ctx.env, createNotification, stripeOpts);
    }
  } else {
    const overriddenStatus = qi.status === 'approved' ? 'rejected' : 'approved';
    await ctx.admin.from('moderation_queue').update({
      status: overriddenStatus, shadow_confirmed_at: now, shadow_confirmed_by: ctx.user.id,
    }).eq('id', input.queueId);

    await ctx.admin.rpc('increment_shadow_overrides', { p_user_id: qi.decision_by });

    if (overriddenStatus === 'approved') {
      await applyApproval(ctx.admin, qi, ctx.user.id, ctx.env, createNotification);
    } else {
      await applyRejection(ctx.admin, qi, ctx.user.id, ctx.env, createNotification, stripeOpts);
    }

    await ctx.admin.from('moderation_audit_log').insert({
      actor_id: ctx.user.id, action: 'shadow_override',
      target_type: qi.item_type, target_id: qi.item_id,
      queue_item_id: input.queueId,
      details: { original: qi.status, overridden_to: overriddenStatus },
    });
  }

  return ok({ redirect: `/admin/moderering/${input.queueId}` });
}

export async function spotCheck(
  ctx: ServiceContext,
  input: { queueId: string; action: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.queueId || !input.action || !['agree', 'disagree'].includes(input.action)) {
    return fail('bad_input', 'Invalid input');
  }

  const role = await getProfileRole(ctx);
  const denied = requireRole(role, ['admin']);
  if (denied) return denied;

  const now = new Date().toISOString();

  const { data: qi } = await ctx.admin
    .from('moderation_queue').select('*').eq('id', input.queueId)
    .eq('spot_check', true).is('spot_check_at', null).maybeSingle();

  if (!qi) return fail('not_found', 'Not found');

  await ctx.admin.from('moderation_queue').update({
    spot_check_at: now, spot_check_by: ctx.user.id,
    spot_check_agreed: input.action === 'agree',
  }).eq('id', input.queueId);

  if (input.action === 'disagree' && qi.decision_by) {
    const { data: stats } = await ctx.admin
      .from('moderator_stats').select('spot_check_disagreements')
      .eq('user_id', qi.decision_by).maybeSingle();
    await ctx.admin.from('moderator_stats').update({
      spot_check_disagreements: (stats?.spot_check_disagreements ?? 0) + 1,
    }).eq('user_id', qi.decision_by);
  }

  await ctx.admin.from('moderation_audit_log').insert({
    actor_id: ctx.user.id,
    action: input.action === 'agree' ? 'spot_check_agree' : 'spot_check_disagree',
    target_type: qi.item_type, target_id: qi.item_id,
    queue_item_id: input.queueId,
    details: { moderator_decision: qi.status },
  });

  return ok({ redirect: `/admin/moderering/${input.queueId}` });
}

export async function resolveReport(
  ctx: ServiceContext,
  input: { reportId: string; action: string; notes?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.reportId || !input.action || !['resolve', 'dismiss'].includes(input.action)) {
    return fail('bad_input', 'Invalid input');
  }

  const role = await getProfileRole(ctx);
  const denied = requireRole(role, ['admin', 'moderator']);
  if (denied) return denied;

  const now = new Date().toISOString();
  await ctx.admin.from('reports').update({
    status: input.action === 'resolve' ? 'resolved' : 'dismissed',
    resolved_by: ctx.user.id, resolved_at: now,
    resolution_notes: input.notes || null,
  }).eq('id', input.reportId);

  await ctx.admin.from('moderation_audit_log').insert({
    actor_id: ctx.user.id, action: `report_${input.action}`,
    target_type: 'report', target_id: input.reportId,
    details: { notes: input.notes },
  });

  return ok({ redirect: '/admin/rapporter' });
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'administrator', moderator: 'moderator', ambassador: 'ambassadør',
};

export async function changeUserRole(
  ctx: ServiceContext,
  input: { userId: string; role: string },
): Promise<ServiceResult<{ redirect: string }>> {
  const VALID_ROLES = ['admin', 'moderator', 'ambassador', ''];
  if (!input.userId || !VALID_ROLES.includes(input.role)) {
    return fail('bad_input', 'Invalid input');
  }

  const role = await getProfileRole(ctx);
  const denied = requireRole(role, ['admin']);
  if (denied) return denied;

  const { data: profile } = await ctx.admin
    .from('profiles').select('role').eq('id', input.userId).single();
  if (!profile) return fail('not_found', 'User not found');

  const newRole = input.role || null;
  await ctx.admin.from('profiles').update({ role: newRole }).eq('id', input.userId);

  await ctx.admin.from('moderation_audit_log').insert({
    actor_id: ctx.user.id,
    action: newRole ? 'role_grant' : 'role_revoke',
    target_type: 'user', target_id: input.userId,
    details: { old_role: profile.role, new_role: newRole },
  });

  if (newRole) {
    await createNotification(ctx.admin, {
      userId: input.userId, type: 'role_changed',
      title: `Du er nå ${ROLE_LABEL[newRole] ?? newRole}!`,
      body: `En administrator har gitt deg rollen som ${ROLE_LABEL[newRole] ?? newRole}.`,
      url: newRole === 'moderator' || newRole === 'admin' ? '/admin' : '/min-side',
      actorId: ctx.user.id,
    }, ctx.env);
  }

  return ok({ redirect: `/admin/brukere/${input.userId}` });
}
