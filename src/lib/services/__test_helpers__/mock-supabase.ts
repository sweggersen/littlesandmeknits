// Rigorous Supabase mock for service-layer unit tests (R2-15).
//
// The old per-test mockCtx returned `rows[table]` for every
// `.select().eq()` regardless of which column or value was filtered on.
// That let a regression swap `eq('id', input.offerId)` for
// `eq('id', 'literal')` and still pass. This mock fixes that by:
//
//   1. Recording every operation (op, table, filters, columns, payload)
//      so tests can assert "an update on listings where id='l1' set
//      status='shipped'" — not just "an update happened".
//
//   2. Letting fixtures be *functions of the filters*, so a test can make
//      a table return different rows depending on which id was queried,
//      and assert that the service queried the right one.
//
// Supported chains (everything the commerce services actually use):
//   from(t).select(cols).eq(c,v).maybeSingle() / .single()
//   from(t).select(cols).eq(c,v).eq(c2,v2).maybeSingle()
//   from(t).select(cols).eq(c,v)                      -> awaited list
//   from(t).select('*', {count:'exact',head:true}).eq(c,v) -> {count}
//   from(t).select(cols).in(c, arr)                   -> awaited list
//   from(t).select(cols).or(str)                      -> awaited list
//   from(t).insert(row).select(cols).single()/.maybeSingle()
//   from(t).insert(row)                               -> awaited
//   from(t).update(row).eq(c,v)[.eq(c2,v2)]           -> awaited
//   from(t).delete().eq(c,v)                          -> awaited
//   .order() / .limit() / .gte() / .lte() / .neq() / .ilike() chain through.

export type FilterType = 'eq' | 'in' | 'is' | 'neq' | 'gte' | 'lte' | 'ilike' | 'or';

export interface RecordedFilter {
  type: FilterType;
  col: string;
  val: unknown;
}

export interface RecordedOp {
  op: 'select' | 'insert' | 'update' | 'delete';
  table: string;
  filters: RecordedFilter[];
  cols?: string;
  count?: boolean;
  payload?: unknown;
}

/** Shape returned when a query builder is awaited (list / count form). */
export interface QueryResult {
  data: unknown;
  error: { message: string } | null;
  count?: number;
}

/** Read fixture: a static row/list, or a function of the recorded filters. */
type ReadFixture =
  | Record<string, unknown>
  | Array<Record<string, unknown>>
  | null
  | ((filters: RecordedFilter[]) => Record<string, unknown> | Array<Record<string, unknown>> | null);

export interface MockConfig {
  /** Per-table read results. */
  read?: Record<string, ReadFixture>;
  /** Per-table insert result: { data, error }. Defaults to { data: {id:'mock-id'} }. */
  insert?: Record<string, { data?: unknown; error?: { message: string } | null }>;
  /** Per-table update/delete error. Defaults to no error. */
  mutateError?: Record<string, { message: string } | null>;
  /** Per-table count for head queries. */
  counts?: Record<string, number>;
}

function resolveRead(fixture: ReadFixture | undefined, filters: RecordedFilter[]): unknown {
  if (fixture === undefined) return null;
  if (typeof fixture === 'function') return fixture(filters);
  return fixture;
}

class Query {
  filters: RecordedFilter[] = [];
  private opType: RecordedOp['op'] = 'select';
  private cols?: string;
  private isCount = false;
  private payload?: unknown;

