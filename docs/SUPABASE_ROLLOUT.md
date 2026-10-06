# Supabase rollout — environment and recovery contract (P2-T01)

**Item:** `docs/REMEDIATION_PLAN.md` P2-T01. **Phase 1 is DONE; this is the Phase 2 entry gate.**
**Method:** repo evidence only. No live database was probed, no Supabase project was
created, no credential was read. Every value below that is not yet decided is a
**placeholder** plus an explicit **CUTOVER BLOCKER** with an owner — nothing is invented.

**Conventions used in this file**

- `https://xyzcompany.supabase.co`, `sb_publishable_...`, `sb_secret_...`,
  `postgres://user:pass@host:5432/db` are placeholder shapes, not real values.
- **Owner "operator"** means the human provisioning the environment (reads: you).
- **Cutover** means any Phase 3+ step that touches a real hosted project. No production
  action is implied by writing this document.

## 1. Environment separation — what runs where today

| Environment           | Database                                                                                                                                                                                                                                                  | App host                                                                                                                               | Supabase relevance                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Local dev             | PGlite (`node scripts/dev.mjs`; `data/pglite/`, git-ignored; `DATABASE_URL` unset). `server/lib/env.ts` auto-enables `DEMO_MODE` only for loopback DBs                                                                                                    | `ELOHIM_PORT=5196` API, `ELOHIM_WEB_PORT=5195` web                                                                                     | None. Managed lanes must never activate here (P2-T05 rejects production project IDs/URLs in the local runner)                                 |
| Disposable test lanes | `test:local`: in-memory PGlite, port `ELOHIM_TEST_DB_PORT` (default 5434), discarded after run. `test:pg`: real Postgres **only** from `ELOHIM_TEST_PG_URL`, guarded to loopback hosts and database names containing "test"; never falls back to app URLs | Same checkout                                                                                                                          | P2-T05 adds a _separate_ local Auth/Storage lane (pinned tooling, synthetic users, local mail sink). It does not reuse these lanes' databases |
| Staging               | **Does not exist yet** — see blocker B8                                                                                                                                                                                                                   | TBD                                                                                                                                    | Required before any rehearsal (P3-T06, P4-T06). Must be an isolated project, never the production project                                     |
| Production            | Hosted Postgres on **Neon** (see §8): project `elohim`, region `aws-us-east-2`, direct host + `sslmode=require`                                                                                                                                           | Netlify (primary site) and Vercel (sample-demo profile); both serverless functions, 30 s Vercel route cap, cold starts run `migrate()` | Target of Auth (Phase 3) and Storage (Phase 4) adoption. Provisioned only via the reviewed manifest at cutover time                           |

Staging gap, stated plainly: today there are two production hosts and zero staging
hosts. The rehearsals in P3-T06/P4-T06 cannot run without one. That is blocker B8,
not an excuse to rehearse against production.

## 2. Supabase project / region decisions

| Decision                                     | Status                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase project for staging Auth/Storage    | **CUTOVER BLOCKER B1** (owner: operator) — new isolated project, placeholder ref `https://xyzcompany.supabase.co`                                                                                                                                                                                                                                                       |
| Supabase project for production Auth/Storage | **CUTOVER BLOCKER B1** (owner: operator) — separate project from staging; never reuse one project's keys in another environment                                                                                                                                                                                                                                         |
| Region                                       | **CUTOVER BLOCKER B1** (owner: operator) — colocate with the serving hosts where possible. Reference point: the current Neon database sits in `aws-us-east-2` (Ohio), the same region as the Netlify function, so queries do not cross the country (`RUNBOOK.md` "Where things stand"). Apply the same colocation reasoning to the Supabase region choice and record it |
| Data API exposure                            | Decided already by the plan: **disabled, or an empty dedicated schema only** (P2-T04). No browser table access until a later explicit RLS decision. Re-state at provisioning; do not accept dashboard defaults silently                                                                                                                                                 |

