import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createNotification } from '../notify';
import { createStripe } from '../stripe';
import { insertQueueItem } from '../moderation';
import { VALID_CATEGORIES } from '../labels';
import { bookShipment, getTracking as bringGetTracking } from '../bring';

const toIntOrNull = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

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

  const { data: buyerProfile } = await ctx.supabase
    .from('profiles').select('trust_tier').eq('id', ctx.user.id).maybeSingle();
  const autoApprove = buyerProfile?.trust_tier === 'trusted';

  const { data, error } = await ctx.admin
    .from('commission_requests')
    .insert({
      buyer_id: ctx.user.id,
      title,
      description: input.description?.trim() || null,
      category: input.category,
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

  return ok({ redirect: `/marked/oppdrag/${data.id}` });
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
    .select('id, buyer_id, status, title')
    .eq('id', input.requestId)
    .maybeSingle();

  if (!req || req.status !== 'open') return fail('bad_input', 'Request not open');
  if (req.buyer_id === ctx.user.id) return fail('bad_input', 'Cannot bid on own request');

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
    url: `/marked/oppdrag/${input.requestId}`,
    actorId: ctx.user.id, referenceId: input.requestId,
  }, ctx.env);

  return ok({ redirect: `/marked/oppdrag/${input.requestId}` });
}

export async function acceptOffer(
  ctx: ServiceContext,
  input: { offerId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.offerId) return fail('bad_input', 'Missing offer ID');

  const { data: offer } = await ctx.supabase
    .from('commission_offers')
    .select('id, request_id, status, knitter_id')
    .eq('id', input.offerId)
    .maybeSingle();

  if (!offer) return fail('not_found', 'Offer not found');

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status, title')
    .eq('id', offer.request_id)
    .single();

  if (!req || req.buyer_id !== ctx.user.id) return fail('forbidden', 'Not your request');
  if (req.status !== 'open' || offer.status !== 'pending') return fail('bad_input', 'Cannot accept this offer');

  await ctx.supabase.from('commission_offers').update({ status: 'accepted' }).eq('id', input.offerId);
  await ctx.supabase.from('commission_requests').update({ status: 'awaiting_payment', awarded_offer_id: input.offerId }).eq('id', offer.request_id);

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
    body: `Kjøper valgte tilbudet ditt på «${req.title}». Venter nå på betaling.`,
    url: `/marked/oppdrag/${offer.request_id}`,
    actorId: ctx.user.id, referenceId: offer.request_id,
  }, ctx.env);

  if (declined?.length) {
    await Promise.all(
      declined.map((d) =>
        createNotification(ctx.admin, {
          userId: d.knitter_id, type: 'offer_declined',
          title: 'Tilbudet ble ikke valgt',
          body: `Kjøper valgte et annet tilbud på «${req.title}».`,
          url: `/marked/oppdrag/${offer.request_id}`,
          actorId: ctx.user.id, referenceId: offer.request_id,
        }, ctx.env),
      ),
    );
  }

  return ok({ redirect: `/marked/oppdrag/${offer.request_id}` });
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

  return ok({ redirect: `/marked/oppdrag/${offer.request_id}` });
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

  return ok({ redirect: '/marked/oppdrag/mine' });
}

const PLATFORM_FEE_PERCENT = 13;
const AMBASSADOR_FEE_PERCENT = 8;

