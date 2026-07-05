import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createNotification } from '../notify';
import { createStripe } from '../stripe';
import { insertQueueItem } from '../moderation';
import { VALID_CATEGORIES } from '../labels';
import { bookShipment, getTracking as bringGetTracking } from '../bring';
import { recordDeadLetter } from './dead-letter';
import { recordPaymentEvent } from './payment-events';
import { assertWithinQuota } from './quota';
import { killGuard } from '../flags';
import { MoneyBreakdown } from '../money';

const toIntOrNull = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** How many commissions this knitter has carried to `delivered`. Two plain
 *  eq/in queries (no join) so it works against the fake-db in tests too. */
export async function knitterCompletedCount(
  db: ServiceContext['supabase'],
  knitterId: string,
): Promise<number> {
  const { data: offers } = await db
    .from('commission_offers')
    .select('request_id')
    .eq('knitter_id', knitterId)
    .eq('status', 'accepted');
  const ids = (offers ?? []).map((o) => o.request_id).filter(Boolean);
  if (!ids.length) return 0;
  const { data: reqs } = await db
    .from('commission_requests')
    .select('id')
    .in('id', ids)
    .eq('status', 'delivered');
  return reqs?.length ?? 0;
}

export async function createRequest(
  ctx: ServiceContext,
  input: {
    title: string; category: string; sizeLabel: string;
    budgetNokMin: string; budgetNokMax: string;
    description?: string; colorway?: string; patternExternalTitle?: string;
    yarnPreference?: string; yarnProvidedByBuyer: boolean; neededBy?: string;
    sizeAgeMonthsMin?: string; sizeAgeMonthsMax?: string; targetKnitterId?: string;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  const title = input.title.trim();
  if (!title) return fail('bad_input', 'Title required');
  if (!VALID_CATEGORIES.has(input.category)) return fail('bad_input', 'Invalid category');
  const sizeLabel = input.sizeLabel.trim();
  if (!sizeLabel) return fail('bad_input', 'Size required');

  const budgetNokMin = toIntOrNull(input.budgetNokMin);
  const budgetNokMax = toIntOrNull(input.budgetNokMax);
  if (budgetNokMin === null || budgetNokMax === null) return fail('bad_input', 'Budget required');
  if (budgetNokMax < budgetNokMin) return fail('bad_input', 'Max budget must exceed minimum');

  // Daily quota — prevents bot floods.
  const quotaFail = await assertWithinQuota(ctx, 'commission_request_create');
  if (quotaFail) return quotaFail;

  const { data: buyerProfile } = await ctx.supabase
    .from('profiles').select('trust_tier').eq('id', ctx.user.id).maybeSingle();
  const autoApprove = buyerProfile?.trust_tier === 'trusted';

  const { data, error } = await ctx.admin
    .from('commission_requests')
    .insert({
      buyer_id: ctx.user.id,
      title,
      description: input.description?.trim() || null,
      category: input.category as 'cardigan' | 'lue' | 'bukser' | 'sokker' | 'genser' | 'teppe' | 'votter' | 'kjole' | 'annet',
      size_label: sizeLabel,
      size_age_months_min: toIntOrNull(input.sizeAgeMonthsMin),
      size_age_months_max: toIntOrNull(input.sizeAgeMonthsMax),
      colorway: input.colorway?.trim() || null,
      pattern_external_title: input.patternExternalTitle?.trim() || null,
      yarn_preference: input.yarnPreference?.trim() || null,
      yarn_provided_by_buyer: input.yarnProvidedByBuyer,
      budget_nok_min: budgetNokMin,
      budget_nok_max: budgetNokMax,
      needed_by: input.neededBy || null,
      target_knitter_id: input.targetKnitterId?.trim() || null,
      status: autoApprove ? 'open' : 'pending_review',
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Commission request create failed', JSON.stringify(error));
    return fail('server_error', `Could not create request: ${error?.message ?? 'unknown'}`);
  }

  if (!autoApprove) {
    await insertQueueItem(ctx.admin, 'commission_request', data.id, ctx.user.id);
  }

  return ok({ redirect: `/market/commissions/${data.id}` });
}

export async function makeOffer(
  ctx: ServiceContext,
  input: { requestId: string; priceNok: string; turnaroundWeeks: string; message: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.requestId) return fail('bad_input', 'Missing request ID');

  const priceNok = parseInt(input.priceNok, 10);
  if (!Number.isFinite(priceNok) || priceNok <= 0) return fail('bad_input', 'Invalid price');

  const turnaroundWeeks = parseInt(input.turnaroundWeeks, 10);
  if (!Number.isFinite(turnaroundWeeks) || turnaroundWeeks <= 0) return fail('bad_input', 'Invalid lead time');

  const message = input.message.trim();
  if (!message) return fail('bad_input', 'Message required');

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status, title, yarn_provided_by_buyer')
    .eq('id', input.requestId)
    .maybeSingle();

  if (!req || req.status !== 'open') return fail('bad_input', 'Request not open');
  if (req.buyer_id === ctx.user.id) return fail('bad_input', 'Cannot bid on own request');

  // Fraud control (P0.3): the buyer ships physical yarn to the knitter, which
  // the platform can't insure. Only let a PROVEN knitter (≥1 completed
  // commission) bid on a buyer-yarn request, so the buyer can only ever award
  // one with a track record. New knitters build trust on platform-sourced yarn.
  if (req.yarn_provided_by_buyer) {
    const completed = await knitterCompletedCount(ctx.supabase, ctx.user.id);
    if (completed < 1) {
      return fail('conflict', 'Du må fullføre minst ett oppdrag før du kan ta oppdrag der kjøper sender eget garn.');
    }
  }

  // Daily quota — prevents an attacker from flooding offers on a
  // popular request. 20/day is generous for any genuine knitter.
  const quotaFail = await assertWithinQuota(ctx, 'commission_offer_make');
  if (quotaFail) return quotaFail;

  const { error } = await ctx.supabase
    .from('commission_offers')
    .insert({ request_id: input.requestId, knitter_id: ctx.user.id, price_nok: priceNok, turnaround_weeks: turnaroundWeeks, message });

  if (error) {
    if (error.code === '23505') return fail('conflict', 'Already submitted an offer');
    console.error('Offer create failed', error);
    return fail('server_error', 'Could not submit offer');
  }

  await createNotification(ctx.admin, {
    userId: req.buyer_id, type: 'new_offer',
    title: 'Nytt tilbud!',
    body: `Noen har gitt tilbud på «${req.title}» — ${priceNok} kr, ${turnaroundWeeks} uker.`,
    url: `/market/commissions/${input.requestId}`,
    actorId: ctx.user.id, referenceId: input.requestId,
  }, ctx.env);

  return ok({ redirect: `/market/commissions/${input.requestId}` });
}

/** Ensures a Project exists for the accepted offer and that the offer
 *  row points at it. Used by both `acceptOffer` (on buyer accept,
 *  status='planning') and `payCommission` (on payment, status='active').
 *
 *  - Idempotent: if offer.project_id already points at a project, only
 *    a status bump is performed when `startActive` is true.
 *  - Failure is soft: lands in dead_letter_events so support can
 *    manually link / create. The parent operation isn't rolled back.
 *  - Returns the project id (or null on failure).
 */
async function ensureCommissionProject(
  ctx: ServiceContext,
  args: {
    offer: { id: string; knitter_id: string; project_id: string | null };
    req: {
      buyer_id: string; title: string;
      description?: string | null;
      size_label?: string | null;
      yarn_preference?: string | null;
      pattern_external_title?: string | null;
      colorway?: string | null;
    };
    startActive: boolean;
    serviceLabel: string;
  },
): Promise<string | null> {
  // Already linked — just flip status if the payment path is calling.
  if (args.offer.project_id) {
    if (args.startActive) {
      await ctx.admin
        .from('projects')
        .update({ status: 'active', started_at: new Date().toISOString() })
        .eq('id', args.offer.project_id);
    }
    return args.offer.project_id;
  }

  const { data: buyerProfile } = await ctx.admin
    .from('profiles').select('display_name').eq('id', args.req.buyer_id).maybeSingle();
  const recipientLabel = (buyerProfile as { display_name?: string } | null)?.display_name ?? null;

  const insertFields: {
    user_id: string;
    title: string;
    summary: string | null;
    recipient: string | null;
    target_size: string | null;
    yarn: string | null;
    pattern_external: string | null;
    status: 'active' | 'planning';
    commission_offer_id: string;
    started_at?: string;
  } = {
    user_id: args.offer.knitter_id,
    title: args.req.title,
    summary: args.req.description ?? null,
    recipient: recipientLabel,
    target_size: args.req.size_label ?? null,
    yarn: args.req.yarn_preference ?? null,
    pattern_external: args.req.pattern_external_title ?? null,
    status: args.startActive ? 'active' : 'planning',
    commission_offer_id: args.offer.id,
  };
  if (args.startActive) insertFields.started_at = new Date().toISOString();

  const { data: project, error: projErr } = await ctx.admin
    .from('projects')
    .insert(insertFields)
    .select('id')
    .single();

  if (projErr || !project) {
    await recordDeadLetter(ctx, {
      service: args.serviceLabel,
      context: {
        offer_id: args.offer.id,
        knitter_id: args.offer.knitter_id,
        buyer_id: args.req.buyer_id,
      },
      error: projErr ?? new Error('insert returned no row'),
    });
    return null;
  }

  await ctx.admin
    .from('commission_offers')
    .update({ project_id: project.id })
    .eq('id', args.offer.id);
  return project.id;
}

export async function acceptOffer(
  ctx: ServiceContext,
  input: { offerId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.offerId) return fail('bad_input', 'Missing offer ID');

  const { data: offer } = await ctx.supabase
    .from('commission_offers')
    .select('id, request_id, status, knitter_id, project_id')
    .eq('id', input.offerId)
    .maybeSingle();

  if (!offer) return fail('not_found', 'Offer not found');

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status, title, description, category, size_label, yarn_preference, pattern_external_title')
    .eq('id', offer.request_id)
    .single();

  if (!req || req.buyer_id !== ctx.user.id) return fail('forbidden', 'Not your request');
  if (req.status !== 'open' || offer.status !== 'pending') return fail('bad_input', 'Cannot accept this offer');

  await ctx.supabase.from('commission_offers').update({ status: 'accepted' }).eq('id', input.offerId);
  await ctx.supabase.from('commission_requests').update({ status: 'awaiting_payment', awarded_offer_id: input.offerId }).eq('id', offer.request_id);

  // Auto-create the linked project (shared with the buyer once payment
  // lands). Starts in 'planning'; payCommission flips it to 'active'.
  await ensureCommissionProject(ctx, {
    offer,
    req,
    startActive: false,
    serviceLabel: 'commissions.acceptOffer:project-create',
  });

  const { data: declined } = await ctx.supabase
    .from('commission_offers')
    .update({ status: 'declined' })
    .eq('request_id', offer.request_id)
    .eq('status', 'pending')
    .neq('id', input.offerId)
    .select('knitter_id');

  await createNotification(ctx.admin, {
    userId: offer.knitter_id, type: 'offer_accepted',
    title: 'Tilbudet ditt er akseptert!',
    body: `Kjøper valgte tilbudet ditt på «${req.title}». Vi har laget et prosjekt for deg i Strikkestua. Venter nå på betaling.`,
    url: `/market/commissions/${offer.request_id}`,
    actorId: ctx.user.id, referenceId: offer.request_id,
  }, ctx.env);

  if (declined?.length) {
    await Promise.all(
      declined.map((d) =>
        createNotification(ctx.admin, {
          userId: d.knitter_id, type: 'offer_declined',
          title: 'Tilbudet ble ikke valgt',
          body: `Kjøper valgte et annet tilbud på «${req.title}».`,
          url: `/market/commissions/${offer.request_id}`,
          actorId: ctx.user.id, referenceId: offer.request_id,
        }, ctx.env),
      ),
    );
  }

  return ok({ redirect: `/market/commissions/${offer.request_id}` });
}

export async function withdrawOffer(
  ctx: ServiceContext,
  input: { offerId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.offerId) return fail('bad_input', 'Missing offer ID');

  const { data: offer } = await ctx.supabase
    .from('commission_offers')
    .select('id, request_id, knitter_id, status')
    .eq('id', input.offerId)
    .maybeSingle();

  if (!offer || offer.knitter_id !== ctx.user.id) return fail('forbidden', 'Not your offer');
  if (offer.status !== 'pending') return fail('bad_input', 'Can only withdraw pending offers');

  await ctx.supabase.from('commission_offers').update({ status: 'withdrawn' }).eq('id', input.offerId);

  return ok({ redirect: `/market/commissions/${offer.request_id}` });
}

export async function cancelCommission(
  ctx: ServiceContext,
  input: { requestId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.requestId) return fail('bad_input', 'Missing request ID');

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status')
    .eq('id', input.requestId)
    .maybeSingle();

  if (!req || req.buyer_id !== ctx.user.id) return fail('forbidden', 'Not your request');
  if (req.status !== 'open') return fail('bad_input', 'Can only cancel open requests');

  await ctx.supabase.from('commission_requests').update({ status: 'cancelled' }).eq('id', input.requestId);
  await ctx.supabase.from('commission_offers').update({ status: 'declined' }).eq('request_id', input.requestId).eq('status', 'pending');

  return ok({ redirect: '/market/commissions/my-listings' });
}

// Commission ("Strikk for meg") platform fee, per terms §5: flat 8 % of the
// agreed price, paid by the BUYER on top of the quote. The knitter keeps 100%.
// Pure helpers live in ../commission-pricing (importable by Astro components);
// re-exported here for back-compat with existing importers.
export { COMMISSION_FEE_PERCENT, commissionFeeNok } from '../commission-pricing';

export async function payCommission(
  ctx: ServiceContext,
  input: { requestId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.requestId) return fail('bad_input', 'Missing request ID');
  const blocked = await killGuard(['purchases', 'commissions'], ctx.env);
  if (blocked) return blocked;

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status, awarded_offer_id, title, category, size_label, colorway, yarn_preference, pattern_external_title, yarn_provided_by_buyer')
    .eq('id', input.requestId)
    .single();

  if (!req || req.buyer_id !== ctx.user.id) return fail('forbidden', 'Not your request');
  if (req.status !== 'awaiting_payment') return fail('bad_input', 'Request not awaiting payment');

  const { data: offer } = await ctx.supabase
    .from('commission_offers')
    .select('id, knitter_id, price_nok')
    .eq('id', req.awarded_offer_id!)
    .single();

  if (!offer) return fail('not_found', 'Offer not found');

  const { data: knitterSeller } = await ctx.admin
    .from('seller_profiles')
    .select('stripe_account_id, stripe_connect_status')
    .eq('id', offer.knitter_id)
    .maybeSingle();

  // The knitter must be able to receive payouts before we collect money.
  if (knitterSeller?.stripe_connect_status !== 'verified' || !knitterSeller.stripe_account_id) {
    return fail('conflict', 'Strikkeren har ikke fullført oppsett av utbetaling ennå.');
  }

  // Buyer pays the knitter's quote PLUS the platform fee on top (knitter keeps
  // 100%). All money math is assembled + validated by the money authority.
  const money = MoneyBreakdown.commissionPayment({ priceNok: offer.price_nok });
  const platformFee = money.platformFeeOre;

  const siteUrl = ctx.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);

  // Separate charges & transfers (H2b): a knit takes weeks but a manual-capture
  // auth dies in ~7 days, so we charge the buyer IN FULL now (automatic
  // capture, no transfer_data — funds land in the PLATFORM balance and sit
  // there as real escrow) and transfer the knitter's share via
  // releaseCommissionFunds when the work is delivered/auto-released. Refunds
  // before release are plain refunds from the platform balance. The
  // post-payment side-effects (status, project activation, notify) run in the
  // stripe webhook (type=commission_payment) once Stripe confirms payment —
  // NOT here, so an abandoned checkout leaves the request untouched.
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: money
      .lineItems({ item: `Strikk for meg: ${req.title}`, fee: 'Strikketorget-gebyr (trygg betaling)' })
      .map((li) => ({ price_data: { currency: 'nok' as const, unit_amount: li.amountOre, product_data: { name: li.name } }, quantity: 1 })),
    payment_method_types: ['vipps' as 'card', 'card'],
    success_url: `${siteUrl}/market/commissions/${input.requestId}?paid=1`,
    cancel_url: `${siteUrl}/market/commissions/${input.requestId}`,
    customer_email: ctx.user.email ?? undefined,
    client_reference_id: ctx.user.id,
    metadata: {
      type: 'commission_payment',
      commission_request_id: input.requestId,
      buyer_id: ctx.user.id,
      platform_fee_ore: String(platformFee),
    },
    locale: 'nb',
  });

  if (!session.url) return fail('server_error', 'Checkout URL missing');
  return ok({ redirect: session.url });
}

