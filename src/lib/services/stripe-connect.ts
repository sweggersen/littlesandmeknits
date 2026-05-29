// Stripe Connect Custom accounts for Norwegian sellers (the "Tise"
// model). We collect name, birthdate, kontonummer, and address in our
// own UI, then POST to Stripe to create a fully-managed Custom account.
// Stripe runs KYC silently in the background; the seller never sees a
// Stripe page.

import { createStripe } from '../stripe';
import { normalizeKontonummer, isValidKontonummer } from '../kontonummer';

export interface SellerOnboardingInput {
  legalName: string;
  birthdate: string;       // 'YYYY-MM-DD'
  kontonummer: string;     // raw or formatted
  address: string;
  postalCode: string;
  city: string;
  email: string;
}

export interface CreateAccountResult {
  ok: boolean;
  accountId?: string;
  reason?: string;
  detail?: string;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function parseBirthdate(iso: string): { day: number; month: number; year: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (year < 1900 || year > new Date().getFullYear() - 13) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { day, month, year };
}

export async function createSellerConnectAccount(
  stripeSecret: string,
  input: SellerOnboardingInput,
): Promise<CreateAccountResult> {
  if (!isValidKontonummer(input.kontonummer)) {
    return { ok: false, reason: 'bad_kontonummer' };
  }
  const name = splitName(input.legalName);
  if (!name.first || !name.last) {
    return { ok: false, reason: 'bad_name' };
  }
  const dob = parseBirthdate(input.birthdate);
  if (!dob) return { ok: false, reason: 'bad_birthdate' };

  const stripe = createStripe(stripeSecret);

  // Convert Norwegian kontonummer to IBAN form Stripe expects. Stripe
  // accepts the raw 11-digit account number for NO bank accounts when
  // country='NO' is set; no IBAN conversion is required.
  const accountNumber = normalizeKontonummer(input.kontonummer);

  try {
    const account = await stripe.accounts.create({
      type: 'custom',
      country: 'NO',
      email: input.email,
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
      },
      business_type: 'individual',
      individual: {
        first_name: name.first,
        last_name: name.last,
        email: input.email,
        dob: { day: dob.day, month: dob.month, year: dob.year },
        address: {
          line1: input.address,
          postal_code: input.postalCode,
          city: input.city,
          country: 'NO',
        },
      },
      external_account: {
        object: 'bank_account',
        country: 'NO',
        currency: 'nok',
        account_holder_name: input.legalName,
        account_holder_type: 'individual',
        account_number: accountNumber,
      } as any, // Stripe's TS types don't expose external_account on create
      tos_acceptance: {
        date: Math.floor(Date.now() / 1000),
        ip: '0.0.0.0', // overwritten by caller with real IP if available
      },
      settings: {
        payouts: {
          schedule: { interval: 'daily', delay_days: 7 },
        },
      },
    });

    return { ok: true, accountId: account.id };
  } catch (err: any) {
    const msg = err?.message ?? 'unknown';
    console.error('Stripe Connect account create failed', err);
    // Stripe returns specific codes for kontonummer/identity rejection;
    // surface a short message to the seller.
    return { ok: false, reason: 'stripe_error', detail: msg };
  }
}

export type ConnectStatus = 'pending' | 'restricted' | 'verified' | 'rejected';

// Derive our coarse status from the Stripe Account object. Verified means
// the seller can receive payouts; restricted means Stripe needs more info.
export function statusFromAccount(account: {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: string[] | null;
    past_due?: string[] | null;
  } | null;
}): ConnectStatus {
  const disabled = account.requirements?.disabled_reason;
  if (disabled === 'rejected.fraud' || disabled === 'rejected.terms_of_service' || disabled === 'rejected.other') {
    return 'rejected';
  }
  if (account.payouts_enabled) return 'verified';
  const due = (account.requirements?.currently_due?.length ?? 0)
    + (account.requirements?.past_due?.length ?? 0);
  return due > 0 ? 'restricted' : 'pending';
}
