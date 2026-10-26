import { describe, expect, it } from 'vitest';
import { adminSql, database, result } from './helpers/data-api.ts';
import { createAccount, seedScan, seedProgressPhoto } from './helpers/two-accounts.ts';

describe('installed empty-project schema', () => {
  it('has no facial geometry, legacy migration ledger, or budget-to-user foreign keys', () => {
    expect(adminSql("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='skin_scans' AND column_name='landmarks_json');").trim()).toBe('f');
    expect(adminSql("SELECT to_regclass('public._migrations') IS NULL;").trim()).toBe('t');
    expect(adminSql("SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid IN ('public.usage_ledger'::regclass,'public.budget_reservations'::regclass);").trim()).toBe('0');
  });
  it('links an explicit progress photo to its actual consent event', async () => {
    const { userId } = await createAccount('schema');
    const scan = await seedScan(userId);
    const photo = await seedProgressPhoto(userId, scan.id!);
    expect(await result(database().from('progress_photos').select('consent_event_id').eq('id', photo.id).single()))
      .toEqual({ consent_event_id: photo.consentEventId });
  });
});