/** Release a paid commission's funds to the knitter when the work is
 *  delivered (buyer confirm, cron auto-release, or admin dispute release).
 *
 *  Handles both payment rails:
 *   - NEW (separate charges & transfers): the PI was auto-captured into the
 *     platform balance at payment (buyer paid price + fee); transfer the FULL
 *     price to the knitter's account, tied to the original charge via
 *     source_transaction, and retain the fee. The Stripe idempotency key (per request) makes a
 *     buyer-click/cron race yield ONE transfer.
 *   - LEGACY (manual-capture destination charge): requires_capture → capture
 *     (Stripe routes via the PI's transfer_data); already-succeeded
 *     destination charges have nothing left to do.
 *
 *  Returns released=false (with a dead-letter) when the money state is wrong
 *  (e.g. auth expired before the rail switch) — callers must NOT mark the
 *  commission delivered in that case. */
export async function releaseCommissionFunds(
  admin: ServiceContext['admin'],
  stripeSecretKey: string,
  input: { requestId: string; paymentIntentId: string; knitterId: string; priceNok: number },
): Promise<{ released: boolean; reason?: string }> {
  const stripe = createStripe(stripeSecretKey);
  const pi = await stripe.paymentIntents.retrieve(input.paymentIntentId);

  if (pi.status === 'requires_capture') {
    // Legacy rail: capture routes the funds via the PI's transfer_data.
    await stripe.paymentIntents.capture(input.paymentIntentId);
    return { released: true };
  }

  if (pi.status === 'succeeded') {
    if (pi.transfer_data) return { released: true }; // legacy, already routed

    const { data: knitterSeller } = await admin
      .from('seller_profiles')
      .select('stripe_account_id')
      .eq('id', input.knitterId)
      .maybeSingle();
    if (!knitterSeller?.stripe_account_id) {
      await recordDeadLetter({ admin }, {
        service: 'commissions.releaseCommissionFunds:no-payout-account',
        context: { commission_request_id: input.requestId, knitter_id: input.knitterId },
        error: 'Knitter has no Stripe account id at release time',
      });
      return { released: false, reason: 'no_payout_account' };
    }

    // The buyer paid price + fee; transfer the FULL price (sellerCredit) to the
    // knitter and retain the fee. Money math via the validated authority.
    const money = MoneyBreakdown.commissionPayment({ priceNok: input.priceNok });
    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
    const transfer = await stripe.transfers.create({
      amount: money.sellerCreditOre,
      currency: 'nok',
      destination: knitterSeller.stripe_account_id,
      // Draw against the original charge's funds (not the general balance).
      ...(chargeId ? { source_transaction: chargeId } : {}),
      transfer_group: `commission_${input.requestId}`,
      metadata: { commission_request_id: input.requestId, platform_fee_ore: String(money.platformFeeOre) },
    }, {
      // One transfer per commission, even if confirm + cron race.
      idempotencyKey: `commission-transfer-${input.requestId}`,
    });
    await admin
      .from('commission_requests')
      .update({ stripe_transfer_id: transfer.id })
      .eq('id', input.requestId);
    return { released: true };
  }

  // canceled / anything else: money was never collected — surface, don't mark delivered.
  await recordDeadLetter({ admin }, {
    service: 'commissions.releaseCommissionFunds:not-releasable',
    context: { commission_request_id: input.requestId, payment_intent_id: input.paymentIntentId, pi_status: pi.status },
    error: `Commission PaymentIntent not releasable (status=${pi.status})`,
  });
  return { released: false, reason: pi.status };
}

