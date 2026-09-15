/**
 * The shelf: the operator's own catalogue, and how it gets here.
 *
 * Two ways in. A storefront URL (`ELOHIM_STORE_URL`) is read directly — a
 * Shopify shop publishes its products at `/products.json` and a WooCommerce
 * shop at `/wp-json/wc/store/v1/products`, both public, both paginated, both
 * with prices, links and pictures. Anything else is imported as JSON through
 * the admin route. Either way the rows land in `catalogue_products` and the
 * picker never knows which.
 *
 * Ingredient lists are the one thing storefronts rarely publish in a field of
 * their own, so they are pulled out of the description when it carries an
 * "Ingredients:" panel, and left empty when it does not. The picker copes
 * with empty: a product is also matched on what its name says it is.
 */
import { row, rows, run } from '../db/index.ts';
import { newId, nowIso } from '../lib/ids.ts';
import { log } from '../lib/log.ts';
import type { CatalogueProduct, CatalogueStatus } from '../../shared/types.ts';

export type CatalogueSource = 'shopify' | 'woocommerce' | 'import' | 'manual';

interface CatalogueRow {
  id: string;
  source: string;
  external_id: string | null;
  sku: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  description: string;
  ingredients_json: string;
  tags_json: string;
  price_cents: number | null;
  currency: string;
  url: string;
  image_url: string | null;
  in_stock: number | boolean;
  updated_at: string;
}

function hydrate(r: CatalogueRow): CatalogueProduct {
  return {
    id: r.id,
    source: r.source as CatalogueProduct['source'],
    sku: r.sku,
    name: r.name,
    brand: r.brand,
    category: r.category,
    description: r.description,
    ingredients: JSON.parse(r.ingredients_json) as string[],
    tags: JSON.parse(r.tags_json) as string[],
    priceCents: r.price_cents,
    currency: r.currency,
    url: r.url,
    imageUrl: r.image_url,
    inStock: Boolean(r.in_stock),
    updatedAt: r.updated_at,
  };
}

export function storeName(): string {
  return process.env.ELOHIM_STORE_NAME?.trim() || 'Ese';
}