## 3. SMTP + Auth redirect URLs

Mail is a **hard prerequisite**: signup confirmation, password recovery, and magic-link
flows (if used) all send email. **Mail MUST be configured before any recovery flow is
rehearsed or cut over** (gates P3-T03/P3-T06). Supabase's built-in mailer is rate-limited
and not a production sender; a custom SMTP sender is the expected production shape.

| Requirement                                                           | Status                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per-environment sender (SMTP host, from-address, domain verification) | **CUTOVER BLOCKER B2** (owner: operator). Local lane uses a mail sink (P2-T05), never real delivery. Staging and production each need their own verified sender. No SMTP host is recorded here because none has been chosen                            |
| Redirect URL allowlist, local                                         | `http://localhost:5195/**` (matches default `ELOHIM_WEB_PORT`; adjust if the port changes). Signup/recovery/magic-link callbacks outside the allowlist must fail closed                                                                                |
| Redirect URL allowlist, staging                                       | **CUTOVER BLOCKER B3** (owner: operator) — register the staging host origin once B8 lands                                                                                                                                                              |
| Redirect URL allowlist, production                                    | **CUTOVER BLOCKER B3** (owner: operator) — register the Netlify origin and the Vercel origin as two explicit entries; a single "production" entry covering only one host will break callbacks on the other                                             |
| Callback hygiene                                                      | Tokens stay out of URLs after callback handling and out of JS persistence (P3-T03). Generic public errors for unknown emails. These are implementation rules, recorded here so provisioning does not trade them away via a "helpful" dashboard default |

## 4. Connection / pooler mode

The application talks SQL over `pg` (see `server/db/index.ts`: the driver is
provider-agnostic; only the connection string changes). What the string points at
matters a great deal:

- **Migrations take a session-level advisory lock** (`pg_advisory_lock` in `migrate()`).
  A transaction-mode pooler (PgBouncer-style, e.g. Neon's `-pooler` host, Supabase
  Supavisor in transaction mode on port 6543) may hand consecutive statements to
  different backends, so the lock would guard nothing. This already bit once: the
  runbook records the learned rule **"use the direct host, never the `-pooler` one"**.
- **Rule carried forward to Supabase:** migrations and any other session-dependent
  work (advisory locks, `LISTEN`/`NOTIFY`, prepared-statement-heavy paths) use the
  **direct connection (port 5432) or a session-mode pooler**. Transaction-mode pooling
  is acceptable only for stateless request queries, never for the migration path.
- **IPv4 vs IPv6:** serverless hosts without IPv6 egress must use the pooler hostname
  (or a session-mode path) for runtime traffic; the direct path is still required for
  migrations, run from an environment with a route to it (release step / migration
  role, consistent with the P5-T05 direction of migrations as a release step with a
  dedicated role). Exact hostnames and ports are **CUTOVER BLOCKER B4** (owner:
  operator) — recorded at provisioning from the Supabase dashboard, in placeholder
  shape `postgres://user:pass@host:5432/db`, never pasted with real credentials.

## 5. Object Storage quota planning

Storage holds **application-encrypted** photo bytes (AES-256-GCM via `ELOHIM_BLOB_KEY`).
The bucket is **private**; the browser never gets direct access (no signed photo URLs
in the first migration — plan §"Agreed architecture"). Quota math starts from the
validated per-purpose ceilings in `server/lib/image-input.ts` (decoded bytes; stored
ciphertext adds a 12-byte IV + 16-byte auth tag + small envelope per object):

| Purpose                                         | Decoded ceiling                   | Stored?            | Planning figure per object                                         |
| ----------------------------------------------- | --------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `face` (provider scan frame)                    | 3_000_000 B, ≤2048 px, ≤2.5 M px  | No (transient)     | 0 — never reaches Storage                                          |
| `label` (label reader, full frame)              | 7_500_000 B, ≤4096 px, ≤12.5 M px | No (transient)     | 0 — never reaches Storage                                          |
| `progress` (canonical 288×384 crop, JPEG q0.86) | 768_000 B, ≤1024 px, ≤500 K px    | **Yes, encrypted** | ≈ 768 KiB + 32 B envelope overhead → plan **768_032 B** worst case |

