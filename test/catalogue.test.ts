/**
 * The shelf: what gets read from a storefront, and what she is allowed to say
 * about it.
 *
 * Two promises are tested here. Ingredients come out of a description only
 * when there is an ingredients panel in it - never from the marketing copy.
 * And the price line is written from what was actually fetched: one price is
 * a price, not a comparison, and a search link never counts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueProduct, SkinProfile } from '../shared/types.ts';
import type { RoutinePlan } from '../server/skin/recommend.ts';

const shelf: CatalogueProduct[] = [];

vi.mock(import('../server/catalogue/store.ts'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listCatalogue: vi.fn(async () => shelf),
    storeName: () => 'Ese',
    storeUrl: () => 'https://ese.example',
  };
});

vi.mock('../server/catalogue/offers.ts', () => ({
  comparisonAvailable: () => false,
  ebayOffers: vi.fn(async () => []),
  webOffers: vi.fn(async (query: string) => [
    { merchant: 'Amazon', title: `Search Amazon for ${query}`, priceCents: null, currency: null, url: 'https://amazon.example/s?k=x', imageUrl: null, compared: false },
  ]),
}));

const { extractIngredients } = await import('../server/catalogue/store.ts');
const { pickProducts } = await import('../server/catalogue/picks.ts');

function product(partial: Partial<CatalogueProduct> & { name: string }): CatalogueProduct {
  return {
    id: partial.name.toLowerCase().replace(/\s+/g, '-'),
    source: 'import',
    sku: null,
    brand: 'Ese',
    category: null,
    description: '',
    ingredients: [],
    tags: [],
    priceCents: 3000,
    currency: 'USD',
    url: `https://ese.example/products/${partial.name.toLowerCase().replace(/\s+/g, '-')}`,
    imageUrl: null,
    inStock: true,
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...partial,
  };
}

const profile: SkinProfile = {
  skinType: 'combination',
  fitzpatrick: null,
  concerns: [],
  sensitivities: [],
  pregnancyStatus: 'unknown',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

const plan: RoutinePlan = {
  suggestions: [
    {
      step: 'treat',
      title: 'Centella or niacinamide',
      actives: ['Centella Asiatica', 'Niacinamide'],
      family: 'soothing',
      because: { key: 'redness', value: 62, label: 'Redness' },
      why: 'Calms visible irritation.',
      cautions: [],
      alreadyCovered: false,
      coveredBy: [],
      priority: 0.6,
    },
  ],
  gaps: [],
  caveat: '',
};

describe('extractIngredients', () => {
  it('reads an INCI list that follows an "Ingredients:" label', () => {
    const html = '<p>A calming serum for reactive skin.</p><p><strong>Ingredients:</strong> Aqua, Glycerin, Centella Asiatica Extract, Niacinamide, Phenoxyethanol.</p>';
    expect(extractIngredients(html)).toEqual([
      'Aqua',
      'Glycerin',
      'Centella Asiatica Extract',
      'Niacinamide',
      'Phenoxyethanol',
    ]);
  });

  it('returns nothing when there is no panel, rather than guessing from the copy', () => {
    expect(extractIngredients('<p>Packed with centella and niacinamide for calm, even skin.</p>')).toEqual([]);
  });
});

describe('pickProducts', () => {
  beforeEach(() => {
    shelf.length = 0;
  });

  it('matches on what a product contains, and says one price is not a comparison', async () => {
    shelf.push(
      product({ name: 'Calm Cica Serum', ingredients: ['Aqua', 'Centella Asiatica Extract', 'Niacinamide'], priceCents: 3200 }),
      product({ name: 'Gentle Milk Cleanser', category: 'Cleanser', ingredients: ['Aqua', 'Coco-Betaine'] }),
    );
    const picks = await pickProducts(plan, profile, { web: false });
    expect(picks).toHaveLength(1);
    expect(picks[0].product?.name).toBe('Calm Cica Serum');
    expect(picks[0].matched).toContain('Centella Asiatica Extract');
    expect(picks[0].compared).toBe(1);
    expect(picks[0].priceNote).toContain('$32.00 on the Ese shelf');
    expect(picks[0].priceNote).toContain('not compared');
  });

  it('matches on the name when the shelf carries no ingredient lists', async () => {
    shelf.push(product({ name: 'Cica Rescue Serum', ingredients: [] }));
    const picks = await pickProducts(plan, profile, { web: false });
    expect(picks[0].product?.name).toBe('Cica Rescue Serum');
  });

  it('never puts a cleanser forward for a treatment step', async () => {
    shelf.push(product({ name: 'Niacinamide Foaming Cleanser', category: 'Cleanser', ingredients: ['Niacinamide'] }));
    const picks = await pickProducts(plan, profile, { web: false });
    expect(picks).toHaveLength(0);
  });

  it('vetoes a product that clashes with a stated sensitivity', async () => {
    shelf.push(product({ name: 'Calm Cica Serum', ingredients: ['Centella Asiatica Extract', 'Parfum', 'Limonene'] }));
    const picks = await pickProducts(plan, { ...profile, sensitivities: ['fragrance'] }, { web: false });
    expect(picks).toHaveLength(0);
  });

  it('offers places to look, and says so, when the shelf has nothing', async () => {
    const picks = await pickProducts(plan, profile, { web: true });
    expect(picks).toHaveLength(1);
    expect(picks[0].product).toBeNull();
    expect(picks[0].compared).toBe(0);
    expect(picks[0].offers[0].merchant).toBe('Amazon');
    expect(picks[0].priceNote).toContain('No prices fetched');
  });
});
