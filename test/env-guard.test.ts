/**
 * Cross-environment startup guard (`server/lib/env-guard.ts` + its wiring in
 * `server/lib/env.ts`).
 *
 * Pure + wiring, no network/DB. Every URL/key below is synthetic, built from
 * the NON-SECRET project refs the guard itself maps (reportable URL
 * subdomains per docs/SUPABASE_ROLLOUT.md §12); JWT-shaped stubs are built
 * locally by `fakeJwt` and never leave this process. A greppable canary
 * secret proves refusal messages name only the lane value + project refs,
 * never key material.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_PROJECT_REF,
  EnvGuardError,
  assertEnvGuard,
} from "../server/lib/env-guard.ts";

const STAGING_REF = EXPECTED_PROJECT_REF.staging;
const PROD_REF = EXPECTED_PROJECT_REF.production;
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const PROD_URL = `https://${PROD_REF}.supabase.co`;
const STAGING_POOLER_URL = `https://db.${STAGING_REF}.supabase.co`;
const PROD_POOLER_URL = `https://db.${PROD_REF}.supabase.co`;

/** Greppable stand-in for key material: must never appear in any message. */
const CANARY = "env-guard-canary-secret-9f8e7d6c5b4a";

/** Unsigned JWT-shaped stub carrying a `ref` claim plus the canary. Test-only.
 *
 * The canary rides twice: once inside the JSON payload (base64url-encoded in
 * transit, proving payload material is never echoed) and once raw as the
 * signature segment (proving even a literal secret substring of the key never
 * reaches a refusal message). `extractKeyRef` only parses the payload, so
 * both shapes stay decodable.
 */
function fakeJwt(ref: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ ref, role: "authenticated", note: CANARY }),
  ).toString("base64url");
  return `${header}.${payload}.${CANARY}`;
}

type Env = Record<string, string | undefined>;

/** Explicit env object per case: never depends on ambient process.env. */
function env(over: Env): Env {
  return {
    APP_ENV: undefined,
    SUPABASE_URL: undefined,
    SUPABASE_ANON_KEY: undefined,
    ...over,
  };
}

/** Run `fn`, returning the refusal message (fails the test when it boots). */
function refusalOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected EnvGuardError, but the guard let it boot");
}

describe("env-guard: ref map", () => {
  it("maps each lane to its non-secret project ref", () => {
    expect(EXPECTED_PROJECT_REF).toEqual({
      staging: "jwjvtcuakdozdmleenyg",
      production: "yjpbngdrtnzmtbdxpuun",
    });
  });
});

describe("env-guard: unset APP_ENV is inactive (zero behavior change)", () => {
  it.each([
    ["production URL", PROD_URL],
    ["staging URL", STAGING_URL],
    ["malformed URL", "not a url"],
    ["loopback URL", "http://127.0.0.1:54321"],
  ])("boots with APP_ENV unset + %s", (_label, url) => {
    expect(() =>
      assertEnvGuard(env({ SUPABASE_URL: url })),
    ).not.toThrow();
  });

  it("boots with APP_ENV unset + nothing set", () => {
    expect(() => assertEnvGuard(env({}))).not.toThrow();
  });

  it("boots with blank APP_ENV (whitespace trims to unset)", () => {
    expect(() =>
      assertEnvGuard(env({ APP_ENV: "   ", SUPABASE_URL: PROD_URL })),
    ).not.toThrow();
  });
});

describe("env-guard: matching lane boots", () => {
  it("APP_ENV=staging + staging URL boots", () => {
    expect(() =>
      assertEnvGuard(env({ APP_ENV: "staging", SUPABASE_URL: STAGING_URL })),
    ).not.toThrow();
  });

  it("APP_ENV=production + production URL boots", () => {
    expect(() =>
      assertEnvGuard(env({ APP_ENV: "production", SUPABASE_URL: PROD_URL })),
    ).not.toThrow();
  });

  it("tolerates the pooler hostname shape when the ref matches", () => {
    expect(() =>
      assertEnvGuard(
        env({ APP_ENV: "staging", SUPABASE_URL: STAGING_POOLER_URL }),
      ),
    ).not.toThrow();
  });

  it("boots when the lane value carries surrounding whitespace", () => {
    expect(() =>
      assertEnvGuard(
        env({ APP_ENV: " staging ", SUPABASE_URL: STAGING_URL }),
      ),
    ).not.toThrow();
  });
});

describe("env-guard: mismatched lane refuses, naming lane + ref only", () => {
  it("APP_ENV=staging + production URL refuses", () => {
    const message = refusalOf(() =>
      assertEnvGuard(
        env({
          APP_ENV: "staging",
          SUPABASE_URL: PROD_URL,
          SUPABASE_ANON_KEY: fakeJwt(PROD_REF),
        }),
      ),
    );
    expect(message).toContain("staging");
    expect(message).toContain(PROD_REF);
  });

  it("APP_ENV=production + staging URL refuses", () => {
    const message = refusalOf(() =>
      assertEnvGuard(
        env({
          APP_ENV: "production",
          SUPABASE_URL: STAGING_URL,
          SUPABASE_ANON_KEY: fakeJwt(STAGING_REF),
        }),
      ),
    );
    expect(message).toContain("production");
    expect(message).toContain(STAGING_REF);
  });

  it("refuses a mismatched pooler hostname too (ref reuse, not string match)", () => {
    expect(() =>
      assertEnvGuard(
        env({ APP_ENV: "staging", SUPABASE_URL: PROD_POOLER_URL }),
      ),
    ).toThrowError(EnvGuardError);
  });

  it("throws EnvGuardError (boot-fatal class)", () => {
    expect(() =>
      assertEnvGuard(env({ APP_ENV: "staging", SUPABASE_URL: PROD_URL })),
    ).toThrowError(EnvGuardError);
  });

  it("refusal never carries key material (canary absence)", () => {
    const prodKey = fakeJwt(PROD_REF);
    expect(prodKey).toContain(CANARY);
    const message = refusalOf(() =>
      assertEnvGuard(
        env({
          APP_ENV: "staging",
          SUPABASE_URL: PROD_URL,
          SUPABASE_ANON_KEY: prodKey,
        }),
      ),
    );
    expect(message).not.toContain(CANARY);
    expect(message).not.toContain(prodKey);
    expect(message).not.toContain(PROD_URL);
  });
});

