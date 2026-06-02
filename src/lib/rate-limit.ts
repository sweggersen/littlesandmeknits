// In-memory sliding-window rate limiter, keyed by (action, identifier).
//
// Scope:
//   - Per Worker instance. Cloudflare runs multiple isolates, so an
//     attacker can multiply this limit by the number of isolates they
//     happen to hit. Sufficient for accidental flooding (a runaway script
//     in a browser tab); real DoS protection lives in Cloudflare WAF.
//   - Useful for pre-auth endpoints where the DB-backed user_action_counts
//     quota system can't apply (no user id yet).
//
// Usage:
//   const allowed = checkRateLimit('vipps.start', clientIp(request), {
//     limit: 10, windowSeconds: 60,
//   });
//   if (!allowed) return new Response('Too many requests', { status: 429 });

interface Window {
  // Unix-ms timestamps of recent hits, oldest first. Trimmed on every check.
  hits: number[];
}

const STATE = new Map<string, Window>();

/** Returns the client IP from CF-Connecting-IP (Cloudflare's real client IP
 *  header), falling back to X-Forwarded-For, then '0.0.0.0' so the limiter
 *  always has *some* key (an unknown-source bucket is better than no bucket). */
export function clientIp(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return '0.0.0.0';
}

export interface RateLimitOpts {
  /** Max hits allowed in the window. Inclusive — limit=10 allows the 10th hit. */
  limit: number;
  /** Sliding window length, in seconds. */
  windowSeconds: number;
}

/** Returns true if the call is allowed (and records the hit), false if rate-limited. */
export function checkRateLimit(
  action: string,
  identifier: string,
  opts: RateLimitOpts,
): boolean {
  const key = `${action}:${identifier}`;
  const now = Date.now();
  const cutoff = now - opts.windowSeconds * 1000;

  let win = STATE.get(key);
  if (!win) {
    win = { hits: [] };
    STATE.set(key, win);
  }

  // Trim expired hits.
  while (win.hits.length && win.hits[0] < cutoff) win.hits.shift();

  if (win.hits.length >= opts.limit) return false;
  win.hits.push(now);
  return true;
}

/** Test helper — clear all limiter state. Don't use in production code. */
export function _resetRateLimiterForTests(): void {
  STATE.clear();
}