/** Refund a paid commission back to the buyer (admin dispute decision or
 *  cancellation before delivery). Branches on rail: an uncaptured legacy auth
 *  is canceled; a captured charge is refunded (with transfer/app-fee reversal
 *  only when it was a legacy destination charge). */
export async function refundCommissionPayment(
  stripeSecretKey: string,
  paymentIntentId: string,
): Promise<void> {
  const stripe = createStripe(stripeSecretKey);
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.status === 'canceled') return; // already void
  if (pi.status === 'requires_capture') {
    await stripe.paymentIntents.cancel(paymentIntentId);
    return;
  }
  // Idempotency key (per PI) so a webhook retry / double dispute-resolve can't
  // issue TWO refunds and pay the buyer back twice.
  const idem = { idempotencyKey: `commission-refund-${paymentIntentId}` };
  if (pi.transfer_data) {
    // Legacy destination charge: pull the funds back from the connected
    // account and return our application fee so the buyer is made whole.
    await stripe.refunds.create({ payment_intent: paymentIntentId, reverse_transfer: true, refund_application_fee: true }, idem);
  } else {
    // New rail: funds are still in the platform balance — plain refund.
    await stripe.refunds.create({ payment_intent: paymentIntentId }, idem);
  }
}

/** Finalize a commission payment after Stripe confirms the Checkout Session.
 *  Called from the webhook (no user session). Idempotent: acts only while the
 *  request is still awaiting_payment, so a Stripe retry is a safe no-op. */
