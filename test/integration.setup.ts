import { cleanFixtureIdentities } from './helpers/auth-fixtures.ts';
import { beforeAll } from 'vitest';
import { adminSql, requireDataApi } from './helpers/data-api.ts';

beforeAll(async () => {
  await requireDataApi();
  await cleanFixtureIdentities();
  // One fixed schema, serial files. Global counters/cache cannot be isolated by user IDs.
  adminSql(`TRUNCATE public.users, public.blobs, public.products, public.usage_ledger,
    public.budget_reservations, public.voice_lines, public.rate_limit_buckets,
    public.catalogue_products, public.catalogue_syncs RESTART IDENTITY CASCADE;`);
});