export async function payCommission(
  ctx: ServiceContext,
  input: { requestId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.requestId) return fail('bad_input', 'Missing request ID');

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

  const { data: knitterProfile } = await ctx.admin
    .from('profiles')
    .select('stripe_account_id, stripe_onboarded, role')
    .eq('id', offer.knitter_id)
    .maybeSingle();

  const feePercent = knitterProfile?.role === 'ambassador' ? AMBASSADOR_FEE_PERCENT : PLATFORM_FEE_PERCENT;
  const amountOre = offer.price_nok * 100;
  const platformFee = Math.round(amountOre * feePercent / 100);
  let paymentIntentId: string | undefined;

  if (knitterProfile?.stripe_onboarded && knitterProfile.stripe_account_id) {
    const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);
    const pi = await stripe.paymentIntents.create({
      amount: amountOre, currency: 'nok', capture_method: 'manual',
      application_fee_amount: platformFee,
      transfer_data: { destination: knitterProfile.stripe_account_id },
      metadata: { commission_request_id: input.requestId, buyer_id: ctx.user.id },
    });
    paymentIntentId = pi.id;

    await stripe.paymentIntents.confirm(pi.id, {
      payment_method: 'pm_card_visa',
      return_url: `${ctx.env.PUBLIC_SITE_URL}/marked/oppdrag/${input.requestId}`,
    });
  }

  const needsYarn = req.yarn_provided_by_buyer;

  const { data: project } = await ctx.admin
    .from('projects')
    .insert({
      user_id: offer.knitter_id, title: req.title, target_size: req.size_label,
      yarn: req.yarn_preference ?? undefined,
      summary: [
        req.pattern_external_title ? `Oppskrift: ${req.pattern_external_title}` : null,
        req.colorway ? `Farge: ${req.colorway}` : null,
      ].filter(Boolean).join('\n') || null,
      status: 'planning', commission_offer_id: offer.id,
    })
    .select('id')
    .single();

  if (project) {
    await ctx.admin.from('commission_offers').update({ project_id: project.id }).eq('id', offer.id);
  }

  await ctx.admin
    .from('commission_requests')
    .update({
      status: needsYarn ? 'awaiting_yarn' : 'awarded',
      stripe_payment_intent_id: paymentIntentId ?? null,
      platform_fee_nok: Math.round(platformFee / 100),
    })
    .eq('id', input.requestId);

  await createNotification(ctx.admin, {
    userId: offer.knitter_id, type: 'payment_received',
    title: 'Betaling mottatt!',
    body: needsYarn
      ? `Betaling for «${req.title}» er mottatt. Venter på at kjøper sender garnet.`
      : `Betaling for «${req.title}» er mottatt — du kan begynne å strikke!`,
    url: `/marked/oppdrag/${input.requestId}`,
    actorId: ctx.user.id, referenceId: input.requestId,
  }, ctx.env);

  return ok({ redirect: `/marked/oppdrag/${input.requestId}` });
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

  return ok({ redirect: `/marked/oppdrag/${offer.request_id}` });
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
      url: `/marked/oppdrag/${input.requestId}`,
      actorId: ctx.user.id, referenceId: input.requestId,
    }, ctx.env);
  }

  return ok({ redirect: `/marked/oppdrag/${input.requestId}` });
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
    url: `/marked/oppdrag/${input.requestId}`,
    actorId: ctx.user.id, referenceId: input.requestId,
  }, ctx.env);

  return ok({ redirect: `/marked/oppdrag/${input.requestId}` });
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
    url: `/marked/oppdrag/${input.requestId}`,
    actorId: ctx.user.id, referenceId: input.requestId,
  }, ctx.env);

  return ok({ redirect: `/marked/oppdrag/${input.requestId}` });
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

  if (req.stripe_payment_intent_id) {
    const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);
    await stripe.paymentIntents.capture(req.stripe_payment_intent_id);
  }

  const reviewDeadline = new Date();
  reviewDeadline.setDate(reviewDeadline.getDate() + 14);

  await ctx.admin.from('commission_requests').update({
    status: 'delivered',
    delivered_at: new Date().toISOString(),
    review_deadline_at: reviewDeadline.toISOString(),
  }).eq('id', input.requestId);

  const { data: offer } = await ctx.supabase
    .from('commission_offers').select('knitter_id').eq('id', req.awarded_offer_id!).single();

  if (offer) {
    await createNotification(ctx.admin, {
      userId: offer.knitter_id, type: 'commission_delivered',
      title: 'Levering bekreftet!',
      body: `Kjøper har bekreftet mottak av «${req.title}». Takk for flott arbeid!`,
      url: `/marked/oppdrag/${input.requestId}`,
      actorId: ctx.user.id, referenceId: input.requestId,
    }, ctx.env);
  }

  return ok({ redirect: `/marked/oppdrag/${input.requestId}` });
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

  return ok({ redirect: `/marked/oppdrag/${input.requestId}` });
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
      url: `/marked/oppdrag/${input.requestId}`,
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
      url: '/admin/tvister',
      referenceId: input.requestId,
    }, ctx.env);
  }

  return ok({ redirect: `/marked/oppdrag/${input.requestId}` });
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

  return ok({ redirect: `/marked/oppdrag/${input.requestId}` });
}