export async function finalizeCommissionPayment(
  admin: ServiceContext['admin'],
  env: Parameters<typeof createNotification>[2],
  input: { requestId: string; paymentIntentId: string | null; platformFeeOre: number | null },
): Promise<ServiceResult<{ updated: boolean }>> {
  const { data: req } = await admin
    .from('commission_requests')
    .select('id, buyer_id, status, awarded_offer_id, title, description, size_label, yarn_preference, pattern_external_title, colorway, yarn_provided_by_buyer')
    .eq('id', input.requestId)
    .maybeSingle();
  if (!req) return fail('not_found', 'Request not found');
  if (req.status !== 'awaiting_payment') return ok({ updated: false }); // already finalized

  const { data: offer } = await admin
    .from('commission_offers')
    .select('id, knitter_id, project_id, price_nok')
    .eq('id', req.awarded_offer_id!)
    .maybeSingle();
  if (!offer) return fail('not_found', 'Offer not found');

  const needsYarn = req.yarn_provided_by_buyer;
  // ensureCommissionProject + recordDeadLetter only use ctx.admin / ctx.user.id.
  const ctx = { admin, user: { id: req.buyer_id as string } } as unknown as ServiceContext;

  await ensureCommissionProject(ctx, {
    offer: { id: offer.id, knitter_id: offer.knitter_id, project_id: offer.project_id ?? null },
    req,
    startActive: true,
    serviceLabel: 'commissions.finalizeCommissionPayment:project-activate',
  });

  await admin
    .from('commission_requests')
    .update({
      status: needsYarn ? 'awaiting_yarn' : 'awarded',
      stripe_payment_intent_id: input.paymentIntentId,
      platform_fee_nok: input.platformFeeOre != null ? Math.round(input.platformFeeOre / 100) : null,
    })
    .eq('id', input.requestId);

  // Ledger: commission paid in full into the platform balance (separate
  // charges & transfers — the knitter is paid later, at delivery/release).
  await recordPaymentEvent(admin, {
    kind: 'commission', type: 'captured', commissionRequestId: input.requestId,
    actorId: req.buyer_id, amountNok: offer.price_nok,
    feeNok: input.platformFeeOre != null ? Math.round(input.platformFeeOre / 100) : null,
    paymentIntentId: input.paymentIntentId,
  });

  await createNotification(admin, {
    userId: offer.knitter_id, type: 'payment_received',
    title: 'Betaling mottatt!',
    body: needsYarn
      ? `Betaling for «${req.title}» er mottatt. Venter på at kjøper sender garnet.`
      : `Betaling for «${req.title}» er mottatt — du kan begynne å strikke!`,
    url: `/market/commissions/${input.requestId}`,
    referenceId: input.requestId,
  }, env);

  return ok({ updated: true });
}

