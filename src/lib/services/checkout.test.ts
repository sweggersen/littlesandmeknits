import { describe, it, expect, vi } from 'vitest';
import { createPatternCheckout } from './checkout';
import { createFakeDb } from './__test_helpers__/fake-db';
import type { ServiceContext } from './types';

vi.mock('../flags', () => ({ killGuard: vi.fn(async () => null) }));

function ctxWith(db: ReturnType<typeof createFakeDb>): ServiceContext {
  return {
    supabase: db.client as any,
    admin: db.client as any,
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
