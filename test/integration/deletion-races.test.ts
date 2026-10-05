/** P1-T09 — account/asset deletion serialization and rollback invariants. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, row, run } from '../../server/db/index.ts';
import { deleteAccount } from '../../server/privacy/delete-account.ts';
import { insertScan } from '../../server/db/scans.ts';

const lane = process.env.ELOHIM_PG_LANE === '1';
const tag = `p1t09-${process.pid}`;
const userA = `${tag}-a`;
const userB = `${tag}-b`;
const userC = `${tag}-c`;
const sample = {
  capturedAt: new Date().toISOString(),
  metrics: { hydration: 1, evenness: 1, oiliness: 1, redness: 1, texture: 1, pores: 1, darkSpots: 1, underEye: 1, acneIndicators: 1 },
  regions: {}, quality: {}, confidence: 1, modelVersion: 'fixture', observations: [],
};

beforeAll(async () => {
  if (!lane) return;
  await migrate();
  await run('INSERT INTO users (id, email, display_name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)', userA, `${userA}@test.local`, 'A', 'hash', 'salt', new Date().toISOString());
  await run('INSERT INTO users (id, email, display_name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)', userB, `${userB}@test.local`, 'B', 'hash', 'salt', new Date().toISOString());
  await run('INSERT INTO users (id, email, display_name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)', userC, `${userC}@test.local`, 'C', 'hash', 'salt', new Date().toISOString());
  await run('INSERT INTO blobs (ref, data, bytes, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)', 'legacy-a', Buffer.from('a'), 1, new Date().toISOString(), 'b-photo', Buffer.from('b'), 1, new Date().toISOString());
  await run(`INSERT INTO skin_scans (id, user_id, captured_at, image_ref, thumb_ref, metrics_json, model_version)
    VALUES (?, ?, ?, ?, ?, '{}', 'fixture'), (?, ?, ?, ?, ?, '{}', 'fixture')`,
    `${tag}-scan-a`, userA, new Date().toISOString(), 'legacy-a', null,
    `${tag}-scan-b`, userB, new Date().toISOString(), 'b-photo', null);
}, 60_000);

afterAll(async () => {
  if (!lane) return;
  await run(`DROP TRIGGER IF EXISTS ${tag.replaceAll('-', '_')}_fail_delete ON users`);
  await run(`DROP FUNCTION IF EXISTS ${tag.replaceAll('-', '_')}_fail_delete()`);
  await run('DELETE FROM users WHERE id LIKE ?', `${tag}%`);
  await run('DELETE FROM blobs WHERE ref IN (?, ?)', 'legacy-a', 'b-photo');
});

describe.skipIf(!lane)('atomic account deletion', () => {
  it('rolls back the complete delete when a relational delete fails', async () => {
    const fn = `${tag.replaceAll('-', '_')}_fail_delete`;
    await run(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture delete failure'; END; $$`);
    await run(`CREATE TRIGGER ${fn} BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    await expect(deleteAccount(userA)).rejects.toThrow('fixture delete failure');
    expect(await row('SELECT id FROM users WHERE id = ?', userA)).toBeTruthy();
    expect(await row('SELECT ref FROM blobs WHERE ref = ?', 'legacy-a')).toBeTruthy();
    await run(`DROP TRIGGER ${fn} ON users`);
  });

  it('deletes legacy refs atomically, is idempotent, and isolates account B', async () => {
    const result = await deleteAccount(userA);
    expect(result.ok).toBe(true);
    expect(await row('SELECT id FROM users WHERE id = ?', userA)).toBeUndefined();
    expect(await row('SELECT ref FROM blobs WHERE ref = ?', 'legacy-a')).toBeUndefined();
    expect(await row('SELECT id FROM users WHERE id = ?', userB)).toBeTruthy();
    expect(await row('SELECT ref FROM blobs WHERE ref = ?', 'b-photo')).toBeTruthy();
    expect(await deleteAccount(userA)).toEqual({ ok: true, blobsShredded: 0, blobsFailed: 0 });
  });

  it('serializes capture creation with deletion so no row is stranded', async () => {
    const [created, deleted] = await Promise.allSettled([
      insertScan(userC, sample),
      deleteAccount(userC),
    ]);
    expect(deleted.status).toBe('fulfilled');
    expect(await row('SELECT id FROM users WHERE id = ?', userC)).toBeUndefined();
    expect(await row('SELECT id FROM skin_scans WHERE user_id = ?', userC)).toBeUndefined();
    // Either the capture acquired the fence first and was included in the
    // delete, or deletion won and the capture was rejected. Both are safe.
    expect(created.status === 'fulfilled' || created.status === 'rejected').toBe(true);
  });
});
