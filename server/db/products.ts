import { row, rows, run } from './index.ts';
import { newId, nowIso } from '../lib/ids.ts';
import type { Product, ProductUsage } from '../../shared/types.ts';

interface ProductRow {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  ingredients_json: string;
  source: string;
}

function hydrate(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    ingredients: JSON.parse(row.ingredients_json),
    source: row.source as Product['source'],
  };
}

export async function upsertProduct(input: {
  name: string;
  brand?: string | null;
  category?: string | null;
  ingredients?: string[];
  source?: Product['source'];
}): Promise<Product> {
  // coalesce(...) rather than `=` so a null brand matches a null brand — SQL
  // equality never matches two nulls.
  const existing = await row<ProductRow>(
    `SELECT * FROM products
        WHERE lower(name) = lower(?)
          AND coalesce(lower(brand), '') = coalesce(lower(?), '')`,
    input.name,
    input.brand ?? null,
  );

  if (existing) {
    if (input.ingredients?.length) {
      await run(
        'UPDATE products SET ingredients_json = ? WHERE id = ?',
        JSON.stringify(input.ingredients),
        existing.id,
      );
      existing.ingredients_json = JSON.stringify(input.ingredients);
    }
    return hydrate(existing);
  }

  const id = newId();
  await run(
    `INSERT INTO products (id, name, brand, category, ingredients_json, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.name.trim(),
    input.brand ?? null,
    input.category ?? null,
    JSON.stringify(input.ingredients ?? []),
    input.source ?? 'user',
    nowIso(),
  );
  return {
    id,
    name: input.name.trim(),
    brand: input.brand ?? null,
    category: input.category ?? null,
    ingredients: input.ingredients ?? [],
    source: input.source ?? 'user',
  };
}

export async function searchProducts(query: string, limit = 20): Promise<Product[]> {
  return (await rows<ProductRow>(
    // ILIKE, not LIKE: SQLite matched ASCII case-insensitively by default and
    // Postgres does not, so after the migration "ordinary" stopped finding
    // "The Ordinary" — a silently degraded search rather than an error.
    'SELECT * FROM products WHERE name ILIKE ? OR brand ILIKE ? ORDER BY name LIMIT ?',
    `%${query}%`,
    `%${query}%`,
    limit,
  )).map(hydrate);
}

export async function getProduct(id: string): Promise<Product | null> {
  const found = await row<ProductRow>('SELECT * FROM products WHERE id = ?', id);
  return found ? hydrate(found) : null;
}

export async function startUsage(
  userId: string,
  productId: string,
  opts: { startedAt?: string; frequency?: string; notes?: string } = {},
): Promise<string> {
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
    'UPDATE product_usage SET ended_at = ? WHERE id = ? AND user_id = ?',
    endedAt ?? nowIso(),
    usageId,
    userId,
  );
}

export async function listUsage(userId: string): Promise<ProductUsage[]> {
  return (await rows<
    ProductRow & {
      id: string;
      pid: string;
      started_at: string;
      ended_at: string | null;
      frequency: string | null;
      notes: string | null;
    }
  >(
    `SELECT u.id, u.started_at, u.ended_at, u.frequency, u.notes,
            p.id AS pid, p.name, p.brand, p.category, p.ingredients_json, p.source
       FROM product_usage u
       JOIN products p ON p.id = u.product_id
      WHERE u.user_id = ?
      ORDER BY u.started_at DESC`,
    userId,
  )).map((r) => ({
    id: r.id,
    product: hydrate({ ...r, id: r.pid }),
    startedAt: r.started_at,
    endedAt: r.ended_at,
    frequency: r.frequency,
    notes: r.notes,
  }));
}
