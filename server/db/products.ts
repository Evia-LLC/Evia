import { database, result, affected, allPages } from '../lib/data-api.ts';
import { newId, nowIso } from "../lib/ids.ts";
import type { Product, ProductUsage } from "../../shared/types.ts";

interface ProductRow {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  ingredients_json: string;
  source: string;
  owner_id: string | null;
}

function hydrate(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    ingredients: JSON.parse(row.ingredients_json),
    source: row.source as Product["source"],
  };
}

/**
 * Thrown when a user tries to use a product they may not see: another user's
 * private row. Mapped to 404 (not 403) so the row's existence is not confirmed
 * to a caller who has no business knowing about it.
 */
export class ProductAccessDenied extends Error {
  readonly status = 404;
  constructor(productId: string) {
    super(`No such product: ${productId}`);
    this.name = "ProductAccessDenied";
  }
}

/**
 * User-scoped upsert (P1-T04).
 *
 * A user submission with an owner may create a user-owned row or modify ONLY
 * that user's own row, matched on name + brand + owner. It NEVER updates a
 * shared row (owner_id NULL) or another user's row: submitting A's name/brand
 * as B creates B's own separate row instead of poisoning A's.
 *
 * The second parameter is the caller's user id. Passing null/undefined takes
 * the shared path (operator catalogue, historical rows) — ordinary user routes
 * must always pass the authenticated id.
 */
export async function upsertProduct(
  input: {
    name: string;
    brand?: string | null;
    category?: string | null;
    ingredients?: string[];
    source?: Product["source"];
  },
  ownerId?: string | null,
): Promise<Product> {
  const existing = (await result<ProductRow[]>(database().rpc('evia_find_product_match', {
    p_name: input.name, p_brand: input.brand ?? null, p_owner_id: ownerId || null,
  })))[0];
  if (existing) {
    if (input.ingredients?.length) {
      await result(database().from('products').update({ ingredients_json: JSON.stringify(input.ingredients) }).eq('id', existing.id));
      existing.ingredients_json = JSON.stringify(input.ingredients);
    }
    return hydrate(existing);
  }
  const id = newId();
  await result(database().from('products').insert({
    id, name: input.name.trim(), brand: input.brand ?? null, category: input.category ?? null,
    ingredients_json: JSON.stringify(input.ingredients ?? []), source: input.source ?? 'user',
    owner_id: ownerId || null, created_at: nowIso(),
  }));
  return { id, name: input.name.trim(), brand: input.brand ?? null, category: input.category ?? null,
    ingredients: input.ingredients ?? [], source: input.source ?? 'user' };
}

/**
 * Explicit operator/shared write (P1-T04).
 *
 * The admin/catalogue import path (server/routes/admin.ts, catalogue store)
 * writes a different table today, so nothing calls this yet — it exists so a
 * later item can switch operator writes onto the products table without
 * routing them through the user upsert, which must never create or mutate
 * shared rows on a user's behalf.
 */
export async function createSharedProduct(input: {
  name: string;
  brand?: string | null;
  category?: string | null;
  ingredients?: string[];
  source?: Product["source"];
}): Promise<Product> {
  return upsertProduct(input, null);
}

/**
 * Owner-aware search (P1-T04).
 *
 * Returns shared rows plus the caller's own rows, never another user's. The
 * second parameter accepts the historical numeric-limit call shape so existing
 * callers keep compiling; without a user id only shared rows are returned —
 * private rows are deny-by-default.
 */
export async function searchProducts(
  query: string,
  userIdOrLimit?: string | number | null,
  limit = 20,
): Promise<Product[]> {
  const userId = typeof userIdOrLimit === "string" ? userIdOrLimit : null;
  const max = typeof userIdOrLimit === "number" ? userIdOrLimit : limit;
  const found = await result<ProductRow[]>(database().rpc('evia_search_products', {
    p_query: query, p_user_id: userId, p_limit: max,
  }));
  return found.map(hydrate);
}

export async function getProduct(id: string): Promise<Product | null> {
  const found = await result<ProductRow | null>(database().from('products').select('id,name,brand,category,ingredients_json,source,owner_id').eq('id', id).maybeSingle());
  return found ? hydrate(found) : null;
}

/**
 * Owner-aware single-row read (P1-T04).
 *
 * Returns the row only when the caller may see it: shared rows for everyone,
 * private rows only for their owner. Cross-owner private access reads as a
 * miss (null → 404 upstream), never as a forbidden confirmation.
 */
export async function getVisibleProduct(
  id: string,
  userId: string,
): Promise<Product | null> {
  const found = await result<ProductRow | null>(database().from('products').select('id,name,brand,category,ingredients_json,source,owner_id').eq('id', id).or(`owner_id.is.null,owner_id.eq.${JSON.stringify(userId)}`).maybeSingle());
  return found ? hydrate(found) : null;
}

/** Every product row a user owns. Used by data export. */
export async function listOwnedProducts(userId: string): Promise<Product[]> {
  return (await allPages<ProductRow>((from, to) => database().from('products').select('id,name,brand,category,ingredients_json,source,owner_id').eq('owner_id', userId).order('name').order('id').range(from, to))).map(hydrate);
}

/**
 * Removes every product row a user owns. Shared rows are never matched, so
 * the operator catalogue survives account deletion. Usage rows pointing at
 * the removed products go with them through products(id); the caller's
 * remaining usage goes with the users(id) cascade when the account row is
 * deleted right after.
 */
export async function deleteOwnedProducts(userId: string): Promise<number> {
  return affected(database().from('products').delete({ count: 'exact' }).eq('owner_id', userId));
}

export async function startUsage(
  userId: string,
  productId: string,
  opts: { startedAt?: string; frequency?: string; notes?: string } = {},
): Promise<string> {
  // Owner-aware gate: attaching a product the caller may not see fails BEFORE
  // any usage row is written, so a 404 leaves no orphan behind.
  const visible = await getVisibleProduct(productId, userId);
  if (!visible) throw new ProductAccessDenied(productId);
  const id = newId();
  await result(database().from('product_usage').insert({
    id, user_id: userId, product_id: productId, started_at: opts.startedAt ?? nowIso(),
    frequency: opts.frequency ?? null, notes: opts.notes ?? null,
  }));
  return id;
}

export async function endUsage(
  userId: string,
  usageId: string,
  endedAt?: string,
): Promise<void> {
  await result(database().from('product_usage').update({ ended_at: endedAt ?? nowIso() }).eq('id', usageId).eq('user_id', userId));
}

export async function listUsage(userId: string): Promise<ProductUsage[]> {
  const found = await allPages<{
    id: string; started_at: string; ended_at: string | null; frequency: string | null; notes: string | null;
    product: ProductRow;
  }>((from, to) => database().from('product_usage')
    .select('id,started_at,ended_at,frequency,notes,product:products!product_usage_product_id_fkey!inner(id,name,brand,category,ingredients_json,source,owner_id)')
    .eq('user_id', userId).order('started_at', { ascending: false }).order('id').range(from, to));
  return found.map((r) => ({ id: r.id, product: hydrate(r.product), startedAt: r.started_at,
    endedAt: r.ended_at, frequency: r.frequency, notes: r.notes }));
}
