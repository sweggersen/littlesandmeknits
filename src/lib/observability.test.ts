import { describe, it, expect } from 'vitest';
import { parseDsn, buildEnvelope } from './observability';

const DSN = 'https://abc123@o42.ingest.sentry.io/5551212';

describe('parseDsn', () => {
  it('extracts the envelope URL + key from a valid DSN', () => {
    const p = parseDsn(DSN)!;
    expect(p).not.toBeNull();
    expect(p.publicKey).toBe('abc123');
    expect(p.projectId).toBe('5551212');
    expect(p.envelopeUrl).toBe('https://o42.ingest.sentry.io/api/5551212/envelope/?sentry_key=abc123&sentry_version=7');
  });

  it('returns null for empty / malformed input', () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn('')).toBeNull();
    expect(parseDsn('not a url')).toBeNull();
    expect(parseDsn('https://sentry.io/5551212')).toBeNull(); // no public key
    expect(parseDsn('https://abc@sentry.io/')).toBeNull();    // no project id
  });
});

describe('buildEnvelope', () => {
  const dsn = parseDsn(DSN)!;

  it('produces the 3-line envelope (header / item / event)', () => {
    const body = buildEnvelope(dsn, new Error('boom'), { eventId: 'deadbeef', timestamp: 1000, service: 'svc.x' });
    const lines = body.split('\n');
    expect(lines).toHaveLength(3);

    const header = JSON.parse(lines[0]);
    expect(header.event_id).toBe('deadbeef');
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' });

    const event = JSON.parse(lines[2]);
    expect(event.event_id).toBe('deadbeef');
    expect(event.timestamp).toBe(1000);
    expect(event.level).toBe('error');
    expect(event.tags).toEqual({ service: 'svc.x' });
    expect(event.exception.values[0].value).toBe('boom');
    expect(event.exception.values[0].type).toBe('Error');
  });

  it('handles string and object errors + attaches extra context', () => {
    const s = JSON.parse(buildEnvelope(dsn, 'plain string fail', { eventId: 'e', timestamp: 1, extra: { listing_id: 'L1' } }).split('\n')[2]);
    expect(s.exception.values[0].value).toBe('plain string fail');
    expect(s.extra).toEqual({ listing_id: 'L1' });

    const o = JSON.parse(buildEnvelope(dsn, { code: 42 }, { eventId: 'e', timestamp: 1 }).split('\n')[2]);
    expect(o.exception.values[0].value).toContain('42');
  });

  it('truncates very long messages', () => {
    const long = 'x'.repeat(5000);
    const event = JSON.parse(buildEnvelope(dsn, new Error(long), { eventId: 'e', timestamp: 1 }).split('\n')[2]);
    expect(event.exception.values[0].value.length).toBeLessThanOrEqual(2000);
  });
});
