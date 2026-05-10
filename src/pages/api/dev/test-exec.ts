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

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user || !ADMINS.includes(user.email ?? '')) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'Service role key not configured' }, 503);
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const { action, actor, params = {} } = await request.json();

  const { data: { users: allUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailToId = new Map<string, string>();
  for (const u of allUsers ?? []) {
    if (u.email) emailToId.set(u.email, u.id);
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
        .select('buyer_id, title, offer_count')
        .eq('id', p.request_id)
        .single();
      if (req) {
        await db.from('commission_requests')
          .update({ offer_count: (req.offer_count ?? 0) + 1 })
          .eq('id', p.request_id);
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

      const { data: project } = await db.from('projects').insert({
        user_id: offer.knitter_id,
        title: req.title,
        status: 'planning',
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
      if (Array.isArray(p.request_ids)) {
        for (const id of p.request_ids as string[]) {
          const { data: req } = await db.from('commission_requests')
            .select('awarded_offer_id')
            .eq('id', id)
            .maybeSingle();

          if (req?.awarded_offer_id) {
            await db.from('projects').delete().eq('commission_offer_id', req.awarded_offer_id);
          }

          const { data: offers } = await db.from('commission_offers')
            .select('id')
            .eq('request_id', id);
          for (const o of offers ?? []) {
            await db.from('notifications').delete().eq('reference_id', o.id);
          }

          await db.from('commission_offers').delete().eq('request_id', id);
          await db.from('notifications').delete().eq('reference_id', id);
          await db.from('commission_requests').delete().eq('id', id);
        }
      }

      if (Array.isArray(p.listing_ids)) {
        for (const id of p.listing_ids as string[]) {
          const { data: convos } = await db.from('marketplace_conversations')
            .select('id')
            .eq('listing_id', id);
          for (const c of convos ?? []) {
            await db.from('marketplace_messages').delete().eq('conversation_id', c.id);
            await db.from('notifications').delete().eq('url', `/marked/meldinger/${c.id}`);
          }
          await db.from('marketplace_conversations').delete().eq('listing_id', id);
          await db.from('listings').delete().eq('id', id);
        }
      }

      if (p.clean_notifications) {
        const testIds = [...emailToId.entries()]
          .filter(([e]) => e.endsWith('@test.strikketorget.no'))
          .map(([, id]) => id);
        for (const uid of testIds) {
          await db.from('notifications').delete().eq('user_id', uid);
        }
      }

      return { data: { cleaned: true } };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
