/**
 * P1-T02 — abuse limits are shared, normalized, and fail closed.
 *
 * The limiter used to count in a per-process Map with an email key that was
 * only lowercased, while authentication trims AND lowercases — so one address
 * had several quotas, and every serverless instance had its own. Everything
 * here runs against the real disposable Postgres from `npm run test:local`
 * (same convention as body-store.test.ts: its own schema, migrated, dropped
 * afterwards), with synthetic identities only.
 *
 * What each test proves:
 *  - two instances share one cap: two separate Express apps over one database
 *    enforce a single quota (no quota multiplication across instances);
 *  - whitespace/case variants share one login bucket (normalization matches
 *    users.authenticate exactly);
 *  - many account names from one address trip the address cap, while one
 *    account's fat fingers only trip its own account bucket and leave a
 *    neighbour behind the same NAT untouched;
 *  - a forged X-Forwarded-For on a direct connection can neither bypass the
 *    cap (rotating values still land in the peer bucket) nor select a bucket;
 *  - adapter extraction trusts only its host's header and ignores XFF;
 *  - a short window expires and resets;
 *  - a dead store denies paid and login paths (fail closed, never fail open).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";

const BASE_URL = process.env.NETLIFY_DATABASE_URL ?? "";
const configured = BASE_URL.length > 0;

if (!configured) {
  console.warn(
    "[rate-limit] NETLIFY_DATABASE_URL is not set — database tests did not run (use `npm run test:local`).",
  );
}

/** Its own schema, named for this run. */
const SCHEMA = `elohim_test_rl_${process.pid}_${Date.now()}`;

/** A short-lived connection for the schema itself, outside the app's pool. */
async function admin(sql: string) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: BASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

type RateLimit = typeof import("../server/lib/rate-limit.ts");
let rl: RateLimit;

beforeAll(async () => {
  if (!configured) return;
  await admin(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  // search_path in the connection string, not a SET: a pool opens
  // connections whenever it likes and a SET binds to one of them.
  process.env.NETLIFY_DATABASE_URL = `${BASE_URL}${BASE_URL.includes("?") ? "&" : "?"}options=-csearch_path%3D${SCHEMA}`;
  const { migrate } = await import("../server/db/index.ts");
  await migrate();
  rl = await import("../server/lib/rate-limit.ts");
});

afterAll(async () => {
  if (!configured) return;
  process.env.NETLIFY_DATABASE_URL = BASE_URL;
  await admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
});

/** Serves one Express app on a loopback port; caller closes the server. */
async function listen(
  app: express.Express,
): Promise<{ server: Server; base: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no listener");
  return {
    server,
    base: `http://127.0.0.1:${(address as { port: number }).port}`,
  };
}

const post = (
  base: string,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });

/**
 * Simulates what the deployment adapters do: stamp a verified client address
 * so several "NAT neighbours" can be exercised from one loopback socket.
 */
function stampedAs(ip: string) {
  return (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    rl.stampVerifiedClientIp(req, ip);
    next();
  };
}

describe.skipIf(!configured)("two instances share one cap", () => {
  it("counts hits from two apps against a single quota", async () => {
    const limiter = rl.rateLimit({
      name: "t-shared-cap",
      max: 3,
      windowMs: 60_000,
    });
    const ok = (_req: express.Request, res: express.Response) =>
      res.json({ ok: true });
    const appA = express();
    appA.use(express.json());
    appA.post("/paid", limiter, ok);
    const appB = express();
    appB.use(express.json());
    appB.post("/paid", limiter, ok);
    const a = await listen(appA);
    const b = await listen(appB);
    try {
      // Two instances, one database: the first three hits anywhere pass...
      expect((await post(a.base, "/paid", {})).status).toBe(200);
      expect((await post(b.base, "/paid", {})).status).toBe(200);
      expect((await post(a.base, "/paid", {})).status).toBe(200);
      // ...and the fourth is denied with the preserved 429 contract.
      const denied = await post(b.base, "/paid", {});
      expect(denied.status).toBe(429);
      expect(denied.headers.get("retry-after")).toMatch(/^\d+$/);
      expect(((await denied.json()) as { error: string }).error).toBe(
        "Too many requests — give it a moment.",
      );
    } finally {
      a.server.close();
      b.server.close();
    }
  });
});

