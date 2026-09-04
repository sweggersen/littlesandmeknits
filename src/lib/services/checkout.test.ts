import { describe, it, expect, vi } from 'vitest';
import { createPatternCheckout, patternPdfExists } from './checkout';
import { createFakeDb } from './__test_helpers__/fake-db';
import type { ServiceContext } from './types';

vi.mock('../flags', () => ({ killGuard: vi.fn(async () => null) }));
// The real Stripe path calls createStripe(); stub it so the non-sim branch runs
// offline. The sim tests return before this, so they're unaffected.
vi.mock('../stripe', () => ({
  createStripe: () => ({
    checkout: { sessions: { create: async () => ({ url: 'https://stripe.test/checkout' }) } },
  }),
}));

// A ctx.admin whose storage.from('patterns').list(slug) returns `files`.
function storageStub(files: Array<{ name: string }> | null, error: unknown = null) {
  return { storage: { from: () => ({ list: async () => ({ data: files, error }) }) } };
}

function ctxWith(db: ReturnType<typeof createFakeDb>, storage?: any): ServiceContext {
  // db.client.from is a closure (no `this`), so spread keeps it working.
  const admin = storage ? { ...db.client, ...storage } : db.client;
  return {
    supabase: db.client as any,
    admin: admin as any,
    user: { id: 'buyer-1', email: 'buyer@x.io' },
    env: { PUBLIC_SITE_URL: 'https://test.site' } as any,
  };
}

const INPUT = {
  slug: 'solskinn-genseren',
  lang: 'nb' as const,
  title: 'Solskinn-genseren',
  summary: 'En lett rundfelling.',
  priceNok: 89,
};

describe('createPatternCheckout — sk_simulate (dev)', () => {
  it('grants the pattern immediately and returns the success URL', async () => {
    const db = createFakeDb({ purchases: [], user_action_counts: [] });
    const r = await createPatternCheckout(ctxWith(db), { ...INPUT, stripeSecretKey: 'sk_simulate' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.checkoutUrl).toBe('https://test.site/profile/purchases?simulated=1');

    const purchase = db.find('purchases', { user_id: 'buyer-1', pattern_slug: 'solskinn-genseren' }) as any;
    expect(purchase).toBeTruthy();
    expect(purchase.status).toBe('completed');
    expect(purchase.amount_nok).toBe(89);
    expect(purchase.pdf_path).toBe('solskinn-genseren/v1.pdf');
    expect(purchase.fulfilled_at).toBeTruthy();
  });

  it('rejects a missing slug before doing anything', async () => {
    const db = createFakeDb({ purchases: [], user_action_counts: [] });
    const r = await createPatternCheckout(ctxWith(db), { ...INPUT, slug: '', stripeSecretKey: 'sk_simulate' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
    expect(db.find('purchases', { user_id: 'buyer-1' })).toBeFalsy();
  });
});

describe('patternPdfExists', () => {
  it('true when v1.pdf is present under the slug prefix', async () => {
    const admin = storageStub([{ name: 'v1.pdf' }, { name: 'cover.png' }]) as any;
    expect(await patternPdfExists(admin, 'solskinn-genseren')).toBe(true);
  });
  it('false when the bucket lists cleanly but v1.pdf is absent', async () => {
    const admin = storageStub([{ name: 'cover.png' }]) as any;
    expect(await patternPdfExists(admin, 'solskinn-genseren')).toBe(false);
  });
  it('null when the storage check itself errors (fail-open sentinel)', async () => {
    const admin = storageStub(null, { message: 'bucket not found' }) as any;
    expect(await patternPdfExists(admin, 'solskinn-genseren')).toBeNull();
  });
});

describe('createPatternCheckout — real Stripe path (v1.pdf guard)', () => {
  const REAL = { ...INPUT, stripeSecretKey: 'sk_test_x' as string };

  it('blocks checkout when the pattern PDF is confirmed missing', async () => {
    const db = createFakeDb({ purchases: [], user_action_counts: [] });
    const r = await createPatternCheckout(ctxWith(db, storageStub([{ name: 'cover.png' }])), REAL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');
  });

  it('proceeds to Stripe when the PDF exists', async () => {
    const db = createFakeDb({ purchases: [], user_action_counts: [] });
    const r = await createPatternCheckout(ctxWith(db, storageStub([{ name: 'v1.pdf' }])), REAL);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.checkoutUrl).toBe('https://stripe.test/checkout');
  });

  it('fails open (proceeds) when the existence check errors', async () => {
    const db = createFakeDb({ purchases: [], user_action_counts: [] });
    const r = await createPatternCheckout(ctxWith(db, storageStub(null, { message: 'blip' })), REAL);
    expect(r.ok).toBe(true); // a storage blip must not block a real sale
  });
});
