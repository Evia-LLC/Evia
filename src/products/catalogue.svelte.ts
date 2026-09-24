/**
 * The shelf as the Products page has fetched it: the current page of the
 * catalogue for the chip and search in view, the shop's public status, and
 * the per-product detail (what the ingredient list contains, how it sits with
 * the profile) fetched when a product is opened.
 *
 * Page-local on purpose: nothing here belongs to the session, is shown on
 * another page or survives sign-out beyond a stale list the next load
 * replaces. Only a signed-in account can read the catalogue route; a guest
 * gets `signed-out` and the page explains, and the public status (product
 * count, shop name) is read for everyone.
 *
 * Requests race when someone types fast or flicks between chips; each load
 * carries a ticket and only the latest one writes.
 *
 * A chip or "View all" asks for one page of up to 60 products; the route's
 * cursor then brings the next page on "Show more", appended under the same
 * query, so a large catalogue is never silently cut at the first page.
 *
 * Saved products are fetched by id (a saved product may sit on any page of
 * the shelf, or have left it): `savedItems` holds each one, or null when the
 * shop no longer has it.
 */
import { api, ApiError, type CatalogueCategory, type CatalogueListing } from '@/lib/api.ts';
import type { CatalogueExtra } from '@/view/products.ts';

export type ShelfStatus = 'idle' | 'loading' | 'ready' | 'error' | 'signed-out';

export const shelf = $state({
  status: 'idle' as ShelfStatus,
  items: [] as CatalogueListing[],
  total: 0,
  /** The cursor for the next page of the same query; null on the last page. */
  nextCursor: null as string | null,
  loadingMore: false,
  /** Saved shelf products by catalogue id; null = no longer on the shelf. */
  savedItems: {} as Record<string, CatalogueListing | null>,
  /** From the public status route; null until it answers. */
  storeName: 'Ese',
  shelfCount: null as number | null,
  extras: {} as Record<string, CatalogueExtra>,
});

let ticket = 0;
let statusAsked = false;
/** The query the current list answers, for "Show more". */
let current: { category: CatalogueCategory | null; q: string; limit: number } | null = null;

/** The shop's name and size, once per visit (public: guests too). */
export async function loadShelfStatus(): Promise<void> {
  if (statusAsked) return;
  statusAsked = true;
  try {
    const { status } = await api.catalogueStatus();
    shelf.storeName = status.storeName || 'Ese';
    shelf.shelfCount = status.products;
  } catch {
    statusAsked = false;
  }
}

/** One page of the shelf for a chip (null = everything) and a search. */
export async function loadShelf(
  query: { category: CatalogueCategory | null; q: string; limit: number },
  signedIn: boolean,
): Promise<void> {
  const mine = ++ticket;
  current = query;
  shelf.nextCursor = null;
  shelf.loadingMore = false;
  if (!signedIn) {
    shelf.status = 'signed-out';
    shelf.items = [];
    shelf.total = 0;
    return;
  }
  shelf.status = 'loading';
  try {
    const page = await api.catalogue({ category: query.category, q: query.q, limit: query.limit });
    if (mine !== ticket) return;
    shelf.items = page.products;
    shelf.total = page.total;
    shelf.nextCursor = page.nextCursor;
    shelf.status = 'ready';
  } catch {
    if (mine !== ticket) return;
    shelf.items = [];
    shelf.total = 0;
    shelf.status = 'error';
  }
}

/** The next page of the same chip and search, added under what is shown. */
export async function loadMoreShelf(): Promise<void> {
  const cursor = shelf.nextCursor;
  if (!cursor || !current || shelf.loadingMore || shelf.status !== 'ready') return;
  const mine = ticket;
  shelf.loadingMore = true;
  try {
    const page = await api.catalogue({ category: current.category, q: current.q, limit: current.limit, cursor });
    if (mine !== ticket) return;
    const seen = new Set(shelf.items.map((p) => p.id));
    shelf.items = [...shelf.items, ...page.products.filter((p) => !seen.has(p.id))];
    shelf.total = page.total;
    shelf.nextCursor = page.nextCursor;
  } catch {
    // The button stays; pressing it again retries.
  } finally {
    if (mine === ticket) shelf.loadingMore = false;
  }
}

const asked = new Set<string>();

/** What a shelf product's ingredient list says, fetched once per product. */
export async function loadShelfDetail(id: string): Promise<void> {
  if (asked.has(id)) return;
  asked.add(id);
  const mine = ticket;
  try {
    const { product, contains, assessment } = await api.catalogueProduct(id);
    if (mine !== ticket) return;
    shelf.extras = { ...shelf.extras, [id]: { contains, assessment } };
    shelf.savedItems = { ...shelf.savedItems, [id]: product };
  } catch (err) {
    asked.delete(id);
    if (mine === ticket && err instanceof ApiError && err.status === 404) {
      shelf.savedItems = { ...shelf.savedItems, [id]: null };
    }
  }
}

/** The saved shelf products (catalogue ids), each fetched once. */
export function loadSavedShelf(ids: string[]): void {
  for (const id of ids.slice(0, 60)) {
    if (!(id in shelf.savedItems)) void loadShelfDetail(id);
  }
}

/** Forget everything (sign-out, account switch). */
export function resetShelf(): void {
  ticket++;
  asked.clear();
  shelf.status = 'idle';
  shelf.items = [];
  shelf.total = 0;
  shelf.nextCursor = null;
  shelf.loadingMore = false;
  shelf.savedItems = {};
  shelf.extras = {};
  current = null;
}
