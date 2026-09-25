/**
 * Browsing the shelf: the Products page's category chips, its search box and
 * its paging, over whatever `listCatalogue` holds.
 *
 * Storefronts give a product one free-text category (Shopify's product type,
 * WooCommerce's first category) and a bag of tags, so there is no taxonomy to
 * filter on. The page's eight chips are matched here by words instead - a
 * "Gentle Foaming Wash" with no category still lands under Cleansers - and a
 * product that matches no chip is simply only found under "all" and by
 * search. Nothing is guessed beyond that: no product is put in a category its
 * own name, category and tags do not mention.
 *
 * Search is every word of the query against the name, brand, category, tags
 * and ingredient list, so "niacinamide serum" finds a serum that lists
 * niacinamide. Paging is an opaque cursor (an offset today; the page never
 * reads it) so the route can move to keyset paging without the client
 * noticing.
 */
import type { CatalogueProduct } from '../../shared/types.ts';
import { matchIngredients } from '../skin/ingredients.ts';
import { FAMILY_LABELS, type IngredientFamily } from '../skin/ingredient-data.ts';
import { affiliateLink, retailerFor } from './offers.ts';

export const CATALOGUE_CATEGORIES = [
  'cleansers',
  'toners',
  'serums',
  'moisturisers',
  'sunscreens',
  'treatments',
  'makeup',
] as const;

export type CatalogueCategory = (typeof CATALOGUE_CATEGORIES)[number];

/** The words that put a product under a chip. Matched on word starts. */
const CATEGORY_WORDS: Record<CatalogueCategory, RegExp> = {
  cleansers: /\b(cleans|face ?wash|facial wash|wash\b|micellar|cleansing|foam(ing)? wash|makeup remover)/i,
  toners: /\b(toner|tonic|essence|facial mist|face mist|mist\b)/i,
  serums: /\b(serum|ampoule|ampule|booster|concentrate|drops?\b)/i,
  moisturisers: /\b(moisturi[sz]|cream\b|lotion|gel[- ]cream|emulsion|balm\b|hydrator|night cream|day cream)/i,
  sunscreens: /\b(sunscreen|sun ?screen|sun ?cream|sunblock|spf\s?\d*|sun fluid|uv\b)/i,
  treatments: /\b(treatment|exfoliant|exfoliat|peel\b|spot\b|retin|bha\b|aha\b|mask\b)/i,
  makeup: /\b(makeup|make-up|foundation|concealer|lipstick|lip ?(gloss|tint|balm)|mascara|blush|bronzer|primer|eyeliner|eyeshadow|brow)/i,
};

export function isCatalogueCategory(value: unknown): value is CatalogueCategory {
  return typeof value === 'string' && (CATALOGUE_CATEGORIES as readonly string[]).includes(value);
}

/** Which chips a product belongs under (possibly none, possibly two). */
export function categoriesOf(product: CatalogueProduct): CatalogueCategory[] {
  const text = [product.category ?? '', product.name, ...product.tags].join(' ');
  return CATALOGUE_CATEGORIES.filter((key) => CATEGORY_WORDS[key].test(text));
}

function searchable(product: CatalogueProduct): string {
  return [product.name, product.brand ?? '', product.category ?? '', ...product.tags, ...product.ingredients]
    .join(' ')
    .toLowerCase();
}

export interface BrowseQuery {
  category?: CatalogueCategory | null;
  q?: string | null;
  limit?: number;
  cursor?: string | null;
}

export interface BrowsePage {
  products: CatalogueProduct[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
  /** How many products match, across all pages. */
  total: number;
}

export const BROWSE_DEFAULT_LIMIT = 24;
export const BROWSE_MAX_LIMIT = 60;

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
  return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

/** One page of the shelf, filtered. Keeps `listCatalogue`'s order (in stock first, then by name). */
export function browseCatalogue(all: CatalogueProduct[], query: BrowseQuery = {}): BrowsePage {
  const words = (query.q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 8);
  const category = query.category ?? null;

  const matching = all.filter((product) => {
    if (category && !categoriesOf(product).includes(category)) return false;
    if (!words.length) return true;
    const text = searchable(product);
    return words.every((word) => text.includes(word));
  });

  const limit = Math.min(Math.max(Math.trunc(query.limit ?? BROWSE_DEFAULT_LIMIT) || BROWSE_DEFAULT_LIMIT, 1), BROWSE_MAX_LIMIT);
  const offset = decodeCursor(query.cursor);
  const products = matching.slice(offset, offset + limit);
  const next = offset + products.length;
  return {
    products,
    nextCursor: next < matching.length ? encodeCursor(next) : null,
    total: matching.length,
  };
}

// --- what the page is sent ----------------------------------------------------

/** Families that are the formula's base rather than something it is for. */
const BASE_FAMILIES: IngredientFamily[] = ['texture', 'preservative', 'solvent', 'fragrance'];

/**
 * What the ingredient list says the product contains, as families
 * ("humectants", "barrier support"), in list order. Empty when the shop
 * published no list, which is common - the page then says nothing rather
 * than guessing from the marketing copy.
 */
export function containsFor(product: CatalogueProduct): string[] {
  const seen: string[] = [];
  for (const { rule } of matchIngredients(product.ingredients).matches) {
    if (BASE_FAMILIES.includes(rule.family)) continue;
    const label = FAMILY_LABELS[rule.family];
    if (!seen.includes(label)) seen.push(label);
  }
  return seen;
}

export interface CatalogueListing extends CatalogueProduct {
  /** The chips this product shows under. */
  categories: CatalogueCategory[];
  /**
   * Where "Shop at {retailer}" goes: the product URL with its retailer's
   * affiliate tag, if one is configured, and that product's own retailer.
   */
  shop: { url: string; retailer: string; affiliate: boolean };
}

export function listingFor(product: CatalogueProduct): CatalogueListing {
  const link = affiliateLink(product.url);
  return {
    ...product,
    categories: categoriesOf(product),
    /* Named from the product's own link (and its import's `retailer`), never from the tagged URL's query. */
    shop: { url: link.url, retailer: retailerFor(product.url, product), affiliate: link.affiliate },
  };
}