Capacity formula: `users × photos-per-user × 768_032 B`, plus headroom for the
backfill window (P4-T05 keeps original DB bytes until the rollback window closes, so
both copies exist simultaneously). Real product caps (per-user photo limits, total plan
quota, bucket name, lifecycle/retention policy) are **CUTOVER BLOCKER B5** (owner:
operator). Transport ceilings that bound all of this from above: 12 MB Express JSON
bodies, ~6 MB platform payload caps in front (`web-lambda` bridge), 30 s Vercel route
budget — none of which Storage adoption changes.

## 6. Backup / recovery targets

Database recovery and ciphertext/key recovery are **two separate procedures**. Supabase
database backups do **not** include Storage objects (plan source list), and neither any
database backup nor any object backup is worth anything without the encryption key:

> **Losing `ELOHIM_BLOB_KEY` orphans every stored image even with a perfect DB backup.**
> The blobs are AES-256-GCM ciphertext; without the key they are random bytes with no
> recovery path. Key recovery is specified separately from database recovery, below.

| Environment              | RPO (max data loss)                                                                      | RTO (restore time)                                                   | Status                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Local / disposable lanes | None — nothing worth restoring                                                           | Re-run the launcher                                                  | No backup. By design                                                                                   |
| Staging                  | ≤ 24 h (nightly or on-demand before rehearsals)                                          | ≤ 4 h                                                                | Proposed; **BLOCKER B6** (owner: operator) to confirm schedule                                         |
| Production               | ≤ 24 h point-in-time for Postgres; Storage objects versioned/copied on the same schedule | ≤ 8 h to a verified isolated restore (reads + deletion work, P4-T06) | Proposed; **BLOCKER B6** (owner: operator) to confirm against the Supabase plan's backup/PITR offering |

**Procedure A — database recovery (per environment).** Record backup ID, restore into an
_isolated_ target (never over the live project on first pass), run migrations to the
pinned release, reconcile user/mapping/consent/scan counts per P3-T06/P4-T06, then
promote. Deletion tombstones must survive restore: a restore must never re-enable
deleted users or resurrect deleted objects.

**Procedure B — ciphertext + encryption-key recovery (separate).** (1) Restore
`ELOHIM_BLOB_KEY` from the offline copy **first** — current known copy:
`.secrets/production-blob-key.txt` (git-ignored) plus "somewhere safer than this
folder" per the runbook; confirming that safer copy exists and who holds it is
**BLOCKER B7** (owner: operator). (2) Restore object copies independently of the DB
restore. (3) Prove decryption of sample rows before declaring recovery complete.
**Rotation shape** (not timed here): generate new 32-byte key → record new key version
(P4-T01 envelope carries a key ID) → re-encrypt/backfill → keep the old key readable
until the rollback window closes → only then retire it. Never delete the only copy of
any live key version.

**Seven-day minimum rollback observation window** applies to both Auth (P3-T07) and
Storage (P4-T07) cutovers; rollback targets a _compatible_ release that understands
managed IDs / managed store pointers, never an old build, and never restores deleted
accounts.

## 7. Key classification table

Rule applied: a key imported by client code (`src/`, via `import.meta.env`) **is**
public regardless of intent. Evidence (repo grep, this branch): `src/` contains **zero**
`process.env` reads; the only client-side reads are `import.meta.env.DEV`, `.MODE`,
`.VITE_SAMPLE_DEMO`, `.VITE_DEPLOY_ENV`. Every other variable is read exclusively by
`server/`, `scripts/`, `vite.config.ts` (build-time Node), or tests. **No mismatch was
found** — no server-intended secret is reachable from the bundle today.