describe.skipIf(!configured)("login identity normalization", () => {
  it("whitespace/case variants share one account bucket", async () => {
    const app = express();
    app.use(express.json());
    app.post("/login", rl.loginLimiter, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listen(app);
    try {
      const variants = [
        "  Case@Test.Local ",
        "case@test.local",
        "CASE@TEST.LOCAL",
        "\tcase@test.local\n",
        "  case@test.local",
        "CASE@test.local  ",
        "cAsE@tEsT.lOcAl",
        " case@test.local ",
        "CASE@test.LOCAL",
        "  CASE@test.local  ",
      ];
      for (const email of variants) {
        expect((await post(base, "/login", { email })).status).toBe(200);
      }
      // Ten variants filled the per-account quota of 10: the eleventh, in yet
      // another spelling, is denied — they all landed in one bucket.
      const denied = await post(base, "/login", { email: " CaSe@tEsT.lOcAl " });
      expect(denied.status).toBe(429);
      expect(((await denied.json()) as { error: string }).error).toBe(
        "Too many sign-in attempts. Wait a few minutes and try again.",
      );
    } finally {
      server.close();
    }
  });
});

describe.skipIf(!configured)(
  "per-address versus per-account login limits",
  () => {
    it("many account names from one address trip the address cap", async () => {
      const app = express();
      app.use(express.json());
      app.use(stampedAs("10.7.0.10"));
      app.post("/login", rl.loginLimiter, (_req, res) =>
        res.json({ ok: true }),
      );
      const { server, base } = await listen(app);
      try {
        // Eight accounts x four tries = 32 address-bucket hits against a cap of
        // 30, while no single account bucket passes 4 of its 10.
        let denied = 0;
        for (let account = 0; account < 8; account++) {
          for (let attempt = 0; attempt < 4; attempt++) {
            const res = await post(base, "/login", {
              email: `spray${account}@test.local`,
            });
            if (res.status === 429) denied += 1;
          }
        }
        expect(denied).toBeGreaterThan(0);
        // A brand-new account name from the same address is also denied: it is
        // the address cap firing, not any account bucket.
        expect(
          (await post(base, "/login", { email: "fresh-name@test.local" }))
            .status,
        ).toBe(429);
      } finally {
        server.close();
      }
    });

    it("one account's fat fingers do not lock out its NAT neighbour", async () => {
      const app = express();
      app.use(express.json());
      app.use(stampedAs("10.7.0.11"));
      app.post("/login", rl.loginLimiter, (_req, res) =>
        res.json({ ok: true }),
      );
      const { server, base } = await listen(app);
      try {
        for (let attempt = 0; attempt < 10; attempt++) {
          expect(
            (await post(base, "/login", { email: "clumsy@test.local" })).status,
          ).toBe(200);
        }
        // Eleventh try trips the per-account cap of 10...
        expect(
          (await post(base, "/login", { email: "clumsy@test.local" })).status,
        ).toBe(429);
        // ...but a different account behind the same address is unaffected: the
        // address bucket holds 12 of its 30.
        expect(
          (await post(base, "/login", { email: "neighbour@test.local" }))
            .status,
        ).toBe(200);
      } finally {
        server.close();
      }
    });
  },
);

describe.skipIf(!configured)("untrusted forwarding headers", () => {
  it("a forged X-Forwarded-For on a direct connection selects no bucket", async () => {
    const limiter = rl.rateLimit({
      name: "t-xff-direct",
      max: 3,
      windowMs: 60_000,
    });
    const app = express();
    app.use(express.json());
    // No adapter stamping here: this is a direct connection, local-dev style.
    app.post("/paid", limiter, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listen(app);
    try {
      // Rotate a fresh forged address per request. If XFF were trusted, every
      // request would open its own bucket and all would pass.
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await post(
          base,
          "/paid",
          {},
          { "X-Forwarded-For": `9.9.9.${i}` },
        );
        statuses.push(res.status);
      }
      // All eight landed in the direct peer's bucket: three pass, rest 429.
      expect(statuses.filter((s) => s === 200)).toHaveLength(3);
      expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    } finally {
      server.close();
    }
  });

  it("adapter extraction trusts only its host header, never X-Forwarded-For", () => {
    // Vercel: x-real-ip (overwritten by the edge) is trusted...
    expect(rl.extractVercelClientIp({ "x-real-ip": "203.0.113.7" })).toBe(
      "203.0.113.7",
    );
    // ...X-Forwarded-For alone selects nothing, even when it looks plausible.
    expect(
      rl.extractVercelClientIp({ "x-forwarded-for": "203.0.113.7" }),
    ).toBeNull();
    expect(rl.extractVercelClientIp({})).toBeNull();
    // Netlify: x-nf-client-connection-ip (set by the CDN) is trusted...
    expect(
      rl.extractNetlifyClientIp({
        "x-nf-client-connection-ip": "198.51.100.9",
      }),
    ).toBe("198.51.100.9");
    // ...X-Forwarded-For alone selects nothing.
    expect(
      rl.extractNetlifyClientIp({ "x-forwarded-for": "198.51.100.9" }),
    ).toBeNull();
    expect(rl.extractNetlifyClientIp({})).toBeNull();
    // A forged XFF alongside the host header cannot override it.
    expect(
      rl.extractVercelClientIp({
        "x-real-ip": "203.0.113.7",
        "x-forwarded-for": "9.9.9.9",
      }),
    ).toBe("203.0.113.7");
  });
});

describe.skipIf(!configured)("window expiry", () => {
  it("a short window resets", async () => {
    const limiter = rl.rateLimit({ name: "t-expiry", max: 2, windowMs: 200 });
    const app = express();
    app.use(express.json());
    app.post("/paid", limiter, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listen(app);
    try {
      expect((await post(base, "/paid", {})).status).toBe(200);
      expect((await post(base, "/paid", {})).status).toBe(200);
      expect((await post(base, "/paid", {})).status).toBe(429);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect((await post(base, "/paid", {})).status).toBe(200);
    } finally {
      server.close();
    }
  });
});

describe.skipIf(!configured)("store failure fails closed", () => {
  it("denies the paid path when the store errors", async () => {
    const spy = vi
      .spyOn(rl.rateLimitStore, "consume")
      .mockRejectedValue(new Error("db down"));
    try {
      const app = express();
      app.use(express.json());
      app.post("/paid", rl.chatLimiter, (_req, res) => res.json({ ok: true }));
      const { server, base } = await listen(app);
      try {
        const res = await post(base, "/paid", {});
        expect([429, 503]).toContain(res.status);
      } finally {
        server.close();
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("denies login when the store errors", async () => {
    const spy = vi
      .spyOn(rl.rateLimitStore, "consume")
      .mockRejectedValue(new Error("db down"));
    try {
      const app = express();
      app.use(express.json());
      app.post("/login", rl.loginLimiter, (_req, res) =>
        res.json({ ok: true }),
      );
      const { server, base } = await listen(app);
      try {
        const res = await post(base, "/login", { email: "anyone@test.local" });
        // Denied — never let through on a store error.
        expect([429, 503]).toContain(res.status);
      } finally {
        server.close();
      }
    } finally {
      spy.mockRestore();
    }
  });
});
