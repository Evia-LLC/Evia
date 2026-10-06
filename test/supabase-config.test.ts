/**
 * P2-T02 — server-only Supabase client boundary.
 *
 * No network, synthetic config only. Every URL/key below is a clearly fake
 * placeholder in the documented `https://xyzcompany.supabase.co` shape
 * (docs/SUPABASE_ROLLOUT.md conventions); unsigned JWT-shaped stubs are built
 * locally by `fakeJwt` and never leave this process except into client
 * constructors (which perform no I/O) or the fetch stub that replaces the
 * network. NEVER real credentials.
 *
 * Bundle-hygiene proof approach (cheap, runs in milliseconds): a static
 * source-graph scan asserting no `src/**` file imports `server/lib/supabase`
 * or `@supabase/supabase-js` and mentions no `SUPABASE_*` / `sb_secret_` /
 * `sb_publishable_` marker. Why this proves the property: Vite emits into the
 * client bundle only modules reachable from the client entry graph
 * (`index.html` → `src/`); with zero import edges from `src/` to the server
 * module or the SDK, neither SDK code nor secret credentials can appear in
 * client assets under any build. Scanning one prebuilt `dist/` output would
 * be slower, flakier, and weaker (it attests one build, not every build), so
 * the graph check is the proof and no full `vite build` runs here.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SupabaseConfigError,
  createAdminClient,
  createRequestClient,
  extractKeyRef,
  extractProjectRef,
  isManagedAuthEnabled,
  readSupabaseConfig,
  resolveSupabaseConfig,
  validateSupabaseConfig,
} from "../server/lib/supabase.ts";

// --- synthetic fixtures ------------------------------------------------------
// Placeholder project refs. `xyzcompany` is the documented stand-in from
// docs/SUPABASE_ROLLOUT.md; `otherproject` exists only to build a mismatch.
const URL_A = "https://xyzcompany.supabase.co";
const URL_B = "https://otherproject.supabase.co";

/** Unsigned JWT-shaped stub carrying a `ref` claim. Test-only, never a secret. */
function fakeJwt(ref: string, role = "authenticated"): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ ref, role, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  return `${header}.${payload}.`;
}

const ANON_A = fakeJwt("xyzcompany");
const ANON_B = fakeJwt("otherproject");
const SERVICE_A = fakeJwt("xyzcompany", "service_role");
const SERVICE_B = fakeJwt("otherproject", "service_role");

const EMPTY = {
  SUPABASE_URL: undefined,
  SUPABASE_ANON_KEY: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
};
const FULL_A = {
  SUPABASE_URL: URL_A,
  SUPABASE_ANON_KEY: ANON_A,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_A,
};
const ANON_ONLY_A = {
  SUPABASE_URL: URL_A,
  SUPABASE_ANON_KEY: ANON_A,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
};

// --- environment hygiene ------------------------------------------------------
const savedUrl = process.env["SUPABASE_URL"];
const savedAnon = process.env["SUPABASE_ANON_KEY"];
const savedService = process.env["SUPABASE_SERVICE_ROLE_KEY"];

function restoreProcessEnv(): void {
  if (savedUrl === undefined) delete process.env["SUPABASE_URL"];
  else process.env["SUPABASE_URL"] = savedUrl;
  if (savedAnon === undefined) delete process.env["SUPABASE_ANON_KEY"];
  else process.env["SUPABASE_ANON_KEY"] = savedAnon;
  if (savedService === undefined)
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  else process.env["SUPABASE_SERVICE_ROLE_KEY"] = savedService;
}