export async function linkProject(
  ctx: ServiceContext,
  input: { offerId: string; projectId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.offerId || !input.projectId) return fail('bad_input', 'Missing offer or project ID');

  const { data: offer } = await ctx.supabase
    .from('commission_offers')
    .select('id, request_id, knitter_id, status')
    .eq('id', input.offerId)
    .maybeSingle();

  if (!offer || offer.knitter_id !== ctx.user.id) return fail('forbidden', 'Not your offer');
  if (offer.status !== 'accepted') return fail('bad_input', 'Offer not accepted');

  const { data: project } = await ctx.supabase
    .from('projects').select('id, user_id').eq('id', input.projectId).maybeSingle();

  if (!project || project.user_id !== ctx.user.id) return fail('forbidden', 'Not your project');

  await ctx.supabase.from('commission_offers').update({ project_id: input.projectId }).eq('id', input.offerId);
  await ctx.supabase.from('projects').update({ commission_offer_id: input.offerId }).eq('id', input.projectId);

  return ok({ redirect: `/market/commissions/${offer.request_id}` });
}

export async function shipYarn(
  ctx: ServiceContext,
  input: { requestId: string; trackingCode?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.requestId) return fail('bad_input', 'Missing request ID');

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status, title, awarded_offer_id')
    .eq('id', input.requestId)
    .single();

  if (!req || req.buyer_id !== ctx.user.id) return fail('forbidden', 'Not your request');
  if (req.status !== 'awaiting_yarn') return fail('bad_input', 'Request not awaiting yarn');

  await ctx.supabase.from('commission_requests').update({
    yarn_shipped_at: new Date().toISOString(),
    yarn_tracking_code: input.trackingCode?.trim() || null,
  }).eq('id', input.requestId);

  const { data: offer } = await ctx.supabase
    .from('commission_offers').select('knitter_id').eq('id', req.awarded_offer_id!).single();

  if (offer) {
    await createNotification(ctx.admin, {
      userId: offer.knitter_id, type: 'yarn_shipped',
      title: 'Garnet er sendt!',
      body: input.trackingCode ? `Sporingskode: ${input.trackingCode}` : `Kjøper har sendt garnet for «${req.title}»`,
      url: `/market/commissions/${input.requestId}`,
      actorId: ctx.user.id, referenceId: input.requestId,
    }, ctx.env);
  }

  return ok({ redirect: `/market/commissions/${input.requestId}` });
}

