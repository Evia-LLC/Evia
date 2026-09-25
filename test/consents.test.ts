import fs from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { consentWordingVersion } from '../shared/legal-content.ts';

const init = fs.readFileSync(new URL('../server/db/migrations/001_init.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../server/db/migrations/011_versioned_consents.sql', import.meta.url), 'utf8');
let db: PGlite;

async function user(id = 'u1') {
  await db.query(`INSERT INTO users VALUES ($1,'a@example.test','A','h','s','2026-01-01')`, [id]);
}
async function event(type: string, state: 'granted' | 'withdrawn', version: string, key: string, at: string) {
  await db.query(`INSERT INTO consent_events
    (id,user_id,consent_type,wording_version_id,state,recorded_at,idempotency_key)
    VALUES ($1,'u1',$2,$3,$4,$5,$6) ON CONFLICT (user_id,idempotency_key) DO NOTHING`,
  [`e-${key}`, type, version, state, at, key]);
}
async function current(type: string) {
  const result = await db.query<{ state: string; wording_version_id: string }>(
    `SELECT state, wording_version_id FROM consent_events WHERE user_id='u1' AND consent_type=$1
     ORDER BY recorded_at DESC, event_sequence DESC LIMIT 1`, [type]);
  return result.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(init);
  await db.exec(migration);
}, 30_000);

beforeEach(async () => {
  await db.exec('TRUNCATE consent_events, users CASCADE');
  await user();
});

describe('versioned consent events', () => {
  it('represents no decision with no event', async () => expect(await current('new-key')).toBeUndefined());
  it('resolves a grant', async () => { await event('photos','granted','v1','1','2026-01-01'); expect((await current('photos'))?.state).toBe('granted'); });
  it('resolves withdrawal without changing the grant', async () => {
    await event('photos','granted','v1','1','2026-01-01'); await event('photos','withdrawn','v1','2','2026-01-02');
    expect((await current('photos'))?.state).toBe('withdrawn');
    expect((await db.query(`SELECT * FROM consent_events WHERE consent_type='photos'`)).rows).toHaveLength(2);
  });
  it('allows a grant after withdrawal', async () => {
    await event('photos','withdrawn','v1','1','2026-01-01'); await event('photos','granted','v2','2','2026-01-02');
    expect(await current('photos')).toMatchObject({ state: 'granted', wording_version_id: 'v2' });
  });
  it('rejects mutation of history', async () => {
    await event('photos','granted','v1','1','2026-01-01');
    await expect(db.exec(`UPDATE consent_events SET state='withdrawn' WHERE id='e-1'`)).rejects.toThrow(/immutable/);
  });
  it('retains decisions under different wording versions', async () => {
    await event('photos','granted','v1','1','2026-01-01'); await event('photos','granted','v2','2','2026-01-02');
    expect((await db.query(`SELECT DISTINCT wording_version_id FROM consent_events`)).rows).toHaveLength(2);
  });
  it('keeps consent types independent', async () => {
    await event('photos','granted','v1','1','2026-01-01'); await event('cloud','withdrawn','v1','2','2026-01-02');
    expect((await current('photos'))?.state).toBe('granted'); expect((await current('cloud'))?.state).toBe('withdrawn');
  });
  it('makes retries idempotent', async () => {
    await event('photos','granted','v1','same','2026-01-01'); await event('photos','granted','v1','same','2026-01-01');
    expect((await db.query(`SELECT * FROM consent_events`)).rows).toHaveLength(1);
  });
  it('uses insertion sequence to resolve equal timestamps deterministically', async () => {
    await event('photos','granted','v1','1','2026-01-01'); await event('photos','withdrawn','v1','2','2026-01-01');
    expect((await current('photos'))?.state).toBe('withdrawn');
  });
  it('only recognises registered wording versions', () => {
    expect(consentWordingVersion('cloud-reasoning-v1')?.consentType).toBe('cloud_reasoning');
    expect(consentWordingVersion('unknown')).toBeUndefined();
  });
});
