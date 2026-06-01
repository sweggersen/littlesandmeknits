import { describe, it, expect } from 'vitest';
import { statusFromAccount, createSellerConnectAccount } from './stripe-connect';

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
