import { database, result } from '../lib/data-api.ts';
import type { Database } from './database.types.ts';

/** Internal authentication lookup; never a public user projection. */
export function findCredentials(email: string) {
  return result<Database['public']['Tables']['users']['Row'] | null>(database().from('users')
    .select('id,email,display_name,password_hash,password_salt,created_at,date_of_birth').eq('email', email).maybeSingle());
}
