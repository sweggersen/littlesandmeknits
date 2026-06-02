import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { checkRateLimit, clientIp, _resetRateLimiterForTests } from './rate-limit';

describe('clientIp', () => {
  it('prefers CF-Connecting-IP', () => {
    const r = new Request('https://x.io', {
      headers: {
        'cf-connecting-ip': '1.2.3.4',
        'x-forwarded-for': '9.9.9.9',
      },
    });
    expect(clientIp(r)).toBe('1.2.3.4');
  });

  it('falls back to X-Forwarded-For first hop', () => {
    const r = new Request('https://x.io', {
      headers: { 'x-forwarded-for': '5.5.5.5, 1.1.1.1, 2.2.2.2' },
    });
    expect(clientIp(r)).toBe('5.5.5.5');
  });

  it('returns 0.0.0.0 when no headers set', () => {
    expect(clientIp(new Request('https://x.io'))).toBe('0.0.0.0');
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => {
    _resetRateLimiterForTests();
  });

  it('allows up to the limit then blocks', () => {
    const opts = { limit: 3, windowSeconds: 60 };
    expect(checkRateLimit('test', 'ip1', opts)).toBe(true);
    expect(checkRateLimit('test', 'ip1', opts)).toBe(true);
    expect(checkRateLimit('test', 'ip1', opts)).toBe(true);
    expect(checkRateLimit('test', 'ip1', opts)).toBe(false);
    expect(checkRateLimit('test', 'ip1', opts)).toBe(false);
  });

  it('isolates buckets by identifier', () => {
    const opts = { limit: 1, windowSeconds: 60 };
    expect(checkRateLimit('test', 'a', opts)).toBe(true);
    expect(checkRateLimit('test', 'a', opts)).toBe(false);
    expect(checkRateLimit('test', 'b', opts)).toBe(true);
  });

  it('isolates buckets by action', () => {
    const opts = { limit: 1, windowSeconds: 60 };
    expect(checkRateLimit('a1', 'ip', opts)).toBe(true);
    expect(checkRateLimit('a1', 'ip', opts)).toBe(false);
    expect(checkRateLimit('a2', 'ip', opts)).toBe(true);
  });

  it('expires hits after the window passes', () => {
    vi.useFakeTimers();
    const start = new Date('2026-06-01T12:00:00Z');
    vi.setSystemTime(start);

    const opts = { limit: 2, windowSeconds: 60 };
    expect(checkRateLimit('test', 'ip', opts)).toBe(true);
    expect(checkRateLimit('test', 'ip', opts)).toBe(true);
    expect(checkRateLimit('test', 'ip', opts)).toBe(false);

    vi.setSystemTime(new Date(start.getTime() + 61_000));
    expect(checkRateLimit('test', 'ip', opts)).toBe(true);
    vi.useRealTimers();
  });
});

afterEach(() => {
  _resetRateLimiterForTests();
});