`VITE_`-prefixed variables are embedded in the client bundle at build time by
construction: **never put a secret behind a `VITE_` name** (the existing
`.env.example` already warns this for `PERFECTCORP_API_KEY`).

| Variable                                                                                                                                | Class       | Evidence / note                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                                                                                                     | server-only | Read in `server/ai/claude.ts` only. Never in `src/`                                                                                                                                          |
| `ELOHIM_MODEL`                                                                                                                          | server-only | Model override; `server/ai/claude.ts`. Model _name_ is not a credential but stays server-side                                                                                                |
| `ELOHIM_CLASSIFIER_MODEL`                                                                                                               | server-only | `server/ai/claude.ts`                                                                                                                                                                        |
| `ELOHIM_MODEL_CLASSIFIER`                                                                                                               | server-only | `server/ai/classify.ts`; `0` default                                                                                                                                                         |
| `ELOHIM_USER_DAILY_TURNS` / `ELOHIM_DAILY_TURNS` / `ELOHIM_DAILY_TOKENS`                                                                | server-only | `server/ai/budget.ts` gates. `/api/health` reports _spend against_ them (counts), never the keys — that reporting is the intended public capability, not a leak                              |
| `ELOHIM_VOICE_API_KEY`                                                                                                                  | server-only | `server/voice/tts.ts` + voice synth scripts. Audio bytes reach the browser; the key never does                                                                                               |
| `ELOHIM_VOICE_ID`                                                                                                                       | server-only | Voice identifier; server-side config (could be public by nature, kept server-side by implementation — no client read)                                                                        |
| `ELOHIM_VOICE_MODEL` / `ELOHIM_VOICE_ENDPOINT`                                                                                          | server-only | Optional overrides, server reads only                                                                                                                                                        |
| `ELOHIM_GUEST_VOICE`                                                                                                                    | server-only | Policy flag read server-side (`server/voice/tts.ts`)                                                                                                                                         |
| `ELOHIM_PORT` / `ELOHIM_WEB_PORT`                                                                                                       | server-only | Local ports; build-time Node (`vite.config.ts`) + `server/index.ts`. Not secrets, not bundled                                                                                                |
| `DATABASE_URL`                                                                                                                          | server-only | `server/db/index.ts`, `server/lib/env.ts`, scripts. Highest-sensitivity connection string                                                                                                    |
| `NETLIFY_DATABASE_URL`                                                                                                                  | server-only | Same as above; takes precedence even if empty — leave absent where unused                                                                                                                    |
| `ELOHIM_DB_POOL`                                                                                                                        | server-only | Bounded integer 1–50 (`server/db/index.ts`); not a secret, still server config                                                                                                               |
| `ELOHIM_DB_CA`                                                                                                                          | server-only | CA material: **public by nature** (certificate, not a secret) but consumed server-side only — keep intact, never log negligently                                                             |
| `ELOHIM_BLOB_KEY`                                                                                                                       | server-only | `server/lib/crypto.ts`. Loss orphans all stored photos (§6). Refused-not-clear when unset                                                                                                    |
| `ELOHIM_STORE_URL` / `ELOHIM_STORE_NAME` / `ELOHIM_STORE_KIND` / `ELOHIM_STORE_CURRENCY`                                                | server-only | Catalogue sync (`server/catalogue/store.ts`). Store _name_ surfaces in UI copy as a display string, which is presentation, not key exposure                                                  |
| `ELOHIM_ADMIN_TOKEN`                                                                                                                    | server-only | Protects catalogue import/sync (`server/routes/admin.ts`)                                                                                                                                    |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`                                                                                                 | server-only | Marketplace offers (`server/catalogue/offers.ts`, `store.ts`)                                                                                                                                |
| `EBAY_MARKETPLACE`                                                                                                                      | server-only | Default `EBAY_US` (`offers.ts`)                                                                                                                                                              |
| `ELOHIM_AMAZON_TAG` / `ELOHIM_AMAZON_DOMAIN`                                                                                            | server-only | Affiliate tag/domain for search links; tag is server config, links are public output                                                                                                         |
| `DEMO_MODE`                                                                                                                             | server-only | Deployment-behavior switch (`server/lib/env.ts`, `server/app.ts`); must never be set on a live site                                                                                          |
| `ELOHIM_LOG_LEVEL`                                                                                                                      | server-only | `server/lib/log.ts`; `info` on hosted environments                                                                                                                                           |
| `EVIA_SAMPLE_DEMO`                                                                                                                      | server-only | Sample-release gate (`server/ai/perfectcorp.ts`, legal-content script); client learns _sampleDemo:true_ via API, not via the flag                                                            |
| `ANALYSIS_PROVIDER`                                                                                                                     | server-only | `perfectcorp`/`local`; `server/ai/perfectcorp.ts`                                                                                                                                            |
| `PERFECTCORP_API_KEY`                                                                                                                   | server-only | Trial/commercial key; `.env.example` already forbids a `VITE_` prefix                                                                                                                        |
| `ELOHIM_DEV_DB_PORT` / `ELOHIM_TEST_DB_PORT` / `ELOHIM_SHOT_PORT`                                                                       | server-only | Local tooling ports only                                                                                                                                                                     |
| `ELOHIM_TEST_PG_URL`                                                                                                                    | server-only | Disposable-lane target; guarded to loopback + "test" names; never an app DB URL                                                                                                              |
| `ELOHIM_PG_LANE`                                                                                                                        | server-only | Test-lane marker set by the runner itself                                                                                                                                                    |
| `ELOHIM_ASSET_ORIGIN`                                                                                                                   | server-only | Prebuild asset origin (default Netlify site); build script use                                                                                                                               |
| `LEGAL_RELEASE` / `LEGAL_PRODUCTION`                                                                                                    | server-only | Build/release gates (`check-legal-content.ts`); not bundled values                                                                                                                           |
| `VITE_SAMPLE_DEMO`                                                                                                                      | **public**  | `VITE_` prefix → embedded in bundle; read in `src/App.svelte`. Visible notice flag by design                                                                                                 |
| `VITE_DEPLOY_ENV`                                                                                                                       | **public**  | `VITE_` prefix → embedded in bundle; read in `LegalPlaceholderNotice.svelte`. Presentation setting only                                                                                      |
| `DEV` / `MODE` (Vite built-ins)                                                                                                         | **public**  | Build-provided; not project secrets                                                                                                                                                          |
| `ELOHIM_DB_PATH`                                                                                                                        | n/a (dead)  | Referenced only by `server/db/index.ts.sqlite.bak`, a leftover backup file — not imported anywhere. Flagged for dead-code inspection under P5-T05; not a live key                            |
| Host signals (`VERCEL`, `VERCEL_ENV`, `NETLIFY`, `CONTEXT`, `LAMBDA_TASK_ROOT`, `AWS_LAMBDA_FUNCTION_NAME`, `NODE_ENV`, `NODE_VERSION`) | server-only | Platform-provided; never spoof to change deployment type (`docs/BACKEND_ENV_INVENTORY.md`). `NODE_ENV=production` also enables secure auth cookies                                           |
| `SUPABASE_URL` (placeholder `https://xyzcompany.supabase.co`)                                                                           | server-only | Prospective (P2-T02). Although a project URL is not a secret, this design keeps **all** Supabase SDK use backend-side (browser talks same-origin), so the URL is not published to the bundle |
| `SUPABASE_ANON_KEY` (placeholder `sb_publishable_...`)                                                                                  | server-only | Prospective ordinary-Auth operations key (P2-T02). Publishable by design, but policy is backend-only; never add a `VITE_` alias for it                                                       |
| `SUPABASE_SERVICE_ROLE_KEY` (placeholder `sb_secret_...`)                                                                               | server-only | Prospective privileged admin operations only (P2-T02: separate from ordinary Auth ops). Highest-sensitivity Supabase credential                                                              |
| `SUPABASE_DB_DIRECT_URL` (placeholder `postgres://user:pass@host:5432/db`)                                                              | server-only | Prospective direct/session path for migrations _if_ any DB surface ever lives in Supabase (§4). Placeholder shape only                                                                       |

