/**
 * The catalogue remembers who sells a product when an import says so, and
 * never falls back to a house name (BUILD-PLAN decision 11).
 *
 * Runs in the Data API lane (`npm run test:data-api`) against the disposable
 * Supabase stack with every migration applied, so the `retailer` column
 * (supabase/migrations/20261027000000_catalogue_retailer.sql), the import field
 * and the status's store name are checked end to end:
 * import -> row -> product -> "Shop at ..." name.
 *
 * Formerly test/catalogue-retailer-store.test.ts, which ran the same checks on
 * an in-memory Postgres before persistence moved to the Supabase Data API.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminSql } from '../helpers/data-api.ts';
import { catalogueStatus, importCatalogue, listCatalogue, upsertCatalogueProduct } from '../../server/catalogue/store.ts';
import { listingFor } from '../../server/catalogue/browse.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  adminSql('TRUNCATE public.catalogue_products, public.catalogue_syncs RESTART IDENTITY CASCADE;');
});

describe('catalogue retailer', () => {
  it('adds a nullable retailer column', () => {
    const column = adminSql(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'catalogue_products' AND column_name = 'retailer';",
    ).trim();
    expect(column).toBe('YES');
  });

  it('stores an imported retailer and names each product by its own shop', async () => {
    vi.stubEnv('ELOHIM_STORE_URL', 'https://shop.example');
    vi.stubEnv('ELOHIM_STORE_NAME', 'Northside Apothecary');
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
    vi.stubEnv('ELOHIM_STORE_URL', 'https://shop.example');
    vi.stubEnv('ELOHIM_STORE_NAME', 'Northside Apothecary');
    await upsertCatalogueProduct({ source: 'shopify', externalId: '1', name: 'Synced Serum', url: 'https://shop.example/products/serum' });
    const [synced] = await listCatalogue();
    expect(listingFor(synced).shop.retailer).toBe('Northside Apothecary');
    expect((await catalogueStatus()).storeName).toBe('Northside Apothecary');

    vi.stubEnv('ELOHIM_STORE_NAME', '');
    expect(listingFor(synced).shop.retailer).toBe('shop.example');
    const status = await catalogueStatus();
    expect(status.storeName).toBeNull();
    expect(JSON.stringify(status)).not.toMatch(/\bEse\b/);
  });

  it('has no store name for an empty shelf', async () => {
    vi.stubEnv('ELOHIM_STORE_URL', 'https://shop.example');
    vi.stubEnv('ELOHIM_STORE_NAME', 'Northside Apothecary');
    expect(await catalogueStatus()).toMatchObject({ storeName: null, products: 0 });
  });
});
