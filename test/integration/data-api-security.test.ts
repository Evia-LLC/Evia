import { describe, expect, it } from 'vitest';
import { createRequestClient } from '../../server/lib/supabase.ts';
import { verifyDataApi } from '../../server/lib/data-api.ts';
import { adminSql, database, result } from '../helpers/data-api.ts';

describe('real Data API and privileges', () => {
  it('reaches the installed contract using the service credential', async () => {
    await expect(verifyDataApi()).resolves.toBeUndefined();
    const version = adminSql('SELECT version();');
    expect(version).toMatch(/PostgreSQL/);
    expect(version).not.toMatch(/pglite/i);
  });
  it('enables RLS without policies and uses invoker functions/views', () => {
    expect(adminSql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;").trim()).toBe('0');
    expect(adminSql("SELECT count(*) FROM pg_policies WHERE schemaname='public';").trim()).toBe('0');
    expect(adminSql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','evia_private') AND p.proname LIKE 'evia_%' AND p.prosecdef;").trim()).toBe('0');
    expect(adminSql("SELECT reloptions::text FROM pg_class WHERE oid='public.evia_current_consents'::regclass;")).toContain('security_invoker=true');
  });
  it('denies anon table, view, and domain-function access', async () => {
    const anon = createRequestClient();
    for (const name of ['users', 'sessions', 'blobs', 'voice_lines', 'evia_current_consents']) {
      const reply = await anon.from(name).select('*').limit(1);
      expect(reply.error, name).not.toBeNull();
      expect(reply.data, name).toBeNull();
    }
    expect((await anon.rpc('evia_delete_account', { p_user_id: 'not-a-user' })).error).not.toBeNull();
    expect(adminSql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','evia_private') AND p.proname LIKE 'evia_%' AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'));").trim()).toBe('0');
  });
  it('preserves PostgreSQL codes and rejects an invalid bearer through real HTTP', async () => {
    const first = { id: 'duplicate', email: 'duplicate@example.test', display_name: 'D', password_hash: 'h', password_salt: 's', created_at: '2026-01-01' };
    await result(database().from('users').insert(first));
    await expect(result(database().from('users').insert(first))).rejects.toMatchObject({ code: '23505', httpStatus: 409 });
    expect((await createRequestClient(process.env, 'invalid-token').from('users').select('id')).error).not.toBeNull();
  });
});
