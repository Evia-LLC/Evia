import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const state = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock('../server/db/index.ts', () => {
  const adapters = (db: { query: (sql: string, args: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }) => {
    const query = (sql: string, args: unknown[]) => { let n = 0; return db.query(sql.replace(/\?/g, () => `$${++n}`), args); };
    return { row: async (sql: string, ...args: unknown[]) => (await query(sql, args)).rows[0] ?? null,
      rows: async (sql: string, ...args: unknown[]) => (await query(sql, args)).rows,
      run: async (sql: string, ...args: unknown[]) => (await query(sql, args)).affectedRows ?? 0 };
  };
  return { row: (...args: [string, ...unknown[]]) => adapters(state.db!).row(...args),
    rows: (...args: [string, ...unknown[]]) => adapters(state.db!).rows(...args),
    run: (...args: [string, ...unknown[]]) => adapters(state.db!).run(...args),
    transaction: (fn: (tx: unknown) => unknown) => state.db!.transaction(tx => fn(adapters(tx))) };
});
const { createUser } = await import('../server/db/users.ts');
beforeAll(async () => {
  state.db = new PGlite();
  for (const name of readdirSync('server/db/migrations').filter(n => n.endsWith('.sql')).sort()) await state.db.exec(readFileSync(`server/db/migrations/${name}`, 'utf8'));
}, 60_000);
afterAll(async () => { await state.db?.close(); });
it('stores self-declared DOB and a versioned sample Terms event in the same transaction', async () => {
  const id = await createUser('adult@example.test', 'sample-password', 'Sample', { dateOfBirth: '2000-01-01', ip: '127.0.0.1' });
  expect((await state.db!.query('SELECT date_of_birth FROM users WHERE id = $1', [id])).rows).toEqual([{ date_of_birth: '2000-01-01' }]);
  const event = (await state.db!.query('SELECT * FROM consent_events WHERE user_id = $1', [id])).rows[0] as Record<string, unknown>;
  expect(event.consent_type).toBe('registration_terms'); expect(event.actor_id).toBe(id);
  expect(event.metadata_json).toMatchObject({ choice: 'accepted', demoOnly: true, wordingStatus: 'placeholder', source: 'registration', documentVersions: { registration: 'registration-terms-pack-v1-demo-2026-09-24.1' } });
});
it('rolls back account creation if immutable consent recording fails', async () => {
  await state.db!.exec("CREATE FUNCTION reject_signup_evidence() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'evidence unavailable'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_signup_evidence BEFORE INSERT ON consent_events FOR EACH ROW EXECUTE FUNCTION reject_signup_evidence();");
  await expect(createUser('rollback@example.test', 'sample-password', 'Sample', { dateOfBirth: '2000-01-01' })).rejects.toThrow('evidence unavailable');
  expect((await state.db!.query('SELECT id FROM users WHERE email = $1', ['rollback@example.test'])).rows).toHaveLength(0);
});
