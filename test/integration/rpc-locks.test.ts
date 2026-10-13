import { describe, expect, it } from 'vitest';
import { createAccount, sampleAnalysis } from '../helpers/two-accounts.ts';
import { adminSql, startAdminSql, waitForSql, database, result } from '../helpers/data-api.ts';
import { insertScan } from '../../server/db/scans.ts';
import { createSharedProduct, startUsage } from '../../server/db/products.ts';
import { deleteAccount } from '../../server/privacy/delete-account.ts';

describe('real transaction fences through HTTP', () => {
  it('waits on the account fence, then observes the committed account deletion', async () => {
    const { userId } = await createAccount('fence');
    const blocker = startAdminSql(`BEGIN; SET application_name='evia-fixture-fence';
      SELECT id FROM public.users WHERE id='${userId}' FOR UPDATE;
      SELECT pg_sleep(2); DELETE FROM public.users WHERE id='${userId}'; COMMIT;`);
    try {
      await waitForSql("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='evia-fixture-fence' AND wait_event='PgSleep');");
      const capture = insertScan(userId, sampleAnalysis());
      const failure = expect(capture).rejects.toThrow('Account no longer exists');
      await waitForSql("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%evia_insert_skin_scan%');");
      await blocker.done;
      await failure;
      expect(await result(database().from('skin_scans').select('id').eq('user_id', userId))).toEqual([]);
    } finally { await blocker.done; }
  });
  it('checks actual FK trigger order and exercises usage versus deletion without adding a new fence', async () => {
    const order = adminSql("SELECT c.conname FROM pg_trigger t JOIN pg_constraint c ON c.oid=t.tgconstraint WHERE t.tgrelid='public.product_usage'::regclass AND (t.tgtype & 4)<>0 ORDER BY t.tgname;").trim().split('\n');
    expect(order).toContain('product_usage_user_id_fkey');
    expect(order).toContain('product_usage_product_id_fkey');
    const product = await createSharedProduct({ name: 'Shared race product' });
    for (let i = 0; i < 8; i++) {
      const { userId } = await createAccount('usage-race-' + i);
      const outcomes = await Promise.allSettled([startUsage(userId, product.id), deleteAccount(userId)]);
      expect(outcomes[1].status).toBe('fulfilled');
      expect(await result(database().from('product_usage').select('id').eq('user_id', userId))).toEqual([]);
      if (outcomes[0].status === 'rejected') expect(outcomes[0].reason.code).toBe('23503');
    }
  });
});
