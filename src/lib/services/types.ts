import type { TypedSupabaseClient } from '../supabase';

export interface ServiceContext {
  supabase: TypedSupabaseClient;
  admin: TypedSupabaseClient;
  user: { id: string; email?: string };
  env: Record<string, string>;
}

export type ServiceResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: ServiceErrorCode; message: string };

export type ServiceErrorCode =
  | 'unauthorized' | 'forbidden' | 'not_found' | 'bad_input'
  | 'conflict' | 'server_error' | 'service_unavailable';

export const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data });

export const fail = (code: ServiceErrorCode, message: string): ServiceResult<never> =>
  ({ ok: false, code, message });
