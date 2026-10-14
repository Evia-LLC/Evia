import { createAdminClient } from './supabase.ts';

/** Transport errors are internal. Do not map upstream HTTP status to a route status. */
export class DataApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: { message: string; code?: string; details?: string | null; hint?: string | null }, status = 0) {
    super(error.message);
    this.name = 'DataApiError';
    this.code = error.code ?? '';
    this.httpStatus = status;
    this.details = error.details ?? null;
    this.hint = error.hint ?? null;
  }
}

interface Response {
  data: unknown;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
  status?: number;
  count?: number | null;
}

/** One place to handle the SDK's result errors, including non-JSON gateway failures. */
export async function result<T>(request: PromiseLike<Response>): Promise<T> {
  const response = await request;
  if (response.error) throw new DataApiError(response.error, response.status);
  return response.data as T;
}

export async function affected(request: PromiseLike<Response>): Promise<number> {
  const response = await request;
  if (response.error) throw new DataApiError(response.error, response.status);
  if (response.count === null || response.count === undefined) {
    throw new DataApiError({ message: 'Data API did not return the requested exact count.' });
  }
  return response.count;
}

/** Only authenticated server-side credentials are used for application persistence. */
export const database = createAdminClient;

/** Full-list contracts must explicitly page beyond the Data API's response ceiling. */
export async function allPages<T>(page: (from: number, to: number) => PromiseLike<Response>, limit = Infinity): Promise<T[]> {
  const collected: T[] = [];
  const pageSize = 500;
  if (limit === 0) return collected;
  for (let from = 0; ;) {
    const batch = await result<T[]>(page(from, Math.min(from + pageSize - 1, limit - 1)));
    if (!Array.isArray(batch)) throw new DataApiError({ message: 'Data API did not return a row collection.' });
    if (batch.length === 0) return collected;
    collected.push(...batch);
    if (collected.length >= limit) return collected;
    // The hosted response ceiling can be lower than our requested page size.
    // Advance by what was returned and stop only on an empty page.
    from += batch.length;
  }
}

export function encodeBytea(bytes: Buffer): string {
  return '\\x' + bytes.toString('hex');
}

export function decodeBytea(value: string): Buffer {
  if (typeof value !== 'string' || !/^\\x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new DataApiError({ message: 'Invalid bytea representation from the Data API.' });
  }
  return Buffer.from(value.slice(2), 'hex');
}

export const DATA_API_CONTRACT = 'evia-managed-auth-v2';

export async function verifyDataApi(): Promise<void> {
  const status = await result<{ contract: string }>(database().rpc('evia_data_api_status'));
  if (status?.contract !== DATA_API_CONTRACT) {
    throw new DataApiError({ message: 'The installed Data API schema contract is incompatible.' });
  }
}
