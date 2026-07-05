import { describe, it, expect, vi } from 'vitest';
import { statusFromAccount, createSellerConnectAccount, createSellerVerificationLink } from './stripe-connect';

const accountLinksCreate = vi.fn();
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({ accountLinks: { create: accountLinksCreate } })),
}));

describe('statusFromAccount', () => {
  it('returns verified when payouts_enabled', () => {
    expect(statusFromAccount({ payouts_enabled: true })).toBe('verified');
    expect(statusFromAccount({ payouts_enabled: true, charges_enabled: true })).toBe('verified');
  });

  it('returns rejected when disabled_reason starts with rejected.', () => {
    expect(statusFromAccount({ requirements: { disabled_reason: 'rejected.fraud' } })).toBe('rejected');
    expect(statusFromAccount({ requirements: { disabled_reason: 'rejected.terms_of_service' } })).toBe('rejected');
    expect(statusFromAccount({ requirements: { disabled_reason: 'rejected.other' } })).toBe('rejected');
  });

  it('returns restricted when payouts disabled and requirements outstanding', () => {
    expect(statusFromAccount({
      payouts_enabled: false,
      requirements: { currently_due: ['individual.id_number'] },
    })).toBe('restricted');
    expect(statusFromAccount({
      payouts_enabled: false,
      requirements: { past_due: ['external_account'] },
    })).toBe('restricted');
  });

  it('returns pending when payouts disabled and no requirements', () => {
    expect(statusFromAccount({ payouts_enabled: false, requirements: {} })).toBe('pending');
    expect(statusFromAccount({})).toBe('pending');
  });
});

describe('createSellerConnectAccount input validation', () => {
  // We can validate the input-rejection branches without hitting Stripe by
  // using an obviously-broken secret key. The function should reject
  // bad input BEFORE making any network call.

  const BAD_SECRET = 'sk_test_invalid_definitely_does_not_authenticate';

  it('rejects missing surname (single-word name)', async () => {
    const result = await createSellerConnectAccount(BAD_SECRET, {
      legalName: 'Sam',
      birthdate: '1985-07-13',
      kontonummer: '1234 56 78903',
      address: 'Storgata 1', postalCode: '0123', city: 'Oslo',
      email: 'test@example.com',
    });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('bad_name');
  });

  it('rejects malformed birthdate', async () => {
    const result = await createSellerConnectAccount(BAD_SECRET, {
      legalName: 'Sam Weggersen',
      birthdate: 'not-a-date',
      kontonummer: '1234 56 78903',
      address: 'Storgata 1', postalCode: '0123', city: 'Oslo',
      email: 'test@example.com',
    });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('bad_birthdate');
  });

  it('rejects birthdate that would make user under 13', async () => {
    const tooYoung = `${new Date().getFullYear()}-01-01`;
    const result = await createSellerConnectAccount(BAD_SECRET, {
      legalName: 'Sam Weggersen',
      birthdate: tooYoung,
      kontonummer: '1234 56 78903',
      address: 'Storgata 1', postalCode: '0123', city: 'Oslo',
      email: 'test@example.com',
    });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('bad_birthdate');
  });

  it('rejects invalid kontonummer', async () => {
    const result = await createSellerConnectAccount(BAD_SECRET, {
      legalName: 'Sam Weggersen',
      birthdate: '1985-07-13',
      kontonummer: '1234 56 78901', // wrong check digit
      address: 'Storgata 1', postalCode: '0123', city: 'Oslo',
      email: 'test@example.com',
    });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('bad_kontonummer');
  });
});

describe('createSellerVerificationLink (P0.4 remediation)', () => {
  it('returns the Stripe account-onboarding link URL', async () => {
    accountLinksCreate.mockResolvedValueOnce({ url: 'https://connect.stripe.com/setup/x' });
    const r = await createSellerVerificationLink('sk_test', 'acct_123', {
      refreshUrl: 'https://site/api/seller/verification-link',
      returnUrl: 'https://site/profile?verification=submitted',
    });
    expect(r).toEqual({ ok: true, url: 'https://connect.stripe.com/setup/x' });
    expect(accountLinksCreate).toHaveBeenCalledWith({
      account: 'acct_123',
      refresh_url: 'https://site/api/seller/verification-link',
      return_url: 'https://site/profile?verification=submitted',
      type: 'account_onboarding',
    });
  });

  it('fails gracefully when Stripe throws', async () => {
    accountLinksCreate.mockRejectedValueOnce(new Error('No such account'));
    const r = await createSellerVerificationLink('sk_test', 'acct_bad', { refreshUrl: 'r', returnUrl: 'ret' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/No such account/);
  });
});
