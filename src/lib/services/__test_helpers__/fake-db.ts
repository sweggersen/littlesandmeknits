// In-memory Supabase fake for service-layer tests (R2-15+).
//
// Unlike mock-supabase.ts (a recording *stub* — returns whatever fixture you
// hand it regardless of filters), this is a *fake*: it stores seeded rows and
// actually applies eq/in/is/neq/gte/lte/ilike/or filters. That means a service
// that queries the wrong row — `eq('id', 'literal')` instead of
// `eq('id', input.id)` — gets back null and misbehaves, so the regression is
// caught automatically by every test, without the author writing a custom
// filter fixture.
//
// It also mutates state on insert/update/delete, so a test can assert the final
// row state (`db.rows('listings')`) the way it would against a real DB.
//
// Supported chains (everything the commerce services use):
//   from(t).select(cols).eq(c,v)[.eq...].maybeSingle() / .single()
//   from(t).select(cols).eq(c,v)                           -> awaited list
//   from(t).select('*', {count:'exact',head:true}).eq(...) -> { count }
//   from(t).select(cols).in(c, arr) / .or(expr)            -> awaited list
//   from(t).insert(row|rows)[.select(cols).single()/.maybeSingle()]
//   from(t).update(row).eq(c,v)[.eq..][.neq..][.select(cols)] -> awaited
//   from(t).delete().eq(c,v)                               -> awaited
//   .order() / .limit() chain through (no-ops on ordering for test purposes).

type Row = Record<string, unknown>;

type FilterType = 'eq' | 'in' | 'is' | 'neq' | 'gte' | 'lte' | 'ilike' | 'or';
interface Filter { type: FilterType; col: string; val: unknown }

export interface FakeOp {
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  table: string;
  filters: Filter[];
  payload?: unknown;
}

function ilikeMatch(value: unknown, pattern: string): boolean {
  if (typeof value !== 'string') return false;
  const re = new RegExp(
    '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$',
    'i',
  );
  return re.test(value);
}

// Project a row down to the selected columns, mimicking PostgREST's column
// projection. Returns the row unchanged for `*`, embedded relations
// (`table(...)`), or count/empty selects — we only project plain column lists,
// which is what the commerce services use. With projection on, a service that
// reads a column it didn't select gets `undefined` (a real bug), and a
// `.select('a,b')` -> `.select('')` mutation yields an empty row -> test fails.
function projectRow(row: Row, cols: string | undefined): Row {
  // undefined = `.select()` with no column list = all columns. An explicit
  // empty string (`.select('')`, e.g. a blanked-out mutant) projects to {}.
  if (cols === undefined || cols.includes('*') || cols.includes('(')) return row;
  const wanted = cols.split(',').map((c) => c.trim()).filter(Boolean);
  const out: Row = {};
  for (const c of wanted) out[c] = row[c];
  return out;
}

function matchesFilter(row: Row, f: Filter): boolean {
  if (f.type === 'or') {
    // Parse PostgREST-style "colA.eq.val,colB.eq.val" — row matches if ANY clause does.
    const clauses = String(f.val).split(',');
    return clauses.some((clause) => {
      const m = clause.match(/^([^.]+)\.eq\.(.+)$/);
      if (!m) return false;
      return String(row[m[1]]) === m[2];
    });
  }
  const cell = row[f.col];
  switch (f.type) {
    case 'eq': return cell === f.val;
    case 'neq': return cell !== f.val;
    case 'in': return Array.isArray(f.val) && (f.val as unknown[]).includes(cell);
    case 'is': return f.val === null ? cell == null : cell === f.val;
    case 'gte': return (cell as number) >= (f.val as number);
    case 'lte': return (cell as number) <= (f.val as number);
    case 'ilike': return ilikeMatch(cell, String(f.val));
  }
}

class FakeQuery {
  private filters: Filter[] = [];
  private opType: FakeOp['op'] = 'select';
  private payload?: unknown;
  private cols?: string;
  private hasSelect = false;
  private isCount = false;
  private conflict?: string;

  constructor(
    private readonly table: string,
    private readonly store: Map<string, Row[]>,
    private readonly ops: FakeOp[],
    private readonly seq: { n: number },
    private readonly project: boolean,
    private readonly updateError: Record<string, { message: string }>,
  ) {}

