import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCurrentUser } from '../../../lib/auth';
import { createAdminSupabase } from '../../../lib/supabase';

const ADMINS = ['ammon.weggersen@gmail.com', 'sam.mathias.weggersen@gmail.com'];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyAdminToken(token: string): Promise<boolean> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(env.SUPABASE_SERVICE_ROLE_KEY);
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  for (const date of [now, yesterday]) {
    const day = date.toISOString().slice(0, 10);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`admin-tower-${day}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig))).slice(0, 43);
    if (token === expected) return true;
  }
  return false;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (import.meta.env.PROD) return json({ ok: false, error: 'Not available' }, 403);

  const host = new URL(request.url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.workers.dev')) {
    return json({ ok: false, error: 'Not available in production' }, 403);
  }

  const adminToken = request.headers.get('X-Admin-Token');
  if (adminToken) {
    if (!(await verifyAdminToken(adminToken))) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }
  } else {
    const user = await getCurrentUser({ request, cookies });
    if (!user || !ADMINS.includes(user.email ?? '')) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'Service role key not configured' }, 503);
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const { action, actor, params = {} } = await request.json();

  const { data: { users: allUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailToId = new Map<string, string>();
  for (const u of allUsers ?? []) {
    if (u.email?.endsWith('@test.strikketorget.no')) emailToId.set(u.email, u.id);
  }

  async function ensureTestUser(email: string) {
    if (!email.endsWith('@test.strikketorget.no') || emailToId.has(email)) return;
    const name = email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { display_name: name },
    });
    if (createErr) throw new Error(`Could not create test user ${email}: ${createErr.message}`);
    if (created.user) {
      emailToId.set(email, created.user.id);
      await admin.from('profiles').upsert({ id: created.user.id, display_name: name }, { onConflict: 'id' });
    }
  }

  if (actor) await ensureTestUser(actor);
  if (Array.isArray(params.user_emails)) {
    for (const email of params.user_emails) await ensureTestUser(email);
  }

  const actorId = actor ? emailToId.get(actor) ?? null : null;
  if (actor && !actorId) return json({ ok: false, error: `Unknown user: ${actor}` }, 400);

  try {
    const result = await handle(admin, action, actorId, params, emailToId);
    return json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('test-exec error:', msg);
    return json({ ok: false, error: msg }, 500);
  }
};

async function handle(
  db: ReturnType<typeof createAdminSupabase>,
  action: string,
  actorId: string | null,
  p: Record<string, unknown>,
  emailToId: Map<string, string>,
) {
  switch (action) {
    // ── Commission flow ───────────────────────────────

    case 'create-request': {
      if (!actorId) throw new Error('Actor required');
      const { data, error } = await db.from('commission_requests').insert({
        buyer_id: actorId,
        title: p.title ?? 'Test-oppdrag',
        category: p.category ?? 'genser',
        size_label: p.size_label ?? '2 år',
        budget_nok_min: p.budget_nok_min ?? 800,
        budget_nok_max: p.budget_nok_max ?? 1500,
        description: p.description ?? 'Testoppdrag fra kontrollpanelet.',
        yarn_provided_by_buyer: p.yarn_provided_by_buyer ?? false,
        target_knitter_id: p.target_knitter_id ?? null,
        needed_by: p.needed_by ?? null,
        colorway: p.colorway ?? null,
        yarn_preference: p.yarn_preference ?? null,
        status: 'open',
        offer_count: 0,
      }).select().single();
      if (error) throw error;
      return { data };
    }

    case 'make-offer': {
      if (!actorId) throw new Error('Actor required');
      const { data, error } = await db.from('commission_offers').insert({
        request_id: p.request_id,
        knitter_id: actorId,
        price_nok: p.price_nok ?? 1200,
        turnaround_weeks: p.turnaround_weeks ?? 3,
        message: p.message ?? 'Jeg kan strikke dette for deg!',
        status: 'pending',
      }).select().single();
      if (error) throw error;

      const { data: req } = await db.from('commission_requests')
        .select('buyer_id, title')
        .eq('id', p.request_id)
        .single();
      if (req) {
        await db.from('notifications').insert({
          user_id: req.buyer_id,
          type: 'new_offer',
          title: `Nytt tilbud på «${req.title}»`,
          body: `${p.price_nok ?? 1200} kr — ${p.turnaround_weeks ?? 3} uker`,
          url: `/marked/oppdrag/${p.request_id}`,
          actor_id: actorId,
          reference_id: data.id,
        });
      }
      return { data };
    }

    case 'accept-offer': {
      if (!actorId) throw new Error('Actor required');
      const { data: offer } = await db.from('commission_offers')
        .select('id, request_id, knitter_id, price_nok')
        .eq('id', p.offer_id)
        .single();
      if (!offer) throw new Error('Offer not found');

      const { data: req } = await db.from('commission_requests')
        .select('id, title, buyer_id')
        .eq('id', offer.request_id)
        .single();
      if (!req) throw new Error('Request not found');

      await db.from('commission_offers')
        .update({ status: 'accepted' })
        .eq('id', p.offer_id);

      const { data: declined } = await db.from('commission_offers')
        .update({ status: 'declined' })
        .eq('request_id', offer.request_id)
        .neq('id', p.offer_id as string)
        .eq('status', 'pending')
        .select('knitter_id');

      await db.from('commission_requests')
        .update({ status: 'awaiting_payment', awarded_offer_id: p.offer_id })
        .eq('id', offer.request_id);

      await db.from('notifications').insert({
        user_id: offer.knitter_id,
        type: 'offer_accepted',
        title: 'Tilbudet ditt ble akseptert!',
        body: `«${req.title}» — ${offer.price_nok} kr`,
        url: `/marked/oppdrag/${offer.request_id}`,
        actor_id: actorId,
        reference_id: p.offer_id,
      });

      for (const d of declined ?? []) {
        await db.from('notifications').insert({
          user_id: d.knitter_id,
          type: 'offer_declined',
          title: 'Tilbudet ditt ble avslått',
          body: `«${req.title}»`,
          url: `/marked/oppdrag/${offer.request_id}`,
          actor_id: actorId,
        });
      }

      return { data: { offerId: p.offer_id, declined: declined?.length ?? 0 } };
    }

    case 'pay': {
      if (!actorId) throw new Error('Actor required');
      const { data: req } = await db.from('commission_requests')
        .select('*, commission_offers!commission_requests_awarded_offer_fkey(knitter_id, price_nok)')
        .eq('id', p.request_id)
        .single();
      if (!req) throw new Error('Request not found');

      const offer = (req as any).commission_offers;
      if (!offer) throw new Error('No awarded offer');

      const nextStatus = req.yarn_provided_by_buyer ? 'awaiting_yarn' : 'awarded';

      await db.from('commission_requests')
        .update({
          status: nextStatus,
          stripe_payment_intent_id: 'pi_test_' + Date.now(),
          platform_fee_nok: Math.round(offer.price_nok * 0.13),
        })
        .eq('id', p.request_id);

      const projectStatus = req.yarn_provided_by_buyer ? 'planning' : 'active';
      const { data: project } = await db.from('projects').insert({
        user_id: offer.knitter_id,
        title: req.title,
        status: projectStatus,
        target_size: req.size_label,
        yarn: req.yarn_preference,
        summary: req.description,
        commission_offer_id: req.awarded_offer_id,
      }).select().single();

      await db.from('notifications').insert({
        user_id: offer.knitter_id,
        type: 'payment_received',
        title: `Betaling mottatt for «${req.title}»`,
        body: `${offer.price_nok} kr`,
        url: `/marked/oppdrag/${p.request_id}`,
        actor_id: actorId,
        reference_id: p.request_id as string,
      });

      return { data: { status: nextStatus, project } };
    }

    case 'ship-yarn': {
      if (!actorId) throw new Error('Actor required');
      await db.from('commission_requests')
        .update({
          yarn_shipped_at: new Date().toISOString(),
          yarn_tracking_code: p.tracking_code ?? 'TEST-TRACK-001',
        })
        .eq('id', p.request_id);

      const { data: req } = await db.from('commission_requests')
        .select('title, commission_offers!commission_requests_awarded_offer_fkey(knitter_id)')
        .eq('id', p.request_id)
        .single();

      const knitterId = (req as any)?.commission_offers?.knitter_id;
      if (knitterId) {
        await db.from('notifications').insert({
          user_id: knitterId,
          type: 'yarn_shipped',
          title: 'Garnet er sendt!',
          body: p.tracking_code ? `Sporing: ${p.tracking_code}` : 'Ingen sporingskode.',
          url: `/marked/oppdrag/${p.request_id}`,
          actor_id: actorId,
        });
      }

      return { data: { shipped: true } };
    }

    case 'receive-yarn': {
      if (!actorId) throw new Error('Actor required');
      await db.from('commission_requests')
        .update({ status: 'awarded', yarn_received_at: new Date().toISOString() })
        .eq('id', p.request_id);

      const { data: req } = await db.from('commission_requests')
        .select('title, buyer_id, awarded_offer_id')
        .eq('id', p.request_id)
        .single();

      if (req?.awarded_offer_id) {
        await db.from('projects')
          .update({ status: 'active', started_at: new Date().toISOString().slice(0, 10) })
          .eq('commission_offer_id', req.awarded_offer_id);
      }

      if (req) {
        await db.from('notifications').insert({
          user_id: req.buyer_id,
          type: 'yarn_received',
          title: 'Strikkeren har mottatt garnet',
          body: `«${req.title}»`,
          url: `/marked/oppdrag/${p.request_id}`,
          actor_id: actorId,
        });
      }

      return { data: { status: 'awarded' } };
    }

    case 'mark-completed': {
      if (!actorId) throw new Error('Actor required');
      const autoRelease = new Date();
      autoRelease.setDate(autoRelease.getDate() + 14);

      await db.from('commission_requests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          auto_release_at: autoRelease.toISOString(),
        })
        .eq('id', p.request_id);

      const { data: req } = await db.from('commission_requests')
        .select('title, buyer_id')
        .eq('id', p.request_id)
        .single();

      if (req) {
        await db.from('notifications').insert({
          user_id: req.buyer_id,
          type: 'commission_completed',
          title: 'Oppdraget er ferdig!',
          body: `«${req.title}» — bekreft mottak innen 14 dager.`,
          url: `/marked/oppdrag/${p.request_id}`,
          actor_id: actorId,
        });
      }

      return { data: { status: 'completed' } };
    }

    case 'confirm-delivery': {
      if (!actorId) throw new Error('Actor required');
      await db.from('commission_requests')
        .update({ status: 'delivered', delivered_at: new Date().toISOString() })
        .eq('id', p.request_id);

      const { data: req } = await db.from('commission_requests')
        .select('title, commission_offers!commission_requests_awarded_offer_fkey(knitter_id)')
        .eq('id', p.request_id)
        .single();

      const knitterId = (req as any)?.commission_offers?.knitter_id;
      if (knitterId) {
        await db.from('notifications').insert({
          user_id: knitterId,
          type: 'commission_delivered',
          title: 'Levering bekreftet!',
          body: `«${req?.title}» — pengene frigis.`,
          url: `/marked/oppdrag/${p.request_id}`,
          actor_id: actorId,
        });
      }

      return { data: { status: 'delivered' } };
    }

    // ── Listing & messaging ──────────────────────────

    case 'create-listing': {
      if (!actorId) throw new Error('Actor required');
      const { data, error } = await db.from('listings').insert({
        seller_id: actorId,
        kind: p.kind ?? 'pre_loved',
        title: p.title ?? 'Test-annonse',
        category: p.category ?? 'genser',
        size_label: p.size_label ?? '2 år',
        price_nok: p.price_nok ?? 249,
        condition: p.condition ?? 'lite_brukt',
        description: p.description ?? 'Testannonse fra kontrollpanelet.',
        status: 'draft',
      }).select().single();
      if (error) throw error;
      return { data };
    }

    case 'publish-listing': {
      const { error } = await db.from('listings')
        .update({ status: 'active' })
        .eq('id', p.listing_id);
      if (error) throw error;
      return { data: { status: 'active' } };
    }

    case 'send-message': {
      if (!actorId) throw new Error('Actor required');
      const { data: listing } = await db.from('listings')
        .select('seller_id, title')
        .eq('id', p.listing_id)
        .single();
      if (!listing) throw new Error('Listing not found');

      const { data: existing } = await db.from('marketplace_conversations')
        .select('id')
        .eq('listing_id', p.listing_id as string)
        .eq('buyer_id', actorId)
        .maybeSingle();

      let convId: string;
      if (existing) {
        convId = existing.id;
      } else {
        const { data: conv, error } = await db.from('marketplace_conversations').insert({
          listing_id: p.listing_id,
          buyer_id: actorId,
          seller_id: listing.seller_id,
        }).select().single();
        if (error) throw error;
        convId = conv.id;
      }

      const { data: msg, error } = await db.from('marketplace_messages').insert({
        conversation_id: convId,
        sender_id: actorId,
        body: p.message ?? 'Hei! Er denne fortsatt tilgjengelig?',
      }).select().single();
      if (error) throw error;

      await db.from('notifications').insert({
        user_id: listing.seller_id,
        type: 'new_message',
        title: 'Ny melding',
        body: `Om «${listing.title}»`,
        url: `/marked/meldinger/${convId}`,
        actor_id: actorId,
      });

      return { data: { conversationId: convId, message: msg } };
    }

    case 'reply': {
      if (!actorId) throw new Error('Actor required');
      const { data: conv } = await db.from('marketplace_conversations')
        .select('buyer_id, seller_id, listing_id, listings!inner(title)')
        .eq('id', p.conversation_id)
        .single();

      const { data: msg, error } = await db.from('marketplace_messages').insert({
        conversation_id: p.conversation_id,
        sender_id: actorId,
        body: p.message ?? 'Takk for meldingen!',
      }).select().single();
      if (error) throw error;

      if (conv) {
        const recipientId = actorId === conv.buyer_id ? conv.seller_id : conv.buyer_id;
        await db.from('notifications').insert({
          user_id: recipientId,
          type: 'new_message',
          title: 'Ny melding',
          body: `Om «${(conv as any).listings?.title}»`,
          url: `/marked/meldinger/${p.conversation_id}`,
          actor_id: actorId,
        });
      }

      return { data: { message: msg } };
    }

    // ── Moderation flow ────────────────────────────────

    case 'set-role': {
      if (!actorId) throw new Error('Actor required');
      const role = p.role || null;
      await db.from('profiles').update({ role }).eq('id', actorId);
      return { data: { role, user_id: actorId } };
    }

    case 'set-trust': {
      if (!actorId) throw new Error('Actor required');
      await db.from('profiles').update({
        trust_score: p.trust_score ?? 0,
        trust_tier: p.trust_tier ?? 'new',
        total_completed_transactions: p.total_completed_transactions ?? 0,
        total_rejections: p.total_rejections ?? 0,
      }).eq('id', actorId);
      return { data: { trust_score: p.trust_score, trust_tier: p.trust_tier, user_id: actorId } };
    }

    case 'set-mod-stats': {
      if (!actorId) throw new Error('Actor required');
      const { data: existing } = await db.from('moderator_stats')
        .select('user_id').eq('user_id', actorId).maybeSingle();

      const stats = {
        total_reviews: p.total_reviews ?? 0,
        total_approvals: p.total_approvals ?? 0,
        total_rejections: p.total_rejections ?? 0,
        shadow_overrides: p.shadow_overrides ?? 0,
        current_month_reviews: p.current_month_reviews ?? 0,
        current_month_earned_nok: p.current_month_earned_nok ?? 0,
        total_earned_nok: p.total_earned_nok ?? 0,
        rate_nok_per_review: p.rate_nok_per_review ?? 1.00,
      };

      if (existing) {
        await db.from('moderator_stats').update(stats).eq('user_id', actorId);
      } else {
        await db.from('moderator_stats').insert({ user_id: actorId, ...stats });
      }
      return { data: { ...stats, user_id: actorId } };
    }

    case 'create-listing-moderated': {
      if (!actorId) throw new Error('Actor required');
      const { data: listing, error } = await db.from('listings').insert({
        seller_id: actorId,
        kind: p.kind ?? 'pre_loved',
        title: p.title ?? 'Test-annonse',
        category: p.category ?? 'genser',
        size_label: p.size_label ?? '2 år',
        price_nok: p.price_nok ?? 249,
        condition: p.condition ?? 'lite_brukt',
        description: p.description ?? 'Testannonse for moderering.',
        status: 'pending_review',
      }).select().single();
      if (error) throw error;

      const { data: qi, error: qError } = await db.from('moderation_queue').insert({
        item_type: 'listing',
        item_id: listing.id,
        submitter_id: actorId,
      }).select().single();
      if (qError) throw qError;

      return { data: { ...listing, queue_item_id: qi.id } };
    }

    case 'create-request-moderated': {
      if (!actorId) throw new Error('Actor required');
      const { data: req, error } = await db.from('commission_requests').insert({
        buyer_id: actorId,
        title: p.title ?? 'Test-oppdrag',
        category: p.category ?? 'genser',
        size_label: p.size_label ?? '2 år',
        budget_nok_min: p.budget_nok_min ?? 800,
        budget_nok_max: p.budget_nok_max ?? 1500,
        description: p.description ?? 'Testoppdrag for moderering.',
        status: 'pending_review',
        offer_count: 0,
      }).select().single();
      if (error) throw error;

      const { data: qi, error: qError } = await db.from('moderation_queue').insert({
        item_type: 'commission_request',
        item_id: req.id,
        submitter_id: actorId,
      }).select().single();
      if (qError) throw qError;

      return { data: { ...req, queue_item_id: qi.id } };
    }

    case 'moderate-review': {
      if (!actorId) throw new Error('Actor required');
      const decision = String(p.decision);
      if (!['approve', 'reject', 'escalate'].includes(decision)) throw new Error('Invalid decision');

      const { data: qi } = await db.from('moderation_queue')
        .select('*').eq('id', p.queue_item_id).single();
      if (!qi) throw new Error('Queue item not found');

      if (qi.submitter_id === actorId) throw new Error('Cannot review own submission');

      const { data: modStats } = await db.from('moderator_stats')
        .select('total_reviews, shadow_overrides')
        .eq('user_id', actorId).maybeSingle();
      const totalReviews = modStats?.total_reviews ?? 0;
      const isShadow = totalReviews < 50;
      const forceSpotCheck = !!p.force_spot_check;
      const isSpotCheck = !isShadow && (forceSpotCheck || Math.random() < 0.10);

      const now = new Date().toISOString();
      const status = decision === 'escalate' ? 'escalated' : decision === 'approve' ? 'approved' : 'rejected';

      await db.from('moderation_queue').update({
        status,
        decision_by: actorId,
        decision_at: now,
        rejection_reason: p.rejection_reason ?? null,
        internal_notes: p.internal_notes ?? null,
        shadow_review: isShadow,
        spot_check: isSpotCheck,
      }).eq('id', p.queue_item_id);

      await db.from('moderation_audit_log').insert({
        actor_id: actorId,
        action: decision,
        target_type: qi.item_type,
        target_id: qi.item_id,
        queue_item_id: String(p.queue_item_id),
        details: { shadow: isShadow, spot_check: isSpotCheck },
      });

      if (decision !== 'escalate') {
        const rate = totalReviews >= 50 && (modStats?.shadow_overrides ?? 0) < 3 ? 2.0 : 1.0;
        const { data: existing } = await db.from('moderator_stats')
          .select('user_id').eq('user_id', actorId).maybeSingle();

        if (existing) {
          await db.from('moderator_stats').update({
            total_reviews: totalReviews + 1,
            [`total_${decision === 'approve' ? 'approvals' : 'rejections'}`]: ((modStats as any)?.[`total_${decision === 'approve' ? 'approvals' : 'rejections'}`] ?? 0) + 1,
            current_month_reviews: (modStats as any)?.current_month_reviews + 1 || 1,
            current_month_earned_nok: ((modStats as any)?.current_month_earned_nok ?? 0) + rate,
            total_earned_nok: ((modStats as any)?.total_earned_nok ?? 0) + rate,
            rate_nok_per_review: rate,
            last_review_at: now,
          }).eq('user_id', actorId);
        } else {
          await db.from('moderator_stats').insert({
            user_id: actorId,
            total_reviews: 1,
            total_approvals: decision === 'approve' ? 1 : 0,
            total_rejections: decision === 'reject' ? 1 : 0,
            current_month_reviews: 1,
            current_month_earned_nok: rate,
            total_earned_nok: rate,
            rate_nok_per_review: rate,
            last_review_at: now,
          });
        }
      }

      if (!isShadow && decision === 'approve') {
        if (qi.item_type === 'listing') {
          await db.from('listings').update({
            status: 'active', published_at: now, reviewed_at: now, reviewed_by: actorId,
          }).eq('id', qi.item_id);
        } else {
          await db.from('commission_requests').update({
            status: 'open', reviewed_at: now, reviewed_by: actorId,
          }).eq('id', qi.item_id);
        }
      }

      if (!isShadow && decision === 'reject') {
        if (qi.item_type === 'listing') {
          await db.from('listings').update({
            status: 'rejected', moderation_notes: p.rejection_reason ?? null,
            reviewed_at: now, reviewed_by: actorId,
          }).eq('id', qi.item_id);
        } else {
          await db.from('commission_requests').update({
            status: 'rejected', moderation_notes: p.rejection_reason ?? null,
            reviewed_at: now, reviewed_by: actorId,
          }).eq('id', qi.item_id);
        }
        await db.from('profiles').update({
          total_rejections: (await db.from('profiles').select('total_rejections').eq('id', qi.submitter_id).single()).data?.total_rejections + 1 || 1,
        }).eq('id', qi.submitter_id);
      }

      return { data: { status, shadow_review: isShadow, spot_check: isSpotCheck, queue_item_id: p.queue_item_id } };
    }

    case 'shadow-confirm': {
      if (!actorId) throw new Error('Actor required');
      const confirmAction = String(p.action);
      if (!['confirm', 'override'].includes(confirmAction)) throw new Error('Invalid action');

      const now = new Date().toISOString();

      const { data: qi } = await db.from('moderation_queue')
        .select('*').eq('id', p.queue_item_id)
        .eq('shadow_review', true).is('shadow_confirmed_at', null).single();
      if (!qi) throw new Error('Shadow queue item not found');

      if (confirmAction === 'confirm') {
        await db.from('moderation_queue').update({
          shadow_confirmed_at: now, shadow_confirmed_by: actorId,
        }).eq('id', p.queue_item_id);

        if (qi.status === 'approved') {
          if (qi.item_type === 'listing') {
            await db.from('listings').update({
              status: 'active', published_at: now, reviewed_at: now, reviewed_by: qi.decision_by,
            }).eq('id', qi.item_id);
          } else {
            await db.from('commission_requests').update({
              status: 'open', reviewed_at: now, reviewed_by: qi.decision_by,
            }).eq('id', qi.item_id);
          }
        } else if (qi.status === 'rejected') {
          if (qi.item_type === 'listing') {
            await db.from('listings').update({
              status: 'rejected', reviewed_at: now, reviewed_by: qi.decision_by,
            }).eq('id', qi.item_id);
          } else {
            await db.from('commission_requests').update({
              status: 'rejected', reviewed_at: now, reviewed_by: qi.decision_by,
            }).eq('id', qi.item_id);
          }
        }

        await db.from('moderation_audit_log').insert({
          actor_id: actorId, action: 'shadow_confirm',
          target_type: qi.item_type, target_id: qi.item_id,
          queue_item_id: String(p.queue_item_id),
        });
      } else {
        const overriddenStatus = qi.status === 'approved' ? 'rejected' : 'approved';
        await db.from('moderation_queue').update({
          status: overriddenStatus,
          shadow_confirmed_at: now, shadow_confirmed_by: actorId,
          shadow_decision_overridden: true,
        }).eq('id', p.queue_item_id);

        if (qi.decision_by) {
          const { data: ms } = await db.from('moderator_stats')
            .select('shadow_overrides').eq('user_id', qi.decision_by).maybeSingle();
          await db.from('moderator_stats').update({
            shadow_overrides: (ms?.shadow_overrides ?? 0) + 1,
          }).eq('user_id', qi.decision_by);
        }

        if (overriddenStatus === 'approved') {
          if (qi.item_type === 'listing') {
            await db.from('listings').update({
              status: 'active', published_at: now, reviewed_at: now, reviewed_by: actorId,
            }).eq('id', qi.item_id);
          } else {
            await db.from('commission_requests').update({
              status: 'open', reviewed_at: now, reviewed_by: actorId,
            }).eq('id', qi.item_id);
          }
        } else {
          if (qi.item_type === 'listing') {
            await db.from('listings').update({
              status: 'rejected', reviewed_at: now, reviewed_by: actorId,
            }).eq('id', qi.item_id);
          } else {
            await db.from('commission_requests').update({
              status: 'rejected', reviewed_at: now, reviewed_by: actorId,
            }).eq('id', qi.item_id);
          }
        }

        await db.from('moderation_audit_log').insert({
          actor_id: actorId, action: 'shadow_override',
          target_type: qi.item_type, target_id: qi.item_id,
          queue_item_id: String(p.queue_item_id),
          details: { original: qi.status, overridden_to: overriddenStatus },
        });
      }

      return { data: { action: confirmAction, queue_item_id: p.queue_item_id } };
    }

    case 'spot-check-review': {
      if (!actorId) throw new Error('Actor required');
      const agrees = p.agrees === true;
      const now = new Date().toISOString();

      await db.from('moderation_queue').update({
        spot_check_at: now, spot_check_by: actorId, spot_check_agreed: agrees,
      }).eq('id', p.queue_item_id);

      if (!agrees) {
        const { data: qi } = await db.from('moderation_queue')
          .select('decision_by').eq('id', p.queue_item_id).single();
        if (qi?.decision_by) {
          const { data: ms } = await db.from('moderator_stats')
            .select('spot_check_disagreements').eq('user_id', qi.decision_by).maybeSingle();
          await db.from('moderator_stats').update({
            spot_check_disagreements: (ms?.spot_check_disagreements ?? 0) + 1,
          }).eq('user_id', qi.decision_by);
        }
      }

      await db.from('moderation_audit_log').insert({
        actor_id: actorId,
        action: agrees ? 'spot_check_agree' : 'spot_check_disagree',
        target_type: 'moderation_queue', target_id: String(p.queue_item_id),
        queue_item_id: String(p.queue_item_id),
      });

      return { data: { agreed: agrees } };
    }

    case 'submit-report': {
      if (!actorId) throw new Error('Actor required');
      const { data, error } = await db.from('reports').insert({
        reporter_id: actorId,
        target_type: p.target_type ?? 'listing',
        target_id: p.target_id,
        reason: p.reason ?? 'scam',
        description: p.description ?? null,
      }).select().single();
      if (error) throw error;
      return { data };
    }

    case 'resolve-report': {
      if (!actorId) throw new Error('Actor required');
      const now = new Date().toISOString();
      await db.from('reports').update({
        status: p.dismiss ? 'dismissed' : 'resolved',
        resolved_by: actorId,
        resolved_at: now,
        resolution_notes: p.notes ?? null,
      }).eq('id', p.report_id);

      await db.from('moderation_audit_log').insert({
        actor_id: actorId,
        action: p.dismiss ? 'report_dismiss' : 'report_resolve',
        target_type: 'report', target_id: String(p.report_id),
      });

      return { data: { resolved: true } };
    }

    case 'submit-tx-review': {
      if (!actorId) throw new Error('Actor required');
      const { data: req } = await db.from('commission_requests')
        .select('buyer_id').eq('id', p.commission_request_id).single();
      if (!req) throw new Error('Commission not found');

      const { data: offer } = await db.from('commission_offers')
        .select('knitter_id').eq('request_id', p.commission_request_id as string)
        .eq('status', 'accepted').maybeSingle();
      if (!offer) throw new Error('No accepted offer');

      const isBuyer = actorId === req.buyer_id;
      const revieweeId = isBuyer ? offer.knitter_id : req.buyer_id;

      const { data, error } = await db.from('transaction_reviews').insert({
        commission_request_id: p.commission_request_id,
        reviewer_id: actorId,
        reviewee_id: revieweeId,
        reviewer_role: isBuyer ? 'buyer' : 'knitter',
        rating: p.rating ?? 5,
        comment: p.comment ?? null,
      }).select().single();
      if (error) throw error;

      return { data };
    }

    case 'generate-payouts': {
      if (!actorId) throw new Error('Actor required');
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

      const { data: stats } = await db.from('moderator_stats')
        .select('user_id, current_month_reviews, current_month_earned_nok')
        .gt('current_month_reviews', 0);

      if (!stats?.length) return { data: { count: 0 } };

      const payouts = stats.map(s => ({
        moderator_id: s.user_id,
        period_start: periodStart,
        period_end: periodEnd,
        review_count: s.current_month_reviews,
        amount_nok: s.current_month_earned_nok,
        status: 'pending',
      }));

      const { data: inserted } = await db.from('moderator_payouts').insert(payouts).select('id');
      return { data: { count: payouts.length, total_nok: payouts.reduce((s, p) => s + p.amount_nok, 0), first_payout_id: inserted?.[0]?.id } };
    }

    case 'mark-payout-paid': {
      await db.from('moderator_payouts').update({
        status: 'paid', paid_at: new Date().toISOString(),
      }).eq('id', p.payout_id);
      return { data: { paid: true } };
    }

    // ── State inspection ─────────────────────────────

    case 'get-state': {
      const result: Record<string, unknown> = {};

      if (p.request_id) {
        const { data: req } = await db.from('commission_requests')
          .select('*')
          .eq('id', p.request_id)
          .single();
        result.request = req;

        if (req) {
          const { data: offers } = await db.from('commission_offers')
            .select('id, knitter_id, price_nok, turnaround_weeks, message, status, created_at, profiles!commission_offers_knitter_id_fkey(display_name)')
            .eq('request_id', p.request_id as string)
            .order('created_at');
          result.offers = offers;

          if (req.awarded_offer_id) {
            const { data: project } = await db.from('projects')
              .select('id, title, status, started_at, finished_at')
              .eq('commission_offer_id', req.awarded_offer_id)
              .maybeSingle();
            result.project = project;
          }
        }
      }

      if (p.listing_id) {
        const { data: listing } = await db.from('listings')
          .select('*')
          .eq('id', p.listing_id)
          .single();
        result.listing = listing;

        const { data: convos } = await db.from('marketplace_conversations')
          .select('id, buyer_id, created_at, marketplace_messages(id, sender_id, body, created_at)')
          .eq('listing_id', p.listing_id as string)
          .order('created_at', { ascending: false });
        result.conversations = convos;
      }

      if (p.queue_item_id) {
        const { data: qi } = await db.from('moderation_queue')
          .select('*').eq('id', p.queue_item_id).maybeSingle();
        result.queue_item = qi;
      }

      if (p.include_queue) {
        const { data: queue } = await db.from('moderation_queue')
          .select('*').order('created_at', { ascending: false }).limit(20);
        result.queue = queue;
      }

      if (p.include_mod_stats && Array.isArray(p.user_emails)) {
        const modStats: Record<string, unknown> = {};
        for (const email of p.user_emails as string[]) {
          const uid = emailToId.get(email);
          if (!uid) continue;
          const { data } = await db.from('moderator_stats')
            .select('*').eq('user_id', uid).maybeSingle();
          if (data) modStats[email] = data;
        }
        result.mod_stats = modStats;
      }

      if (p.include_reports) {
        const { data: reports } = await db.from('reports')
          .select('*').order('created_at', { ascending: false }).limit(20);
        result.reports = reports;
      }

      if (p.include_tx_reviews && p.request_id) {
        const { data: reviews } = await db.from('transaction_reviews')
          .select('*').eq('commission_request_id', p.request_id as string);
        result.tx_reviews = reviews;
      }

      if (p.include_payouts) {
        const { data: payouts } = await db.from('moderator_payouts')
          .select('*').order('created_at', { ascending: false }).limit(20);
        result.payouts = payouts;
      }

      if (p.include_profiles && Array.isArray(p.user_emails)) {
        const profiles: Record<string, unknown> = {};
        for (const email of p.user_emails as string[]) {
          const uid = emailToId.get(email);
          if (!uid) continue;
          const { data } = await db.from('profiles')
            .select('id, display_name, role, trust_score, trust_tier, total_completed_transactions, total_rejections')
            .eq('id', uid).maybeSingle();
          if (data) profiles[email] = data;
        }
        result.profiles = profiles;
      }

      if (Array.isArray(p.user_emails)) {
        const notifs: Record<string, unknown[]> = {};
        for (const email of p.user_emails as string[]) {
          const uid = emailToId.get(email);
          if (!uid) continue;
          const { data } = await db.from('notifications')
            .select('id, type, title, body, url, read_at, created_at')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(20);
          notifs[email] = data ?? [];
        }
        result.notifications = notifs;
      }

      return { data: result };
    }

    // ── Cleanup ──────────────────────────────────────

    case 'cleanup': {
      const testUserIds = [...emailToId.entries()]
        .filter(([e]) => e.endsWith('@test.strikketorget.no'))
        .map(([, id]) => id);

      if (testUserIds.length === 0) return { data: { cleaned: true, deleted: 0 } };

      // Find all commission requests by test users
      const { data: testRequests } = await db.from('commission_requests')
        .select('id, awarded_offer_id')
        .in('buyer_id', testUserIds);

      for (const req of testRequests ?? []) {
        if (req.awarded_offer_id) {
          await db.from('projects').delete().eq('commission_offer_id', req.awarded_offer_id);
        }
        await db.from('commission_offers').delete().eq('request_id', req.id);
        await db.from('notifications').delete().eq('reference_id', req.id);
        await db.from('commission_requests').delete().eq('id', req.id);
      }

      // Find all offers by test knitters (on non-test requests)
      const { data: testOffers } = await db.from('commission_offers')
        .select('id')
        .in('knitter_id', testUserIds);
      for (const o of testOffers ?? []) {
        await db.from('notifications').delete().eq('reference_id', o.id);
      }
      await db.from('commission_offers').delete().in('knitter_id', testUserIds);

      // Projects owned by test users
      await db.from('project_logs').delete().in('user_id', testUserIds);
      await db.from('projects').delete().in('user_id', testUserIds);

      // Listings + conversations
      const { data: testListings } = await db.from('listings')
        .select('id')
        .in('seller_id', testUserIds);
      for (const l of testListings ?? []) {
        const { data: convos } = await db.from('marketplace_conversations')
          .select('id')
          .eq('listing_id', l.id);
        for (const c of convos ?? []) {
          await db.from('marketplace_messages').delete().eq('conversation_id', c.id);
        }
        await db.from('marketplace_conversations').delete().eq('listing_id', l.id);
      }
      await db.from('listings').delete().in('seller_id', testUserIds);

      // Conversations started by test buyers
      const { data: buyerConvos } = await db.from('marketplace_conversations')
        .select('id')
        .in('buyer_id', testUserIds);
      for (const c of buyerConvos ?? []) {
        await db.from('marketplace_messages').delete().eq('conversation_id', c.id);
      }
      await db.from('marketplace_conversations').delete().in('buyer_id', testUserIds);

      // Moderation data for test users
      await db.from('moderation_audit_log').delete().in('actor_id', testUserIds);
      await db.from('moderator_payouts').delete().in('moderator_id', testUserIds);
      await db.from('moderator_stats').delete().in('user_id', testUserIds);
      await db.from('reports').delete().in('reporter_id', testUserIds);
      await db.from('transaction_reviews').delete().in('reviewer_id', testUserIds);

      // Queue items submitted by or decided by test users
      await db.from('moderation_queue').delete().in('submitter_id', testUserIds);
      await db.from('moderation_queue').delete().in('decision_by', testUserIds);

      // Reset roles and trust for test users
      await db.from('profiles').update({
        role: null, trust_score: 0, trust_tier: 'new',
        total_completed_transactions: 0, total_rejections: 0,
      }).in('id', testUserIds);

      // All notifications for test users
      for (const uid of testUserIds) {
        await db.from('notifications').delete().eq('user_id', uid);
      }

      const total = (testRequests?.length ?? 0) + (testOffers?.length ?? 0) + (testListings?.length ?? 0);
      return { data: { cleaned: true, deleted: total } };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
