// Error tracking (june26.md §1.7), gated on a SENTRY_DSN env var — no DSN, no-op.
// We talk to Sentry's envelope HTTP API directly via fetch rather than pull in
// an SDK: it's a few lines, runs natively on Workers, and keeps the dependency
// surface (and bundle) small. The DSN is read from the live Cloudflare runtime
// binding the same defensive way flags.ts does, so a dashboard flip takes
// effect without a redeploy and the unit suite (no cloudflare:workers) no-ops.
//
// Wired into recordDeadLetter, so every money-path failure the §1.2 hardening
// captures also lands in Sentry. Also exported for ad-hoc captureException.

export interface ParsedDsn {
  envelopeUrl: string;
  publicKey: string;
  projectId: string;
}

/** Parse a Sentry DSN (`https://<key>@<host>/<projectId>`) into the envelope
 *  ingest URL + auth key. Returns null for anything malformed. Pure. */
export function parseDsn(dsn: string | undefined | null): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\/+/, '');
    if (!publicKey || !projectId) return null;
    const envelopeUrl = `${u.protocol}//${u.host}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7`;
    return { envelopeUrl, publicKey, projectId };
  } catch {
    return null;
  }
}

export interface CaptureMeta {
  /** Logical source, e.g. 'stripe.webhook:chargeback_freeze'. Becomes a tag. */
  service?: string;
  /** Structured context attached as `extra`. */
  extra?: Record<string, unknown>;
  /** Override for tests; defaults to crypto.randomUUID(). */
  eventId?: string;
  /** Unix seconds; override for tests. */
  timestamp?: number;
}

/** Build the Sentry envelope (newline-delimited: header / item-header / event).
 *  Pure — caller supplies the parsed DSN. Returns the POST body string. */
export function buildEnvelope(dsn: ParsedDsn, error: unknown, meta: CaptureMeta): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const eventId = meta.eventId ?? crypto.randomUUID().replace(/-/g, '');
  const timestamp = meta.timestamp ?? Date.now() / 1000;

  const event = {
    event_id: eventId,
    timestamp,
    platform: 'javascript',
    level: 'error',
    logger: 'strikketorget',
    tags: meta.service ? { service: meta.service } : undefined,
    extra: meta.extra,
    exception: {
      values: [{
        type: error instanceof Error ? error.name : 'Error',
        value: message.slice(0, 2000),
        stacktrace: stack ? { frames: [{ function: '(raw)', context_line: stack.slice(0, 2000) }] } : undefined,
      }],
    },
  };

  const header = JSON.stringify({ event_id: eventId, sent_at: new Date(timestamp * 1000).toISOString() });
  const itemHeader = JSON.stringify({ type: 'event' });
  return `${header}\n${itemHeader}\n${JSON.stringify(event)}`;
}

async function runtimeDsn(): Promise<string | undefined> {
  try {
    const { env } = await import('cloudflare:workers');
    return (env as unknown as Record<string, string | undefined>).SENTRY_DSN;
  } catch {
    return undefined;
  }
}

/** Best-effort: report an error to Sentry if SENTRY_DSN is configured.
 *  Never throws — observability must not break the path it observes. */
export async function captureException(error: unknown, meta: CaptureMeta = {}): Promise<void> {
  try {
    const dsn = parseDsn(await runtimeDsn());
    if (!dsn) return;
    const body = buildEnvelope(dsn, error, meta);
    await fetch(dsn.envelopeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
      body,
    });
  } catch {
    // swallow — never let telemetry failure surface to the caller
  }
}