describe("env-guard: APP_ENV set + no SUPABASE_URL boots (P2-T02 degradation)", () => {
  it.each([["staging"], ["production"]])("APP_ENV=%s + no URL boots", (lane) => {
    expect(() => assertEnvGuard(env({ APP_ENV: lane }))).not.toThrow();
  });

  it("boots even with a wrong-lane key present but no URL (managed features stay disabled)", () => {
    expect(() =>
      assertEnvGuard(
        env({ APP_ENV: "staging", SUPABASE_ANON_KEY: fakeJwt(PROD_REF) }),
      ),
    ).not.toThrow();
  });
});

describe("env-guard: unparseable URLs boot (nothing authoritative to compare)", () => {
  it.each([
    ["malformed URL", "not a url"],
    ["loopback local lane", "http://127.0.0.1:54321"],
    ["non-Supabase host", "https://db.internal.example:5432/evia"],
  ])("APP_ENV=staging + %s boots", (_label, url) => {
    expect(() =>
      assertEnvGuard(env({ APP_ENV: "staging", SUPABASE_URL: url })),
    ).not.toThrow();
  });
});

describe("env-guard: ANON key handling", () => {
  it("opaque next-gen keys skip the key check by design (URL authoritative)", () => {
    expect(() =>
      assertEnvGuard(
        env({
          APP_ENV: "staging",
          SUPABASE_URL: STAGING_URL,
          SUPABASE_ANON_KEY: "sb_publishable_opaquestub000000000000001",
        }),
      ),
    ).not.toThrow();
  });

  it("matching JWT-shaped key boots", () => {
    expect(() =>
      assertEnvGuard(
        env({
          APP_ENV: "staging",
          SUPABASE_URL: STAGING_URL,
          SUPABASE_ANON_KEY: fakeJwt(STAGING_REF),
        }),
      ),
    ).not.toThrow();
  });

  it("decodable key from the wrong project refuses, naming the key ref without key material", () => {
    const prodKey = fakeJwt(PROD_REF);
    const message = refusalOf(() =>
      assertEnvGuard(
        env({
          APP_ENV: "staging",
          SUPABASE_URL: STAGING_URL,
          SUPABASE_ANON_KEY: prodKey,
        }),
      ),
    );
    expect(message).toContain("staging");
    expect(message).toContain(PROD_REF);
    expect(message).not.toContain(CANARY);
    expect(message).not.toContain(prodKey);
  });
});

describe("env-guard: unknown APP_ENV fails closed", () => {
  it('APP_ENV="prod" refuses rather than booting unguarded', () => {
    const message = refusalOf(() =>
      assertEnvGuard(env({ APP_ENV: "prod", SUPABASE_URL: STAGING_URL })),
    );
    expect(message).toContain("prod");
  });
});

describe("wiring: server/lib/env.ts load invokes the guard", () => {
  let savedDemo: string | undefined;

  beforeEach(() => {
    savedDemo = process.env["DEMO_MODE"];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (savedDemo === undefined) delete process.env["DEMO_MODE"];
    else process.env["DEMO_MODE"] = savedDemo;
  });

  it("mismatched lane refuses at env-load, before migrations/sessions", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("SUPABASE_URL", PROD_URL);
    vi.resetModules();
    let error: Error | null = null;
    try {
      await import("../server/lib/env.ts");
    } catch (caught) {
      error = caught as Error;
    }
    // A fresh module namespace is asserted by name: the re-imported graph
    // carries its own EnvGuardError class object, so instanceof against the
    // top-level import would compare across realms.
    expect(error).not.toBeNull();
    expect(error?.name).toBe("EnvGuardError");
    expect(error?.message).toContain("staging");
    expect(error?.message).toContain(PROD_REF);
  });

  it("the app boot path (server/index.ts + both adapters) refuses before migrate()", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("SUPABASE_URL", STAGING_URL);
    vi.resetModules();
    const error: Error | null = await import("../server/app.ts").then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    // server/app.ts imports server/lib/env.ts first: the refusal fires during
    // that import, so migrate()/sessions are never reached on any boot path.
    expect(error).not.toBeNull();
    expect(error?.name).toBe("EnvGuardError");
    expect(error?.message).toContain("production");
    expect(error?.message).toContain(STAGING_REF);
  });

  it("matching lane loads env past the guard", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("SUPABASE_URL", STAGING_URL);
    vi.resetModules();
    const loaded = await import("../server/lib/env.ts");
    expect(loaded.ENV_FILE_LOADED).toEqual(expect.any(Boolean));
  });

  it("unset APP_ENV loads env with any URL (guard inactive)", async () => {
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("SUPABASE_URL", PROD_URL);
    vi.resetModules();
    const loaded = await import("../server/lib/env.ts");
    expect(loaded.ENV_FILE_LOADED).toEqual(expect.any(Boolean));
  });
});
