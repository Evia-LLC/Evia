/**
 * P2-T02 — server-only Supabase client boundary.
 *
 * Everything Supabase stays behind this module, and this module stays on the
 * server: only `server/` imports it, never `src/`. The browser keeps talking
 * to the same-origin backend (REMEDIATION_PLAN P2-T02, SUPABASE_ROLLOUT §7).
 * There is deliberately NO `VITE_`-prefixed alias for any Supabase variable —
 * `VITE_` names are embedded in the client bundle by construction, so a
 * `VITE_SUPABASE_*` variable would publish credentials regardless of intent.
 *
 * Boundary shape:
 *
 * - ORDINARY Auth operations use `createRequestClient`: an anon-key client
 *   created FRESH per call/request (`persistSession: false`,
 *   `autoRefreshToken: false`, `detectSessionInUrl: false`), with an optional
 *   per-request bearer token. There is no module-level client instance anywhere
 *   in this file, so one request's session state can never leak into another's.
 * - PRIVILEGED admin operations use `createAdminClient`: a service-role client
 *   constructed only inside that explicit factory, which throws unless it is
 *   running in a server context (no `window`/`document`) AND the service-role
 *   key is configured. The service-role key never leaves the server.
 * - The module otherwise exports only factories and pure config validation.
 *   Importing it has no side effects and performs no I/O: validation is pure
 *   string work (no network calls), so it is offline-safe.
 *
 * Enablement semantics (validated at feature enablement, i.e. inside every
 * factory and `isManagedAuthEnabled`):
 *
 * - Missing `SUPABASE_URL` or `SUPABASE_ANON_KEY` (the normal local/CI state —
 *   no live project exists, SUPABASE_ROLLOUT blocker B1) → managed features
 *   report disabled (`isManagedAuthEnabled()` is false), the ordinary factory
 *   throws a clear "not configured" error, and existing local behavior is
 *   untouched.
 * - MIXED-project config (URL of project A + key of project B) → throw loudly
 *   via `SupabaseConfigError`, never silently operate against the wrong
 *   project. Detection compares the URL subdomain ref (`<ref>.supabase.co`,
 *   tolerating the `db.<ref>.supabase.co` pooler shape) against the JWT `ref`
 *   claim of each JWT-shaped key. Next-gen opaque keys (`sb_publishable_…` /
 *   `sb_secret_…`) carry no decodable ref, so the comparison is SKIPPED for
 *   them by design: they are platform-scoped to one project and a mismatch
 *   surfaces as an authentication failure, not as silent cross-project writes —
 *   and every factory still re-validates before constructing a client. Error
 *   messages name only project refs (public URL subdomains), never key material.
 * - Non-`*supabase.co` hosts (e.g. a future loopback local lane, P2-T05) yield
 *   no URL ref, so the ref comparison is skipped there as well.
 */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Thrown for every Supabase configuration or boundary violation. Loud, never silent. */
export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigError";
  }
}

/** Minimal env shape; `process.env` satisfies it. Tests pass plain objects. */
export type SupabaseEnv = Record<string, string | undefined>;

