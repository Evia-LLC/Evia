/**
 * P1-T13 — public capability checks vs operator diagnostics.
 *
 * Synthetic only: no network, no production credentials. Every secret below
 * is invented for this file (`hunter2-fake`, `sk-ant-fake-…`) and every
 * database is either absent or the disposable one `npm run test:local`
 * provides — assertions therefore tolerate both `database: true` and
 * `database: false`, and prove the *shape* of the contract instead:
 *
 *   - failing boot (unparseable DB URL, so `ready()`/`migrate()` throw with
 *     no network at all) and failing providers (availability flags stubbed
 *     off via env) keep every public response free of raw exception text,
 *     stacks, URLs, tokens and personal text — on both adapters;
 *   - capability flags still drive the correct voice/fallback selection, via
 *     the pure selector the voice client itself uses;
 *   - GET /api/admin/diagnostics requires admin (401 anonymous, 401 with a
 *     wrong token — the same shared-secret pattern as its sibling admin
 *     routes — 404 when no admin token is configured, 200 with totals and
 *     zero secrets for the operator);
 *   - no secret reaches any log sink, at any level including debug.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { app, publicErrorFor } from "../server/app.ts";
import { log, redact, scrubString } from "../server/lib/log.ts";
import { voiceCapabilityGranted } from "../src/lib/api.ts";

const ADMIN_TOKEN = "p1-t13-synthetic-admin-token";

/** Distinctly fake secrets — greppable, never production-shaped. */
const FAKE_DB_URL =
  "postgres://operator:hunter2-fake@db.internal.example:5432/evia";
const FAKE_API_KEY = "sk-ant-fake-secret-key-12345";
const FAKE_CHAT_TEXT = "I feel hopeless about my acne and hate my face";
const FAKE_VOICE_SENTENCE = "My private voice sentence about my redness";
const FAKE_QUERY_SECRET = "vendorsupersecret999";

/**
 * Patterns that must never appear in an anonymous response body. Word
 * boundaries keep legitimate count fields (e.g. `tokens`) from tripping
 * the sweep.
 */
const SECRET_PATTERNS: RegExp[] = [
  /password/i,
  /passwd/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /postgres(?:ql)?:\/\//i,
  /api[_-]?key/i,
  /bearer/i,
  /BEGIN CERTIFICATE/i,
  /sk-ant-/i,
  /whsec_/i,
  /\bstack\b/i,
  /hunter2/i,
  /ELOHIM_/i,
];

/** Returns the sources of every forbidden pattern found in `value`. */
function sweep(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return SECRET_PATTERNS.filter((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  }).map((pattern) => String(pattern));
}

let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(async () => {
  vi.stubEnv("ELOHIM_ADMIN_TOKEN", ADMIN_TOKEN);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("no listener");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});

describe("public error vocabulary (unit)", () => {
  it.each([
    [400, "That request could not be read."],
    [401, "You need to sign in to continue."],
    [403, "That is not available for this account."],
    [409, "That conflicts with what is already saved."],
    [413, "That upload is too large."],
    [429, "Too many requests. Try again shortly."],
    [503, "The service is temporarily unavailable. Try again later."],
  ] as Array<[number, string]>)(
    "maps %i to its stable generic message",
    (status, error) => {
      expect(publicErrorFor(status)).toEqual({ status, error });
    },
  );

  it.each([500, 502, 200, undefined, null, "503", {}, Number.NaN])(
    "collapses unknown/missing/non-numeric statuses (%p) to the generic 500",
    (status) => {
      expect(publicErrorFor(status)).toEqual({
        status: 500,
        error: "Something went wrong.",
      });
    },
  );

  it("never reflects input in the message", () => {
    for (const status of [401, 403, 409, 429, 503]) {
      expect(sweep(publicErrorFor(status))).toEqual([]);
    }
  });
});

