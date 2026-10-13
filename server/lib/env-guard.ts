/**
 * Cross-environment startup guard: the backend REFUSES TO BOOT when a
 * deployment lane is wired to the wrong Supabase project (staging lane with
 * production credentials, or vice versa).
 *
 * Contract:
 *
 * - New non-secret lane marker `APP_ENV`: `staging` | `production` | unset.
 *   Unset (local/dev/CI/test lanes) = guard inactive, zero behavior change.
 * - When `APP_ENV` is set AND `SUPABASE_URL` is set, the URL's project ref
 *   (reusing `extractProjectRef` from `./supabase.ts`, never reimplemented)
 *   MUST equal the mapped ref for that lane. Mismatch → boot-fatal
 *   `EnvGuardError` naming the lane value + the observed ref, never key
 *   material.
 * - `APP_ENV` set + no `SUPABASE_URL` → boot (managed features stay disabled
 *   per the P2-T02 graceful degradation: one credential alone cannot operate).
 * - URLs with no extractable ref (malformed, non-Supabase hosts, loopback
 *   local lane) → boot; there is nothing authoritative to compare, and
 *   malformed-URL errors stay owned by the Supabase config validation.
 * - `SUPABASE_ANON_KEY` is checked only when it is decodable: the installed
 *   keys are opaque next-gen `sb_publishable_…` strings, so `extractKeyRef`
 *   returns null for them and the comparison is SKIPPED by design — the URL
 *   check above is authoritative (same rationale as the mixed-project check
 *   in `supabase.ts`). A decodable (JWT-shaped) key from the wrong project
 *   still refuses the boot. Nothing here logs or returns key material.
 *
 * Wiring (documented choice): the single call lives in `server/lib/env.ts`,
 * evaluated at import time right after `.env` loading. That module is the
 * earliest single point every boot path evaluates — `server/index.ts`
 * imports it first, `server/app.ts` imports it first, and both function
 * adapters (`netlify/functions/api.mts`, `server/vercel.ts`) reach it through
 * `server/app.ts` — so one call covers the server and both functions BEFORE
 * migrations/sessions, with no second wiring inside `ready()`. `ready()` was
 * deliberately NOT chosen: both adapters catch `ready()` failures into a
 * generic 503 "no database" response, which would mute a cross-env refusal
 * into a misleading outage shape; an import-time throw here fails the boot
 * loudly on every path instead.
 *
 * Pure function + one wiring call: no I/O, no network. Tests cover the pure
 * function and the wiring call with stubbed env, never a real boot.
 */
import { extractKeyRef, extractProjectRef } from "./supabase.ts";

/** Deployment lanes that activate the guard. Unset = local/dev/CI/test. */
export type AppEnv = "staging" | "production";

/** Minimal env shape; `process.env` satisfies it. Tests pass plain objects. */
export type EnvGuardEnv = Record<string, string | undefined>;

/**
 * Expected Supabase project ref per deployment lane.
 *
 * NON-SECRET constants: a project ref is the public subdomain of the project
 * URL (`https://<ref>.supabase.co`) and is safe to report back for
 * verification — see docs/SUPABASE_ROLLOUT.md §12 ("project URL, project ref,
 * region, bucket name and public site origins are safe to report"; dashboard
 * table: "Project ref and region | rollout record | Non-secret").
 */
export const EXPECTED_PROJECT_REF: Record<AppEnv, string> = {
  staging: "jwjvtcuakdozdmleenyg",
  production: "yjpbngdrtnzmtbdxpuun",
};

/** Boot-fatal: thrown when the process must refuse to start on env wiring. */
export class EnvGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvGuardError";
  }
}

/**
 * Assert the lane/credential wiring. Returns quietly when the guard is
 * inactive or the wiring matches; throws `EnvGuardError` (naming only the
 * lane value and project refs, never key material) on any cross-env mix.
 */
export function assertEnvGuard(env: EnvGuardEnv = process.env): void {
  const appEnvRaw = (env["APP_ENV"] ?? "").trim();

  // Unset (local/dev/CI/test lanes): guard inactive, zero behavior change —
  // every existing test runs with APP_ENV unset and never reaches below.
  if (appEnvRaw === "") return;

  // Fail closed on an unknown lane marker: a typo such as APP_ENV=prod must
  // refuse loudly rather than boot as if unguarded.
  if (appEnvRaw !== "staging" && appEnvRaw !== "production") {
    throw new EnvGuardError(
      `Refusing to boot: APP_ENV=${JSON.stringify(appEnvRaw)} is not a known lane ` +
        `(expected "staging" or "production"). Fix APP_ENV or unset it for local/dev/CI use.`,
    );
  }
  const appEnv: AppEnv = appEnvRaw;
  const expected = EXPECTED_PROJECT_REF[appEnv];

  // APP_ENV set + no SUPABASE_URL → boot. Managed features stay disabled per
  // the P2-T02 graceful degradation (one credential alone cannot operate),
  // so there is nothing cross-env to refuse.
  const url = (env["SUPABASE_URL"] ?? "").trim();
  if (url === "") return;

  const observed = extractProjectRef(url);
  // No extractable ref (malformed URL, non-Supabase host, loopback local
  // lane): nothing authoritative to compare — boot, and leave malformed-URL
  // errors to the Supabase config validation that owns them.
  if (observed === null) return;
  if (observed !== expected) {
    throw new EnvGuardError(
      `Refusing to boot: APP_ENV="${appEnv}" expects Supabase project "${expected}", ` +
        `but SUPABASE_URL points at project "${observed}". ` +
        `Point SUPABASE_URL at the ${appEnv} project or fix APP_ENV. ` +
        `Only project refs (public URL subdomains) are named here, never key material.`,
    );
  }

  // ANON key: skipped unless decodable (see module header). A decodable key
  // from the wrong project refuses even when the URL already matched.
  const anonKey = (env["SUPABASE_ANON_KEY"] ?? "").trim();
  if (anonKey !== "") {
    const keyRef = extractKeyRef(anonKey);
    if (keyRef !== null && keyRef !== expected) {
      throw new EnvGuardError(
        `Refusing to boot: APP_ENV="${appEnv}" expects Supabase project "${expected}", ` +
          `but SUPABASE_ANON_KEY belongs to project "${keyRef}". ` +
          `Use the URL and keys of a single Supabase project per environment.`,
      );
    }
  }
}