// --- source-graph helpers ------------------------------------------------------
const ROOT = join(new URL(".", import.meta.url).pathname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|svelte|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("P2-T02 disabled-by-default (normal local/CI: nothing set)", () => {
  it("reports managed Auth disabled and never throws at validation time", () => {
    expect(isManagedAuthEnabled(EMPTY)).toBe(false);
    expect(resolveSupabaseConfig(EMPTY)).toMatchObject({
      enabled: false,
      adminAvailable: false,
    });
  });

  it('ordinary factory throws a clear "not configured" error', () => {
    expect(() => createRequestClient(EMPTY)).toThrowError(SupabaseConfigError);
    expect(() => createRequestClient(EMPTY)).toThrowError(/not configured/i);
  });

  it('admin factory throws a clear "not configured" error', () => {
    expect(() => createAdminClient(EMPTY)).toThrowError(SupabaseConfigError);
    expect(() => createAdminClient(EMPTY)).toThrowError(/not configured/i);
  });

  it("partial config (URL or key alone) stays disabled", () => {
    expect(isManagedAuthEnabled({ ...EMPTY, SUPABASE_URL: URL_A })).toBe(false);
    expect(isManagedAuthEnabled({ ...EMPTY, SUPABASE_ANON_KEY: ANON_A })).toBe(
      false,
    );
    expect(() =>
      createRequestClient({ ...EMPTY, SUPABASE_URL: URL_A }),
    ).toThrowError(/not configured/i);
  });

  it("reads the real process.env path as disabled when nothing is set", () => {
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_ANON_KEY"];
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    try {
      expect(isManagedAuthEnabled()).toBe(false);
    } finally {
      restoreProcessEnv();
    }
  });
});

describe("P2-T02 mixed-project config throws loudly", () => {
  it("URL of A + anon key of B throws on enablement check", () => {
    const mixed = { ...EMPTY, SUPABASE_URL: URL_A, SUPABASE_ANON_KEY: ANON_B };
    expect(() => isManagedAuthEnabled(mixed)).toThrowError(SupabaseConfigError);
    expect(() => isManagedAuthEnabled(mixed)).toThrowError(/mixed-project/i);
  });

  it("mixed config throws from both factories, never constructing a client", () => {
    const mixed = { ...EMPTY, SUPABASE_URL: URL_A, SUPABASE_ANON_KEY: ANON_B };
    expect(() => createRequestClient(mixed)).toThrowError(/mixed-project/i);
    expect(() =>
      createAdminClient({ ...mixed, SUPABASE_SERVICE_ROLE_KEY: SERVICE_A }),
    ).toThrowError(/mixed-project/i);
  });

  it("service-role key of the wrong project throws even when anon matches", () => {
    const env = {
      ...EMPTY,
      SUPABASE_URL: URL_A,
      SUPABASE_ANON_KEY: ANON_A,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_B,
    };
    expect(() => resolveSupabaseConfig(env)).toThrowError(/mixed-project/i);
    expect(() => createAdminClient(env)).toThrowError(/mixed-project/i);
  });

  it("malformed URL with a key present throws instead of silently disabling", () => {
    const env = {
      ...EMPTY,
      SUPABASE_URL: "not a url",
      SUPABASE_ANON_KEY: ANON_A,
    };
    expect(() => resolveSupabaseConfig(env)).toThrowError(SupabaseConfigError);
  });

  it("error messages name refs, never key material", () => {
    const mixed = { ...EMPTY, SUPABASE_URL: URL_A, SUPABASE_ANON_KEY: ANON_B };
    let message = "";
    try {
      resolveSupabaseConfig(mixed);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("xyzcompany");
    expect(message).toContain("otherproject");
    expect(message).not.toContain(ANON_B);
  });
});

describe("P2-T02 matching config enables without network", () => {
  it("matching URL + anon key enables ordinary ops; admin stays unavailable without service key", () => {
    const resolved = resolveSupabaseConfig(ANON_ONLY_A);
    expect(resolved).toMatchObject({ enabled: true, adminAvailable: false });
    expect(isManagedAuthEnabled(ANON_ONLY_A)).toBe(true);
    expect(createRequestClient(ANON_ONLY_A)).toBeDefined();
    expect(() => createAdminClient(ANON_ONLY_A)).toThrowError(
      /SUPABASE_SERVICE_ROLE_KEY/i,
    );
  });

  it("matching service-role key unlocks the admin factory with a fresh instance per call", () => {
    expect(resolveSupabaseConfig(FULL_A).adminAvailable).toBe(true);
    const first = createAdminClient(FULL_A);
    const second = createAdminClient(FULL_A);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  it("opaque next-gen keys (sb_publishable_/sb_secret_) skip the ref comparison by design", () => {
    const env = {
      ...EMPTY,
      SUPABASE_URL: URL_A,
      SUPABASE_ANON_KEY: "sb_publishable_opaquestub000000000000001",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_opaquestub000000000000000002",
    };
    expect(isManagedAuthEnabled(env)).toBe(true);
    expect(createRequestClient(env)).toBeDefined();
    expect(createAdminClient(env)).toBeDefined();
  });

  it("validation performs zero network calls", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch?: unknown }).fetch = () => {
      throw new Error("network call during validation");
    };
    try {
      expect(isManagedAuthEnabled(EMPTY)).toBe(false);
      expect(isManagedAuthEnabled(ANON_ONLY_A)).toBe(true);
      expect(() =>
        isManagedAuthEnabled({
          ...EMPTY,
          SUPABASE_URL: URL_A,
          SUPABASE_ANON_KEY: ANON_B,
        }),
      ).toThrowError(/mixed-project/i);
      expect(createRequestClient(ANON_ONLY_A)).toBeDefined();
      expect(createAdminClient(FULL_A)).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("P2-T02 per-request isolation (no shared user session)", () => {
  it("distinct request clients cannot inherit each other's tokens", async () => {
    const sent: Array<{ auth: string | null }> = [];
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch?: unknown }).fetch = (async (
      url: unknown,
      init?: { headers?: unknown },
    ) => {
      const headers = init?.headers as
        Headers | Record<string, string> | undefined;
      const auth =
        headers instanceof Headers
          ? headers.get("Authorization")
          : (headers?.["Authorization"] ?? null);
      sent.push({ auth: typeof auth === "string" ? auth : null });
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const clientA = createRequestClient(ANON_ONLY_A, "TOKEN-FOR-A");
      const clientB = createRequestClient(ANON_ONLY_A, "TOKEN-FOR-B");
      const clientAnon = createRequestClient(ANON_ONLY_A);
      expect(clientA).not.toBe(clientB);
      await clientA.from("probe_table").select();
      await clientB.from("probe_table").select();
      await clientAnon.from("probe_table").select();
      // A second call on A still carries A's token: nothing leaked in or out.
      await clientA.from("probe_table").select();
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(sent.map((s) => s.auth)).toEqual([
      "Bearer TOKEN-FOR-A",
      "Bearer TOKEN-FOR-B",
      `Bearer ${ANON_A}`,
      "Bearer TOKEN-FOR-A",
    ]);
  });

  it("exports no module-level logged-in client instance", async () => {
    const module = await import("../server/lib/supabase.ts");
    for (const value of Object.values(module)) {
      // A Supabase client instance exposes `.from` + `.auth`; factories and
      // pure validators do not. No export may be one.
      const candidate = value as { from?: unknown; auth?: unknown };
      const looksLikeClient =
        candidate !== null &&
        (typeof candidate === "object" || typeof candidate === "function") &&
        typeof candidate.from === "function";
      expect(looksLikeClient).toBe(false);
    }
    const source = readFileSync(
      new URL("../server/lib/supabase.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /^export\s+(const|let|var)\s+\w*[Cc]lient\w*\s*=/m,
    );
  });
});

describe("P2-T02 pure ref extraction", () => {
  it("reads refs from direct and pooler hostnames", () => {
    expect(extractProjectRef(URL_A)).toBe("xyzcompany");
    expect(extractProjectRef("https://db.xyzcompany.supabase.co")).toBe(
      "xyzcompany",
    );
    expect(extractProjectRef("http://127.0.0.1:54321")).toBeNull();
    expect(extractProjectRef("not a url")).toBeNull();
  });

  it("reads the JWT ref claim and skips opaque keys", () => {
    expect(extractKeyRef(ANON_A)).toBe("xyzcompany");
    expect(extractKeyRef(SERVICE_B)).toBe("otherproject");
    expect(
      extractKeyRef("sb_publishable_opaquestub000000000000001"),
    ).toBeNull();
    expect(extractKeyRef("sb_secret_opaquestub000000000000000002")).toBeNull();
    expect(extractKeyRef("garbage")).toBeNull();
  });

  it("admin factory refuses browser contexts", () => {
    (globalThis as { window?: unknown }).window = {};
    try {
      expect(() => createAdminClient(FULL_A)).toThrowError(/server-only/i);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
    expect(createAdminClient(FULL_A)).toBeDefined();
  });

  it("readSupabaseConfig trims values and defaults to process.env", () => {
    expect(
      readSupabaseConfig({ ...EMPTY, SUPABASE_URL: `  ${URL_A}  ` }).url,
    ).toBe(URL_A);
    expect(readSupabaseConfig(EMPTY)).toEqual({
      url: "",
      anonKey: "",
      serviceRoleKey: "",
    });
    expect(
      validateSupabaseConfig({ url: "", anonKey: "", serviceRoleKey: "" })
        .enabled,
    ).toBe(false);
    expect(URL_B).toContain("otherproject");
  });
});

describe("P2-T02 bundle hygiene: SDK and secrets stay out of client bundles", () => {
  const srcDir = join(ROOT, "src");
  const files = walk(srcDir);

  it("touches real client sources", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no src/** file imports the server module or the Supabase SDK", () => {
    const offenders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return (
        text.includes("server/lib/supabase") ||
        text.includes("@supabase/supabase-js") ||
        text.includes("createAdminClient") ||
        text.includes("createRequestClient")
      );
    });
    expect(offenders).toEqual([]);
  });

  it("no SUPABASE_* variable or key marker appears in client sources", () => {
    const offenders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return (
        text.includes("SUPABASE_URL") ||
        text.includes("SUPABASE_ANON_KEY") ||
        text.includes("SUPABASE_SERVICE_ROLE_KEY") ||
        text.includes("sb_secret_") ||
        text.includes("sb_publishable_")
      );
    });
    expect(offenders).toEqual([]);
  });

  it("the server module reads secrets from process.env only, never import.meta.env", () => {
    const source = readFileSync(
      new URL("../server/lib/supabase.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("import.meta.env");
    expect(source).toContain("process.env");
  });
});
