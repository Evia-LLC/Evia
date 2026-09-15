/**
 * Proof that a rejected promise from an async handler reaches the error
 * middleware instead of killing the process.
 *
 * This is tested against a real HTTP server rather than by inspecting the
 * wrapper, because the behaviour being guarded against lives in Express's
 * dispatch — `router/layer.js` calls the handler inside a try/catch and throws
 * the return value away. A unit test of the wrapper in isolation would pass
 * even if the wrapper were never wired in.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { asyncRouter } from '../server/lib/async-router.ts';

let server: Server;
let base: string;
/** Rejections that escaped to the process. Must stay empty. */
const escaped: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  escaped.push(reason);
};

beforeAll(async () => {
  process.on('unhandledRejection', onUnhandled);

  const router = asyncRouter();

  router.use(async (req, _res, next) => {
    // Async middleware that rejects — the requireAuth shape.
    if (req.path === '/reject-in-middleware') throw new Error('middleware exploded');
    next();
  });

  router.get('/ok', async (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/reject', async () => {
    throw new Error('handler exploded');
  });

  router.get('/reject-in-middleware', async (_req, res) => {
    res.json({ reached: true });
  });

  router.get('/sync-throw', () => {
    throw new Error('sync exploded');
  });

  const app = express();
  app.use(router);
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ): void => {
      res.status(500).json({ error: 'handled', message: err.message });
    },
  );

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  process.off('unhandledRejection', onUnhandled);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe('asyncRouter', () => {
  it('leaves working handlers alone', async () => {
    expect(await get('/ok')).toEqual({ status: 200, body: { ok: true } });
  });

  it('routes a rejected async handler to the error middleware', async () => {
    const { status, body } = await get('/reject');
    expect(status).toBe(500);
    expect(body.message).toBe('handler exploded');
  });

  it('routes a rejected async middleware to the error middleware', async () => {
    const { status, body } = await get('/reject-in-middleware');
    expect(status).toBe(500);
    expect(body.message).toBe('middleware exploded');
  });

  it('still handles a synchronous throw', async () => {
    const { status, body } = await get('/sync-throw');
    expect(status).toBe(500);
    expect(body.message).toBe('sync exploded');
  });

  it('lets nothing escape to the process', () => {
    // The failure this file exists to prevent: an unhandled rejection, which
    // under Node's default policy terminates the function instance.
    expect(escaped).toEqual([]);
  });
});
