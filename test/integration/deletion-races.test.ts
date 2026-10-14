/** Real RPC rollback and deletion/capture contention. */
import { describe, expect, it } from 'vitest';
import { deleteAccount } from '../../server/privacy/delete-account.ts';
import { insertScan } from '../../server/db/scans.ts';
import { createAccount, sampleAnalysis } from '../helpers/two-accounts.ts';
import { adminSql, database, result } from '../helpers/data-api.ts';
import { encodeBytea } from '../../server/lib/data-api.ts';

describe('atomic account deletion', () => {
  it('rolls back blobs and owned products when a later relational delete fails', async () => {
    const { userId } = await createAccount('rollback-delete');
    await result(database().from('blobs').insert({ ref: 'rollback-blob', data: encodeBytea(Buffer.from([0, 255])), bytes: 2, created_at: '2026-01-01' }));
    await result(database().from('skin_scans').insert({ id: 'rollback-scan', user_id: userId, captured_at: '2026-01-01', image_ref: 'rollback-blob', metrics_json: '{}', model_version: 'fixture' }));
    await result(database().from('products').insert({ id: 'rollback-product', owner_id: userId, name: 'Owned', created_at: '2026-01-01' }));
    adminSql(`CREATE FUNCTION evia_private.reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture delete failure'; END; $$;
      CREATE TRIGGER reject_delete BEFORE DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION evia_private.reject_delete();`);
    try {
      await expect(deleteAccount(userId)).rejects.toMatchObject({ rollbackConfirmed: true, message: 'The deletion did not complete. Please try again.' });
      expect(await result(database().from('users').select('id').eq('id', userId).maybeSingle())).toBeTruthy();
      expect(await result(database().from('blobs').select('ref').eq('ref', 'rollback-blob').maybeSingle())).toBeTruthy();
      expect(await result(database().from('products').select('id').eq('id', 'rollback-product').maybeSingle())).toBeTruthy();
    } finally { adminSql('DROP TRIGGER reject_delete ON public.users; DROP FUNCTION evia_private.reject_delete();'); }
    expect(await deleteAccount(userId)).toEqual({ ok: true, blobsShredded: 1, blobsFailed: 0 });
    // A retry reconciles the same committed receipt; it does not fabricate a fresh zero-count erase.
    expect(await deleteAccount(userId)).toEqual({ ok: true, blobsShredded: 1, blobsFailed: 0 });
  });
  it('serializes capture with account deletion and isolates a second account', async () => {
    const a = await createAccount('delete-race-a');
    const b = await createAccount('delete-race-b');
    const [created, deleted] = await Promise.allSettled([insertScan(a.userId, sampleAnalysis()), deleteAccount(a.userId)]);
    expect(deleted.status).toBe('fulfilled');
    expect(await result(database().from('users').select('id').eq('id', a.userId))).toEqual([]);
    expect(await result(database().from('skin_scans').select('id').eq('user_id', a.userId))).toEqual([]);
    expect(await result(database().from('users').select('id').eq('id', b.userId).maybeSingle())).toBeTruthy();
    if (created.status === 'rejected') expect(created.reason.message).toMatch(/Account no longer exists/);
  });
});
