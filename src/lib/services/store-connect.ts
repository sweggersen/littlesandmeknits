// Store-level Stripe Connect onboarding (M5). A store is its own seller of
// record: store-owned listings route escrow to stores.stripe_account_id (see
// listings-escrow.ts), NOT to the individual member's seller_profiles account.
//
// Unlike the seller flow (Custom account + silent KYC we collect ourselves), a
// store is a registered business, so we use an *Express* account and hand the
// owner off to Stripe-hosted onboarding to submit company/representative KYC.
// We prefill what we already know from Brønnøysund (orgnr, legal name, address).
//
// The account.updated webhook flips stripe_onboarded + stripe_connect_status.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';
import { can } from './store-permissions';
import { getMyRole } from './store-members';

/** Create the store's Express Connect account if it doesn't have one yet, and
 *  return a Stripe-hosted onboarding Account Link. Owner-only. */
export async function startStoreOnboarding(
  ctx: ServiceContext,
  storeId: string,
  urls: { refreshUrl: string; returnUrl: string },
): Promise<ServiceResult<{ url: string }>> {
  const myRole = await getMyRole(ctx, storeId);
  if (!can.editStripeSettings(myRole)) return fail('forbidden', 'Bare eieren kan sette opp utbetalinger');

  const stripeSecret = ctx.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) return fail('server_error', 'Betalinger er ikke konfigurert');

  const { data: store } = await ctx.admin
    .from('stores')
    .select('id, legal_name, name, orgnr, legal_address, location_city, contact_email, stripe_account_id, status')
    .eq('id', storeId)
    .maybeSingle();
  if (!store) return fail('not_found', 'Butikk ikke funnet');
  if (store.status === 'archived' || store.status === 'suspended') {
    return fail('conflict', 'Butikken er ikke aktiv');
  }

  const stripe = createStripe(stripeSecret);

  let accountId = store.stripe_account_id;
  if (!accountId) {
    try {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'NO',
        email: store.contact_email ?? ctx.user.email ?? undefined,
        business_type: 'company',
        company: {
          name: store.legal_name ?? store.name,
          // Norwegian organisasjonsnummer — Stripe's tax_id for NO companies.
          tax_id: store.orgnr,
          address: store.legal_address
            ? { line1: store.legal_address, city: store.location_city ?? undefined, country: 'NO' }
            : undefined,
        },
        business_profile: {
          name: store.name,
          mcc: '5949', // sewing/needlework/piece goods stores
        },
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
      });
      accountId = account.id;
    } catch (err: unknown) {
      console.error('Store Connect account create failed', err);
      return fail('server_error', 'Kunne ikke opprette Stripe-konto for butikken');
    }

    const { error: saveErr } = await ctx.admin
      .from('stores')
      .update({ stripe_account_id: accountId, stripe_connect_status: 'pending' })
      .eq('id', storeId);
    if (saveErr) {
      // The account exists at Stripe but we couldn't persist its id. Fail loudly
      // rather than orphan it — the next attempt would create a *second* account.
      console.error('Failed to persist store stripe_account_id', saveErr);
      return fail('server_error', 'Kunne ikke lagre Stripe-konto');
    }
  }

  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: urls.refreshUrl,
      return_url: urls.returnUrl,
      type: 'account_onboarding',
    });
    return ok({ url: link.url });
  } catch (err: unknown) {
    console.error('Store Connect account link failed', err);
    return fail('server_error', 'Kunne ikke starte Stripe-oppsett');
  }
}
