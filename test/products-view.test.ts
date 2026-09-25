/**
 * The Products screen's honesty (BUILD-PLAN decisions 2 and 11).
 *
 * The sample is the mockup's shelf, ratings and badges included, and only
 * ever under the Sample data badge. The real view is built from the picks and
 * the shop's catalogue alone: no ratings, no review counts, no "Trending" /
 * "Popular" / "Best Match", no gallery the shop did not send, no cart - and
 * when the shelf is empty (it is, by default) it says so instead of filling
 * the grid. Every shop link is the URL the server sent, untouched, and every
 * "Shop at ..." names that product's own retailer - never a house name.
 */
import { describe, expect, it } from 'vitest';
import type { CatalogueProduct, ProductPick } from '../shared/types.ts';
import type { CatalogueListing } from '../src/lib/api.ts';
import { SAMPLE_PRODUCTS } from '../src/sample/fixtures/products.ts';
import {
  AFFILIATE_DISCLOSURE,
  buildProducts,
  productsView,
  type ProductsRealInput,
  type ProductsView,
} from '../src/view/products.ts';

const product = (over: Partial<CatalogueProduct> = {}): CatalogueProduct => ({
  id: 'cat-1',
  source: 'import',
  sku: null,
  name: 'Gentle Foaming Cleanser',
  brand: 'Brand',
  category: 'Cleanser',
  description: 'A gentle wash. It foams.',
  ingredients: ['Water', 'Glycerin', 'Niacinamide'],
  tags: [],
  priceCents: 1299,
  currency: 'GBP',
  url: 'https://shop.example/p/1?ref=evia',
  imageUrl: null,
  inStock: true,
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

const listing = (over: Partial<CatalogueProduct> = {}): CatalogueListing => {
  const p = product(over);
  return { ...p, categories: ['cleansers'], shop: { url: p.url, retailer: 'Sephora', affiliate: true } };
};

const pick = (over: Partial<ProductPick> = {}): ProductPick => ({
  suggestion: {
    step: 'treat',
    title: 'A low-strength retinoid',
    actives: ['Retinol'],
    because: { key: 'texture', value: 61, label: 'Texture' },
    why: 'It speeds up cell turnover.',
    cautions: ['Start twice a week.'],
  },
  product: null,
  matched: [],
  from: null,
  offers: [
    {
      merchant: 'Amazon',
      title: 'Search Amazon for Retinol serum',
      priceCents: null,
      currency: null,
      url: 'https://www.amazon.com/s?k=Retinol%20serum&tag=evia-21',
      imageUrl: null,
      compared: false,
    },
  ],
  priceNote: 'No prices fetched — these are places to look.',
  compared: 0,
  bestUrl: null,
  reason: 'Nothing on the shelf does this yet, so here is where I would look.',
  ...over,
});

type InputOver = Omit<Partial<ProductsRealInput>, 'catalogue'> & {
  catalogue?: Partial<ProductsRealInput['catalogue']>;
};

const input = ({ catalogue, ...over }: InputOver = {}): ProductsRealInput => ({
  guest: false,
  signedIn: true,
  hasScan: true,
  picks: [],
  picksLoading: false,
  storeName: null,
  shelfCount: 0,
  catalogue: { status: 'ready', items: [], total: 0, nextCursor: null, loadingMore: false, ...catalogue },
  savedItems: {},
  extras: {},
  category: 'recommended',
  query: '',
  savedIds: [],
  ...over,
});

const cards = (view: ProductsView) => view.sections.flatMap((s) => s.products);
const text = (view: ProductsView) => JSON.stringify(view);

describe('sample mode', () => {
  it('is the mockup shelf: eight products, with its ratings and badges', () => {
    const view = productsView(true, SAMPLE_PRODUCTS, input());
    expect(view.mode).toBe('sample');
    expect(cards(view)).toHaveLength(8);
    expect(cards(view)[0]).toMatchObject({ brand: 'CeraVe', name: 'Hydrating Facial Cleanser', price: '$14.99' });
    expect(cards(view)[0].rating?.value).toBe('4.8');
    expect(cards(view).map((c) => c.badge?.label)).toContain('Trending');
  });

  it('never links a sample price to a real shop', () => {
    const view = productsView(true, SAMPLE_PRODUCTS, input());
    for (const card of cards(view)) {
      expect(card.shop?.url ?? null).toBeNull();
      expect(card.detail.shop?.url ?? null).toBeNull();
    }
  });

  it('names each sample product’s own retailer, the same way a real one is', () => {
    const view = productsView(true, SAMPLE_PRODUCTS, input());
    const retailers = cards(view).map((c) => c.shop!.retailer);
    expect(retailers).toEqual([
      'CeraVe',
      'YesStyle',
      'Ulta Beauty',
      'La Roche-Posay',
      'Stylevana',
      'Paula’s Choice',
      'Target',
      'Amazon',
    ]);
    for (const card of cards(view)) {
      expect(card.shop!.label).toBe(`Shop at ${card.shop!.retailer}`);
      expect(card.detail.shop).toEqual(card.shop);
    }
    expect(text(view)).not.toMatch(/\bEse\b/);
  });
});

describe('real mode', () => {
  it('says the shelf is empty rather than filling it', () => {
    const view = buildProducts(input());
    const shelf = view.sections.find((s) => s.id === 'shelf')!;
    expect(shelf.products).toHaveLength(0);
    expect(shelf.empty?.title).toMatch(/shelf is empty/i);
    expect(shelf.empty?.body).toMatch(/catalogue is connected/);
  });

  it('asks for a scan before it has picks to show', () => {
    const view = buildProducts(input({ hasScan: false }));
    const picks = view.sections.find((s) => s.id === 'picks')!;
    expect(picks.empty?.action).toEqual({ label: 'Take a scan', icon: 'camera', href: '/scan' });
  });

  it('never shows ratings, reviews, popularity or a match badge', () => {
    const view = buildProducts(
      input({ picks: [pick()], catalogue: { status: 'ready', items: [listing()], total: 1 }, shelfCount: 1 }),
    );
    expect(cards(view).length).toBe(2);
    for (const card of cards(view)) {
      expect(card.rating).toBeNull();
      expect(card.detail.rating).toBeNull();
      expect(['Trending', 'Popular', 'Best Match']).not.toContain(card.badge?.label);
      expect(card.detail.rows.map((r) => r.id)).not.toContain('reviews');
      expect(card.detail.rows.map((r) => r.id)).not.toContain('similar');
    }
    expect(text(view)).not.toMatch(/cart/i);
  });

  it('uses the server’s links as they are, adding nothing about the reading', () => {
    const shelfItem = listing();
    const view = buildProducts(
      input({ picks: [pick()], catalogue: { status: 'ready', items: [shelfItem], total: 1 }, shelfCount: 1 }),
    );
    const [pickCard, shelfCard] = cards(view);
    expect(pickCard.shop).toMatchObject({ url: 'https://www.amazon.com/s?k=Retinol%20serum&tag=evia-21', kind: 'search' });
    expect(shelfCard.shop).toMatchObject({ url: shelfItem.shop.url, label: 'Shop at Sephora', retailer: 'Sephora', kind: 'product' });
    for (const card of cards(view)) {
      const url = card.shop?.url ?? '';
      expect(url).not.toMatch(/texture|61|concern|skin|scan/i);
    }
  });

  it('names a shelf pick’s own retailer, and never a house name', () => {
    const shelfPick = pick({
      product: product({ id: 'cat-2', brand: 'CeraVe', url: 'https://www.cerave.com/p/2' }),
      from: 'CeraVe',
      offers: [],
      priceNote: '£12.99 at CeraVe. I have not compared other shops.',
    });
    const [card] = cards(buildProducts(input({ picks: [shelfPick] })));
    expect(card.shop).toMatchObject({ label: 'Shop at CeraVe', retailer: 'CeraVe', url: 'https://www.cerave.com/p/2' });
    expect(card.detail.shop).toEqual(card.shop);

    // An older server that did not name the seller: named from the link, not a default.
    const unnamed = cards(buildProducts(input({ picks: [{ ...shelfPick, from: null }] })))[0];
    expect(unnamed.shop?.label).toBe('Shop at CeraVe');
    const elsewhere = cards(
      buildProducts(input({ picks: [{ ...shelfPick, from: null, product: product({ url: 'https://www.ulta.com/p/9' }) }] })),
    )[0];
    expect(elsewhere.shop?.label).toBe('Shop at Ulta Beauty');

    const everything = buildProducts(
      input({ picks: [shelfPick, pick()], catalogue: { status: 'ready', items: [listing()], total: 1 }, shelfCount: 1 }),
    );
    expect(text(everything)).not.toMatch(/\bEse\b/);
  });

  it('names a configured store in the shelf copy only when the server gives one', () => {
    const unnamed = buildProducts(input({ shelfCount: 1, catalogue: { status: 'ready', items: [listing()], total: 1 } }));
    expect(unnamed.sections.find((s) => s.id === 'shelf')!.subtitle).toBe(
      'From the catalogue. Each product links to the shop that sells it.',
    );
    const named = buildProducts(
      input({ storeName: 'Northside Apothecary', shelfCount: 1, catalogue: { status: 'ready', items: [listing()], total: 1 } }),
    );
    expect(named.sections.find((s) => s.id === 'shelf')!.subtitle).toBe('From the Northside Apothecary catalogue.');
    expect(buildProducts(input()).sections.find((s) => s.id === 'shelf')!.empty?.body).toMatch(
      /^Products appear here when a shop catalogue is connected\./,
    );
  });

  it('gives a pick its real reason and reading, and the patch-test note', () => {
    const view = buildProducts(input({ picks: [pick()] }));
    const rows = cards(view)[0].detail.rows;
    const why = rows.find((r) => r.id === 'why')!;
    expect(why.body).toContain('Your latest scan read texture at 61 out of 100.');
    const fit = rows.find((r) => r.id === 'fit')!;
    expect(fit.list).toContain('Start twice a week.');
    expect(fit.note).toMatch(/patch test/);
  });

  it('shows "In stock" only from the shop’s own flag, and one picture only', () => {
    const view = buildProducts(
      input({
        catalogue: { status: 'ready', items: [listing({ inStock: false, imageUrl: 'https://shop.example/1.jpg' })], total: 1 },
        shelfCount: 1,
      }),
    );
    const card = cards(view)[0];
    expect(card.detail.stock).toBe('out');
    expect(card.detail.gallery).toEqual([{ kind: 'image', src: 'https://shop.example/1.jpg', label: 'Gentle Foaming Cleanser' }]);
    const pickOnly = buildProducts(input({ picks: [pick()] }));
    expect(cards(pickOnly)[0].detail.stock).toBeNull();
  });

  it('checks a shelf product against the profile only when the shop listed its ingredients', () => {
    const noList = buildProducts(
      input({ catalogue: { status: 'ready', items: [listing({ ingredients: [] })], total: 1 }, shelfCount: 1 }),
    );
    const fit = cards(noList)[0].detail.rows.find((r) => r.id === 'fit')!;
    expect(fit.body[0]).toMatch(/not published an ingredient list/);
    expect(fit.note).toMatch(/not a complete safety check/);
  });

  it('puts the user’s picks for a chip before that chip’s shelf', () => {
    const view = buildProducts(input({ picks: [pick()], category: 'serums' }));
    expect(view.sections.map((s) => s.id)).toEqual(['picks', 'shelf']);
    expect(view.sections[0].products).toHaveLength(1);
    const cleansers = buildProducts(input({ picks: [pick()], category: 'cleansers' }));
    expect(cleansers.sections.map((s) => s.id)).toEqual(['shelf']);
  });

  it('tells a guest the shelf is for accounts, or empty, and makes no profile claim', () => {
    const view = buildProducts(
      input({ guest: true, signedIn: false, shelfCount: 3, catalogue: { status: 'signed-out', items: [], total: 0 } }),
    );
    expect(view.sections.find((s) => s.id === 'shelf')!.empty?.title).toBe('Sign in to browse the shelf');
    expect(view.hero.trust).not.toContain('Ingredient lists checked against your profile');
    const empty = buildProducts(
      input({ guest: true, signedIn: false, shelfCount: 0, catalogue: { status: 'signed-out', items: [], total: 0 } }),
    );
    expect(empty.sections.find((s) => s.id === 'shelf')!.empty?.title).toMatch(/shelf is empty/i);
  });

  it('claims a profile check only when there is a shelf to check', () => {
    expect(buildProducts(input()).hero.trust).not.toContain('Ingredient lists checked against your profile');
    const stocked = buildProducts(input({ shelfCount: 1, catalogue: { status: 'ready', items: [listing()], total: 1 } }));
    expect(stocked.hero.trust).toContain('Ingredient lists checked against your profile');
  });

  it('carries the affiliate disclosure', () => {
    expect(buildProducts(input()).disclosure).toBe(AFFILIATE_DISCLOSURE);
  });
});

describe('saved, paging and link names (review fixes)', () => {
  it('never saves a suggestion: only a product has a save id', () => {
    const view = buildProducts(input({ picks: [pick()] }));
    const suggestion = cards(view)[0];
    expect(suggestion.saveId).toBeNull();
    const stocked = buildProducts(input({ shelfCount: 1, catalogue: { items: [listing()], total: 1 } }));
    expect(stocked.sections.find((s) => s.id === 'shelf')!.products[0].saveId).toBe('shelf:cat-1');
  });

  it('builds Saved from products fetched by id, wherever they sit on the shelf', () => {
    const view = buildProducts(
      input({ category: 'saved', savedIds: ['shelf:cat-9'], savedItems: { 'cat-9': listing({ id: 'cat-9', name: 'Far Page Cream' }) } }),
    );
    expect(view.sections[0].products.map((p) => p.name)).toEqual(['Far Page Cream']);
    const waiting = buildProducts(input({ category: 'saved', savedIds: ['shelf:cat-9'] }));
    expect(waiting.sections[0].loading).toBe(true);
    const gone = buildProducts(input({ category: 'saved', savedIds: ['shelf:cat-9'], savedItems: { 'cat-9': null } }));
    expect(gone.sections[0].empty?.title).toMatch(/left the shelf/);
  });

  it('shows the Saved chip only for this list, and keeps it while it is open', () => {
    expect(buildProducts(input()).categories.some((c) => c.key === 'saved')).toBe(false);
    expect(buildProducts(input({ savedIds: ['shelf:cat-1'] })).categories.some((c) => c.key === 'saved')).toBe(true);
    expect(buildProducts(input({ category: 'saved' })).categories.some((c) => c.key === 'saved')).toBe(true);
    const sample = productsView(true, SAMPLE_PRODUCTS, input({ savedIds: ['shelf:someone-else'] }));
    expect(sample.categories.some((c) => c.key === 'saved')).toBe(false);
  });

  it('offers the next page of a chip, and says how much is shown', () => {
    const view = buildProducts(
      input({ category: 'cleansers', shelfCount: 5, catalogue: { items: [listing()], total: 5, nextCursor: 'MQ' } }),
    );
    const section = view.sections.find((s) => s.id === 'shelf')!;
    expect(section.more).toEqual({ shown: 1, total: 5, loading: false });
    expect(section.subtitle).toContain('Showing 1 of 5');
    const last = buildProducts(input({ category: 'cleansers', shelfCount: 1, catalogue: { items: [listing()], total: 1 } }));
    expect(last.sections.find((s) => s.id === 'shelf')!.more).toBeNull();
  });

  it('names a search link by the words it searches for', () => {
    const view = buildProducts(input({ picks: [pick()] }));
    const shop = cards(view)[0].shop!;
    expect(shop.name).toBe('Search Amazon for Retinol serum');
    expect(cards(view)[0].a11yName).toBe('A low-strength retinoid');
  });

  it('does not point at shelf results that are not there', () => {
    const view = buildProducts(input({ picks: [pick()], query: 'zzqx' }));
    expect(text(view)).not.toContain('The shelf results are below');
  });

  it('makes no "straight to the retailer" claim next to a search link', () => {
    expect(text(buildProducts(input({ picks: [pick()] })))).not.toMatch(/straight to the retailer/i);
  });
});
