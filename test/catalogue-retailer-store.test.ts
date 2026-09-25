/**
 * The catalogue remembers who sells a product when an import says so, and
 * never falls back to a house name (BUILD-PLAN decision 11).
 *
 * Run against every migration in order on an in-memory Postgres (PGlite), so
 * the new `retailer` column, the import field and the status's store name are
 * checked end to end: import -> row -> product -> "Shop at ..." name.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const db = vi.hoisted(() => ({ current: null as null | { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> } }));

vi.mock('../server/db/index.ts', () => {
  const toPg = (sql: string) => {
    let n = 0;
    return sql.replace(/\?/g, () => `$${++n}`);
  };
  const q = (sql: string, params: unknown[]) => db.current!.query(toPg(sql), params);
  return {
    toPg,
    rows: async (sql: string, ...params: unknown[]) => (await q(sql, params)).rows,
    row: async (sql: string, ...params: unknown[]) => (await q(sql, params)).rows[0],
    run: async (sql: string, ...params: unknown[]) => (await q(sql, params)).affectedRows ?? 0,
  };
});

const { catalogueStatus, importCatalogue, listCatalogue, upsertCatalogueProduct } = await import(
  '../server/catalogue/store.ts'
);
const { listingFor } = await import('../server/catalogue/browse.ts');

const migrationsDir = fileURLToPath(new URL('../server/db/migrations/', import.meta.url));
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  for (const name of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(new URL(`../server/db/migrations/${name}`, import.meta.url), 'utf8'));
  }
  db.current = pg;
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

const ENV = ['ELOHIM_STORE_URL', 'ELOHIM_STORE_NAME'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(async () => {
  await pg.exec('DELETE FROM catalogue_products; DELETE FROM catalogue_syncs;');
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('catalogue retailer', () => {
  it('adds a nullable retailer column', async () => {
    const columns = await pg.query<{ column_name: string; is_nullable: string }>(
      "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'catalogue_products' AND column_name = 'retailer'",
    );
    expect(columns.rows).toEqual([{ column_name: 'retailer', is_nullable: 'YES' }]);
  });

  it('stores an imported retailer and names each product by its own shop', async () => {
    process.env.ELOHIM_STORE_URL = 'https://shop.example';
    process.env.ELOHIM_STORE_NAME = 'Northside Apothecary';
    const result = await importCatalogue([
      { id: 'a', name: 'Cicaplast Baume B5', brand: 'La Roche-Posay', url: 'https://www.laroche-posay.us/p/b5', retailer: ' Sephora ', price: 16.99 },
      { id: 'b', name: 'Hydrating Cleanser', brand: 'CeraVe', url: 'https://www.cerave.com/p/hydrating' },
      { id: 'c', name: 'Mystery Toner', url: 'https://shop.example/products/toner', retailer: 42 },
    ]);
    expect(result).toEqual({ imported: 3, skipped: 0 });

    const byName = Object.fromEntries((await listCatalogue()).map((p) => [p.name, p]));
    expect(byName['Cicaplast Baume B5'].retailer).toBe('Sephora');
    expect(byName['Hydrating Cleanser'].retailer).toBeNull();
    expect(byName['Mystery Toner'].retailer).toBeNull();

    expect(listingFor(byName['Cicaplast Baume B5']).shop.retailer).toBe('Sephora');
    expect(listingFor(byName['Hydrating Cleanser']).shop.retailer).toBe('CeraVe');
    // Imported, not synced: the configured store's name does not apply.
    expect(listingFor(byName['Mystery Toner']).shop.retailer).toBe('shop.example');

    // An import is not the configured store, so the shelf is not "the Northside Apothecary catalogue".
    expect((await catalogueStatus()).storeName).toBeNull();
  });

  it('re-importing without a retailer clears it (the import is the source of truth)', async () => {
    await importCatalogue([{ id: 'a', name: 'Balm', url: 'https://www.sephora.com/p/1', retailer: 'Sephora' }]);
    await importCatalogue([{ id: 'a', name: 'Balm', url: 'https://www.ulta.com/p/1' }]);
    const [balm] = await listCatalogue();
    expect(balm.retailer).toBeNull();
    expect(listingFor(balm).shop.retailer).toBe('Ulta Beauty');
  });

  it('names the shelf after the store only when it is all synced from a named store', async () => {
    process.env.ELOHIM_STORE_URL = 'https://shop.example';
    process.env.ELOHIM_STORE_NAME = 'Northside Apothecary';
    await upsertCatalogueProduct({ source: 'shopify', externalId: '1', name: 'Synced Serum', url: 'https://shop.example/products/serum' });
    const [synced] = await listCatalogue();
    expect(listingFor(synced).shop.retailer).toBe('Northside Apothecary');
    expect((await catalogueStatus()).storeName).toBe('Northside Apothecary');

    delete process.env.ELOHIM_STORE_NAME;
    expect(listingFor(synced).shop.retailer).toBe('shop.example');
    const status = await catalogueStatus();
    expect(status.storeName).toBeNull();
    expect(JSON.stringify(status)).not.toMatch(/\bEse\b/);
  });

  it('has no store name for an empty shelf', async () => {
    process.env.ELOHIM_STORE_URL = 'https://shop.example';
    process.env.ELOHIM_STORE_NAME = 'Northside Apothecary';
    expect(await catalogueStatus()).toMatchObject({ storeName: null, products: 0 });
  });
});
