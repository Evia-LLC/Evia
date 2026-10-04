import { row, rows, run } from "./index.ts";
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
  if (ownerId) {
    // coalesce(...) rather than `=` so a null brand matches a null brand — SQL
    // equality never matches two nulls. owner_id uses `=` deliberately: it is
    // NOT NULL here, so no null-matching subtlety, and a shared row (NULL)
    // can never equal a user id.
    const existing = await row<ProductRow>(
      `SELECT * FROM products
        WHERE lower(name) = lower(?)
          AND coalesce(lower(brand), '') = coalesce(lower(?), '')
          AND owner_id = ?`,
      input.name,
      input.brand ?? null,
      ownerId,
    );

    if (existing) {
      if (input.ingredients?.length) {
        await run(
          "UPDATE products SET ingredients_json = ? WHERE id = ?",
          JSON.stringify(input.ingredients),
          existing.id,
        );
        existing.ingredients_json = JSON.stringify(input.ingredients);
      }
      return hydrate(existing);
    }

    const id = newId();
    await run(
      `INSERT INTO products (id, name, brand, category, ingredients_json, source, owner_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name.trim(),
      input.brand ?? null,
      input.category ?? null,
      JSON.stringify(input.ingredients ?? []),
      input.source ?? "user",
      ownerId,
      nowIso(),
    );
    return {
      id,
      name: input.name.trim(),
      brand: input.brand ?? null,
      category: input.category ?? null,
      ingredients: input.ingredients ?? [],
      source: input.source ?? "user",
    };
  }

  // Shared/operator path: matches and mutates only shared rows. Used for the
  // operator catalogue and for every historical row, which all read as shared.
  const existing = await row<ProductRow>(
    `SELECT * FROM products
        WHERE lower(name) = lower(?)
          AND coalesce(lower(brand), '') = coalesce(lower(?), '')
          AND owner_id IS NULL`,
    input.name,
    input.brand ?? null,
  );

  if (existing) {
    if (input.ingredients?.length) {
      await run(
        "UPDATE products SET ingredients_json = ? WHERE id = ?",
        JSON.stringify(input.ingredients),
        existing.id,
      );
      existing.ingredients_json = JSON.stringify(input.ingredients);
    }
    return hydrate(existing);
  }

  const id = newId();
  await run(
    `INSERT INTO products (id, name, brand, category, ingredients_json, source, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    id,
    input.name.trim(),
    input.brand ?? null,
    input.category ?? null,
    JSON.stringify(input.ingredients ?? []),
    input.source ?? "user",
    nowIso(),
  );
  return {
    id,
    name: input.name.trim(),
    brand: input.brand ?? null,
    category: input.category ?? null,
    ingredients: input.ingredients ?? [],
    source: input.source ?? "user",
  };
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
  const like = `%${query}%`;
  const found = userId
    ? await rows<ProductRow>(
        // ILIKE, not LIKE: SQLite matched ASCII case-insensitively by default and
        // Postgres does not, so after the migration "ordinary" stopped finding
        // "The Ordinary" — a silently degraded search rather than an error.
        `SELECT * FROM products
          WHERE (name ILIKE ? OR brand ILIKE ?)
            AND (owner_id IS NULL OR owner_id = ?)
          ORDER BY name LIMIT ?`,
        like,
        like,
        userId,
        max,
      )
    : await rows<ProductRow>(
        `SELECT * FROM products
          WHERE (name ILIKE ? OR brand ILIKE ?)
            AND owner_id IS NULL
          ORDER BY name LIMIT ?`,
        like,
        like,
        max,
      );
  return found.map(hydrate);
}

export async function getProduct(id: string): Promise<Product | null> {
  const found = await row<ProductRow>(
    "SELECT * FROM products WHERE id = ?",
    id,
  );
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
  const found = await row<ProductRow>(
    "SELECT * FROM products WHERE id = ? AND (owner_id IS NULL OR owner_id = ?)",
    id,
    userId,
  );
  return found ? hydrate(found) : null;
}

/** Every product row a user owns. Used by data export. */
export async function listOwnedProducts(userId: string): Promise<Product[]> {
  return (
    await rows<ProductRow>(
      "SELECT * FROM products WHERE owner_id = ? ORDER BY name",
      userId,
    )
  ).map(hydrate);
}

/**
 * Removes every product row a user owns. Shared rows are never matched, so
 * the operator catalogue survives account deletion. Usage rows pointing at
 * the removed products go with them through products(id); the caller's
 * remaining usage goes with the users(id) cascade when the account row is
 * deleted right after.
 */
export async function deleteOwnedProducts(userId: string): Promise<number> {
  return run("DELETE FROM products WHERE owner_id = ?", userId);
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
  await run(
    `INSERT INTO product_usage (id, user_id, product_id, started_at, frequency, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    productId,
    opts.startedAt ?? nowIso(),
    opts.frequency ?? null,
    opts.notes ?? null,
  );
  return id;
}

export async function endUsage(
  userId: string,
  usageId: string,
  endedAt?: string,
): Promise<void> {
  await run(
    "UPDATE product_usage SET ended_at = ? WHERE id = ? AND user_id = ?",
    endedAt ?? nowIso(),
    usageId,
    userId,
  );
}

export async function listUsage(userId: string): Promise<ProductUsage[]> {
  return (
    await rows<
      ProductRow & {
        id: string;
        pid: string;
        started_at: string;
        ended_at: string | null;
        frequency: string | null;
        notes: string | null;
      }
    >(
      // Scoped to the caller's own usage rows, so the join can only ever expose
      // products the caller already attached — and after P1-T04 those are only
      // shared rows or the caller's own, because startUsage refuses the rest.
      `SELECT u.id, u.started_at, u.ended_at, u.frequency, u.notes,
            p.id AS pid, p.name, p.brand, p.category, p.ingredients_json, p.source
       FROM product_usage u
       JOIN products p ON p.id = u.product_id
      WHERE u.user_id = ?
      ORDER BY u.started_at DESC`,
      userId,
    )
  ).map((r) => ({
    id: r.id,
    product: hydrate({ ...r, id: r.pid }),
    startedAt: r.started_at,
    endedAt: r.ended_at,
    frequency: r.frequency,
    notes: r.notes,
  }));
}
