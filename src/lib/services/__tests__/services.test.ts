import { describe, it, expect } from 'vitest';
import { ok, fail } from '../types';
import { createMockContext } from './mock-context';

import { createNeedle, updateNeedle, deleteNeedle } from '../needles';
import { deleteNotification, updatePreferences, markAllRead } from '../notifications';
import { submitReport } from '../reports';
import { submitReview } from '../reviews';
import { createPatternCheckout, getDownloadUrl } from '../checkout';
import { deleteProject, updateStatus, shareProject, updateProgress } from '../projects';

describe('ok / fail helpers', () => {
  it('ok wraps data correctly', () => {
    const r = ok({ id: '1' });
    expect(r).toEqual({ ok: true, data: { id: '1' } });
  });

  it('fail wraps error correctly', () => {
    const r = fail('not_found', 'Nope');
    expect(r).toEqual({ ok: false, code: 'not_found', message: 'Nope' });
  });
});

describe('needles — input validation', () => {
  it('rejects invalid needle type', async () => {
    const ctx = createMockContext();
    const result = await createNeedle(ctx, { needleType: 'crochet', sizeMm: '4' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects missing size', async () => {
    const ctx = createMockContext();
    const result = await createNeedle(ctx, { needleType: 'circular', sizeMm: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('accepts valid circular needle', async () => {
    const ctx = createMockContext();
    ctx._supabase._setTableData('needles', { id: 'n-1' });
    const result = await createNeedle(ctx, {
      needleType: 'circular', sizeMm: '4.5', lengthCm: '80', material: 'bamboo',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects update with missing id', async () => {
    const ctx = createMockContext();
    const result = await updateNeedle(ctx, { needleId: '', needleType: 'dpn', sizeMm: '3' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects delete with missing id', async () => {
    const ctx = createMockContext();
    const result = await deleteNeedle(ctx, { needleId: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });
});

describe('notifications — input validation', () => {
  it('rejects delete with missing id', async () => {
    const ctx = createMockContext();
    const result = await deleteNotification(ctx, { notificationId: '' });
    expect(result.ok).toBe(false);
  });

  it('rejects preferences with no valid fields', async () => {
    const ctx = createMockContext();
    const result = await updatePreferences(ctx, { bogus_key: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('markAllRead sanitizes referer', async () => {
    const ctx = createMockContext();
    const result = await markAllRead(ctx, { referer: '//evil.com' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.redirect).toBe('/varsler');
  });

  it('markAllRead accepts valid referer', async () => {
    const ctx = createMockContext();
    const result = await markAllRead(ctx, { referer: '/studio/prosjekter' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.redirect).toBe('/studio/prosjekter');
  });
});

describe('reports — input validation', () => {
  it('rejects invalid target type', async () => {
    const ctx = createMockContext();
    const result = await submitReport(ctx, {
      targetType: 'user', targetId: '550e8400-e29b-41d4-a716-446655440000', reason: 'spam',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects non-UUID target id', async () => {
    const ctx = createMockContext();
    const result = await submitReport(ctx, { targetType: 'listing', targetId: 'not-a-uuid', reason: 'spam' });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid reason', async () => {
    const ctx = createMockContext();
    const result = await submitReport(ctx, {
      targetType: 'listing', targetId: '550e8400-e29b-41d4-a716-446655440000', reason: 'dislike',
    });
    expect(result.ok).toBe(false);
  });
});

describe('reviews — input validation', () => {
  it('rejects missing commission request id', async () => {
    const ctx = createMockContext();
    const result = await submitReview(ctx, { commissionRequestId: '', rating: 4 });
    expect(result.ok).toBe(false);
  });

  it('rejects rating out of range', async () => {
    const ctx = createMockContext();
    const result = await submitReview(ctx, { commissionRequestId: 'cr-1', rating: 6 });
    expect(result.ok).toBe(false);
  });

  it('rejects rating of zero', async () => {
    const ctx = createMockContext();
    const result = await submitReview(ctx, { commissionRequestId: 'cr-1', rating: 0 });
    expect(result.ok).toBe(false);
  });
});

describe('checkout — input validation', () => {
  it('rejects missing slug', async () => {
    const ctx = createMockContext();
    const result = await createPatternCheckout(ctx, {
      slug: '', lang: 'nb', title: 'Test', summary: 'Sum', priceNok: 89, stripeSecretKey: 'sk_test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects missing stripe key', async () => {
    const ctx = createMockContext();
    const result = await createPatternCheckout(ctx, {
      slug: 'test', lang: 'nb', title: 'Test', summary: 'Sum', priceNok: 89, stripeSecretKey: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('server_error');
  });

  it('rejects download with missing id', async () => {
    const ctx = createMockContext();
    const result = await getDownloadUrl(ctx, { purchaseId: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });
});

describe('projects — input validation', () => {
  it('rejects delete with missing id', async () => {
    const ctx = createMockContext();
    const result = await deleteProject(ctx, { projectId: '' });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid status', async () => {
    const ctx = createMockContext();
    const result = await updateStatus(ctx, { projectId: 'p-1', status: 'bogus' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects share with missing project id', async () => {
    const ctx = createMockContext();
    const result = await shareProject(ctx, { projectId: '', share: true });
    expect(result.ok).toBe(false);
  });

  it('rejects progress update with missing project id', async () => {
    const ctx = createMockContext();
    const result = await updateProgress(ctx, { projectId: '' });
    expect(result.ok).toBe(false);
  });
});

describe('commission state machine — validation', async () => {
  const { makeOffer } = await import('../commissions');

  it('rejects offer with missing request id', async () => {
    const ctx = createMockContext();
    const result = await makeOffer(ctx, { requestId: '', priceNok: '500', turnaroundWeeks: '3', message: 'Hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects offer with invalid price', async () => {
    const ctx = createMockContext();
    const result = await makeOffer(ctx, { requestId: 'r-1', priceNok: '-10', turnaroundWeeks: '3', message: 'Hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Invalid price');
  });

  it('rejects offer with invalid lead time', async () => {
    const ctx = createMockContext();
    const result = await makeOffer(ctx, { requestId: 'r-1', priceNok: '500', turnaroundWeeks: '0', message: 'Hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Invalid lead time');
  });

  it('rejects offer with empty message', async () => {
    const ctx = createMockContext();
    const result = await makeOffer(ctx, { requestId: 'r-1', priceNok: '500', turnaroundWeeks: '3', message: '  ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Message required');
  });

  it('rejects offer on non-open request', async () => {
    const ctx = createMockContext();
    ctx._supabase._setTableData('commission_requests', { id: 'r-1', buyer_id: 'other', status: 'awarded', title: 'T' });
    const result = await makeOffer(ctx, { requestId: 'r-1', priceNok: '500', turnaroundWeeks: '3', message: 'Hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Request not open');
  });

  it('rejects bidding on own request', async () => {
    const ctx = createMockContext();
    ctx._supabase._setTableData('commission_requests', { id: 'r-1', buyer_id: 'user-1', status: 'open', title: 'T' });
    const result = await makeOffer(ctx, { requestId: 'r-1', priceNok: '500', turnaroundWeeks: '3', message: 'Hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Cannot bid on own request');
  });
});

describe('moderation — role checks', async () => {
  const { claimItem, reviewItem } = await import('../moderation');

  it('rejects claim without moderator role', async () => {
    const ctx = createMockContext();
    ctx._admin._setTableData('profiles', { role: null });
    const result = await claimItem(ctx, {} as Record<string, never>);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('forbidden');
      expect(result.message).toBe('Moderator access required');
    }
  });

  it('rejects review with invalid decision', async () => {
    const ctx = createMockContext();
    const result = await reviewItem(ctx, { queueId: 'q-1', decision: 'maybe' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });
});

describe('listing purchase — input validation', async () => {
  const { purchaseListing, shipListing, confirmListingDelivery, disputeListing } = await import('../listings');

  it('rejects purchase with missing id', async () => {
    const ctx = createMockContext();
    const result = await purchaseListing(ctx, { listingId: '', stripeSecretKey: 'sk_test' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects purchase without stripe key', async () => {
    const ctx = createMockContext();
    const result = await purchaseListing(ctx, { listingId: 'l-1', stripeSecretKey: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('server_error');
  });

  it('rejects ship with missing id', async () => {
    const ctx = createMockContext();
    const result = await shipListing(ctx, { listingId: '', trackingCode: 'TRACK-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects confirm delivery with missing id', async () => {
    const ctx = createMockContext();
    const result = await confirmListingDelivery(ctx, { listingId: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects dispute with missing id', async () => {
    const ctx = createMockContext();
    const result = await disputeListing(ctx, { listingId: '', reason: 'broken' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects dispute with empty reason', async () => {
    const ctx = createMockContext();
    const result = await disputeListing(ctx, { listingId: 'l-1', reason: '  ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });
});

describe('commission dispute — input validation', async () => {
  const { disputeCommission } = await import('../commissions');

  it('rejects dispute with missing request id', async () => {
    const ctx = createMockContext();
    const result = await disputeCommission(ctx, { requestId: '', reason: 'problem' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects dispute with empty reason', async () => {
    const ctx = createMockContext();
    const result = await disputeCommission(ctx, { requestId: 'r-1', reason: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });
});

describe('dispute resolution — input validation', async () => {
  const { resolveDispute } = await import('../disputes');

  it('rejects invalid decision', async () => {
    const ctx = createMockContext();
    ctx._admin._setTableData('profiles', { role: 'admin' });
    const result = await resolveDispute(ctx, { itemType: 'listing', itemId: 'l-1', decision: 'maybe' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects missing item id', async () => {
    const ctx = createMockContext();
    ctx._admin._setTableData('profiles', { role: 'admin' });
    const result = await resolveDispute(ctx, { itemType: 'listing', itemId: '', decision: 'refund' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects non-admin', async () => {
    const ctx = createMockContext();
    ctx._admin._setTableData('profiles', { role: null });
    const result = await resolveDispute(ctx, { itemType: 'listing', itemId: 'l-1', decision: 'refund' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('forbidden');
  });

  it('rejects invalid item type', async () => {
    const ctx = createMockContext();
    ctx._admin._setTableData('profiles', { role: 'admin' });
    const result = await resolveDispute(ctx, { itemType: 'user', itemId: 'u-1', decision: 'refund' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });
});