export async function receiveYarn(
  ctx: ServiceContext,
  input: { requestId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.requestId) return fail('bad_input', 'Missing request ID');

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status, title, awarded_offer_id, yarn_shipped_at')
    .eq('id', input.requestId)
    .single();

  if (!req || req.status !== 'awaiting_yarn' || !req.yarn_shipped_at) {
    return fail('bad_input', 'Yarn not marked as shipped');
  }

  const { data: offer } = await ctx.supabase
    .from('commission_offers')
    .select('id, knitter_id, project_id')
    .eq('id', req.awarded_offer_id!)
    .single();

  if (!offer || offer.knitter_id !== ctx.user.id) return fail('forbidden', 'Not the knitter on this commission');

  await ctx.admin.from('commission_requests').update({
    status: 'awarded', yarn_received_at: new Date().toISOString(),
  }).eq('id', input.requestId);

  if (offer.project_id) {
    await ctx.admin.from('projects').update({ status: 'active' }).eq('id', offer.project_id);
  }

  await createNotification(ctx.admin, {
    userId: req.buyer_id, type: 'yarn_received',
    title: 'Garnet er mottatt!',
    body: `Strikkeren har mottatt garnet for «${req.title}» og kan begynne.`,
    url: `/market/commissions/${input.requestId}`,
    actorId: ctx.user.id, referenceId: input.requestId,
  }, ctx.env);

  return ok({ redirect: `/market/commissions/${input.requestId}` });
}

