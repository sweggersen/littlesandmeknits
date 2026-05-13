import type { ServiceContext } from '../types';

type MockRow = Record<string, unknown>;

interface MockQueryBuilder {
  select: (...args: unknown[]) => MockQueryBuilder;
  insert: (row: MockRow | MockRow[]) => MockQueryBuilder;
  update: (row: MockRow) => MockQueryBuilder;
  delete: () => MockQueryBuilder;
  eq: (col: string, val: unknown) => MockQueryBuilder;
  neq: (col: string, val: unknown) => MockQueryBuilder;
  in: (col: string, vals: unknown[]) => MockQueryBuilder;
  is: (col: string, val: unknown) => MockQueryBuilder;
  not: (col: string, op: string, val: unknown) => MockQueryBuilder;
  lt: (col: string, val: unknown) => MockQueryBuilder;
  gte: (col: string, val: unknown) => MockQueryBuilder;
  order: (col: string, opts?: Record<string, unknown>) => MockQueryBuilder;
  limit: (n: number) => MockQueryBuilder;
  single: () => Promise<{ data: MockRow | null; error: null }>;
  maybeSingle: () => Promise<{ data: MockRow | null; error: null }>;
}

function createChainableMock(resolveData: MockRow | MockRow[] | null = null): MockQueryBuilder {
  const builder: MockQueryBuilder = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    is: () => builder,
    not: () => builder,
    lt: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => Promise.resolve({ data: Array.isArray(resolveData) ? resolveData[0] : resolveData, error: null }),
    maybeSingle: () => Promise.resolve({ data: Array.isArray(resolveData) ? resolveData[0] : resolveData, error: null }),
  };
  return builder;
}

export interface MockSupabase {
  from: (table: string) => MockQueryBuilder;
  storage: { from: (bucket: string) => { upload: () => Promise<{ error: null }>; remove: () => Promise<{ error: null }>; createSignedUrl: (path: string, ttl: number) => Promise<{ data: { signedUrl: string } | null; error: null }> } };
  auth: { updateUser: () => Promise<{ error: null }> };
  rpc: () => Promise<{ data: null; error: null }>;
  _tableData: Map<string, MockRow | MockRow[] | null>;
  _setTableData: (table: string, data: MockRow | MockRow[] | null) => void;
}

export function createMockSupabase(): MockSupabase {
  const tableData = new Map<string, MockRow | MockRow[] | null>();

  return {
    _tableData: tableData,
    _setTableData: (table, data) => tableData.set(table, data),
    from: (table: string) => createChainableMock(tableData.get(table) ?? null),
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ error: null }),
        remove: () => Promise.resolve({ error: null }),
        createSignedUrl: (_path: string, _ttl: number) =>
          Promise.resolve({ data: { signedUrl: 'https://signed.example.com/file.pdf' }, error: null }),
      }),
    },
    auth: { updateUser: () => Promise.resolve({ error: null }) },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

export function createMockContext(overrides?: Partial<ServiceContext>): ServiceContext & { _supabase: MockSupabase; _admin: MockSupabase } {
  const supabase = createMockSupabase();
  const admin = createMockSupabase();

  const ctx = {
    supabase: supabase as unknown as ServiceContext['supabase'],
    admin: admin as unknown as ServiceContext['admin'],
    user: { id: 'user-1', email: 'test@example.com' },
    env: {
      PUBLIC_SITE_URL: 'https://test.example.com',
      STRIPE_SECRET_KEY: 'sk_test_xxx',
    },
    _supabase: supabase,
    _admin: admin,
    ...overrides,
  };

  return ctx as ServiceContext & { _supabase: MockSupabase; _admin: MockSupabase };
}