export function storeUrl(): string | null {
  const url = process.env.ELOHIM_STORE_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

export interface CatalogueInput {
  source: CatalogueSource;
  externalId?: string | null;
  sku?: string | null;
  name: string;
  brand?: string | null;
  category?: string | null;
  description?: string;
  ingredients?: string[];
  tags?: string[];
  priceCents?: number | null;
  currency?: string;
  url: string;
  imageUrl?: string | null;
  inStock?: boolean;
}

export async function upsertCatalogueProduct(input: CatalogueInput): Promise<string> {
  const existing = input.externalId
    ? await row<{ id: string }>(
        'SELECT id FROM catalogue_products WHERE source = ? AND external_id = ?',
        input.source,
        input.externalId,
      )
    : await row<{ id: string }>(
        'SELECT id FROM catalogue_products WHERE source = ? AND lower(name) = lower(?) AND coalesce(brand, \'\') = coalesce(?, \'\')',
        input.source,
        input.name,
        input.brand ?? null,
      );

  const values = [
    input.sku ?? null,
    input.name.trim(),
    input.brand?.trim() || null,
    input.category?.trim() || null,
    (input.description ?? '').slice(0, 4000),
    JSON.stringify((input.ingredients ?? []).slice(0, 120)),
    JSON.stringify((input.tags ?? []).slice(0, 40)),
    input.priceCents ?? null,
    (input.currency ?? process.env.ELOHIM_STORE_CURRENCY ?? 'USD').toUpperCase().slice(0, 3),
    input.url,
    input.imageUrl ?? null,
    input.inStock === false ? 0 : 1,
    nowIso(),
  ] as const;

  if (existing) {
    await run(
      `UPDATE catalogue_products
          SET sku = ?, name = ?, brand = ?, category = ?, description = ?, ingredients_json = ?,
              tags_json = ?, price_cents = ?, currency = ?, url = ?, image_url = ?, in_stock = ?,
              updated_at = ?
        WHERE id = ?`,
      ...values,
      existing.id,
    );
    return existing.id;
  }

  const id = newId();
  await run(
    `INSERT INTO catalogue_products
       (id, source, external_id, sku, name, brand, category, description, ingredients_json,
        tags_json, price_cents, currency, url, image_url, in_stock, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.source,
    input.externalId ?? null,
    ...values,
  );
  return id;
}

export async function listCatalogue(limit = 500): Promise<CatalogueProduct[]> {
  return (await rows<CatalogueRow>(
    'SELECT * FROM catalogue_products ORDER BY in_stock DESC, name LIMIT ?',
    limit,
  )).map(hydrate);
}

export async function getCatalogueProduct(id: string): Promise<CatalogueProduct | null> {
  const found = await row<CatalogueRow>('SELECT * FROM catalogue_products WHERE id = ?', id);
  return found ? hydrate(found) : null;
}

/** Removes rows of one source that a sync did not see again. */
async function pruneMissing(source: CatalogueSource, seen: Set<string>): Promise<number> {
  const all = await rows<{ id: string; external_id: string | null }>(
    'SELECT id, external_id FROM catalogue_products WHERE source = ?',
    source,
  );
  let removed = 0;
  for (const r of all) {
    if (r.external_id && !seen.has(r.external_id)) {
      await run('DELETE FROM catalogue_products WHERE id = ?', r.id);
      removed++;
    }
  }
  return removed;
}

export async function catalogueStatus(): Promise<CatalogueStatus> {
  const count = await row<{ n: string | number }>('SELECT count(*) AS n FROM catalogue_products');
  const last = await row<{ finished_at: string | null; source: string; imported: number; error: string | null }>(
    'SELECT finished_at, source, imported, error FROM catalogue_syncs ORDER BY started_at DESC LIMIT 1',
  );
  return {
    storeName: storeName(),
    storeUrl: storeUrl(),
    products: Number(count?.n ?? 0),
    lastSync: last?.finished_at ?? null,
    lastSource: (last?.source as CatalogueStatus['lastSource']) ?? null,
    lastError: last?.error ?? null,
    comparison: Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET),
  };
}

// --- ingredient extraction --------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * Pulls an INCI list out of prose, when there is one.
 *
 * Looks for the word "ingredients" followed by a separator and takes the run
 * of comma-separated terms after it, stopping at a blank line or a full stop
 * that is not inside a term. Returns nothing rather than guessing: a list
 * that is not there is better than a list made of the marketing copy.
 */
export function extractIngredients(text: string): string[] {
  const plain = stripHtml(text);
  const match = plain.match(/ingredients?\s*(?:list)?\s*[:\-–—]\s*([^\n]{8,3000})/i);
  if (!match) return [];
  let run = match[1];
  // Stop at the first sentence end that follows a comma-free stretch of prose.
  const stop = run.search(/\.\s+[A-Z][a-z]+\s+[a-z]+\s+[a-z]+/);
  if (stop > 0) run = run.slice(0, stop);
  const terms = run
    .split(/,|;|•/)
    .map((t) => t.replace(/\.$/, '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 2 && t.length <= 60 && !/^\d+$/.test(t));
  return terms.slice(0, 120);
}

// --- storefront readers -----------------------------------------------------

interface ShopifyProduct {
  id: number | string;
  title: string;
  handle: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  variants?: Array<{ price?: string; available?: boolean; sku?: string }>;
  images?: Array<{ src?: string }>;
}

interface WooProduct {
  id: number | string;
  name: string;
  permalink: string;
  description?: string;
  short_description?: string;
  sku?: string;
  images?: Array<{ src?: string }>;
  categories?: Array<{ name?: string }>;
  tags?: Array<{ name?: string }>;
  prices?: { price?: string; currency_code?: string; currency_minor_unit?: number };
  is_in_stock?: boolean;
  brands?: Array<{ name?: string }>;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Elohim/1.0 (+catalogue sync)' },
  });
  if (!response.ok) return null;
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null;
  return (await response.json()) as T;
}

async function readShopify(base: string): Promise<CatalogueInput[]> {
  const out: CatalogueInput[] = [];
  for (let page = 1; page <= 20; page++) {
    const data = await fetchJson<{ products?: ShopifyProduct[] }>(
      `${base}/products.json?limit=250&page=${page}`,
    );
    const products = data?.products ?? [];
    if (!products.length) break;
    for (const p of products) {
      const variant = p.variants?.find((v) => v.available) ?? p.variants?.[0];
      const price = variant?.price ? Math.round(Number(variant.price) * 100) : null;
      const tags = Array.isArray(p.tags)
        ? p.tags
        : String(p.tags ?? '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
      out.push({
        source: 'shopify',
        externalId: String(p.id),
        sku: variant?.sku ?? null,
        name: p.title,
        brand: p.vendor ?? null,
        category: p.product_type ?? null,
        description: stripHtml(p.body_html ?? ''),
        ingredients: extractIngredients(p.body_html ?? ''),
        tags,
        priceCents: Number.isFinite(price) ? price : null,
        url: `${base}/products/${p.handle}`,
        imageUrl: p.images?.[0]?.src ?? null,
        inStock: p.variants ? p.variants.some((v) => v.available !== false) : true,
      });
    }
    if (products.length < 250) break;
  }
  return out;
}

async function readWooCommerce(base: string): Promise<CatalogueInput[]> {
  const out: CatalogueInput[] = [];
  for (let page = 1; page <= 50; page++) {
    const products = await fetchJson<WooProduct[]>(
      `${base}/wp-json/wc/store/v1/products?per_page=100&page=${page}`,
    );
    if (!products?.length) break;
    for (const p of products) {
      const minor = p.prices?.currency_minor_unit ?? 2;
      const raw = p.prices?.price ? Number(p.prices.price) : NaN;
      const price = Number.isFinite(raw) ? Math.round(raw * Math.pow(10, 2 - minor)) : null;
      const text = `${p.short_description ?? ''}\n${p.description ?? ''}`;
      out.push({
        source: 'woocommerce',
        externalId: String(p.id),
        sku: p.sku ?? null,
        name: p.name,
        brand: p.brands?.[0]?.name ?? null,
        category: p.categories?.[0]?.name ?? null,
        description: stripHtml(text),
        ingredients: extractIngredients(text),
        tags: (p.tags ?? []).map((t) => t.name ?? '').filter(Boolean),
        priceCents: price,
        currency: p.prices?.currency_code ?? undefined,
        url: p.permalink,
        imageUrl: p.images?.[0]?.src ?? null,
        inStock: p.is_in_stock !== false,
      });
    }
    if (products.length < 100) break;
  }
  return out;
}

/** Which platform a storefront is, by asking each in turn. */
export async function detectStore(base: string): Promise<CatalogueSource | null> {
  const kind = process.env.ELOHIM_STORE_KIND?.toLowerCase();
  if (kind === 'shopify' || kind === 'woocommerce') return kind;
  const shopify = await fetchJson<{ products?: unknown[] }>(`${base}/products.json?limit=1`).catch(
    () => null,
  );
  if (shopify?.products) return 'shopify';
  const woo = await fetchJson<unknown[]>(`${base}/wp-json/wc/store/v1/products?per_page=1`).catch(
    () => null,
  );
  if (Array.isArray(woo)) return 'woocommerce';
  return null;
}

/**
 * Reads the configured storefront into the shelf.
 *
 * Rows the store no longer lists are removed; rows it still lists are updated
 * in place, so prices and stock follow the shop. Returns what happened, and
 * records it, so the admin can see the last sync without reading logs.
 */
export async function syncStore(): Promise<{ imported: number; removed: number; source: CatalogueSource }> {
  const base = storeUrl();
  if (!base) throw new Error('ELOHIM_STORE_URL is not set.');
  const syncId = newId();
  await run(
    'INSERT INTO catalogue_syncs (id, source, store_url, started_at) VALUES (?, ?, ?, ?)',
    syncId,
    'unknown',
    base,
    nowIso(),
  );
  try {
    const source = await detectStore(base);
    if (!source) {
      throw new Error(
        `${base} does not look like a Shopify or WooCommerce storefront. Import the catalogue as JSON instead.`,
      );
    }
    const items = source === 'shopify' ? await readShopify(base) : await readWooCommerce(base);
    const seen = new Set<string>();
    for (const item of items) {
      await upsertCatalogueProduct(item);
      if (item.externalId) seen.add(item.externalId);
    }
    const removed = await pruneMissing(source, seen);
    await run(
      'UPDATE catalogue_syncs SET source = ?, imported = ?, removed = ?, finished_at = ? WHERE id = ?',
      source,
      items.length,
      removed,
      nowIso(),
      syncId,
    );
    log.info('catalogue', 'store synced', { source, imported: items.length, removed });
    return { imported: items.length, removed, source };
  } catch (err) {
    await run(
      'UPDATE catalogue_syncs SET error = ?, finished_at = ? WHERE id = ?',
      (err as Error).message.slice(0, 500),
      nowIso(),
      syncId,
    );
    throw err;
  }
}

/** A JSON import: for shops that are neither platform, or for a hand-kept list. */
export async function importCatalogue(items: unknown[]): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  const syncId = newId();
  await run(
    'INSERT INTO catalogue_syncs (id, source, started_at) VALUES (?, ?, ?)',
    syncId,
    'import',
    nowIso(),
  );
  for (const raw of items.slice(0, 2000)) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const url = typeof p.url === 'string' ? p.url.trim() : '';
    if (!name || !/^https?:\/\//.test(url)) {
      skipped++;
      continue;
    }
    const price =
      typeof p.price === 'number'
        ? Math.round(p.price * 100)
        : typeof p.priceCents === 'number'
          ? Math.round(p.priceCents)
          : null;
    await upsertCatalogueProduct({
      source: 'import',
      externalId: typeof p.id === 'string' || typeof p.id === 'number' ? String(p.id) : null,
      sku: typeof p.sku === 'string' ? p.sku : null,
      name,
      brand: typeof p.brand === 'string' ? p.brand : null,
      category: typeof p.category === 'string' ? p.category : null,
      description: typeof p.description === 'string' ? p.description : '',
      ingredients: Array.isArray(p.ingredients)
        ? p.ingredients.filter((i): i is string => typeof i === 'string')
        : typeof p.ingredients === 'string'
          ? extractIngredients(`Ingredients: ${p.ingredients}`)
          : [],
      tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
      priceCents: price,
      currency: typeof p.currency === 'string' ? p.currency : undefined,
      url,
      imageUrl: typeof p.image === 'string' ? p.image : typeof p.imageUrl === 'string' ? p.imageUrl : null,
      inStock: p.inStock !== false,
    });
    imported++;
  }
  await run(
    'UPDATE catalogue_syncs SET imported = ?, finished_at = ? WHERE id = ?',
    imported,
    nowIso(),
    syncId,
  );
  return { imported, skipped };
}