  constructor(
    private readonly table: string,
    private readonly cfg: MockConfig,
    private readonly ops: RecordedOp[],
  ) {}

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    // select after insert keeps opType='insert'; otherwise it's a read.
    if (this.opType !== 'insert') this.opType = 'select';
    this.cols = cols;
    if (opts?.count === 'exact') this.isCount = true;
    return this;
  }
  insert(row: unknown) { this.opType = 'insert'; this.payload = row; return this; }
  update(row: unknown) { this.opType = 'update'; this.payload = row; return this; }
  delete() { this.opType = 'delete'; return this; }

  eq(col: string, val: unknown) { this.filters.push({ type: 'eq', col, val }); return this; }
  in(col: string, val: unknown) { this.filters.push({ type: 'in', col, val }); return this; }
  is(col: string, val: unknown) { this.filters.push({ type: 'is', col, val }); return this; }
  neq(col: string, val: unknown) { this.filters.push({ type: 'neq', col, val }); return this; }
  gte(col: string, val: unknown) { this.filters.push({ type: 'gte', col, val }); return this; }
  lte(col: string, val: unknown) { this.filters.push({ type: 'lte', col, val }); return this; }
  ilike(col: string, val: unknown) { this.filters.push({ type: 'ilike', col, val }); return this; }
  or(expr: string) { this.filters.push({ type: 'or', col: expr, val: expr }); return this; }
  order(_col?: string, _opts?: unknown) { return this; }
  limit(_n?: number) { return this; }

  private record(): void {
    this.ops.push({
      op: this.opType,
      table: this.table,
      filters: this.filters,
      cols: this.cols,
      count: this.isCount,
      payload: this.payload,
    });
  }

  private resultData(single: boolean): unknown {
    if (this.opType === 'insert') {
      const cfg = this.cfg.insert?.[this.table];
      return cfg?.data ?? { id: 'mock-id' };
    }
    const raw = resolveRead(this.cfg.read?.[this.table], this.filters);
    if (single) {
      if (Array.isArray(raw)) return raw[0] ?? null;
      return raw ?? null;
    }
    if (Array.isArray(raw)) return raw;
    return raw == null ? [] : [raw];
  }

  private error(): { message: string } | null {
    if (this.opType === 'insert') return this.cfg.insert?.[this.table]?.error ?? null;
    if (this.opType === 'update' || this.opType === 'delete') {
      return this.cfg.mutateError?.[this.table] ?? null;
    }
    return null;
  }

  async maybeSingle() {
    this.record();
    return { data: this.resultData(true), error: this.error() };
  }
  async single() {
    this.record();
    return { data: this.resultData(true), error: this.error() };
  }

  // Thenable: awaiting the builder runs the terminal "list" (or count) form.
  // Typed as PromiseLike<QueryResult> so `await query` infers correctly.
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.record();
    const value: QueryResult = this.isCount
      ? { data: null, count: this.cfg.counts?.[this.table] ?? 0, error: null }
      : { data: this.resultData(false), error: this.error() };
    return Promise.resolve(value).then(onfulfilled, onrejected);
  }
}

export interface MockSupabase {
  client: { from: (table: string) => Query };
  ops: RecordedOp[];
  /** All recorded inserts, optionally filtered by table. */
  inserts(table?: string): RecordedOp[];
  /** All recorded updates, optionally filtered by table. */
  updates(table?: string): RecordedOp[];
  /** All recorded selects, optionally filtered by table. */
  selects(table?: string): RecordedOp[];
  /** All recorded deletes, optionally filtered by table. */
  deletes(table?: string): RecordedOp[];
}

export function createMockSupabase(cfg: MockConfig = {}): MockSupabase {
  const ops: RecordedOp[] = [];
  const client = { from: (table: string) => new Query(table, cfg, ops) };
  const byOp = (op: RecordedOp['op'], table?: string) =>
    ops.filter((o) => o.op === op && (table === undefined || o.table === table));
  return {
    client,
    ops,
    inserts: (t) => byOp('insert', t),
    updates: (t) => byOp('update', t),
    selects: (t) => byOp('select', t),
    deletes: (t) => byOp('delete', t),
  };
}

/** Convenience: assert a recorded op filtered on a given column=value. */
export function hasFilter(op: RecordedOp, col: string, val: unknown): boolean {
  return op.filters.some((f) => f.col === col && f.val === val);
}
