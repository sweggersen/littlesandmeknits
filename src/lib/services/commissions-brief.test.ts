// Phase 1 "commission brief enrichment" (migration 0105): createRequest now
// persists a pattern_reference, a requires_agreement flag, and reference-image
// uploads (commission_request_photos). These tests pin that behaviour against
// the in-memory fake-db + a recording storage stub.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest } from './commissions';
import type { ServiceContext } from './types';
import { createFakeDb, type FakeDb } from './__test_helpers__/fake-db';

vi.mock('../notify', () => ({ createNotification: vi.fn() }));
vi.mock('./dead-letter', () => ({ recordDeadLetter: vi.fn() }));
vi.mock('./quota', () => ({ assertWithinQuota: vi.fn(async () => null) }));
vi.mock('../moderation', () => ({ insertQueueItem: vi.fn(async () => {}) }));

const BUYER = 'buyer-1';

function makeCtx(db: FakeDb) {
  const uploads: string[] = [];
  const supabase = {
    from: (t: string) => db.client.from(t),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploads.push(path);
          return { error: null };
        },
      }),
    },
  };
  const ctx = {
    user: { id: BUYER },
    supabase,
    admin: db.client,
    env: {},
  } as unknown as ServiceContext;
  return { ctx, uploads };
}

const baseInput = {
  title: 'Sondre cardigan',
  category: 'cardigan',
  sizeLabel: '92',
  budgetNokMin: '300',
  budgetNokMax: '800',
  yarnProvidedByBuyer: false,
};

function jpg(name = 'ref.jpg') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
}

describe('createRequest — commission brief enrichment', () => {
  let db: FakeDb;
  beforeEach(() => {
    // Trusted buyer → autoApprove, so status lands 'open' and no moderation queue.
    db = createFakeDb({ profiles: [{ id: BUYER, trust_tier: 'trusted' }] });
  });

  it('persists pattern_reference + requires_agreement, and mirrors the reference into pattern_external_title', async () => {
    const { ctx } = makeCtx(db);
    const res = await createRequest(ctx, {
      ...baseInput,
      patternReference: 'https://example.com/oppskrift',
      requiresAgreement: true,
    });
    expect(res.ok).toBe(true);
    const row = db.rows('commission_requests')[0];
    expect(row.pattern_reference).toBe('https://example.com/oppskrift');
    expect(row.requires_agreement).toBe(true);
    // Mirrored so the downstream project-prefill (ensureCommissionProject) keeps working.
    expect(row.pattern_external_title).toBe('https://example.com/oppskrift');
    expect(row.status).toBe('open');
  });

  it('defaults requires_agreement to false and pattern_reference to null when omitted', async () => {
    const { ctx } = makeCtx(db);
    const res = await createRequest(ctx, { ...baseInput });
    expect(res.ok).toBe(true);
    const row = db.rows('commission_requests')[0];
    expect(row.requires_agreement).toBe(false);
    expect(row.pattern_reference).toBeNull();
  });

  it('uploads reference images under the buyer folder and records ordered photo rows', async () => {
    const { ctx, uploads } = makeCtx(db);
    const res = await createRequest(ctx, {
      ...baseInput,
      referenceImages: [jpg('a.jpg'), jpg('b.jpg')],
    });
    expect(res.ok).toBe(true);
    const reqRow = db.rows('commission_requests')[0];
    const photos = db.rows('commission_request_photos');
    expect(photos).toHaveLength(2);
    expect(photos.map((p) => p.request_id)).toEqual([reqRow.id, reqRow.id]);
    expect(photos.map((p) => p.position)).toEqual([0, 1]);
    expect(uploads).toHaveLength(2);
    // 0003 projects-bucket RLS pins folder[1] = auth.uid().
    expect(uploads[0]).toMatch(new RegExp(`^${BUYER}/commissions/${reqRow.id}/photo-`));
  });

  it('rejects more than the max number of reference images without creating a request', async () => {
    const { ctx } = makeCtx(db);
    const res = await createRequest(ctx, {
      ...baseInput,
      referenceImages: Array.from({ length: 7 }, () => jpg()),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('bad_input');
    expect(db.rows('commission_requests')).toHaveLength(0);
    expect(db.rows('commission_request_photos')).toHaveLength(0);
  });

  it('rejects a non-image reference file without creating a request', async () => {
    const { ctx } = makeCtx(db);
    const pdf = new File([new Uint8Array([1])], 'pattern.pdf', { type: 'application/pdf' });
    const res = await createRequest(ctx, { ...baseInput, referenceImages: [pdf] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('bad_input');
    expect(db.rows('commission_requests')).toHaveLength(0);
  });
});
