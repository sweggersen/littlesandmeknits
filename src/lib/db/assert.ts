// Lightweight runtime guards used at service boundaries.
//
// Most user IDs in this codebase come from `ctx.user.id` (middleware-
// loaded, Supabase-authenticated) and are guaranteed-shape UUIDs —
// they don't need re-validation. But the moment a value crosses an
// external boundary (URL param, form field, JSON body, third-party
// callback), it does. assertUuid is the single chokepoint.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Throws if `s` is not a canonical UUID. Use at any service
 *  boundary that receives an ID from outside the trusted set
 *  (URL/form/JSON/webhook payload). */
export function assertUuid(s: unknown, fieldName = 'id'): asserts s is string {
  if (typeof s !== 'string' || !UUID_RE.test(s)) {
    throw new Error(`Invalid UUID for ${fieldName}: ${typeof s === 'string' ? s.slice(0, 60) : typeof s}`);
  }
}

/** Non-throwing variant — returns the typed UUID or null. */
export function asUuid(s: unknown): string | null {
  return typeof s === 'string' && UUID_RE.test(s) ? s : null;
}

/** Same idea as assertUuid but for the PostgREST .or() filter DSL.
 *  Refuses any string that contains characters that would break out
 *  of an `eq.<value>` clause. Use this whenever you absolutely have
 *  to interpolate into .or() and can't restructure into .in() /
 *  separate queries. */
export function assertSafeForOrFilter(s: unknown, fieldName = 'value'): asserts s is string {
  if (typeof s !== 'string') {
    throw new Error(`Non-string value for ${fieldName}`);
  }
  // PostgREST .or() syntax: `column.op.value,column.op.value`. A safe
  // value contains only [A-Za-z0-9_-] (UUIDs satisfy this). Anything
  // else could break out and inject extra clauses.
  if (!/^[A-Za-z0-9_-]+$/.test(s)) {
    throw new Error(`Unsafe characters in ${fieldName}: ${s.slice(0, 60)}`);
  }
}

/** Builds a PostgREST `.or()` filter string for the common "row where
 *  EITHER columnA OR columnB equals value" pattern. Validates the
 *  value first so callers can't accidentally inject DSL operators.
 *
 *  Usage:
 *    .or(orEither('buyer_id', 'seller_id', ctx.user.id))
 *
 *  Throws if `value` isn't UUID-safe. Catches things like
 *  `${user.id}` where user.id was crafted to include
 *  `,buyer_id.gt.0`. */
export function orEither(columnA: string, columnB: string, value: unknown): string {
  assertSafeForOrFilter(value, `or(${columnA},${columnB})`);
  return `${columnA}.eq.${value},${columnB}.eq.${value}`;
}
