// Soft-delete helpers — explicit filtering so readers can't silently skip the
// `deleted_at IS NULL` clause on tables that use the soft-delete pattern.
//
// Tables with deleted_at columns:
//   - stores            (cron purges after 90 days)
//   - profiles          (anonymized on delete via deleteAccount; readers
//                        intentionally see anonymized rows, not filtered out,
//                        so existing conversations/listings remain coherent)
//
// Usage:
//   const { data } = await notDeleted(supabase.from('stores').select('*'));
//   // equivalent to: .is('deleted_at', null)
//
// The audit test src/lib/db/soft-delete.test.ts pins that every stores query
// in the codebase either filters deleted_at or is explicitly listed as an
// exception (e.g. archived-preview pages).

interface QueryWithIs<Q> {
  is(column: string, value: null): Q;
}

export function notDeleted<Q extends QueryWithIs<Q>>(query: Q): Q {
  return query.is('deleted_at', null);
}

// For readers that *want* to see soft-deleted rows (admin tools, archived
// previews), wrap them with this marker so the audit test recognizes the
// exception explicitly rather than treating it as a bug.
export const SOFT_DELETE_EXCEPTION_NOTE =
  'soft-delete exception: reader intentionally includes deleted_at rows';
