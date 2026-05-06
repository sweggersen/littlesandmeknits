import type Stripe from 'stripe';
import { createStripe } from './stripe';

export interface ConnectStatus {
  account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_currently_due: string[];
}

export async function ensureConnectAccount(
  secretKey: string,
  opts: { existingId: string | null; email: string | undefined; userId: string }
): Promise<Stripe.Account> {
  const stripe = createStripe(secretKey);
  if (opts.existingId) {
    return stripe.accounts.retrieve(opts.existingId);
  }
  return stripe.accounts.create({
    type: 'express',
    country: 'NO',
    email: opts.email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: 'individual',
    metadata: { user_id: opts.userId },
  });
}

export async function createOnboardingLink(
  secretKey: string,
  opts: { accountId: string; siteUrl: string }
): Promise<string> {
  const stripe = createStripe(secretKey);
  const link = await stripe.accountLinks.create({
    account: opts.accountId,
    refresh_url: `${opts.siteUrl}/studio/marked/innstillinger?refresh=1`,
    return_url: `${opts.siteUrl}/studio/marked/innstillinger?return=1`,
    type: 'account_onboarding',
  });
  return link.url;
}

export async function getConnectStatus(
  secretKey: string,
  accountId: string
): Promise<ConnectStatus> {
  const stripe = createStripe(secretKey);
  const account = await stripe.accounts.retrieve(accountId);
  return {
    account_id: account.id,
    charges_enabled: !!account.charges_enabled,
    payouts_enabled: !!account.payouts_enabled,
    details_submitted: !!account.details_submitted,
    requirements_currently_due: account.requirements?.currently_due ?? [],
  };
}

export async function createLoginLink(
  secretKey: string,
  accountId: string
): Promise<string> {
  const stripe = createStripe(secretKey);
  const link = await stripe.accounts.createLoginLink(accountId);
  return link.url;
}

// Platform fee math. Mirrors docs/marketplace/04-trust-fees-legal.md.
// Returns whole NOK.
export function calculatePlatformFee(opts: {
  kind: 'pre_loved' | 'ready_made' | 'commission';
  gross_nok: number;
}): number {
  const g = opts.gross_nok;
  if (opts.kind === 'pre_loved') {
    if (g < 200) return 10;
    if (g <= 500) return Math.max(15, Math.round(g * 0.05));
    return Math.round(g * 0.07);
  }
  if (opts.kind === 'ready_made') return Math.round(g * 0.09);
  return Math.round(g * 0.13); // commission
}