/** Raw trimmed readings: empty string means absent. */
export interface SupabaseReadings {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

/** Result of pure config validation. `enabled` false means "behave locally". */
export interface ValidatedSupabaseConfig {
  enabled: boolean;
  url: string | null;
  anonKey: string | null;
  serviceRoleKey: string | null;
  /** True when a service-role key is present (admin factory can construct). */
  adminAvailable: boolean;
}

const NOT_CONFIGURED =
  "Supabase managed Auth is not configured (SUPABASE_URL / SUPABASE_ANON_KEY are unset). " +
  "Managed features are disabled; local behavior applies. " +
  "See docs/SUPABASE_ROLLOUT.md (blocker B1: no live project exists yet).";

const ADMIN_NOT_CONFIGURED =
  "Supabase admin operations are not configured (SUPABASE_SERVICE_ROLE_KEY is unset). " +
  "Ordinary request-scoped operations may still be available; privileged operations are refused.";

const HOST_SUFFIX = ".supabase.co";

/** Read the three server-only variables. Pure, no I/O, no defaults invented. */
export function readSupabaseConfig(
  env: SupabaseEnv = process.env,
): SupabaseReadings {
  return {
    url: (env["SUPABASE_URL"] ?? "").trim(),
    anonKey: (env["SUPABASE_ANON_KEY"] ?? "").trim(),
    serviceRoleKey: (env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim(),
  };
}

/**
 * Extract the project ref from a Supabase URL hostname.
 * `<ref>.supabase.co` → `<ref>`; `db.<ref>.supabase.co` (pooler) → `<ref>`.
 * Anything else (loopback local lane, non-Supabase host, unparseable) → null,
 * meaning "no ref to compare", never an error by itself.
 */
export function extractProjectRef(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.endsWith(HOST_SUFFIX)) return null;
  const labels = host.slice(0, -HOST_SUFFIX.length).split(".");
  if (labels.length === 1 && labels[0]) return labels[0];
  if (labels.length === 2 && labels[0] === "db" && labels[1]) return labels[1];
  return null;
}

/**
 * Extract the `ref` claim from a JWT-shaped key. Opaque next-gen keys
 * (`sb_publishable_…` / `sb_secret_…`, not three dot-separated segments) and
 * malformed payloads → null ("cannot verify, skip comparison"). Pure, offline.
 */
export function extractKeyRef(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    if (typeof payload === "object" && payload !== null && "ref" in payload) {
      const ref: unknown = (payload as { ref: unknown }).ref;
      return typeof ref === "string" && ref.length > 0 ? ref : null;
    }
    return null;
  } catch {
    return null;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function assertSameProject(url: string, key: string, varName: string): void {
  const urlRef = extractProjectRef(url);
  const keyRef = extractKeyRef(key);
  if (urlRef !== null && keyRef !== null && urlRef !== keyRef) {
    throw new SupabaseConfigError(
      `Supabase mixed-project config: SUPABASE_URL points at project "${urlRef}" ` +
        `but ${varName} belongs to project "${keyRef}". Refusing to operate against ` +
        "the wrong project. Use the URL and keys of a single Supabase project per environment.",
    );
  }
}

/**
 * Pure validation. Incomplete config → disabled (no throw); complete but
 * contradictory or malformed config → throws `SupabaseConfigError`. No network.
 */
export function validateSupabaseConfig(
  readings: SupabaseReadings,
): ValidatedSupabaseConfig {
  const disabled: ValidatedSupabaseConfig = {
    enabled: false,
    url: null,
    anonKey: null,
    serviceRoleKey: null,
    adminAvailable: false,
  };
  const { url, anonKey, serviceRoleKey } = readings;
  if (url === "" || anonKey === "") return disabled;
  if (!isHttpUrl(url)) {
    throw new SupabaseConfigError(
      "Supabase misconfigured: SUPABASE_URL is not a valid http(s) URL. " +
        "Unset it (managed features stay disabled) or set the URL of one real project.",
    );
  }
  assertSameProject(url, anonKey, "SUPABASE_ANON_KEY");
  if (serviceRoleKey !== "")
    assertSameProject(url, serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY");
  return {
    enabled: true,
    url,
    anonKey,
    serviceRoleKey: serviceRoleKey === "" ? null : serviceRoleKey,
    adminAvailable: serviceRoleKey !== "",
  };
}

/** Read + validate in one step. Throws only on contradictory/malformed config. */
export function resolveSupabaseConfig(
  env: SupabaseEnv = process.env,
): ValidatedSupabaseConfig {
  return validateSupabaseConfig(readSupabaseConfig(env));
}

/**
 * Feature flag for managed Auth. False when unconfigured (normal local/CI);
 * throws on mixed-project config rather than reporting a misleading value.
 */
export function isManagedAuthEnabled(env: SupabaseEnv = process.env): boolean {
  return resolveSupabaseConfig(env).enabled;
}

function assertServerContext(): void {
  const g = globalThis as { window?: unknown; document?: unknown };
  if (g.window !== undefined || g.document !== undefined) {
    throw new SupabaseConfigError(
      "createAdminClient is server-only: it must never run in a browser bundle. " +
        "Keep all Supabase SDK use behind the same-origin backend (docs/SUPABASE_ROLLOUT.md §7).",
    );
  }
}

const FRESH_CLIENT_OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
} as const;

/**
 * ORDINARY operations: build a fresh anon-key client for one call/request.
 * Never a module-level singleton; session persistence is off so tokens cannot
 * linger in shared state. Pass the caller's bearer token for per-request
 * identity; omit it for unauthenticated ordinary operations.
 */
export function createRequestClient(
  env: SupabaseEnv = process.env,
  accessToken?: string,
): SupabaseClient {
  const resolved = resolveSupabaseConfig(env);
  if (!resolved.enabled || resolved.url === null || resolved.anonKey === null) {
    throw new SupabaseConfigError(NOT_CONFIGURED);
  }
  return createClient(resolved.url, resolved.anonKey, {
    ...FRESH_CLIENT_OPTIONS,
    ...(accessToken !== undefined && accessToken !== ""
      ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
      : {}),
  });
}

/**
 * PRIVILEGED operations only: build a fresh service-role client. Throws unless
 * running in a server context and the service-role key is configured. Each call
 * returns a new instance with session persistence off — no shared mutable
 * session state, no module-level logged-in client.
 */
export function createAdminClient(
  env: SupabaseEnv = process.env,
): SupabaseClient {
  assertServerContext();
  const resolved = resolveSupabaseConfig(env);
  if (!resolved.enabled || resolved.url === null) {
    throw new SupabaseConfigError(NOT_CONFIGURED);
  }
  if (!resolved.adminAvailable || resolved.serviceRoleKey === null) {
    throw new SupabaseConfigError(ADMIN_NOT_CONFIGURED);
  }
  return createClient(resolved.url, resolved.serviceRoleKey, {
    ...FRESH_CLIENT_OPTIONS,
  });
}
