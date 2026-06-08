import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { isHelthjemConfigured, getTracking, __resetHelthjemTokenCache } from './helthjem';

// The booking/tracking field shapes are TODO (docs gated), so we only test the
// stable contract: the config gate, and that the OAuth token is fetched once
// and reused (so we don't hammer the token endpoint per call).

describe('isHelthjemConfigured', () => {
  it('is false unless all three credentials are present', () => {
    expect(isHelthjemConfigured(undefined)).toBe(false);
    expect(isHelthjemConfigured({})).toBe(false);
    expect(isHelthjemConfigured({ clientId: 'a', clientSecret: 'b' })).toBe(false);
    expect(isHelthjemConfigured({ clientId: 'a', clientSecret: 'b', shopId: 'c' })).toBe(true);
  });
});

describe('token caching', () => {
  const auth = { clientId: 'id', clientSecret: 'secret', shopId: 'shop' };

  beforeEach(() => {
    __resetHelthjemTokenCache();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it('fetches the OAuth token once across multiple calls, then reuses it', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/oauth2/v1/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      // tracking fetch
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await getTracking(auth, 'ABC123');
    await getTracking(auth, 'ABC123');

    const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/token'));
    expect(tokenCalls).toHaveLength(1); // token cached after first fetch
  });

  it('returns [] (no throw) when the token endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    const events = await getTracking(auth, 'ABC123');
    expect(events).toEqual([]);
  });
});
