/**
 * The operator's routes.
 *
 * Not a user, not a guest: whoever runs the shop. Guarded by a shared secret
 * (`ELOHIM_ADMIN_TOKEN`) in a header, because there is exactly one operator
 * and an admin account system would be a login page for one person. With no
 * token configured the routes do not exist, so a deployment cannot be
 * administered by accident.
 */
import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { asyncRouter } from '../lib/async-router.ts';
import { catalogueStatus, importCatalogue, listCatalogue, syncStore } from '../catalogue/store.ts';
import { log } from '../lib/log.ts';

export const adminRouter = asyncRouter();

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ELOHIM_ADMIN_TOKEN;
  if (!expected) {
    res.status(404).json({ error: 'Not found.' });
    return;
  }
  const given = String(req.headers['x-admin-token'] ?? '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Not authorised.' });
    return;
  }
  next();
}

adminRouter.use(requireAdmin);

adminRouter.get('/catalogue', async (_req, res) => {
  res.json({ status: await catalogueStatus(), products: await listCatalogue(1000) });
});

/** Reads the configured storefront into the shelf. */
adminRouter.post('/catalogue/sync', async (_req, res) => {
  try {
    const result = await log.timed('catalogue', 'sync', () => syncStore());
    res.json({ ok: true, ...result, status: await catalogueStatus() });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * A JSON import: `{ products: [{ name, url, price, currency, brand, category,
 * ingredients, image, inStock, sku, id }] }`. Price in major units.
 */
adminRouter.post('/catalogue/import', async (req, res) => {
  const items = req.body?.products;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'A non-empty products array is required.' });
    return;
  }
  const result = await importCatalogue(items);
  res.json({ ok: true, ...result, status: await catalogueStatus() });
});
