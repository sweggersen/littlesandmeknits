// Structured logger — thin wrapper over console with consistent JSON shape.
//
// Cloudflare Workers captures stdout/stderr; the goal here isn't a fancy
// transport, it's that every log line in a hot path has the same fields so
// you can grep / filter by service + event in the Workers dashboard.
//
// Usage:
//   import { log } from '../log';
//   log.info('checkout.session_created', { listingId, userId, amount });
//   log.error('webhook.db_failure', { eventId, error: err });
//   log.warn('quota.exceeded', { userId, action });
//
// Output shape (one JSON object per line, prefix omitted in dev for readability):
//   {"t":"2026-06-02T12:34:56Z","lvl":"info","ev":"checkout.session_created","listingId":"l1",...}
//
// Conventions:
//   - First arg is a *namespaced event name*: `<service>.<action>` (snake_case
//     after the dot is fine: `webhook.db_failure`). Use stable strings so log
//     queries don't drift.
//   - Second arg is a flat field bag. Don't nest deeply; the Workers log UI
//     reads top-level keys.
//   - Errors: pass as `error: err` — we serialize the message + stack but
//     drop noisy properties.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type Fields = Record<string, unknown>;

function serializeError(e: unknown): unknown {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  if (typeof e === 'object' && e !== null) {
    try {
      return JSON.parse(JSON.stringify(e));
    } catch {
      return String(e);
    }
  }
  return e;
}

function emit(level: LogLevel, event: string, fields: Fields = {}): void {
  const out: Record<string, unknown> = {
    t: new Date().toISOString(),
    lvl: level,
    ev: event,
  };
  for (const [k, v] of Object.entries(fields)) {
    out[k] = k === 'error' ? serializeError(v) : v;
  }
  const line = JSON.stringify(out);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Fields) => emit('debug', event, fields),
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
};
