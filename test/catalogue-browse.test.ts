/**
 * The shelf as the Products page reads it, and the links it sends people out
 * on.
 *
 * Three promises. The catalogue routes are behind sign-in like every other
 * /api route, filter by the page's chips and search without inventing a
 * category, and say "nothing here" as an empty page rather than filling it.
 * An assessment is only made from a published ingredient list - an empty list
 * is not an all-clear. And an affiliate tag is added only to its own
 * retailer's links, carries only the operator's static string, and nothing a
 * scan produced ever reaches a URL (SRS ADS-01).
 *
 * Tested against a real HTTP server with the router mounted, so the auth
 * guard and Express's routing are part of what is checked.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { CatalogueProduct, ProductPick, SkinProfile } from '../shared/types.ts';
import { SKIN_METRIC_KEYS } from '../shared/types.ts';

const shelf: CatalogueProduct[] = [];

function product(partial: Partial<CatalogueProduct> & { name: string }): CatalogueProduct {
  const slug = partial.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    id: slug,
    source: 'import',
    sku: null,
    brand: 'Ese',
    category: null,
    description: '',
    ingredients: [],
    tags: [],
    priceCents: 1800,
    currency: 'USD',
    url: `https://shop.example/products/${slug}`,
    imageUrl: null,
    inStock: true,
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...partial,
  };
}

const profile: SkinProfile = {
  skinType: 'combination',
  fitzpatrick: null,
  concerns: ['texture'],
  sensitivities: ['fragrance'],
  pregnancyStatus: 'unknown',
  updatedAt: '2026-09-20T00:00:00.000Z',
};

vi.mock(import('../server/db/users.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  userIdForSession: vi.fn(async (token: string) => (token === 'good-token' ? 'user-1' : null)),
  getProfile: vi.fn(async () => profile),
}));

vi.mock(import('../server/db/products.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  listUsage: vi.fn(async () => []),
}));

vi.mock(import('../server/catalogue/store.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  listCatalogue: vi.fn(async () => shelf),
  getCatalogueProduct: vi.fn(async (id: string) => shelf.find((p) => p.id === id) ?? null),
}));

const { apiRouter } = await import('../server/routes/api.ts');
const { publicRouter } = await import('../server/routes/public.ts');
const { browseCatalogue, categoriesOf } = await import('../server/catalogue/browse.ts');
const { affiliateLink, amazonLink, retailerFor, tagPicks } = await import('../server/catalogue/offers.ts');

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/public', publicRouter);
  app.use('/api', apiRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const AFFILIATE_ENV = [
  'ELOHIM_AFFILIATE_AMAZON_TAG',
  'ELOHIM_AMAZON_TAG',
  'ELOHIM_AFFILIATE_EBAY_PARAMS',
  'ELOHIM_AFFILIATE_STORE_PARAMS',
  'ELOHIM_AFFILIATE_LINKS',
  'ELOHIM_STORE_URL',
  'ELOHIM_STORE_NAME',
] as const;
const savedEnv = Object.fromEntries(AFFILIATE_ENV.map((k) => [k, process.env[k]]));

afterEach(() => {
  shelf.length = 0;
  for (const key of AFFILIATE_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

async function get(path: string, token: string | null = 'good-token') {
  const response = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('GET /api/catalogue', () => {
  it('needs a signed-in user, like every other /api route', async () => {
    expect((await get('/catalogue', null)).status).toBe(401);
    expect((await get('/catalogue', 'wrong')).status).toBe(401);
  });

  it('says the shelf is empty rather than filling it', async () => {
    const { status, body } = await get('/catalogue');
    expect(status).toBe(200);
    expect(body).toEqual({ products: [], nextCursor: null, total: 0 });
  });

  it('filters by chip and search, and sends the shop link with each product', async () => {
    process.env.ELOHIM_STORE_URL = 'https://shop.example';
    process.env.ELOHIM_STORE_NAME = 'Ese';
    process.env.ELOHIM_AFFILIATE_STORE_PARAMS = 'ref=evia';
    shelf.push(
      product({ name: 'Gentle Foaming Wash' }),
      product({ name: 'Barrier Cream', category: 'Moisturiser', ingredients: ['Aqua', 'Glycerin', 'Ceramide NP'] }),
      product({ name: 'Calm Drops', tags: ['serum'], ingredients: ['Aqua', 'Niacinamide'] }),
    );

    const cleansers = await get('/catalogue?category=cleansers');
    expect((cleansers.body.products as Array<{ name: string }>).map((p) => p.name)).toEqual(['Gentle Foaming Wash']);

    const search = await get('/catalogue?q=niacinamide');
    const found = search.body.products as Array<{ name: string; shop: { url: string; retailer: string; affiliate: boolean } }>;
    expect(found.map((p) => p.name)).toEqual(['Calm Drops']);
    expect(found[0].shop).toEqual({
      url: 'https://shop.example/products/calm-drops?ref=evia',
      retailer: 'Ese',
      affiliate: true,
    });
  });

  it('refuses a category it does not know rather than ignoring it', async () => {
    expect((await get('/catalogue?category=miracles')).status).toBe(400);
  });

  it('pages with an opaque cursor', async () => {
    for (let i = 0; i < 5; i++) shelf.push(product({ name: `Cream ${i}` }));
    const first = await get('/catalogue?limit=2');
    expect((first.body.products as unknown[]).length).toBe(2);
    expect(first.body.total).toBe(5);
    const second = await get(`/catalogue?limit=2&cursor=${first.body.nextCursor as string}`);
    expect((second.body.products as Array<{ name: string }>)[0].name).toBe('Cream 2');
  });
});

describe('GET /api/catalogue/:id', () => {
  it('404s an unknown product', async () => {
    expect((await get('/catalogue/nope')).status).toBe(404);
  });

  it('assesses a product only from a published ingredient list', async () => {
    shelf.push(
      product({ name: 'Scented Cream', category: 'Moisturiser', ingredients: ['Aqua', 'Glycerin', 'Parfum'] }),
      product({ name: 'Mystery Cream', category: 'Moisturiser' }),
    );

    const listed = await get('/catalogue/scented-cream');
    expect(listed.status).toBe(200);
    const assessment = listed.body.assessment as { verdict: string; findings: Array<{ severity: string }> };
    // Fragrance is on this profile's sensitivities: flagged, not waved through.
    expect(assessment.verdict).toBe('not_now');
    expect(listed.body.contains).toEqual(['humectants']);

    const unlisted = await get('/catalogue/mystery-cream');
    expect(unlisted.body.assessment).toBeNull();
    expect(unlisted.body.contains).toEqual([]);
  });
});

describe('browseCatalogue', () => {
  it('puts a product under no chip its own words do not name', () => {
    expect(categoriesOf(product({ name: 'Rose Water' }))).toEqual([]);
    expect(categoriesOf(product({ name: 'Daily Fluid', category: 'Sunscreen' }))).toEqual(['sunscreens']);
    expect(browseCatalogue([product({ name: 'Rose Water' })], { category: 'toners' }).total).toBe(0);
  });
});

describe('affiliate links', () => {
  it('tags each retailer with its own parameters only', () => {
    process.env.ELOHIM_AFFILIATE_AMAZON_TAG = 'evia-20';
    process.env.ELOHIM_AFFILIATE_EBAY_PARAMS = 'mkevt=1&campid=5338';
    process.env.ELOHIM_AFFILIATE_LINKS = 'sephora.com:om_mmc=aff-evia';

    expect(affiliateLink('https://www.amazon.co.uk/dp/B00X').url).toBe('https://www.amazon.co.uk/dp/B00X?tag=evia-20');
    expect(affiliateLink('https://www.ebay.com/itm/1').url).toBe('https://www.ebay.com/itm/1?mkevt=1&campid=5338');
    expect(affiliateLink('https://www.sephora.com/product/p1').url).toBe(
      'https://www.sephora.com/product/p1?om_mmc=aff-evia',
    );
    // A retailer with no programme configured, a search engine, and a
    // lookalike host get nothing.
    expect(affiliateLink('https://www.boots.com/p/1')).toEqual({ url: 'https://www.boots.com/p/1', affiliate: false });
    expect(affiliateLink('https://www.google.com/search?tbm=shop&q=x').affiliate).toBe(false);
    expect(affiliateLink('https://amazon.evil.example/dp/1').affiliate).toBe(false);
  });

  it('keeps the older Amazon variable working, and never tags twice', () => {
    process.env.ELOHIM_AMAZON_TAG = 'legacy-20';
    const link = amazonLink('niacinamide serum');
    expect(link.url).toBe('https://www.amazon.com/s?k=niacinamide+serum&tag=legacy-20');
    expect(affiliateLink(link.url).url).toBe(link.url);
  });

  it('refuses a configured parameter whose name could carry skin data', () => {
    process.env.ELOHIM_AFFILIATE_EBAY_PARAMS = 'campid=5338&skin_concern=acne&scanScore=62';
    expect(affiliateLink('https://www.ebay.com/itm/1').url).toBe('https://www.ebay.com/itm/1?campid=5338');
  });

  it('names the retailer for the button', () => {
    process.env.ELOHIM_STORE_URL = 'https://shop.example/';
    process.env.ELOHIM_STORE_NAME = 'Ese';
    expect(retailerFor('https://shop.example/products/a')).toBe('Ese');
    expect(retailerFor('https://www.amazon.com/s?k=a')).toBe('Amazon');
    expect(retailerFor('https://www.lookfantastic.com/p/1')).toBe('Lookfantastic');
  });

  it('puts nothing from the reading into any link of a pick', () => {
    process.env.ELOHIM_AFFILIATE_AMAZON_TAG = 'evia-20';
    process.env.ELOHIM_STORE_URL = 'https://shop.example';
    process.env.ELOHIM_AFFILIATE_STORE_PARAMS = 'ref=evia';
    const pick: ProductPick = {
      suggestion: {
        step: 'treat',
        title: 'Centella or niacinamide',
        actives: ['Centella Asiatica', 'Niacinamide'],
        because: { key: 'redness', value: 62, label: 'Redness' },
        why: 'Calms visible irritation.',
        cautions: [],
      },
      product: product({ name: 'Calm Drops', url: 'https://shop.example/products/calm-drops' }),
      matched: ['Niacinamide'],
      from: 'Ese',
      offers: [amazonLink('Ese Calm Drops')],
      priceNote: 'One price: $18.00 at Ese.',
      compared: 1,
      bestUrl: 'https://shop.example/products/calm-drops',
      reason: 'Calm Drops carries niacinamide.',
    };
    const [tagged] = tagPicks([pick]);
    const urls = [tagged.product!.url, tagged.bestUrl!, ...tagged.offers.map((o) => o.url)];
    expect(tagged.product!.url).toBe('https://shop.example/products/calm-drops?ref=evia');
    for (const url of urls) {
      const lower = decodeURIComponent(url).toLowerCase();
      for (const key of SKIN_METRIC_KEYS) expect(lower).not.toContain(key.toLowerCase());
      expect(lower).not.toContain('62');
      expect(lower).not.toContain('fragrance');
    }
    // The reasoning is still there for the page to show.
    expect(tagged.suggestion.because).toEqual(pick.suggestion.because);
  });
});

describe('POST /api/public/picks (a guest)', () => {
  it('tags a shelf product link for its retailer, as an account gets it', async () => {
    process.env.ELOHIM_STORE_URL = 'https://shop.example';
    process.env.ELOHIM_AFFILIATE_STORE_PARAMS = 'ref=evia';
    shelf.push(
      product({ name: 'Daily Mineral Sunscreen SPF 50', tags: ['sunscreen', 'spf'], ingredients: ['Zinc Oxide', 'Glycerin'] }),
      product({ name: 'Gentle Gel Cleanser', tags: ['cleanser'], ingredients: ['Water', 'Glycerin', 'Salicylic Acid'] }),
    );
    const metrics = Object.fromEntries(SKIN_METRIC_KEYS.map((k) => [k, 55]));
    const response = await fetch(`${base}/public/picks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metrics, profile: { skinType: 'oily' } }),
    });
    expect(response.status).toBe(200);
    const { picks } = (await response.json()) as { picks: ProductPick[] };
    const shelfPicks = picks.filter((p) => p.product);
    expect(shelfPicks.length).toBeGreaterThan(0);
    for (const pick of shelfPicks) {
      expect(pick.product!.url).toMatch(/[?&]ref=evia$/);
      const lower = decodeURIComponent(pick.product!.url).toLowerCase();
      expect(lower).not.toContain('55');
      expect(lower).not.toContain('oily');
    }
  });
});