Classification mismatches found: **none**. Cross-check method: `rg "process.env.[A-Z_]+" src/` →
empty; `rg "import.meta.env.[A-Z_]+"` → only `DEV`, `MODE`, `VITE_SAMPLE_DEMO`,
`VITE_DEPLOY_ENV`; no `SUPABASE_*`, `ANTHROPIC_*`, `PERFECTCORP_*`, or `ELOHIM_BLOB_KEY`
appears under `src/`.

## 8. Where the application DB lives today (repo evidence, no probing)

**Finding: the application database already lives on Neon, not Supabase.**
Evidence: `RUNBOOK.md` "Where things stand" — Neon project `elohim`
(`calm-silence-63515149`), region `aws-us-east-2`, Postgres 17, direct host with
`sslmode=require`, 19 tables via the app's own `migrate()`; `server/db/index.ts`
names Supabase only as one hypothetical among providers ("`pg` talks to any Postgres
— Neon, Supabase, RDS…"). `docs/BACKEND_ENV_INVENTORY.md` confirms no Supabase key,
JWT secret, or session secret is required by the current implementation (sessions are
random tokens backed by Postgres).

**Consolidation is explicitly NOT part of Auth adoption.** If the app DB already lived
in Supabase it would stay; since it lives on Neon, moving it is a separately gated
Phase 6 operation (**P6-T02**, blocker register B9 below) — never a prerequisite for
Phases 2–4. The identity mapping (P2-T03) is designed to span separate databases, so
Auth adoption does not need colocation.

## 9. Service inventory — owner, recovery, blockers

Every entry must be provisionable from this runbook in a fresh isolated environment.
"Recovery" names the procedure shape; full step-by-steps belong to the cutover
manifests (P3-T06/P3-T07, P4-T06/P4-T07), not to this contract.

| Service                              | Owner    | Recovery procedure                                                                                                                                                  | Blockers                                                                  |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Supabase Auth (staging)              | operator | Disable signups → export user/mapping counts → restore mapping table from backup → reconcile (P3-T06)                                                               | B1 (project/region), B2 (mail), B3 (redirects)                            |
| Supabase Auth (production)           | operator | Same as staging + 7-day observation before credential retirement (P3-T07); rollback to the compatible release, never an old build                                   | B1, B2, B3, B6 (RPO/RTO sign-off)                                         |
| Supabase Storage bucket (private)    | operator | Restore objects independently of DB (§6 procedure B); verify ciphertext checksums + byte counts before moving location pointers (P4-T05); honor deletion tombstones | B1, B4 (connection paths), B5 (quota/bucket), B6                          |
| Application Postgres (Neon, current) | operator | Existing runbook + `migrate()` idempotency; unchanged by Phases 2–4                                                                                                 | None (live today). B9 tracks the _optional_ P6-T02 consolidation decision |
| SMTP sender(s)                       | operator | Re-verify domain + rotate credentials in dashboard; re-run delivery smoke via dedicated test accounts                                                               | B2                                                                        |
| `ELOHIM_BLOB_KEY` custody            | operator | §6 procedure B: offline copy first, sample-decrypt proof after. Rotation keeps old versions readable through the rollback window                                    | B7                                                                        |
| Staging host + URLs                  | operator | Redeploy from `main`; rerun §10 checks against staging origins                                                                                                      | B8 (no staging exists yet)                                                |

## 10. Verification support — provisioning and health checks

A fresh isolated environment is provisioned from this file plus `RUNBOOK.md`,
`CONTRIBUTING.md` (Node 24, `npm ci`), and `.env.example` (placeholders) alone:

1. Create isolated Supabase project(s) per §2 (blocker B1); confirm Data API
   exposes nothing (P2-T04 deny-by-default).
2. Configure per-environment mail sink/sender per §3 (blocker B2); capture a
   signup mail locally before any hosted rehearsal.
3. Register redirect allowlists per §3 (blocker B3); prove an unlisted origin is
   rejected.
4. Record direct vs pooler strings per §4 (blocker B4); prove migrations run on
   the direct/session path.
5. Create the private bucket + quota per §5 (blocker B5); prove anonymous and
   cross-user reads fail.
6. Confirm backup schedule + key custody per §6 (blockers B6, B7); rehearse an
   isolated restore with sample-decrypt proof.
7. Application health (same as `docs/BACKEND_ENV_INVENTORY.md` "Verification after
   redeployment"): `/api/health` (`ok:true`, `demoMode:false` on hosted), catalogue
   status, sample adult register → sign out/in → scan save/reload, one live provider
   operation at a time.

## 11. Cutover blocker register

| ID  | Blocker                                                                                                      | Owner                 | Gates                                                           |
| --- | ------------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------- |
| B1  | Supabase staging + production projects and regions undecided (placeholders only in this file)                | operator              | P2-T02 and everything after                                     |
| B2  | Custom SMTP sender(s) undecided; mail MUST precede recovery flows                                            | operator              | P3-T03 rehearsal, P3-T06, P3-T07                                |
| B3  | Per-environment Auth redirect URL allowlists unregistered (local known; staging + both production hosts TBD) | operator              | P3-T03, P3-T06, P3-T07                                          |
| B4  | Supabase direct/session vs pooler connection paths unrecorded                                                | operator              | P2-T05 lane, any migration against a Supabase-hosted DB surface |
| B5  | Storage bucket name, private policies, plan quota, per-user ceilings undecided                               | operator              | P4-T02, P4-T05, P4-T07                                          |
| B6  | RPO/RTO targets + backup/PITR schedule unconfirmed (proposals in §6)                                         | operator              | P3-T07, P4-T06, P4-T07                                          |
| B7  | Blob-key offline copy holder + rotation runbook unconfirmed (only `.secrets/` copy attested)                 | operator              | P4-T06, P4-T07, any recovery claim                              |
| B8  | No staging environment exists (host, URLs, project)                                                          | operator              | P3-T06, P4-T06 rehearsals                                       |
| B9  | App-DB consolidation (Neon → Supabase?) explicitly deferred to P6-T02; NOT an Auth/Storage prerequisite      | operator (at Phase 6) | Nothing in Phases 2–5                                           |

## 12. P2-T01 self-check (evidence review, 2026-10-06)

- [x] Every `.env.example` variable appears in the §7 classification table (including
      commented-out optionals; `NETLIFY_DATABASE_URL` covered via the `DATABASE_URL`
      comment).
- [x] Every Phase-3/4 prerequisite (Auth redirect URLs, mail-before-recovery, bucket
      privacy, pooler mode) has an explicit owner or blocker (§9 + §11).
- [x] `npm run typecheck` clean (cheap gate; `.env.example` is not type-checked, doc-only change).
- [x] `git status` shows only allowed files: `docs/SUPABASE_ROLLOUT.md` (new),
      `.env.example` (comments/placeholders only), `docs/BACKEND_ENV_INVENTORY.md`
      (pointer section only).
- [x] No network probes, no live project, no real IDs/regions/hosts/credentials anywhere.
- [x] Residuals: blockers B1–B9 open by design — P2-T01 records decision points, it does
      not make them. Staging non-existence (B8) is the largest structural gap.
