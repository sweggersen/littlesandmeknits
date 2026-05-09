import type { APIRoute } from 'astro';
import { env as cfEnv } from 'cloudflare:workers';
import { createAdminSupabase } from '../../../lib/supabase';
import { createNotification } from '../../../lib/notify';
import { createStripe } from '../../../lib/stripe';

export const POST: APIRoute = async ({ request }) => {
  const env = import.meta.env;
  const secret = request.headers.get('x-cron-secret');
  const expectedSecret = (cfEnv as any).CRON_SECRET ?? env.CRON_SECRET;
  if (!secret || secret !== expectedSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const results = { expired: 0, released: 0, nudged: 0 };

  // 1. Expire open requests older than 30 days with no offers
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: expirable } = await admin
    .from('commission_requests')
    .select('id, buyer_id, title')
    .eq('status', 'open')
    .lt('created_at', thirtyDaysAgo);

  if (expirable?.length) {
    for (const req of expirable) {
      const { count } = await admin
        .from('commission_offers')
        .select('id', { count: 'exact', head: true })
        .eq('request_id', req.id);

      if (count === 0) {
        await admin
          .from('commission_requests')
          .update({ status: 'cancelled' })
          .eq('id', req.id);

        await createNotification(admin, {
          userId: req.buyer_id,
          type: 'request_expired',
          title: 'Forespørselen har utløpt',
          body: `«${req.title}» mottok ingen tilbud innen 30 dager og er nå lukket.`,
          url: `/marked/oppdrag/${req.id}`,
          referenceId: req.id,
        }, env);
        results.expired++;
      }
    }
  }

  // 2. Auto-release completed commissions after 14 days
  const now = new Date().toISOString();
  const { data: releasable } = await admin
    .from('commission_requests')
    .select('id, buyer_id, title, awarded_offer_id, stripe_payment_intent_id')
    .eq('status', 'completed')
    .lt('auto_release_at', now);

  if (releasable?.length) {
    const stripe = createStripe(env.STRIPE_SECRET_KEY);
    for (const req of releasable) {
      if (req.stripe_payment_intent_id) {
        try { await stripe.paymentIntents.capture(req.stripe_payment_intent_id); } catch {}
      }

      await admin
        .from('commission_requests')
        .update({ status: 'delivered', delivered_at: now })
        .eq('id', req.id);

      const { data: offer } = await admin
        .from('commission_offers')
        .select('knitter_id')
        .eq('id', req.awarded_offer_id!)
        .maybeSingle();

      if (offer) {
        await createNotification(admin, {
          userId: offer.knitter_id,
          type: 'commission_delivered',
          title: 'Automatisk levering bekreftet',
          body: `Kjøper svarte ikke innen 14 dager — «${req.title}» er nå merket som levert.`,
          url: `/marked/oppdrag/${req.id}`,
          referenceId: req.id,
        }, env);
      }
      results.released++;
    }
  }

  // 3. Nudge knitters with no project updates in 7+ days
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: stale } = await admin
    .from('commission_requests')
    .select('id, buyer_id, title, awarded_offer_id, last_nudge_sent_at')
    .eq('status', 'awarded');

  if (stale?.length) {
    for (const req of stale) {
      if (req.last_nudge_sent_at && req.last_nudge_sent_at > sevenDaysAgo) continue;

      const { data: offer } = await admin
        .from('commission_offers')
        .select('knitter_id, project_id')
        .eq('id', req.awarded_offer_id!)
        .maybeSingle();

      if (!offer?.project_id) continue;

      const { data: recentLog } = await admin
        .from('project_progress')
        .select('id')
        .eq('project_id', offer.project_id)
        .gte('created_at', sevenDaysAgo)
        .limit(1)
        .maybeSingle();

      if (!recentLog) {
        await createNotification(admin, {
          userId: offer.knitter_id,
          type: 'project_update',
          title: 'Oppdatering påminnelse',
          body: `Kjøper venter på nyheter om «${req.title}». Legg gjerne til en oppdatering!`,
          url: `/studio/prosjekter/${offer.project_id}`,
          referenceId: req.id,
        }, env);

        await admin
          .from('commission_requests')
          .update({ last_nudge_sent_at: now })
          .eq('id', req.id);

        results.nudged++;
      }
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
};