export async function markCompleted(
  ctx: ServiceContext,
  input: { requestId: string; trackingCode?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.requestId) return fail('bad_input', 'Missing request ID');

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status, title, awarded_offer_id')
    .eq('id', input.requestId)
    .single();

  if (!req || req.status !== 'awarded') return fail('bad_input', 'Commission cannot be marked completed');

  const { data: offer } = await ctx.supabase
    .from('commission_offers').select('knitter_id').eq('id', req.awarded_offer_id!).single();

  if (!offer || offer.knitter_id !== ctx.user.id) return fail('forbidden', 'Not the knitter on this commission');

  // Fraud control (P0.2): the finished item ships between strangers with the
  // buyer's money in escrow — require a tracking number so a false "didn't
  // receive it" claim can't take the knitter's payment.
  if (!input.trackingCode?.trim()) {
    return fail('bad_input', 'Legg inn sporingsnummeret for pakken før du markerer som ferdig.');
  }

  const autoRelease = new Date();
  autoRelease.setDate(autoRelease.getDate() + 14);

  await ctx.admin.from('commission_requests').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    auto_release_at: autoRelease.toISOString(),
    finished_item_tracking_code: input.trackingCode?.trim() || null,
  }).eq('id', input.requestId);

  await createNotification(ctx.admin, {
    userId: req.buyer_id, type: 'commission_completed',
    title: 'Oppdraget er ferdig!',
    body: `Strikkeren har merket «${req.title}» som ferdig. Bekreft mottak innen 14 dager.`,
    url: `/market/commissions/${input.requestId}`,
    actorId: ctx.user.id, referenceId: input.requestId,
  }, ctx.env);

  return ok({ redirect: `/market/commissions/${input.requestId}` });
}

export async function confirmDelivery(
  ctx: ServiceContext,
  input: { requestId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.requestId) return fail('bad_input', 'Missing request ID');

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status, title, awarded_offer_id, stripe_payment_intent_id')
    .eq('id', input.requestId)
    .single();

  if (!req || req.buyer_id !== ctx.user.id) return fail('forbidden', 'Not your request');
  if (req.status !== 'completed') return fail('bad_input', 'Commission not marked as completed');
  // Releases escrow to the knitter — bail before any state change if paused.
  const payoutsBlocked = await killGuard(['payouts'], ctx.env);
  if (payoutsBlocked) return payoutsBlocked;

  const { data: offer } = await ctx.supabase
    .from('commission_offers').select('knitter_id, price_nok').eq('id', req.awarded_offer_id!).single();

  if (req.stripe_payment_intent_id && offer) {
    const r = await releaseCommissionFunds(ctx.admin, ctx.env.STRIPE_SECRET_KEY, {
      requestId: input.requestId,
      paymentIntentId: req.stripe_payment_intent_id,
      knitterId: offer.knitter_id,
      priceNok: offer.price_nok,
    });
    // Never mark delivered without the money having moved (dead-lettered inside).
    if (!r.released) return fail('conflict', 'Utbetalingen kunne ikke gjennomføres. Ta kontakt med support.');
    // Ledger: escrow released to the knitter (price minus the platform's cut).
    await recordPaymentEvent(ctx.admin, {
      kind: 'commission', type: 'released', commissionRequestId: input.requestId,
      actorId: ctx.user.id, amountNok: offer.price_nok,
      feeNok: MoneyBreakdown.commissionPayment({ priceNok: offer.price_nok }).platformFeeOre / 100,
      paymentIntentId: req.stripe_payment_intent_id, context: { trigger: 'buyer_confirmed' },
    });
  }

  const reviewDeadline = new Date();
  reviewDeadline.setDate(reviewDeadline.getDate() + 14);

  await ctx.admin.from('commission_requests').update({
    status: 'delivered',
    delivered_at: new Date().toISOString(),
    review_deadline_at: reviewDeadline.toISOString(),
  }).eq('id', input.requestId);

  if (offer) {
    await createNotification(ctx.admin, {
      userId: offer.knitter_id, type: 'commission_delivered',
      title: 'Levering bekreftet!',
      body: `Kjøper har bekreftet mottak av «${req.title}». Takk for flott arbeid!`,
      url: `/market/commissions/${input.requestId}`,
      actorId: ctx.user.id, referenceId: input.requestId,
    }, ctx.env);
  }

  return ok({ redirect: `/market/commissions/${input.requestId}` });
}

export async function bookShipping(
  ctx: ServiceContext,
  input: {
    requestId: string;
    fromName: string; fromAddress: string; fromPostal: string; fromCity: string;
    toName: string; toAddress: string; toPostal: string; toCity: string;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.requestId) return fail('bad_input', 'Missing request ID');

  const POSTAL_RE = /^\d{4}$/;
  if (!input.fromName || !input.fromAddress || !input.fromPostal || !input.fromCity ||
      !input.toName || !input.toAddress || !input.toPostal || !input.toCity) {
    return fail('bad_input', 'All address fields required');
  }
  if (!POSTAL_RE.test(input.fromPostal) || !POSTAL_RE.test(input.toPostal)) {
    return fail('bad_input', 'Postal code must be 4 digits');
  }

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status, yarn_shipped_at')
    .eq('id', input.requestId)
    .single();

  if (!req || req.buyer_id !== ctx.user.id) return fail('forbidden', 'Not your request');
  if (req.status !== 'awaiting_yarn') return fail('bad_input', 'Request not awaiting yarn');

  const auth = { uid: ctx.env.BRING_API_UID, apiKey: ctx.env.BRING_API_KEY, customerNumber: ctx.env.BRING_CUSTOMER_NUMBER };
  const result = await bookShipment(auth, {
    fromName: input.fromName, fromAddress: input.fromAddress, fromPostal: input.fromPostal, fromCity: input.fromCity,
    toName: input.toName, toAddress: input.toAddress, toPostal: input.toPostal, toCity: input.toCity,
    weightGrams: 500,
  });

  if (!result) return fail('server_error', 'Could not book shipment');

  await ctx.admin.from('commission_requests').update({
    yarn_shipped_at: new Date().toISOString(),
    yarn_tracking_code: result.shipmentNumber,
    yarn_bring_shipment_number: result.shipmentNumber,
    label_free_code: result.labelFreeCode ?? null,
  }).eq('id', input.requestId);

  return ok({ redirect: `/market/commissions/${input.requestId}` });
}

