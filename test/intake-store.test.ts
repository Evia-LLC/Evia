import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { emptyIntakeDraft } from '../shared/intake.ts';

const state = vi.hoisted(() => ({ db: null as any, failProfile: false }));
const query = async (db: any, sql: string, ...params: unknown[]) => {
  let i = 0; return db.query(sql.replace(/\?/g, () => `$${++i}`), params);
};
vi.mock('../server/db/index.ts', () => ({
  row: async (sql: string, ...params: unknown[]) => (await query(state.db, sql, ...params)).rows[0],
  transaction: async (callback: (tx: any) => Promise<unknown>) => state.db.transaction(async (db: any) => callback({
    row: async (sql: string, ...params: unknown[]) => (await query(db, sql, ...params)).rows[0],
    run: async (sql: string, ...params: unknown[]) => {
      if (state.failProfile && sql.startsWith('UPDATE skin_profiles')) throw new Error('Simulated write failure');
      return (await query(db, sql, ...params)).affectedRows;
    },
  })),
}));
const { saveIntake, getIntake } = await import('../server/db/intake.ts');
beforeAll(async () => {
  state.db = new PGlite();
  for (const file of ['001_init.sql', '004_pregnancy_status.sql', '011_consultation_intake.sql']) {
    await state.db.exec(readFileSync(new URL(`../server/db/migrations/${file}`, import.meta.url), 'utf8'));
  }
}, 30_000);
afterAll(async () => { await state.db.close(); });
beforeEach(async () => {
  state.failProfile = false; await state.db.exec('TRUNCATE users CASCADE');
  for (const id of ['account-a', 'account-b']) {
    await state.db.query('INSERT INTO users VALUES ($1,$2,$3,$4,$5,$6)', [id, `${id}@test.invalid`, id, 'unused', 'unused', '2026-09-17']);
    await state.db.query('INSERT INTO skin_profiles (user_id,updated_at) VALUES ($1,$2)', [id, '2026-09-17']);
  }
});
const draft = (name = 'Ada') => {
  const value = emptyIntakeDraft(); value.storageConsent = true; value.answers.preferredName = name;
  value.answers.skinFeel = 'tight-dry'; value.answers.medications = 'A private treatment'; return value;
};
describe('intake persistence in real isolated Postgres', () => {
  it('round trips private notes with owner isolation and consent timestamps', async () => {
    await saveIntake('account-a', draft()); await saveIntake('account-b', draft('Bea'));
    expect((await getIntake('account-a'))?.answers.preferredName).toBe('Ada');
    expect((await getIntake('account-b'))?.answers.preferredName).toBe('Bea');
    expect(await getIntake('unknown')).toBeNull();
    expect((await getIntake('account-a'))?.consentedAt).toMatch(/^\d{4}-/);
    expect((await getIntake('account-a'))?.answers.medications).toBe('A private treatment');
  });
  it('does not store anything without explicit storage consent', async () => {
    await expect(saveIntake('account-a', emptyIntakeDraft())).rejects.toThrow('permission');
    expect(await getIntake('account-a')).toBeNull();
  });
  it('updates only the owner profile and does not copy medical notes into profile sensitivities', async () => {
    await saveIntake('account-a', draft());
    const result = await state.db.query('SELECT user_id,skin_type,pregnancy_status,sensitivities_json FROM skin_profiles ORDER BY user_id');
    expect(result.rows[0]).toMatchObject({ user_id: 'account-a', skin_type: 'dry', pregnancy_status: 'unknown', sensitivities_json: '[]' });
    expect(result.rows[1].skin_type).toBe('unknown');
  });
  it('rolls back the intake and name when a profile update fails', async () => {
    state.failProfile = true;
    await expect(saveIntake('account-a', draft())).rejects.toThrow('Simulated');
    expect(await getIntake('account-a')).toBeNull();
    expect((await state.db.query('SELECT display_name FROM users WHERE id=$1', ['account-a'])).rows[0].display_name).toBe('account-a');
  });
  it('cascades account deletion to its intake without affecting the other account', async () => {
    await saveIntake('account-a', draft()); await saveIntake('account-b', draft('Bea'));
    await state.db.query('DELETE FROM users WHERE id=$1', ['account-a']);
    expect(await getIntake('account-a')).toBeNull(); expect(await getIntake('account-b')).not.toBeNull();
  });
  it('rejects an unknown owner before writing any notes', async () => {
    await expect(saveIntake('missing', draft())).rejects.toThrow('unavailable');
    expect((await state.db.query('SELECT * FROM consultation_intakes')).rows).toHaveLength(0);
  });
});