describe("public HTTP surface", () => {
  it("serves a minimal anonymous capability response with no diagnostics", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.ok).toBe("boolean");
    expect(typeof body.database).toBe("boolean");
    expect(body.ok).toBe(body.database);
    expect(typeof body.modelAvailable).toBe("boolean");
    expect(body.model === null || typeof body.model === "string").toBe(true);
    expect(typeof body.imageStorage).toBe("boolean");
    expect(typeof body.demoMode).toBe("boolean");
    for (const key of [
      "budget",
      "databaseConfigured",
      "databaseError",
      "reason",
      "error",
      "stack",
      "connectionString",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(sweep(body)).toEqual([]);
  });

  it("keeps the P1-T05 400 mapping byte-identical for unparsable JSON", async () => {
    const res = await fetch(`${base}/api/health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{oops",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "That request could not be read.",
    });
  });

  it("keeps the P1-T05 413 mapping for a payload over the small-body ceiling", async () => {
    const res = await fetch(`${base}/api/health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pad: "x".repeat(70 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "That upload is too large." });
  });
});

describe("cold-start adapters hide boot failures (no network)", () => {
  // An unparseable URL makes `migrate()` throw synchronously — no DNS, no
  // sockets — while still looking "configured" to the adapters. The pool is
  // dropped first: `getPool()` memoises per process, so a pool opened by an
  // earlier test (with the real test database) would otherwise mask the
  // broken URL and `ready()` would succeed.
  async function breakDatabase(): Promise<void> {
    const { closePool } = await import("../server/db/index.ts");
    await closePool();
    vi.stubEnv("NETLIFY_DATABASE_URL", "not-a-valid-url");
    vi.stubEnv("DATABASE_URL", "");
  }

  afterEach(async () => {
    const { closePool } = await import("../server/db/index.ts");
    await closePool();
    vi.unstubAllEnvs();
    vi.stubEnv("ELOHIM_ADMIN_TOKEN", ADMIN_TOKEN);
  });

  it("Vercel: failing boot keeps /api/health safe and shaped like warm health", async () => {
    await breakDatabase();
    const { default: vercelHandler } = await import("../server/vercel.ts");
    const captured = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: "",
      setHeader(name: string, value: string): void {
        captured.headers[name] = value;
      },
      end(data: string): void {
        captured.body = data;
      },
    };
    const res = captured as unknown as ServerResponse;
    await vercelHandler(
      { url: "/api/health", headers: {} } as unknown as IncomingMessage,
      res,
    );
    const body = JSON.parse(captured.body);
    expect(body.ok).toBe(false);
    expect(body.database).toBe(false);
    expect(typeof body.modelAvailable).toBe("boolean");
    expect(body.model).toBe(null);
    expect(typeof body.imageStorage).toBe("boolean");
    expect(typeof body.clonedVoice).toBe("boolean");
    expect(typeof body.guestVoice).toBe("boolean");
    expect(body.demoMode).toBe(false);
    for (const key of [
      "databaseConfigured",
      "databaseError",
      "budget",
      "reason",
      "stack",
      "error",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(sweep(body)).toEqual([]);
  });

  it("Vercel: failing boot answers anything else with the same generic 503", async () => {
    await breakDatabase();
    const { default: vercelHandler } = await import("../server/vercel.ts");
    const captured = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: "",
      setHeader(name: string, value: string): void {
        captured.headers[name] = value;
      },
      end(data: string): void {
        captured.body = data;
      },
    };
    const res = captured as unknown as ServerResponse;
    await vercelHandler(
      { url: "/api/me", headers: {} } as unknown as IncomingMessage,
      res,
    );
    expect(captured.statusCode).toBe(503);
    expect(JSON.parse(captured.body)).toEqual({
      error:
        "The database is configured but could not be reached just now, so nothing can be saved or signed in to.",
    });
    expect(sweep(captured.body)).toEqual([]);
  });

  it("Netlify: failing boot keeps /api/health safe and shaped like warm health", async () => {
    await breakDatabase();
    const { default: netlifyHandler } =
      await import("../netlify/functions/api.mts");
    const res = await netlifyHandler(
      new Request("http://localhost/api/health"),
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.database).toBe(false);
    expect(typeof body.modelAvailable).toBe("boolean");
    expect(body.model).toBe(null);
    expect(typeof body.imageStorage).toBe("boolean");
    expect(typeof body.clonedVoice).toBe("boolean");
    expect(typeof body.guestVoice).toBe("boolean");
    expect(body.demoMode).toBe(false);
    for (const key of [
      "databaseConfigured",
      "databaseError",
      "budget",
      "reason",
      "stack",
      "error",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(sweep(body)).toEqual([]);
  });

  it("Netlify: failing boot answers anything else with the same generic 503", async () => {
    await breakDatabase();
    const { default: netlifyHandler } =
      await import("../netlify/functions/api.mts");
    const res = await netlifyHandler(
      new Request("http://localhost/api/me"),
      {},
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error:
        "The database is configured but could not be reached just now, so nothing can be saved or signed in to.",
    });
  });
});

describe("operator diagnostics require admin", () => {
  const get = (headers?: Record<string, string>) =>
    fetch(`${base}/api/admin/diagnostics`, headers ? { headers } : undefined);

  it("401s anonymous requests like its sibling admin routes", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authorised." });
  });

  it("401s a wrong token (shared-secret pattern has no other non-admin)", async () => {
    const res = await get({ "x-admin-token": "wrong-token" });
    expect(res.status).toBe(401);
  });

  it("404s when no admin token is configured, like its siblings", async () => {
    vi.stubEnv("ELOHIM_ADMIN_TOKEN", "");
    try {
      const res = await get({ "x-admin-token": ADMIN_TOKEN });
      expect(res.status).toBe(404);
    } finally {
      vi.stubEnv("ELOHIM_ADMIN_TOKEN", ADMIN_TOKEN);
    }
  });

  it("serves totals as counts/booleans with zero secrets to the operator", async () => {
    const res = await get({ "x-admin-token": ADMIN_TOKEN });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.day).toBe("string");
    expect(typeof body.budget.turns).toBe("number");
    expect(typeof body.budget.tokens).toBe("number");
    expect(typeof body.budget.limits.userTurns).toBe("number");
    expect(typeof body.budget.limits.turns).toBe("number");
    expect(typeof body.budget.limits.tokens).toBe("number");
    expect(typeof body.database.configured).toBe("boolean");
    expect(typeof body.database.reachable).toBe("boolean");
    expect(
      body.database.poolMax === null ||
        typeof body.database.poolMax === "number",
    ).toBe(true);
    expect(
      body.database.migrationsApplied === null ||
        typeof body.database.migrationsApplied === "number",
    ).toBe(true);
    expect(typeof body.providers.model.available).toBe("boolean");
    expect(
      body.providers.model.name === null ||
        typeof body.providers.model.name === "string",
    ).toBe(true);
    expect(typeof body.providers.voice.configured).toBe("boolean");
    expect(typeof body.providers.voice.guestsAllowed).toBe("boolean");
    expect(typeof body.providers.imageStorage).toBe("boolean");
    expect(["perfectcorp", "local"]).toContain(
      body.providers.analysis.provider,
    );
    expect(typeof body.providers.analysis.available).toBe("boolean");
    expect(typeof body.providers.analysis.sampleDemo).toBe("boolean");
    expect(body.boot.ready).toBe(true);
    expect(sweep(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(ADMIN_TOKEN);
  });
});

describe("capability flags drive voice/fallback selection", () => {
  it("grants guests only on the guest flag, users only on the account flag", () => {
    expect(
      voiceCapabilityGranted({ clonedVoice: true, guestVoice: true }, true),
    ).toBe(true);
    expect(
      voiceCapabilityGranted({ clonedVoice: true, guestVoice: true }, false),
    ).toBe(true);
    // The operator closed the voice to guests: the account flag must not leak through.
    expect(
      voiceCapabilityGranted({ clonedVoice: true, guestVoice: false }, true),
    ).toBe(false);
    expect(voiceCapabilityGranted({ clonedVoice: true }, true)).toBe(false);
    // A guest grant is not an account grant.
    expect(voiceCapabilityGranted({ guestVoice: true }, false)).toBe(false);
    // Denied everywhere, and absent flags, all fall back.
    expect(
      voiceCapabilityGranted({ clonedVoice: false, guestVoice: false }, true),
    ).toBe(false);
    expect(
      voiceCapabilityGranted({ clonedVoice: false, guestVoice: false }, false),
    ).toBe(false);
    expect(voiceCapabilityGranted({}, true)).toBe(false);
    expect(voiceCapabilityGranted({}, false)).toBe(false);
  });

  it("is the selector the voice client itself reads health through", () => {
    const source = readFileSync(
      new URL("../src/voice/cloned.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("voiceCapabilityGranted");
    expect(source).not.toMatch(
      /guest \? body\.guestVoice === true : body\.clonedVoice === true/,
    );
  });
});

describe("log redaction", () => {
  it("redacts sensitive keys while preserving shape and counts", () => {
    const out = redact({
      token: FAKE_API_KEY,
      text: FAKE_CHAT_TEXT,
      nested: { sentence: FAKE_VOICE_SENTENCE, count: 3 },
      audio: "aGVsbG8=",
      status: 200,
    }) as Record<string, unknown>;
    expect(out.token).toBe(`[redacted ${FAKE_API_KEY.length}c]`);
    expect(out.text).toBe(`[redacted ${FAKE_CHAT_TEXT.length}c]`);
    expect((out.nested as Record<string, unknown>).sentence).toBe(
      `[redacted ${FAKE_VOICE_SENTENCE.length}c]`,
    );
    expect((out.nested as Record<string, unknown>).count).toBe(3);
    expect(out.status).toBe(200);
  });

  it("scrubs structured secrets out of free text, idempotently", () => {
    const dirty =
      `conn=${FAKE_DB_URL} auth Bearer abcdef12345 ` +
      `apiKey: "${FAKE_API_KEY}" endpoint=https://vendor.example/task?key=${FAKE_QUERY_SECRET} ` +
      `-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----`;
    const once = scrubString(dirty);
    expect(once).not.toContain("hunter2");
    expect(once).not.toContain("abcdef12345");
    expect(once).not.toContain(FAKE_API_KEY);
    expect(once).not.toContain(FAKE_QUERY_SECRET);
    expect(once).not.toContain("MIIB");
    expect(once).not.toContain("postgres://");
    expect(scrubString(once)).toBe(once);
  });

  it("lets no secret reach any sink after exercising error paths", () => {
    const lines: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...args: any[]) => {
        lines.push(args.map(String).join(" "));
      });
    try {
      log.error("voice", "synthesis failed", {
        text: FAKE_VOICE_SENTENCE,
        apiKey: FAKE_API_KEY,
        status: 500,
      });
      log.warn("http", "request failed", {
        url: FAKE_DB_URL,
        token: "probe-token-xyz",
      });
      log.info("chat", "turn", {
        content: FAKE_CHAT_TEXT,
        bearer: "Bearer abcdef12345",
      });
      log.error("perfectcorp", "vendor said no", {
        payload: { detail: FAKE_CHAT_TEXT },
        endpoint: `https://vendor.example/task?key=${FAKE_QUERY_SECRET}`,
      });
    } finally {
      spy.mockRestore();
    }
    expect(lines.length).toBeGreaterThan(0);
    const combined = lines.join("\n");
    for (const secret of [
      FAKE_DB_URL,
      "hunter2",
      FAKE_API_KEY,
      FAKE_CHAT_TEXT,
      FAKE_VOICE_SENTENCE,
      FAKE_QUERY_SECRET,
      "abcdef12345",
      "postgres://",
    ]) {
      expect(combined).not.toContain(secret);
    }
  });

  it("redacts even at debug level", async () => {
    vi.resetModules();
    vi.stubEnv("ELOHIM_LOG_LEVEL", "debug");
    try {
      const fresh = await import("../server/lib/log.ts");
      const lines: string[] = [];
      const spy = vi
        .spyOn(console, "log")
        .mockImplementation((...args: any[]) => {
          lines.push(args.map(String).join(" "));
        });
      try {
        fresh.log.debug("voice", "probe", {
          text: FAKE_VOICE_SENTENCE,
          token: "debug-token-abc",
        });
      } finally {
        spy.mockRestore();
      }
      // Debug output is visible at debug level — and still redacted.
      expect(lines.length).toBe(1);
      expect(lines[0]).not.toContain(FAKE_VOICE_SENTENCE);
      expect(lines[0]).not.toContain("debug-token-abc");
      expect(fresh.redact({ text: FAKE_CHAT_TEXT })).toEqual({
        text: `[redacted ${FAKE_CHAT_TEXT.length}c]`,
      });
    } finally {
      vi.unstubAllEnvs();
      vi.stubEnv("ELOHIM_ADMIN_TOKEN", ADMIN_TOKEN);
    }
  });
});