export async function getTracking(
  ctx: ServiceContext,
  input: { requestId: string },
): Promise<ServiceResult<unknown[]>> {
  if (!input.requestId) return fail('bad_input', 'Missing request_id');

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, yarn_bring_shipment_number, awarded_offer_id')
    .eq('id', input.requestId)
    .maybeSingle();

  if (!req) return fail('not_found', 'Not found');

  const { data: offer } = await ctx.supabase
    .from('commission_offers').select('knitter_id').eq('id', req.awarded_offer_id!).maybeSingle();

  if (req.buyer_id !== ctx.user.id && offer?.knitter_id !== ctx.user.id) {
    return fail('forbidden', 'Forbidden');
  }

  if (!req.yarn_bring_shipment_number) return ok([]);

  const auth = { uid: ctx.env.BRING_API_UID, apiKey: ctx.env.BRING_API_KEY, customerNumber: ctx.env.BRING_CUSTOMER_NUMBER };
  const events = await bringGetTracking(auth, req.yarn_bring_shipment_number);

  return ok(events);
}

export async function disputeCommission(
  ctx: ServiceContext,
  input: { requestId: string; reason: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.requestId) return fail('bad_input', 'Missing request ID');
  const reason = input.reason.trim();
  if (!reason) return fail('bad_input', 'Reason required');

  const { data: req } = await ctx.admin
    .from('commission_requests')
    .select('id, buyer_id, title, status, awarded_offer_id, auto_release_at')
    .eq('id', input.requestId)
    .maybeSingle();

  if (!req || req.buyer_id !== ctx.user.id) return fail('not_found', 'Not found');
  if (req.status !== 'completed') return fail('conflict', 'Cannot dispute in this state');

  await ctx.admin
    .from('commission_requests')
    .update({
      status: 'disputed',
      disputed_at: new Date().toISOString(),
      dispute_reason: reason,
      auto_release_at: null,
    })
    .eq('id', input.requestId);

  // Ledger: buyer opened a dispute — the held funds are frozen pending review.
  await recordPaymentEvent(ctx.admin, {
    kind: 'commission', type: 'dispute_opened', commissionRequestId: input.requestId,
    actorId: ctx.user.id, context: { reason },
  });

  const { data: offer } = await ctx.admin
    .from('commission_offers')
    .select('knitter_id')
    .eq('id', req.awarded_offer_id!)
    .maybeSingle();

  if (offer) {
    await createNotification(ctx.admin, {
      userId: offer.knitter_id,
      type: 'dispute_opened',
      title: 'Tvist åpnet',
      body: `Kjøper har rapportert et problem med «${req.title}».`,
      url: `/market/commissions/${input.requestId}`,
      actorId: ctx.user.id,
      referenceId: input.requestId,
    }, ctx.env);
  }

  const { data: admins } = await ctx.admin.from('profiles').select('id').eq('role', 'admin');
  for (const a of admins ?? []) {
    await createNotification(ctx.admin, {
      userId: a.id,
      type: 'dispute_opened',
      title: 'Ny tvist',
      body: `Tvist på oppdrag «${req.title}» — krever gjennomgang.`,
      url: '/admin/disputes',
      referenceId: input.requestId,
    }, ctx.env);
  }

  return ok({ redirect: `/market/commissions/${input.requestId}` });
}

export async function extendRequest(
  ctx: ServiceContext,
  input: { requestId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.requestId) return fail('bad_input', 'Missing request ID');

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status, expires_at')
    .eq('id', input.requestId)
    .single();

  if (!req || req.buyer_id !== ctx.user.id) return fail('forbidden', 'Not your request');
  if (req.status !== 'open') return fail('bad_input', 'Only open requests can be extended');

  const current = req.expires_at ? new Date(req.expires_at) : new Date();
  current.setDate(current.getDate() + 30);

  await ctx.admin.from('commission_requests').update({
    expires_at: current.toISOString(),
  }).eq('id', input.requestId);

  return ok({ redirect: `/market/commissions/${input.requestId}` });
}
