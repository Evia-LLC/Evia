import { describe, expect, it } from 'vitest';
import { createAccount } from '../helpers/two-accounts.ts';
import { upsertProduct, createSharedProduct, searchProducts } from '../../server/db/products.ts';
import { upsertCatalogueProduct } from '../../server/catalogue/store.ts';

describe('database expression matching', () => {
  it('preserves product case/null matching, owner isolation, and selective updates', async () => {
    const a = await createAccount('match-a');
    const b = await createAccount('match-b');
    const first = await upsertProduct({ name: 'Calm Serum', brand: null, ingredients: ['Aqua'], category: 'serum' }, a.userId);
    const again = await upsertProduct({ name: 'CALM SERUM', brand: '', ingredients: [], category: 'changed' }, a.userId);
    expect(again).toEqual(first);
    expect((await upsertProduct({ name: 'calm serum', brand: null }, b.userId)).id).not.toBe(first.id);
    expect((await createSharedProduct({ name: 'calm serum', brand: null })).id).not.toBe(first.id);
  });
  it('keeps asterisks and filter punctuation as SQL pattern values', async () => {
    await createSharedProduct({ name: 'Literal * Serum' });
    await createSharedProduct({ name: 'Ordinary Serum' });
    const literal = await searchProducts('*');
    expect(literal.map((p) => p.name)).toEqual(['Literal * Serum']);
    expect(await searchProducts('),owner_id.not.is.null,(')).toEqual([]);
  });
  it('keeps catalogue brand case sensitive without introducing product uniqueness', async () => {
    const base = { source: 'manual' as const, name: 'Shelf Serum', url: 'https://example.test', brand: 'Brand' };
    const first = await upsertCatalogueProduct(base);
    expect(await upsertCatalogueProduct({ ...base, name: 'SHELF SERUM' })).toBe(first);
    expect(await upsertCatalogueProduct({ ...base, brand: 'brand' })).not.toBe(first);
  });
});
