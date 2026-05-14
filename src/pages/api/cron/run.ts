import type { APIRoute } from 'astro';
import { env as cfEnv } from 'cloudflare:workers';
import { createAdminSupabase } from '../../../lib/supabase';
import { createNotification } from '../../../lib/notify';
import { createStripe } from '../../../lib/stripe';
import { recalculateTrust } from '../../../lib/trust';
import { checkAndGrantAchievements } from '../../../lib/achievements';

export const POST: APIRoute = async ({ request }) => {
  const env = import.meta.env;
  const secret = request.headers.get('x-cron-secret');
  const expectedSecret = (cfEnv as any).CRON_SECRET ?? env.CRON_SECRET;
  const encoder = new TextEncoder();
  const a = encoder.encode(secret ?? '');
  const b = encoder.encode(expectedSecret ?? '');
  if (!secret || a.byteLength !== b.byteLength || !(await crypto.subtle.timingSafeEqual(a, b))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const results: Record<string, number> = { expired: 0, released: 0, listingsReleased: 0, nudged: 0, reviewsRevealed: 0, trustRecalculated: 0, achievementsGranted: 0, staleShadowAlerts: 0, promotionsExpired: 0 };

  // 0. Expire listing promotions
  const { data: expiredPromos } = await admin
    .from('listing_promotions')
    .select('id, listing_id')
    .eq('status', 'active')
    .lt('ends_at', now);

  if (expiredPromos?.length) {
    for (const promo of expiredPromos) {
      await admin
        .from('listing_promotions')
        .update({ status: 'expired' })
        .eq('id', promo.id);

      await admin
        .from('listings')
        .update({ promoted_until: null, promotion_tier: null })
        .eq('id', promo.listing_id);

      results.promotionsExpired++;
    }
  }

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
        try {
          await stripe.paymentIntents.capture(req.stripe_payment_intent_id);
        } catch (e) {
          console.error(`Stripe capture failed for PI ${req.stripe_payment_intent_id}`, e);
        }
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

  // 3. Auto-release listing purchases after 14 days
  const { data: releasableListings } = await admin
    .from('listings')
    .select('id, seller_id, title, stripe_payment_intent_id')
    .in('status', ['reserved', 'shipped'])
    .lt('auto_release_at', now);

  if (releasableListings?.length) {
    const stripe = createStripe(env.STRIPE_SECRET_KEY);
    for (const listing of releasableListings) {
      if (listing.stripe_payment_intent_id) {
        try {
          await stripe.paymentIntents.capture(listing.stripe_payment_intent_id);
        } catch (e) {
          console.error(`Stripe capture failed for listing PI ${listing.stripe_payment_intent_id}`, e);
        }
      }
      await admin.from('listings').update({
        status: 'sold', sold_at: now, delivered_at: now, auto_release_at: null,
      }).eq('id', listing.id);

      if (listing.seller_id) {
        await createNotification(admin, {
          userId: listing.seller_id,
          type: 'listing_delivered',
          title: 'Automatisk levering bekreftet',
          body: `Kjøper svarte ikke innen 14 dager — «${listing.title}» er nå merket som levert.`,
          url: `/marked/listing/${listing.id}`,
          referenceId: listing.id,
        }, env);
      }
      results.listingsReleased++;
    }
  }

  // 4. Nudge knitters with no project updates in 7+ days
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

  // 4. Reveal reviews after review deadline (both parties visible even if one didn't submit)
  const { data: pastDeadline } = await admin
    .from('commission_requests')
    .select('id')
    .eq('status', 'delivered')
    .lt('review_deadline_at', now)
    .not('review_deadline_at', 'is', null);

  if (pastDeadline?.length) {
    for (const req of pastDeadline) {
      const { data: reviews } = await admin
        .from('transaction_reviews')
        .select('id, visible')
        .eq('commission_request_id', req.id)
        .eq('visible', false);

      if (reviews?.length) {
        await admin
          .from('transaction_reviews')
          .update({ visible: true })
          .eq('commission_request_id', req.id);
        results.reviewsRevealed += reviews.length;
      }
    }

    await admin
      .from('commission_requests')
      .update({ review_deadline_at: null })
      .in('id', pastDeadline.map(r => r.id));
  }

  // 5. Recalculate trust scores for recently active users (buyers + knitters)
  const oneDayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ data: recentBuyers }, { data: recentKnitters }] = await Promise.all([
    admin.from('commission_requests').select('buyer_id').gte('updated_at', oneDayAgo).limit(50),
    admin.from('commission_offers').select('knitter_id').gte('updated_at', oneDayAgo).limit(50),
  ]);

  const activeUserIds = [...new Set([
    ...(recentBuyers ?? []).map(r => r.buyer_id),
    ...(recentKnitters ?? []).map(r => r.knitter_id),
  ])];
  for (const uid of activeUserIds) {
    await recalculateTrust(admin, uid);
    const newAchievements = await checkAndGrantAchievements(admin, uid, env);
    results.trustRecalculated++;
    results.achievementsGranted += newAchievements.length;
  }

  // 6. Alert admins about stale shadow reviews (> 48h without confirmation)
  const twoDaysAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
  const { data: staleShadows } = await admin
    .from('moderation_queue')
    .select('id')
    .eq('shadow_review', true)
    .is('shadow_confirmed_at', null)
    .lt('created_at', twoDaysAgo)
    .in('status', ['approved', 'rejected']);

  if (staleShadows?.length) {
    const { data: admins } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'admin');

    for (const a of admins ?? []) {
      await createNotification(admin, {
        userId: a.id,
        type: 'moderation_assigned',
        title: `${staleShadows.length} skyggevurdering${staleShadows.length === 1 ? '' : 'er'} venter`,
        body: 'Skyggevurderinger har ventet over 48 timer på bekreftelse.',
        url: '/admin/moderering',
      }, env);
    }
    results.staleShadowAlerts = staleShadows.length;
  }

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
};
