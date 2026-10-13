/**
 * Server-only Supabase boundary. No module-level client or import-time I/O.
 *
 * Application persistence always uses a fresh service-role client; Evia's own
 * sessions establish user identity and repositories scope access. RLS has no
 * policies, so the anon/request factory cannot access application tables.
 * That factory and managed-Auth configuration query remain separate from this
 * data transport migration. Sessions are not Supabase bearer tokens.
 *
 * The three established environment names remain unchanged. JWT-shaped keys
 * are checked against the project ref; opaque keys are checked by the server
 * on use. Missing data configuration rejects readiness. Hosted URLs require
 * HTTPS; loopback development may use HTTP. No PUBLIC_/VITE_ credential aliases.
 * Every client disables auth persistence and automatic database retries.
 */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from '../db/database.types.ts';

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

/** Result of pure config validation. `enabled` false means factories cannot construct a client. */
export interface ValidatedSupabaseConfig {
  enabled: boolean;
  url: string | null;
  anonKey: string | null;
  serviceRoleKey: string | null;
  /** True when a service-role key is present (admin factory can construct). */
  adminAvailable: boolean;
}

const NOT_CONFIGURED =
  "Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY are unset). " +
  "Application persistence requires the Data API; see docs/DATA_API_ADR.md.";

const ADMIN_NOT_CONFIGURED =
  "Supabase application persistence is not configured (SUPABASE_SERVICE_ROLE_KEY is unset).";

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
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
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
        "Use an HTTPS project URL or an HTTP loopback development URL.",
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

/** Configuration status only, never reachability or permission evidence. */
export function dataApiConfigured(env: SupabaseEnv = process.env): boolean {
  const readings = readSupabaseConfig(env);
  return Boolean(readings.url && readings.anonKey && readings.serviceRoleKey);
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
  db: { timeout: 10_000, retry: false },
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
 * Application persistence and privileged operations: build a fresh service-role client. Throws unless
 * running in a server context and the service-role key is configured. Each call
 * returns a new instance with session persistence off — no shared mutable
 * session state, no module-level logged-in client.
 */
export function createAdminClient(
  env: SupabaseEnv = process.env,
): SupabaseClient<Database> {
  assertServerContext();
  const resolved = resolveSupabaseConfig(env);
  if (!resolved.enabled || resolved.url === null) {
    throw new SupabaseConfigError(NOT_CONFIGURED);
  }
  if (!resolved.adminAvailable || resolved.serviceRoleKey === null) {
    throw new SupabaseConfigError(ADMIN_NOT_CONFIGURED);
  }
  return createClient<Database>(resolved.url, resolved.serviceRoleKey, {
    ...FRESH_CLIENT_OPTIONS,
  });
}
