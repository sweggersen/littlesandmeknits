import type { APIRoute } from 'astro';
import { env as cfEnv } from '../../../lib/env';
import { createAdminSupabase } from '../../../lib/supabase';
import { createNotification } from '../../../lib/notify';
import { createStripe } from '../../../lib/stripe';
import { recalculateTrust } from '../../../lib/trust';
import { checkAndGrantAchievements } from '../../../lib/achievements';
import { sendEmail } from '../../../lib/email';
import { renderDraftNudgeEmail } from '../../../lib/email-templates';
import { isKilled } from '../../../lib/flags';
import { recordDeadLetter } from '../../../lib/services/dead-letter';

export const POST: APIRoute = async ({ request }) => {
  const env = import.meta.env;
  const secret = request.headers.get('x-cron-secret');
  const expectedSecret = (cfEnv as any).CRON_SECRET ?? env.CRON_SECRET;
  const encoder = new TextEncoder();
  const a = encoder.encode(secret ?? '');
  const b = encoder.encode(expectedSecret ?? '');
  // crypto.subtle.timingSafeEqual is a Cloudflare Workers extension --
  // the standard SubtleCrypto type doesn't include it. Cast at the
  // single call site rather than widen the global type.
  const subtleCf = crypto.subtle as unknown as {
    timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): Promise<boolean>;
  };
  if (!secret || a.byteLength !== b.byteLength || !(await subtleCf.timingSafeEqual(a, b))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const results: Record<string, number> = { expired: 0, released: 0, listingsReleased: 0, nudged: 0, reviewsRevealed: 0, trustRecalculated: 0, achievementsGranted: 0, staleShadowAlerts: 0, promotionsExpired: 0, moderationThreadsAutoClosed: 0, userPreferencesRefreshed: 0, promotionDailyWindowsReset: 0, draftsNudged: 0 };

  // One shared timestamp for the whole tick (all the "past-due" comparisons).
  const now = new Date().toISOString();

  // Per-section isolation. PREVIOUSLY a single unhandled throw anywhere in this
  // handler 500'd the entire response — which is exactly what got the prod cron
  // auto-disabled by cron-job.org after 26 consecutive failures, silently
  // halting escrow auto-release, promotion expiry and everything else. Now each
  // section runs independently: a failure is recorded to dead_letter_events AND
  // returned in the response `errors[]` (so the next run's body names the broken
  // section), the remaining sections still run, and the cron returns 200 so it
  // stays enabled. Money-path failures INSIDE a section keep their own
  // finer-grained dead-letters (per-row) as before.
  const errors: Array<{ section: string; error: string }> = [];
  async function runSection(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      errors.push({ section: name, error: e instanceof Error ? e.message : String(e) });
      try {
        await recordDeadLetter({ admin }, {
          service: `cron.run:${name}`,
          context: { section: name },
          error: e,
        });
      } catch {
        // Dead-letter is best-effort — never let it mask the section error.
      }
    }
  }

  // Refresh the user_preferences materialized view powering the
  // promoted-pool ranker. Cheap (CONCURRENTLY) and safe to call every tick.
  await runSection('refresh_user_preferences', async () => {
    const { error } = await admin.rpc('refresh_user_preferences');
    if (!error) results.userPreferencesRefreshed = 1;
    else console.error('refresh_user_preferences failed', error);
  });

  // Reset promotion daily impression counters for windows older than 24h.
  await runSection('reset_promotion_daily_windows', async () => {
    const { data, error } = await admin.rpc('reset_promotion_daily_windows');
    if (!error) results.promotionDailyWindowsReset = (data as number) ?? 0;
    else console.error('reset_promotion_daily_windows failed', error);
  });

  // Nudge stale photo-less drafts. One-shot per listing.
  await runSection('draft_nudge', async () => {
    const apiKey = (cfEnv as any).RESEND_API_KEY ?? env.RESEND_API_KEY;
    const siteUrl = (cfEnv as any).PUBLIC_SITE_URL ?? env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
    if (apiKey) {
      const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data: staleDrafts } = await admin
        .from('listings')
        .select('id, seller_id, title')
        .eq('status', 'draft')
        .is('draft_nudge_sent_at', null)
        .lt('created_at', cutoff)
        .limit(50);

      for (const draft of staleDrafts ?? []) {
        // Skip drafts that already have photos — they're just unpublished, not stuck.
        const { count: photoCount } = await admin
          .from('listing_photos')
          .select('id', { count: 'exact', head: true })
          .eq('listing_id', draft.id);
        if ((photoCount ?? 0) > 0) {
          await admin.from('listings').update({ draft_nudge_sent_at: new Date().toISOString() }).eq('id', draft.id);
          continue;
        }

        const { data: profile } = await admin
          .from('profiles')
          .select('display_name')
          .eq('id', draft.seller_id)
          .maybeSingle();

        const { data: sellerAuth } = await admin.auth.admin.getUserById(draft.seller_id);
        const toEmail = sellerAuth?.user?.email;
        if (!toEmail) {
          await admin.from('listings').update({ draft_nudge_sent_at: new Date().toISOString() }).eq('id', draft.id);
          continue;
        }

        const { subject, html } = renderDraftNudgeEmail({
          name: profile?.display_name,
          listingTitle: draft.title,
          listingId: draft.id,
          siteUrl,
        });
        const sent = await sendEmail(apiKey, { to: toEmail, subject, html });
        await admin.from('listings').update({ draft_nudge_sent_at: new Date().toISOString() }).eq('id', draft.id);
        if (sent) results.draftsNudged++;
      }
    }
  });

  // 0. Expire listing promotions
  await runSection('expire_promotions', async () => {
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
          .update({ promoted_until: null, promotion_tier: null, promoted_at: null })
          .eq('id', promo.listing_id);

        results.promotionsExpired++;
      }
    }
  });

  // 1. Expire open requests older than 30 days with no offers
  await runSection('expire_requests', async () => {
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
            url: `/market/commissions/${req.id}`,
            referenceId: req.id,
          }, env);
          results.expired++;
        }
      }
    }
  });

  // Escrow auto-release moves money to sellers. While payouts are paused
  // (kill-switch), skip both release passes entirely — the rows keep their
  // past-due auto_release_at and are picked up on the next tick once resumed.
  await runSection('auto_release', async () => {
    const payoutsPaused = await isKilled('payouts', cfEnv as unknown as Record<string, string>);
    if (payoutsPaused) {
      results.payoutsPaused = 1;
      return;
    }

    // 2. Auto-release completed commissions after 14 days
    const { data: releasable } = await admin
      .from('commission_requests')
      .select('id, buyer_id, title, awarded_offer_id, stripe_payment_intent_id')
      .eq('status', 'completed')
      .lt('auto_release_at', now);

    if (releasable?.length) {
      const stripe = createStripe(env.STRIPE_SECRET_KEY);
      for (const req of releasable) {
        let commissionCaptured = true;
        if (req.stripe_payment_intent_id) {
          try {
            await stripe.paymentIntents.capture(req.stripe_payment_intent_id);
          } catch (e) {
            // Don't mark delivered if we couldn't capture — leave auto_release_at
            // in the past so the next tick retries, and dead-letter so support
            // sees the stuck escrow rather than it being silently dropped.
            commissionCaptured = false;
            await recordDeadLetter({ admin, user: req.buyer_id ? { id: req.buyer_id } : undefined }, {
              service: 'cron.auto_release:commission_capture',
              context: { commission_request_id: req.id, payment_intent_id: req.stripe_payment_intent_id },
              error: e,
            });
          }
        }
        if (!commissionCaptured) continue;

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
            url: `/market/commissions/${req.id}`,
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
        let listingCaptured = true;
        if (listing.stripe_payment_intent_id) {
          try {
            await stripe.paymentIntents.capture(listing.stripe_payment_intent_id);
          } catch (e) {
            // Leave the row releasable (auto_release_at untouched) for the next
            // tick and dead-letter so a failed capture isn't silently dropped.
            listingCaptured = false;
            await recordDeadLetter({ admin, user: listing.seller_id ? { id: listing.seller_id } : undefined }, {
              service: 'cron.auto_release:listing_capture',
              context: { listing_id: listing.id, payment_intent_id: listing.stripe_payment_intent_id },
              error: e,
            });
          }
        }
        if (!listingCaptured) continue;
        await admin.from('listings').update({
          status: 'sold', sold_at: now, delivered_at: now, auto_release_at: null,
        }).eq('id', listing.id);

        if (listing.seller_id) {
          await createNotification(admin, {
            userId: listing.seller_id,
            type: 'listing_delivered',
            title: 'Automatisk levering bekreftet',
            body: `Kjøper svarte ikke innen 14 dager — «${listing.title}» er nå merket som levert.`,
            url: `/market/listing/${listing.id}`,
            referenceId: listing.id,
          }, env);
        }
        results.listingsReleased++;
      }
    }
  });

  // 4. Nudge knitters with no project updates in 7+ days
  await runSection('knitter_nudge', async () => {
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

        // project_progress was renamed to project_logs at some point;
        // the cron was reading a non-existent table and silently
        // never finding recent logs (so it always nudged).
        const { data: recentLog } = await admin
          .from('project_logs')
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
            url: `/studio/projects/${offer.project_id}`,
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
  });

  // 4. Reveal reviews after review deadline (both parties visible even if one didn't submit)
  await runSection('reveal_reviews', async () => {
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
  });

  // 5. Recalculate trust scores for recently active users (buyers + knitters)
  await runSection('trust_recalc', async () => {
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
      // One user's trust/achievements failure shouldn't abort the rest.
      try {
        await recalculateTrust(admin, uid);
        const newAchievements = await checkAndGrantAchievements(admin, uid, env);
        results.trustRecalculated++;
        results.achievementsGranted += newAchievements.length;
      } catch (e) {
        await recordDeadLetter({ admin, user: { id: uid } }, {
          service: 'cron.trust_recalc:per_user',
          context: { user_id: uid },
          error: e,
        });
      }
    }
  });

  // 6. Alert admins about stale shadow reviews (> 48h without confirmation)
  await runSection('shadow_alerts', async () => {
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
          url: '/admin/moderation',
        }, env);
      }
      results.staleShadowAlerts = staleShadows.length;
    }
  });

  // 7. Auto-close moderation threads when the recipient hasn't replied
  // within 48 hours of the last moderator message. The item stays frozen
  // — non-response is treated as concession on a valid report.
  await runSection('autoclose_threads', async () => {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
    const { data: staleThreads } = await admin
      .from('moderation_threads')
      .select('id, target_type, target_id, recipient_id')
      .eq('status', 'open')
      .lt('updated_at', fortyEightHoursAgo);

    for (const t of staleThreads ?? []) {
      const { data: lastMsg } = await admin
        .from('moderation_messages')
        .select('is_moderator, sender_id')
        .eq('thread_id', t.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastMsg || !lastMsg.is_moderator) continue; // recipient replied last → don't auto-close

      await admin.from('moderation_threads').update({
        status: 'closed', closed_at: now,
      }).eq('id', t.id);

      await admin.from('reports').update({
        status: 'resolved', resolved_at: now,
      }).eq('target_type', t.target_type)
        .eq('target_id', t.target_id)
        .eq('status', 'open');

      await admin.from('moderation_messages').insert({
        thread_id: t.id,
        sender_id: lastMsg.sender_id,
        is_moderator: true,
        body: 'Saken er automatisk avsluttet fordi det ikke kom svar innen 48 timer. Elementet forblir frosset. Kontakt moderatorteamet hvis du vil ta opp saken igjen.',
      });

      await createNotification(admin, {
        userId: t.recipient_id,
        type: 'moderation_message',
        title: 'Saken er avsluttet (ingen svar)',
        body: 'Vi mottok ikke svar innen 48 timer. Elementet forblir frosset.',
        url: `/market/moderasjon/${t.id}`,
      }, env);

      // moderation_audit_log.actor_id is NOT NULL in the schema, so
      // system-initiated actions log under a sentinel uuid. The detail
      // payload tells you it was the cron run.
      await admin.from('moderation_audit_log').insert({
        actor_id: '00000000-0000-0000-0000-000000000000',
        action: 'thread_auto_close_no_reply',
        target_type: 'moderation_thread', target_id: t.id,
        details: { target_type: t.target_type, target_id: t.target_id, reason: 'no_reply_48h' },
      });

      results.moderationThreadsAutoClosed++;
    }
  });

  // Always 200 (even with section errors) so cron-job.org keeps the job
  // enabled; `ok:false` + `errors[]` flag a degraded run for monitoring.
  return new Response(JSON.stringify({ ok: errors.length === 0, results, errors }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
