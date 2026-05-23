import { describe, it, expect } from 'vitest';
import {
  composeReportDraft,
  reasonLabel,
  validateDecideInput,
  restoreStatus,
} from './moderation-helpers';

describe('reasonLabel', () => {
  it('maps known reasons to Norwegian', () => {
    expect(reasonLabel('scam')).toBe('Svindel');
    expect(reasonLabel('inappropriate')).toBe('Upassende innhold');
    expect(reasonLabel('wrong_category')).toBe('Feil kategori');
    expect(reasonLabel('spam')).toBe('Spam');
    expect(reasonLabel('other')).toBe('Annet');
  });

  it('falls back to raw value for unknown reasons', () => {
    expect(reasonLabel('xyz')).toBe('xyz');
  });
});

describe('composeReportDraft', () => {
  it('renders a single-report intro for one open sibling', () => {
    const draft = composeReportDraft(
      [{ reason: 'scam', description: 'Fake bilder', status: 'open' }],
      'listing',
    );
    expect(draft).toContain('Vi har mottatt en rapport om annonsen');
    expect(draft).toContain('«Svindel»');
    expect(draft).toContain('Fake bilder');
    expect(draft).toContain('Vennlig hilsen');
  });

  it('renders a multi-report intro with all reasons listed', () => {
    const draft = composeReportDraft(
      [
        { reason: 'scam', description: 'Fake bilder', status: 'open' },
        { reason: 'inappropriate', description: 'Meget upassende', status: 'open' },
      ],
      'listing',
    );
    expect(draft).toContain('Vi har mottatt 2 rapporter om annonsen');
    expect(draft).toContain('- «Svindel»: Fake bilder');
    expect(draft).toContain('- «Upassende innhold»: Meget upassende');
  });

  it('excludes dismissed siblings from the draft', () => {
    const draft = composeReportDraft(
      [
        { reason: 'scam', description: 'Real concern', status: 'open' },
        { reason: 'spam', description: 'False alarm', status: 'dismissed' },
      ],
      'listing',
    );
    expect(draft).toContain('Real concern');
    expect(draft).not.toContain('False alarm');
    // Only one report visible → singular phrasing
    expect(draft).toContain('Vi har mottatt en rapport');
  });

  it('keeps resolved siblings for context', () => {
    const draft = composeReportDraft(
      [
        { reason: 'scam', description: 'A', status: 'resolved' },
        { reason: 'spam', description: 'B', status: 'open' },
      ],
      'listing',
    );
    expect(draft).toContain('2 rapporter');
    expect(draft).toContain('«Svindel»: A');
    expect(draft).toContain('«Spam»: B');
  });

  it('uses the right definite article for each target type', () => {
    expect(composeReportDraft([{ reason: 'scam', status: 'open' }], 'listing')).toContain('om annonsen');
    expect(composeReportDraft([{ reason: 'scam', status: 'open' }], 'store')).toContain('om butikken');
    expect(composeReportDraft([{ reason: 'scam', status: 'open' }], 'commission_request')).toContain('om oppdraget');
  });

  it('omits the description clause when none provided', () => {
    const draft = composeReportDraft(
      [{ reason: 'spam', status: 'open' }],
      'listing',
    );
    expect(draft).toContain('grunnen «Spam».');
    expect(draft).not.toContain('beskrevet som');
  });

  it('mentions the 48-hour deadline + freeze policy', () => {
    const draft = composeReportDraft(
      [{ reason: 'scam', status: 'open' }],
      'listing',
    );
    expect(draft).toContain('48 timer');
    expect(draft).toContain('frosset');
  });
});

describe('validateDecideInput', () => {
  it('accepts a freeze with a first message', () => {
    const res = validateDecideInput({ reportId: 'r1', action: 'freeze', firstMessage: 'Hei' });
    expect(res.ok).toBe(true);
  });

  it('accepts a dismiss with no first message', () => {
    const res = validateDecideInput({ reportId: 'r1', action: 'dismiss' });
    expect(res.ok).toBe(true);
  });

  it('rejects a freeze with an empty message', () => {
    const res = validateDecideInput({ reportId: 'r1', action: 'freeze', firstMessage: '   ' });
    expect(res.ok).toBe(false);
  });

  it('rejects an unknown action', () => {
    const res = validateDecideInput({ reportId: 'r1', action: 'destroy' });
    expect(res.ok).toBe(false);
  });

  it('rejects a missing reportId', () => {
    const res = validateDecideInput({ action: 'dismiss' });
    expect(res.ok).toBe(false);
  });
});

describe('restoreStatus', () => {
  it('restores active when pre-freeze was active', () => {
    expect(restoreStatus('active')).toBe('active');
  });

  it('restores draft when pre-freeze was draft', () => {
    expect(restoreStatus('draft')).toBe('draft');
  });

  it('defaults to active for intermediate / unsafe statuses', () => {
    expect(restoreStatus('reserved')).toBe('active');
    expect(restoreStatus('shipped')).toBe('active');
    expect(restoreStatus('sold')).toBe('active');
    expect(restoreStatus('rejected')).toBe('active');
  });

  it('defaults to active when pre-freeze is null/undefined', () => {
    expect(restoreStatus(null)).toBe('active');
    expect(restoreStatus(undefined)).toBe('active');
  });
});