  private tableRows(): Row[] {
    let rows = this.store.get(this.table);
    if (!rows) { rows = []; this.store.set(this.table, rows); }
    return rows;
  }

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    // NEVER changes opType — insert/update/delete keep theirs, default stays select.
    this.hasSelect = true;
    this.cols = cols;
    if (opts?.count === 'exact') this.isCount = true;
    return this;
  }
  insert(row: unknown) { this.opType = 'insert'; this.payload = row; return this; }
  update(row: unknown) { this.opType = 'update'; this.payload = row; return this; }
  upsert(row: unknown, opts?: { onConflict?: string }) { this.opType = 'upsert'; this.payload = row; this.conflict = opts?.onConflict; return this; }
  delete() { this.opType = 'delete'; return this; }

  eq(col: string, val: unknown) { this.filters.push({ type: 'eq', col, val }); return this; }
  in(col: string, val: unknown) { this.filters.push({ type: 'in', col, val }); return this; }
  is(col: string, val: unknown) { this.filters.push({ type: 'is', col, val }); return this; }
  neq(col: string, val: unknown) { this.filters.push({ type: 'neq', col, val }); return this; }
  gte(col: string, val: unknown) { this.filters.push({ type: 'gte', col, val }); return this; }
  lte(col: string, val: unknown) { this.filters.push({ type: 'lte', col, val }); return this; }
  ilike(col: string, val: unknown) { this.filters.push({ type: 'ilike', col, val }); return this; }
  or(expr: string) { this.filters.push({ type: 'or', col: '__or__', val: expr }); return this; }
  order(_col?: string, _opts?: unknown) { return this; }
  limit(_n?: number) { return this; }

  private matching(): Row[] {
    return this.tableRows().filter((row) => this.filters.every((f) => matchesFilter(row, f)));
  }

  private genId(): string {
    this.seq.n += 1;
    return `${this.table}_${this.seq.n}`;
  }

  private record(): void {
    this.ops.push({ op: this.opType, table: this.table, filters: this.filters, payload: this.payload });
  }

  // Single terminal resolver used by maybeSingle/single/then.
  private run(mode: 'single' | 'maybe' | 'list'):
    { data: unknown; error: { message: string } | null; count?: number } {
    this.record();
    // Projection only shapes the RETURNED data; stored rows keep every field.
    const proj = (r: Row): Row => (this.project ? projectRow(r, this.cols) : r);

    if (this.opType === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload as Row[] : [this.payload as Row];
      const inserted = rows.map((r) => {
        const row: Row = { ...r };
        if (row.id === undefined) row.id = this.genId();
        this.tableRows().push(row);
        return row;
      });
      const data = mode === 'list' ? inserted.map(proj) : (inserted[0] ? proj(inserted[0]) : null);
      return { data, error: null };
    }

    if (this.opType === 'upsert') {
      // Insert, or update the row matching the onConflict key(s) (defaults to id).
      const rows = Array.isArray(this.payload) ? this.payload as Row[] : [this.payload as Row];
      const keys = (this.conflict ?? 'id').split(',').map((s) => s.trim());
      const out = rows.map((r) => {
        const existing = this.tableRows().find((row) => keys.every((k) => row[k] === (r as Row)[k]));
        if (existing) { Object.assign(existing, r); return existing; }
        const row: Row = { ...(r as Row) };
        if (row.id === undefined) row.id = this.genId();
        this.tableRows().push(row);
        return row;
      });
      const data = this.hasSelect ? (mode === 'list' ? out.map(proj) : (out[0] ? proj(out[0]) : null)) : null;
      return { data, error: null };
    }

    if (this.opType === 'update') {
      const injected = this.updateError[this.table];
      if (injected) return { data: null, error: injected };
      const hits = this.matching();
      for (const row of hits) Object.assign(row, this.payload as Row);
      // update().select() returns the updated rows; otherwise data is null.
      const data = this.hasSelect ? hits.map(proj) : null;
      return { data, error: null };
    }

    if (this.opType === 'delete') {
      const rows = this.tableRows();
      const survivors = rows.filter((row) => !this.filters.every((f) => matchesFilter(row, f)));
      this.store.set(this.table, survivors);
      return { data: null, error: null };
    }

    // select
    if (this.isCount) return { data: null, count: this.matching().length, error: null };
    const hits = this.matching();
    if (mode === 'list') return { data: hits.map(proj), error: null };
    if (mode === 'maybe') return { data: hits[0] ? proj(hits[0]) : null, error: null };
    // single: real PostgREST errors when row count != 1.
    if (hits.length === 1) return { data: proj(hits[0]), error: null };
    return { data: null, error: { message: hits.length === 0 ? 'no rows' : 'multiple rows' } };
  }

  async maybeSingle() { return this.run('maybe'); }
  async single() { return this.run('single'); }

  then<T1 = { data: unknown; error: { message: string } | null; count?: number }, T2 = never>(
    onF?: ((v: { data: unknown; error: { message: string } | null; count?: number }) => T1 | PromiseLike<T1>) | null,
    onR?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return Promise.resolve(this.run('list')).then(onF, onR);
  }
}

export interface FakeDb {
  client: { from: (table: string) => FakeQuery };
  ops: FakeOp[];
  /** Current rows for a table (post-mutation state). */
  rows(table: string): Row[];
  /** First row in a table matching a shallow predicate. */
  find(table: string, where: Row): Row | undefined;
}

export interface FakeDbOptions {
  /** When true, reads return only the columns named in `.select(...)` — so a
   *  service reading an unselected column gets undefined, and a `.select('a,b')`
   *  -> `.select('')` mutation produces an empty row. Off by default to keep
   *  simple tests terse; on for the money suites where projection matters. */
  projectColumns?: boolean;
  /** Tables whose update() should return this error (simulates a DB write
   *  failure) so the service's error branch can be exercised. */
  updateError?: Record<string, { message: string }>;
}

export function createFakeDb(seed: Record<string, Row[]> = {}, opts: FakeDbOptions = {}): FakeDb {
  const store = new Map<string, Row[]>();
  for (const [table, rows] of Object.entries(seed)) {
    store.set(table, rows.map((r) => ({ ...r })));
  }
  const ops: FakeOp[] = [];
  const seq = { n: 0 };
  const project = !!opts.projectColumns;
  const updateError = opts.updateError ?? {};
  return {
    client: { from: (table: string) => new FakeQuery(table, store, ops, seq, project, updateError) },
    ops,
    rows: (table) => store.get(table) ?? [],
    find: (table, where) =>
      (store.get(table) ?? []).find((row) => Object.entries(where).every(([k, v]) => row[k] === v)),
  };
}
