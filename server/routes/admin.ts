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
import { dayString, todaySummary } from '../ai/budget.ts';
import { MODEL, modelAvailable } from '../ai/claude.ts';
import { analysisProvider, perfectCorpAvailable, sampleDemoEnabled } from '../ai/perfectcorp.ts';
import { blobStorageAvailable } from '../lib/crypto.ts';
import { connectionString, resolvePoolMax, row, rows } from '../db/index.ts';
import { clonedVoiceAvailable, guestVoiceAllowed } from '../voice/tts.ts';
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

/**
 * P1-T13 — operator diagnostics. The other half of the public capability
 * check: everything the anonymous /api/health deliberately withholds.
 *
 * Spend totals are computed on demand here, never on health polls. Database
 * state is counts and booleans only — never connection strings, hosts, or
 * credentials. Provider detail is availability booleans plus public names,
 * never keys, endpoints, or payloads. Reaching this handler at all means
 * boot (`ready()`) succeeded, which is what `boot.ready` reports.
 */
adminRouter.get('/diagnostics', async (_req, res) => {
  const summary = await todaySummary();
  const configured = connectionString() !== '';
  let reachable = false;
  try {
    await row('SELECT 1 AS ok');
    reachable = true;
  } catch {
    reachable = false;
  }
  let migrationsApplied: number | null = null;
  try {
    migrationsApplied = (await rows<{ name: string }>('SELECT name FROM _migrations')).length;
  } catch {
    migrationsApplied = null;
  }
  let poolMax: number | null = null;
  try {
    poolMax = resolvePoolMax();
  } catch {
    poolMax = null;
  }
  res.json({
    ok: true,
    day: dayString(),
    budget: {
      turns: summary.turns,
      tokens: summary.tokens,
      limits: summary.limits,
    },
    database: { configured, reachable, poolMax, migrationsApplied },
    providers: {
      model: { available: modelAvailable(), name: modelAvailable() ? MODEL : null },
      voice: { configured: clonedVoiceAvailable(), guestsAllowed: guestVoiceAllowed() },
      imageStorage: blobStorageAvailable(),
      analysis: {
        provider: analysisProvider(),
        available: perfectCorpAvailable(),
        sampleDemo: sampleDemoEnabled(),
      },
    },
    boot: { ready: true, migrationsApplied },
  });
});

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
