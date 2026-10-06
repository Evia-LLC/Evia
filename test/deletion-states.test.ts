/**
 * P1-T10 — deletion responses reflect durable completion.
 *
 * Three layers, following the conventions of the suites it sits beside:
 * - contract unit tests (no database): the shared delete-result shapes.
 * - source assertions (style of test/data-rights-ui.test.ts): each response
 *   state drives the correct UI/session behavior in the client.
 * - HTTP durability tests (style of test/ownership-boundaries.test.ts): real
 *   Express routers plus the real disposable database from `npm run
 *   test:local`, with only rate limiters stubbed. Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  completedAccountDeletion,
  completedItemDeletion,
  failedDeletion,
  isDeletionCompleted,
  isDeletionFailed,
  isDeletionPending,
  pendingDeletion,
} from '../shared/delete-result.ts';

// Same convention as ownership-boundaries.test.ts: database-backed sections
// only run under `npm run test:local` (which injects a disposable PGlite
// URL). A bare `vitest run` runs the contract/source sections and skips the
// HTTP section loudly instead of failing opaquely.
const configured = (process.env.NETLIFY_DATABASE_URL ?? '').length > 0;
if (!configured) {
  console.warn(
    '[deletion-states] NETLIFY_DATABASE_URL is not set — HTTP durability tests did not run (use `npm run test:local`).',
  );
}

const deletionControl = vi.hoisted(() => ({ failNext: false }));

vi.mock('../server/lib/rate-limit.ts', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    loginLimiter: pass,
    registerLimiter: pass,
    chatLimiter: pass,
    visionLimiter: pass,
    voiceLimiter: pass,
    guestVoiceLimiter: pass,
    scanLimiter: pass,
  };
});

// Simulates a mid-transaction durable-store failure that rolls the account
// delete back: the route must answer `failed` with the account preserved.
// The flag is consumed once so the retry in the same test runs the real path.
vi.mock('../server/privacy/delete-account.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/privacy/delete-account.ts')>();
  return {
    ...actual,
    deleteAccount: async (userId: string, dependencies?: unknown) => {
      if (deletionControl.failNext) {
        deletionControl.failNext = false;
        throw new Error('simulated durable-store failure');
      }
      return (actual.deleteAccount as (id: string, deps?: unknown) => Promise<unknown>)(userId, dependencies);
    },
  };
});

describe('deletion result contract', () => {
  it('distinguishes completed, pending and failed with honest messages', () => {
    const completed = completedAccountDeletion(3);
    expect(completed.status).toBe('completed');
    expect(completed.scope).toBe('account');
    expect(completed.blobsShredded).toBe(3);
    expect(completed.deleted).toBe(true);
    expect(completed.message).toMatch(/permanently deleted/i);
    expect(completed.message).toMatch(/signed out/i);
    expect(isDeletionCompleted(completed)).toBe(true);

    const failed = failedDeletion('account', new Error('boom'));
    expect(failed.status).toBe('failed');
    expect(failed.retryable).toBe(true);
    expect(failed.exportAvailable).toBe(true);
    expect(failed.error).toContain('boom');
    expect(isDeletionFailed(failed)).toBe(true);
  });

  it('sanitises failure causes and never leaks stacks or driver detail', () => {
    const fromError = failedDeletion('photo', new Error('storage unavailable\n    at delete (/x.ts:1:1)'));
    expect(fromError.error).toContain('storage unavailable');
    expect(fromError.error).not.toContain('at delete');
    expect(failedDeletion('scan', undefined).error).toMatch(/intact/i);
    expect(failedDeletion('scan', '').error).toMatch(/intact/i);
  });

  it('reports item deletes honestly, including owner-scoped no-ops', () => {
    const gone = completedItemDeletion('photo', 'photo-1');
    expect(gone.status).toBe('completed');
    expect(gone.deleted).toBe(true);
    expect(gone.id).toBe('photo-1');
    const noop = completedItemDeletion('scan', 'foreign-id', { deleted: false });
    expect(noop.deleted).toBe(false);
    expect(noop.message).toMatch(/nothing was deleted/i);
  });

  it('allows pending only with genuinely outstanding work and never claims erasure', () => {
    expect(() => pendingDeletion('account', [])).toThrow(/outstanding/);
    const pending = pendingDeletion('account', ['object-store: 2 blobs', 'managed-identity']);
    expect(pending.status).toBe('pending');
    expect(pending.outstanding).toHaveLength(2);
    expect(pending.exportAvailable).toBe(true);
    expect(pending.sessionPreserved).toBe(true);
    expect(pending.message).toMatch(/not yet/i);
    expect(pending.message).not.toMatch(/permanently deleted/i);
    expect(pending.message).not.toMatch(/signed out/i);
    expect(isDeletionPending(pending)).toBe(true);
  });
});

describe('deletion UI/session source contract', () => {
  it('types every delete caller against the durable contract', async () => {
    const source = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
    expect(source).toContain("request<DeleteResult>('/me/data'");
    expect(source).toContain('request<DeleteResult>(`/scans/${id}`');
    expect(source).toContain('request<DeleteResult>(`/body-scans/${id}`');
    expect(source).toContain('request<DeleteResult>(`/progress-photos/${id}`');
  });

  it('clears the session only on completed and preserves it for pending', async () => {
    const source = await readFile(new URL('../src/state/controller.ts', import.meta.url), 'utf8');
    const deletion = source.slice(
      source.indexOf('export async function deleteAccount'),
      source.indexOf('/** Saves only after the result-screen'),
    );
    // Completed: confirmed response clears auth, in this order.
    expect(deletion).toContain('isDeletionCompleted(receipt)');
    expect(deletion.indexOf('await api.deleteAccount()')).toBeLessThan(deletion.indexOf('setToken(null)'));
    expect(deletion.indexOf('setToken(null)')).toBeLessThan(deletion.indexOf('session.reset()'));
    // Pending: returns the receipt with the session untouched.
    const pendingBranch = deletion.slice(deletion.indexOf('isDeletionPending(receipt)'));
    expect(pendingBranch).not.toContain('setToken(null)');
    expect(pendingBranch).not.toContain('session.reset()');
    // Failed shapes surface as errors, never as success.
    expect(deletion).toContain('throw new ApiError(500, receipt.error)');
    expect(source).toContain('export function lastAccountDeletionReceipt');
  });

  it('renders a success, pending and intact-error screen for the three states', async () => {
    const source = await readFile(new URL('../src/pages/DataRightsPage.svelte', import.meta.url), 'utf8');
    // Completed: states what was deleted and that the session is signed out.
    expect(source).toContain('completedReceipt');
    expect(source).toContain('Your account is deleted.');
    expect(source).toContain('You are signed out.');
    expect(source).toContain('completedReceipt.blobsShredded');
    // Pending: status screen, session intact, export still available, no
    // complete-erasure claim.
    expect(source).toContain('pendingReceipt');
    expect(source).toContain('Deletion is pending.');
    expect(source).toContain('Your data is not yet fully erased.');
    expect(source).toContain('your export above remains available');
    expect(source).toContain('pendingReceipt.outstanding');
    // Failed: account intact, export intact, retry possible.
    expect(source).toContain('Your account and data are intact');
    expect(source).toContain('Your export above is still available');
    expect(source).toContain('you can retry');
  });

  it('answers pending only from the explicit forward-compat path, never the store', async () => {
    const routes = await readFile(new URL('../server/routes/api.ts', import.meta.url), 'utf8');
    expect(routes).toContain('outstandingDurableDeletions()');
    expect(routes).toContain("pendingDeletion('account', outstanding)");
    // The transactional delete maps commit -> completed, throw -> failed.
    expect(routes).toContain('completedAccountDeletion(result.blobsShredded)');
    expect(routes).toContain("failedDeletion('account', err)");
  });
});

const { migrate } = await import('../server/db/index.ts');
const { apiRouter } = await import('../server/routes/api.ts');
const {
  createAccount,
  seedScan,
  seedProgressPhoto,
  authHeaders,
} = await import('./helpers/two-accounts.ts');

const { default: express } = await import('express');
const { createServer } = await import('node:http');
import type { Server } from 'node:http';

let server: Server | undefined;
let base: string;
let survivorToken = '';
let survivorScanId = '';

beforeAll(async () => {
  if (!configured) return;
  await migrate();
  const survivor = await createAccount('deletion-survivor');
  survivorToken = survivor.token;
  survivorScanId = (await seedScan(survivor.userId)).id!;

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const listener = createServer(app);
  server = listener;
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('no listener');
  base = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

const del = (path: string, token?: string) =>
  fetch(base + path, { method: 'DELETE', headers: token ? authHeaders(token) : {} });
const get = (path: string, token?: string) =>
  fetch(base + path, { headers: token ? authHeaders(token) : {} });

describe.skipIf(!configured)('deletion HTTP durability', () => {
  it('answers account deletion as completed, never pending, for the transactional store', async () => {
    const { token } = await createAccount('deletion-completed');
    const res = await del('/api/me/data', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('completed');
    expect(body.scope).toBe('account');
    expect(typeof body.blobsShredded).toBe('number');
    expect(typeof body.deletedAt).toBe('string');
    expect(String(body.message)).toMatch(/permanently deleted/i);
  });

  it('removes access after confirmed deletion while another account survives', async () => {
    const { token } = await createAccount('deletion-access');
    expect((await del('/api/me/data', token)).status).toBe(200);
    // The session row cascades with the user row: the old token is dead.
    expect((await get('/api/me', token)).status).toBe(401);
    expect((await get('/api/me/data-export', token)).status).toBe(401);
    // The survivor is untouched.
    expect((await get('/api/me', survivorToken)).status).toBe(200);
    const scan = await get(`/api/scans/${survivorScanId}`, survivorToken);
    expect(scan.status).toBe(200);
  });

  it('preserves the account and export after a rollback and allows retry', async () => {
    const { token } = await createAccount('deletion-rollback');
    deletionControl.failNext = true;
    const failed = await del('/api/me/data', token);
    expect(failed.status).toBe(500);
    const receipt = (await failed.json()) as Record<string, unknown>;
    expect(receipt.status).toBe('failed');
    expect(receipt.scope).toBe('account');
    expect(receipt.retryable).toBe(true);
    expect(typeof receipt.error).toBe('string');
    // Rolled back: the account still answers and the export still downloads.
    expect((await get('/api/me', token)).status).toBe(200);
    const exported = await get('/api/me/data-export', token);
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    // Retry runs the real store and completes.
    const retried = await del('/api/me/data', token);
    expect(retried.status).toBe(200);
    expect(((await retried.json()) as Record<string, unknown>).status).toBe('completed');
    expect((await get('/api/me', token)).status).toBe(401);
  });

  it('completes a photo delete, removes the item, and reports a missing photo as failed', async () => {
    const { token, userId } = await createAccount('deletion-photo');
    const scanId = (await seedScan(userId)).id!;
    const photo = await seedProgressPhoto(userId, scanId);
    const res = await del(`/api/progress-photos/${photo.id}`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('completed');
    expect(body.scope).toBe('photo');
    // The item is gone from the list and the image route.
    const listed = ((await (await get('/api/progress-photos', token)).json()) as { photos: { id: string }[] }).photos;
    expect(listed.map((p) => p.id)).not.toContain(photo.id);
    expect((await get(`/api/progress-photos/${photo.id}/image`, token)).status).toBe(404);
    // Deleting it again is a failed no-op; the account and export survive.
    const missing = await del(`/api/progress-photos/${photo.id}`, token);
    expect(missing.status).toBe(404);
    const receipt = (await missing.json()) as Record<string, unknown>;
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toBe('No such progress photo.');
    expect((await get('/api/me/data-export', token)).status).toBe(200);
  });

  it('completes a scan delete and keeps cross-account deletes honest no-ops', async () => {
    const owner = await createAccount('deletion-scan-owner');
    const stranger = await createAccount('deletion-scan-stranger');
    const scanId = (await seedScan(owner.userId)).id!;
    // A non-owner answers 200 without touching the row — reported with
    // `deleted: false`, never as a deletion.
    const foreign = await del(`/api/scans/${scanId}`, stranger.token);
    expect(foreign.status).toBe(200);
    const foreignBody = (await foreign.json()) as Record<string, unknown>;
    expect(foreignBody.status).toBe('completed');
    expect(foreignBody.deleted).toBe(false);
    expect((await get(`/api/scans/${scanId}`, owner.token)).status).toBe(200);
    // The owner completes: the row is gone.
    const own = await del(`/api/scans/${scanId}`, owner.token);
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as Record<string, unknown>;
    expect(ownBody.status).toBe('completed');
    expect(ownBody.deleted).toBe(true);
    expect((await get(`/api/scans/${scanId}`, owner.token)).status).toBe(404);
  });
});
