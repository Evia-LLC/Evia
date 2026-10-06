# Evia — Remediation and Phased Supabase Plan

**Status:** ready for item-by-item execution; no implementation item is complete.
**Prepared:** 2026-09-29. **Inspected baseline:** `f622507c462ae6cf8e2b9c6ca49ba5d9f8258c7f`.
**Format reference:** AetherChess `docs/REMEDIATION_PLAN.md`: explicit files, defect,
change, regression test, and completion condition. This document adds dependencies,
release gates, and rollback boundaries for changes involving external services.

This is an implementation plan, not evidence that the application has passed a
penetration test or performance benchmark. The earlier conversational audit was
static. Its check commands did not yield conclusive completion evidence; do not
carry forward a claim that type checks or tests passed. Dependency audit was blocked
by registry DNS access. P0-T01 establishes the reproducible baseline.

## Agreed architecture and scope

Adopt **Supabase Auth and private Storage incrementally**. Keep Svelte, the existing
Node/Express API, business repositories, consent enforcement, and provider integrations.
Continue using SQL over `pg` for application data. A Postgres URL remains a valid
connection method; replacing it everywhere is not an objective.

- Supabase Auth becomes the credential and identity authority. The browser continues
  to talk to the same-origin backend; managed access/refresh tokens stay in HttpOnly
  cookies, not browser localStorage. The backend verifies identities and maps them to
  existing application user IDs.
- Supabase Storage holds **application-encrypted** photo objects. Preserve AES-GCM and
  authenticated backend downloads initially. Private buckets and provider encryption
  are not substitutes for the current application encryption boundary. Do not introduce
  browser-readable signed photo URLs as part of the first migration.
- Keep the current application database in place during Auth/Storage adoption. If it
  already lives in Supabase, retain that database. If it lives elsewhere, consolidation
  is a separately gated operation in Phase 6, not an Auth prerequisite.
- Do not port Express wholesale to Edge Functions. Keep paid AI calls, account
  deletion, consent writes, budgets, and admin operations on the existing backend.
- Leave the Data API disabled or the application schema unexposed. No browser table
  access until a later, explicit RLS-backed endpoint decision. Never use a secret or
  service-role key as evidence that user authorization works.
- Preserve age/Terms checks, consent wording versions, sample-demo restrictions,
  local fallback behavior, and metric-version comparability. Auth adoption does not
  approve legal wording or authorize production facial processing.

Supabase's documentation supports managed identity, private object storage and keeping
SQL connections. Data API exposure is optional, private downloads require authorization,
and database backups do not include Storage objects. See the source list at the end.

## Execution rules and gates

1. Execute phases in order, then task IDs in order. `Depends on` records additional
   dependencies inside a phase; **every task also depends on completion of the preceding
   phase**. Independent tasks may be reordered only with those dependencies satisfied.
2. One item is one reviewable behavior change or operational artifact. Prefer one commit
   per item, including its tests. If a task grows beyond one coherent change, add child
   IDs and dependencies before implementation; do not silently broaden it.
3. For defects, prove the named behavior fails before and passes after. For new services,
   prove the contract with denial/failure cases as well as success. Documentation-only
   and measurement tasks need evidence review, not tests that merely check text exists.
4. Record status, commit, commands, exit codes, evidence and residual risks in the
   execution ledger below. A skipped or unavailable required integration test is not a pass.
5. Run relevant tests per item. Before closing each phase, run the full local gate below;
   run additional Postgres/Supabase gates when that phase introduces them. Do not weaken
   ownership, consent, or quality checks to obtain a green gate.
6. New migrations are additive and use the next unused filename. Do not rename the two
   already-applied `011_*.sql` files. Coordinate numbering with the existing Perfect Corp
   work; this document intentionally does not reserve numeric migration filenames.
7. Use synthetic data and disposable infrastructure. Never run tests against URLs loaded
   from production `.env`, customer photos, or live paid providers. Preserve unrelated
   `.spec/` and `docs/PERFECT_CORP_UTILIZATION_AUDIT.md` work.
8. Application changes and dry-run tooling can proceed from this plan. Production
   provisioning, identity recovery emails, destructive cleanup and cutover are separate
   operational steps with a concrete reviewed manifest. No production action is implied
   by writing this document.

### Required baseline gate

| Check                    | Command                                       | Current evidence                |
| ------------------------ | --------------------------------------------- | ------------------------------- |
| Toolchain                | Node 24; locked install per `CONTRIBUTING.md` | Must record in P0-T01           |
| TypeScript               | `npm run typecheck`                           | Not established                 |
| Svelte                   | `npm run check`                               | Not established                 |
| Application and DB tests | `npm run test:local`                          | Not established                 |
| Build and legal guard    | `npm run build`                               | Not established                 |
| Dependency advisories    | `npm audit --json` and production-only view   | Previous registry access failed |

Build may download public assets. Run without provider credentials. The existing PGlite
runner is useful for application tests; it does not prove Supabase Auth/Storage, TLS,
extension availability, role policies or production concurrency behavior.

### Phase exit conditions

| Phase | Exit condition                                                                           |
| ----- | ---------------------------------------------------------------------------------------- |
| 0     | Reproducible checks, two-user fixtures and real-Postgres integration lane                |
| 1     | Immediate security, privacy, cost and input-boundary defects closed                      |
| 2     | Managed-service configuration, identity mapping and local integration harness ready      |
| 3     | Managed Auth rehearsed and cut over; legacy credentials retired only after observation   |
| 4     | Encrypted Storage rehearsed and cut over; deletion/recovery work across both stores      |
| 5     | Measured latency/query/render improvements and updated operational docs                  |
| 6     | Release evidence and optional consolidation decision; no automatic Data API/Edge rewrite |

## Root causes and evidence corrections

| Finding                                                                                            | Evidence                                                 | Owner task |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------- |
| Remote DB certificate verification disabled                                                        | `server/db/index.ts`, `getPool`                          | P1-T01     |
| Limiter uses per-process Map on serverless deployments                                             | `server/lib/rate-limit.ts`, deployment adapters          | P1-T02     |
| Login normalizes email differently from its limiter; IP+email does not stop cross-account spraying | `loginLimiter` vs `users.authenticate`                   | P1-T02     |
| Password derivation blocks the event loop                                                          | `server/lib/crypto.ts`, `scryptSync`                     | P1-T03     |
| Users can overwrite shared product ingredients                                                     | `POST /products` calls global `upsertProduct`            | P1-T04     |
| Image validation and structured payload validation are incomplete                                  | `server/routes/api.ts`                                   | P1-T05–06  |
| Spend check and write are separate; not all paid calls use the ledger                              | `budget.ts`, classifier, label reader, TTS, Perfect Corp | P1-T07–08  |
| Failed deletes lose discovery refs; uploads can race deletion                                      | `privacy/delete-account.ts`, photo repositories          | P1-T09–10  |
| TTS stores arbitrary text/audio in global cache without user ownership                             | `voice/tts.ts`, `008_voice_cache.sql`                    | P1-T11     |
| Timeout budgets disagree                                                                           | client 28s, Vercel 30s, Perfect Corp up to 180s          | P1-T12     |
| Errors/health expose details; frontend depends on some health fields                               | app, deployment adapters, voice client                   | P1-T13     |
| SQL docs still describe SQLite and single-process limiting                                         | `ARCHITECTURE.md`, limiter comments                      | P5-T05     |

Corrections to the earlier review: uploads are **not unbounded**; Express caps relevant
JSON bodies at 12 MB. The remaining defects are permissive content validation, large
pre-auth parsing, and missing decoded/dimension quotas. `todaySummary()` already catches
query failures, so its async route alone is not evidence of a crashing DB rejection.
Health feature flags are intentionally consumed by clients; move sensitive diagnostics,
not every flag. Marketplace requests occur only when relevant credentials are configured;
without them some results are simple search links. Account deletion already reports
`blobsFailed`, but discards the references needed for retry and still claims `ok: true`.

The existing Perfect Corp audit includes contested scoring claims. Do not implement a
polarity inversion on the strength of a heading. P1-T14 owns evidence and release gating;
new vendor features, masks and geometry persistence are outside this plan.

## Phase 0 — Establish evidence

### P0-T01 — Record a reproducible baseline

- **Depends on:** none.
- **Files:** `docs/REMEDIATION_BASELINE.md` (new); existing `package.json`,
  `CONTRIBUTING.md`, `.github/workflows/ci.yml` are inputs.
- **Change:** record commit, Node/npm versions, clean-install result, all baseline gate
  exit codes/test counts, and lockfile advisory output. Capture pre-existing failures
  separately from environment restrictions. Record route inventory and configured
  deployment limits without dumping environment values or credentials.
- **Verification:** another clean checkout can execute the commands using only synthetic
  fixtures. Advisory severity is assessed for installed versions and reachability; do
  not run `npm audit fix --force` as a blanket remediation.
- **Done when:** every gate has a result or explicit blocker; actionable baseline failures
  receive atomic child tasks and are closed before Phase 1. Registry failure remains an
  unresolved advisory check, not a clean audit.

### P0-T02 — Establish reusable two-account HTTP fixtures

- **Depends on:** P0-T01.
- **Files:** `test/helpers/` (new shared helpers), existing route and privacy tests.
- **Change:** reuse existing Vitest/Express tooling to create isolated A/B users, sessions,
  scans, photos and products. Stub provider calls with request counters. Do not replace
  existing suites or create a second unit-test runner.
- **Test:** `test/ownership-boundaries.test.ts` (new): A cannot read/delete B's scan,
  image, memory or usage; anonymous requests fail; consent denial causes zero provider
  calls. Exercise the HTTP boundary rather than only repository stubs.
- **Done when:** tests run under `test:local`, do not hit external services, and reliably
  distinguish authentication, ownership and consent denials.

### P0-T03 — Add a disposable real-Postgres test lane

- **Depends on:** P0-T01.
- **Files:** `scripts/test-postgres.mjs` (new), `package.json`, CI workflow,
  `test/integration/` (new), `CONTRIBUTING.md`.
- **Change:** provide a guarded ephemeral Postgres target and separate integration command
  for multiple connections, TLS, advisory locks, privileges and extensions. Never fall
  back to inherited application DB URLs. Fail if the dedicated target is not disposable.
- **Test:** rollback/isolation and two independent connections contending on a transaction;
  verify cleanup after failure. Later concurrency tests join this lane.
- **Done when:** CI runs the lane without production credentials; test output identifies
  engine/version and cannot silently substitute PGlite.

## Phase 1 — Close defects before moving them

### P1-T01 — Verify database certificates and bound pool settings

- **Depends on:** Phase 0.
- **Files:** `server/db/index.ts`, `.env.example`, `RUNBOOK.md`;
  `test/db-connection-security.test.ts` (new).
- **Defect/change:** replace remote `rejectUnauthorized: false` with verified TLS and
  an explicit CA option where necessary. Parse connection hosts using URL parsing;
  permit plaintext only for explicit local development. Reject conflicting URL SSL
  options that disable verification. Validate pool size as a bounded positive integer.
- **Test:** valid CA succeeds; wrong CA/hostname fails; local test DB works; URL options
  cannot silently override verification; invalid pool values fail with sanitized errors.
- **Done when:** no remote connection path disables verification and the deployed provider's
  connection method is documented without secrets.

### P1-T02 — Make abuse limits shared and normalize identities

- **Depends on:** P1-T01.
- **Files:** `server/lib/rate-limit.ts`, `server/routes/auth.ts`, deployment adapters,
  additive rate-bucket migration; `test/rate-limit.test.ts` (new).
- **Defect/change:** replace the Map's authoritative counts with atomic Postgres buckets.
  Hash normalized identifiers, expire buckets with bounded maintenance, and apply separate
  per-address and per-account login limits. Trim/lowercase consistently with authentication.
  Establish trusted IP extraction per supported host; never blindly trust incoming
  `X-Forwarded-For`. Fail closed for paid operations on limiter storage failure.
- **Test:** two app instances share the cap; whitespace/case variants do not reset it;
  many account names hit the address cap; forged forwarding headers cannot choose a
  bucket; expiry and store failure behave predictably.
- **Done when:** instances cannot multiply quotas and supported host adapters pass the same
  limiter contract. New write endpoints receive an explicit limit policy.

### P1-T03 — Remove synchronous legacy password derivation

- **Depends on:** P1-T02.
- **Files:** `server/lib/crypto.ts`, `server/db/users.ts`, `server/demo/seed.ts`, callers;
  `test/passwords.test.ts` (new).
- **Defect/change:** use async `scrypt`, await all callers, retain existing hash parameters
  for compatibility, cap password input size, and use a fixed dummy derivation for unknown
  accounts. This small bridge remains necessary until Auth cutover; do not expand the
  legacy authentication system with new features.
- **Test:** old hashes authenticate; wrong/unknown credentials fail; a scheduled timer can
  run while derivation is pending; oversized inputs are rejected before derivation.
- **Done when:** request paths contain no `scryptSync`; bounded concurrent logins do not
  serialize the event loop. P3-T08 removes this bridge after migration.

### P1-T04 — Prevent cross-user product poisoning

- **Depends on:** Phase 0.
- **Files:** `server/db/products.ts`, `server/routes/api.ts`, additive product-ownership
  migration, `server/privacy/export.ts`, `server/privacy/delete-account.ts`;
  `test/product-ownership.test.ts` (new).
- **Defect/change:** any authenticated user can currently submit a known name/brand and
  replace the shared row's ingredients, changing other users' assessments. Separate
  operator-managed shared products from user-owned submissions. A user upsert may modify
  only that user's product. Search/assessment/usage must resolve only authorized rows.
  Treat historical rows without provable ownership as shared read-only; do not guess owners.
- **Test:** B submits A's product name with different ingredients; A's routine and original
  row are unchanged. B cannot attach A's private product. Exports/deletion include owned
  products without deleting operator catalogue items.
- **Done when:** no ordinary user can mutate another user's or shared product ingredients.

### P1-T05 — Validate image content before storage or provider calls

- **Depends on:** P1-T02.
- **Files:** `server/lib/image-input.ts` (new), `server/app.ts`,
  `server/routes/api.ts`, `server/routes/analysis.ts`, `server/lib/web-lambda.ts`;
  `test/image-input.test.ts` and HTTP regressions.
- **Defect/change:** centralize strict base64 decoding, allowed JPEG/PNG signatures,
  decoded-size and dimension/pixel ceilings. Set explicit per-purpose limits below
  deployment transport limits. Reuse existing face-route constraints where appropriate.
  Authenticate before large JSON parsing where the adapter permits; bound adapter reads
  too. Remove `/api/scans` from image routes because it stores structured readings only.
  Return 400/413/415 correctly rather than generic 500 for parser/input errors.
- **Test:** malformed, truncated, mislabeled, oversized and excessive-dimension fixtures;
  boundary-size valid input; anonymous upload; provider/storage spies remain untouched on
  denial. Verify actual frontend captures fit each deployment's limit.
- **Done when:** all three image consumers share validated bytes/type, with no arbitrary
  binary upload and no unsupported capture-size promise.

### P1-T06 — Validate structured writes and reserve server evidence fields

- **Depends on:** P1-T04.
- **Files:** `server/routes/api.ts`, `server/db/users.ts`, shared boundary validators
  (new), `server/db/consents.ts`; `test/request-validation.test.ts` (new).
- **Defect/change:** allowlist profile/preference enums, string-array elements/counts,
  scan nested structures/confidence/timestamps, product inputs and routine fields.
  Bound idempotency keys. Construct consent actor identity/source on the server rather
  than accepting client `metadata.actorId`/`actorType`. Allow only documented client
  metadata; validation is distinct from client-side TypeScript types.
- **Test:** objects inside ingredients, invalid enums/dates, forged evidence, excessive
  lists and malformed observations fail before writes; valid existing contracts survive.
- **Done when:** stored malformed input cannot subsequently crash context/routine builders;
  consent history attributes the authenticated actor correctly.

### P1-T07 — Implement atomic provider budget reservations

- **Depends on:** P1-T01.
- **Files:** `server/ai/budget.ts`, additive reservation/counter migration;
  `test/integration/budget-reservations.test.ts` (new).
- **Defect/change:** replace check-then-record with short transactions reserving bounded
  user and global capacity in a stable lock order. Give every reservation a unique
  operation ID and provider/unit type. Reconcile actual usage idempotently. Track
  uncertain dispatched calls conservatively; process death must not automatically
  refund a call that may have been billed. Never hold a DB transaction over provider I/O.
- **Test:** many connections competing for one remaining allowance admit one; duplicate
  settle/refund cannot double-count; midnight, provider error and crash recovery work.
- **Done when:** pending plus settled usage enforces caps across instances; exhausted or
  unreadable ledger means no dispatch. Document reservation estimates and allowed overrun
  semantics instead of claiming a strict dollar cap from token estimates alone.

### P1-T08 — Put every paid dispatch behind the budget contract

- **Depends on:** P1-T07, P1-T02.
- **Files:** `server/ai/orchestrator.ts`, `classify.ts`, `claude.ts`,
  `server/routes/api.ts`, `server/voice/tts.ts`, `server/ai/perfectcorp.ts`;
  `test/provider-budget-gates.test.ts` (new).
- **Defect/change:** classifier runs before the existing chat allowance; label reading,
  voice and Perfect Corp use different or absent spend accounting. Require reservations
  at their dispatch boundaries, with global protection for guest voice. Count tokens,
  characters or tasks as appropriate; cache hits do not consume provider quota. Preserve
  consent checks before reservation/dispatch and no automatic billable task retry.
- **Test:** exhausted allowance causes zero network calls for each provider path, including
  classifier and guests; cache hits remain available; failure and fallback settle once.
- **Done when:** an inventory of network dispatches has no uncovered billable path.

### P1-T09 — Make current database deletion atomic and fence new writes

- **Depends on:** P1-T04.
- **Files:** `server/privacy/delete-account.ts`, photo/scan/body/user repositories,
  `server/lib/crypto.ts`; `test/integration/deletion-races.test.ts` (new).
- **Defect/change:** current blobs and account data share Postgres, so delete owned blob
  rows and relational data in one transaction. Use a common account lock/state for
  deletion and capture creation; individual photo deletion also removes its blob
  transactionally. Do not delete a discovery row before its blob is safely removed.
- **Test:** injected delete failure rolls back; upload/delete overlap leaves no unreachable
  blob; deleting twice is harmless; B's data survives; legacy image refs are included.
- **Done when:** no successful account/photo deletion strands a database blob. This is the
  current-store fix; P4-T04 adds the cross-service deletion workflow.

### P1-T10 — Make deletion responses reflect durable completion

- **Depends on:** P1-T09.
- **Files:** shared delete-result contract, `server/routes/api.ts`, `src/lib/api.ts`,
  `src/state/controller.ts`, `src/pages/DataRightsPage.svelte`, privacy UI tests.
- **Change:** distinguish completed, pending and failed deletion. Today the transactional
  DB operation completes or fails; reserve pending for Phase 4's durable job. Show success
  only after completion, and show a receipt/status for pending work. Preserve the existing
  account state if deletion did not take effect; do not show a misleading success screen.
- **Test:** each response state produces correct UI/session behavior; export remains
  available after a rollback; confirmed deletion removes access.
- **Done when:** backend and UI agree on what was deleted and what remains pending.

### P1-T11 — Stop persisting arbitrary personal voice lines globally

- **Depends on:** P1-T08.
- **Files:** `server/voice/tts.ts`, new static voice allowlist, additive cache-cleanup
  migration or explicit cleanup script; `test/voice-cache-privacy.test.ts` (new).
- **Defect/change:** `voice_lines` stores sentence text, audio and timings without owner
  or expiry, including personalized replies and guest input. Cache only server-defined
  non-personal stock lines, with bounded lifetime/size. Synthesize arbitrary lines
  without persistent cache writes. Do not let client text label itself as stock content.
  Prepare an explicit purge manifest for legacy unowned entries; do not infer ownership.
- **Test:** private values appear in no cached text, timings or audio row; stock lines hit
  cache; guests cannot promote personal content into it; cleanup preserves only allowlisted
  entries. Do not log provider response bodies that may echo those values.
- **Done when:** personalization is not retained outside account-controlled data, and legacy
  cleanup has an operational checkpoint rather than an undocumented destructive migration.

### P1-T12 — Align provider deadlines with hosting limits

- **Depends on:** P1-T08.
- **Files:** `server/ai/perfectcorp.ts`, `server/routes/analysis.ts`,
  `src/skin-analysis/provider.ts`, `server/voice/tts.ts`, `server/catalogue/offers.ts`,
  Anthropic client setup, `vercel.json`, Netlify adapter; timeout regression tests.
- **Defect/change:** set a single documented request budget per integration. For the current
  30s Vercel route, use a provider budget below the client timeout and leave cleanup/response
  headroom; client remains below host termination. Apply deadlines to TTS/marketplace/model
  requests and stop dispatch on disconnect. Track created vendor tasks for cleanup on
  success, timeout and cancellation; failed cleanup enters a bounded durable retry path.
  If supported vendor latency cannot fit, disable that synchronous live path until a
  separate asynchronous-job design is implemented; increasing an inner timer is not a fix.
- **Test:** fake-clock hung fetch/poll, disconnect and failed cleanup; response precedes
  host deadline; one billable submission; retryable cleanup survives request completion.
- **Done when:** no provider work is intentionally allowed to outlive its host deadline,
  and both deployment adapters demonstrate cancellation or rely on the explicit deadline.

### P1-T13 — Separate public capability checks from operator diagnostics

- **Depends on:** P1-T02.
- **Files:** `server/app.ts`, `server/vercel.ts`, `netlify/functions/`,
  `server/routes/admin.ts`, `server/lib/log.ts`, `src/lib/api.ts`, voice capability client;
  `test/http-errors-health.test.ts` (new).
- **Change:** retain a lightweight documented public capability response for frontend
  fallbacks. Move budget totals, database configuration/error details and operator
  diagnostics behind admin authorization. Normalize public API errors; keep useful
  400/401/403/409/413/429/503 distinctions. Redact tokens, URLs, provider payloads and
  personal text even in production debug logs. Avoid unbounded DB work on health polling.
- **Test:** failing boot and failing providers reveal no raw exception; capabilities still
  select the correct voice/fallback; diagnostics require admin; log sink contains no secrets.
- **Done when:** warm and cold-start adapters have the same safe public contract.

### P1-T14 — Resolve the existing Perfect Corp correctness release gate

- **Depends on:** P1-T12.
- **Files:** `docs/PERFECT_CORP_UTILIZATION_AUDIT.md` (reference, preserve existing work),
  `docs/REMEDIATION_BASELINE.md`, `test/perfectcorp-polarity.test.ts` (new).
- **Change:** reconcile that audit's contested polarity claims with the current mapper,
  client, UI and recommendation consumers. Build a non-50 fixture matrix for all nine
  metrics using authoritative vendor evidence. Record unresolved vendor semantics and
  existing implementation-task ownership without importing proposed masks/geometry work.
- **Test:** end-to-end mapper → display/trend/recommendation contract, not isolated adapter
  rounding. No live user capture or paid vendor request is required for the fixture tests.
- **Done when:** correct semantics have evidence and passing tests, or the uncertain vendor
  path is explicitly disabled. Any required correction is split into a child implementation
  item before re-enabling. A contested claim is never marked fixed by assumption.

## Phase 2 — Prepare managed services without switching users

### P2-T01 — Commit the environment and recovery contract

- **Depends on:** Phase 1.
- **Files:** `docs/SUPABASE_ROLLOUT.md` (new), `.env.example`, backend environment inventory.
- **Change:** record local/staging/production separation, project/region, SMTP and redirect
  requirements, connection/pooler mode, object quota and recovery targets. Classify keys
  as public or server-only. Record whether the existing application DB is already in
  Supabase; avoid moving it merely to adopt Auth. Specify ciphertext backup/key recovery
  separately from database recovery. Use placeholders for secrets.
- **Verification:** inventory has an owner and recovery procedure for each service;
  missing project/region/mail choices are recorded as cutover blockers, not invented.
- **Done when:** the configuration can be provisioned from the runbook in an isolated
  environment and the production decision points are explicit.

### P2-T02 — Add a server-only Supabase client boundary

- **Depends on:** P2-T01.
- **Files:** `server/lib/supabase.ts` (new), `package.json`, lockfile, env validation;
  `test/supabase-config.test.ts` (new).
- **Change:** add the official client as needed; separate ordinary Auth operations from
  privileged administrative operations. Disable shared mutable user session state on
  module-level clients. Reject missing/mixed-project config at feature enablement.
  Keep SDK imports and all secret credentials out of client bundles.
- **Test:** distinct user requests cannot inherit each other's tokens; wrong project config
  fails; built assets contain neither server credentials nor administrative client code.
- **Done when:** disabled managed features leave current local behavior working.

### P2-T03 — Add durable external-identity mapping

- **Depends on:** P2-T02.
- **Files:** additive application migration, `server/db/identities.ts` (new),
  `test/identity-mapping.test.ts` (new).
- **Change:** retain `users.id` and all existing application foreign keys. Map the trusted
  Supabase project/issuer and subject UUID uniquely to that ID. Separate profile creation
  from password hashing. Add pending/active/deleting provisioning state. Never auto-link
  accounts by an unverified email or client-supplied application ID. Do not require a
  cross-database FK to `auth.users`.
- **Test:** duplicate subject mappings fail; one user's subject cannot be reassigned; legacy
  scan/consent/usage IDs are unchanged; interrupted provisioning is idempotently resumed.
- **Done when:** identity and profile lifecycles are explicit and can span separate databases.

### P2-T04 — Make the managed service boundary deny by default

- **Depends on:** P2-T03.
- **Files:** Supabase local config/policy artifacts (new), rollout runbook,
  `test/integration/supabase-access.test.ts` (new).
- **Change:** disable Data API access to application tables or expose only an empty dedicated
  schema, depending on required service behavior. Revoke unintended public grants. Keep
  the private photo bucket inaccessible to ordinary browser credentials initially.
  Separate runtime SQL permissions from migration privileges. Policies must not assume
  direct `pg` sessions automatically receive a JWT or that privileged keys enforce RLS.
- **Test:** anonymous and A/B user credentials cannot list tables, invoke privileged RPCs,
  list objects or read another identity's metadata. Test with real user tokens as well
  as backend credentials; a service-role-only test is insufficient.
- **Done when:** adding Supabase has created no alternate bypass around backend consent gates.

### P2-T05 — Add a local Supabase integration lane

- **Depends on:** P2-T04.
- **Files:** local Supabase config, `scripts/test-supabase.mjs` (new), CI workflow,
  `package.json`, contributor docs; `test/integration/managed-services/` (new).
- **Change:** pin tooling and run disposable local Auth/Storage services with synthetic
  users and a local mail sink. Reject production project IDs/URLs in this runner. Keep
  PGlite tests fast; managed service tests are a distinct required lane from Phase 3 onward.
- **Test:** signup/recovery mail is captured locally, user tokens exercise denial policies,
  private object round-trip works through the backend and cleanup runs on failure.
- **Done when:** the full lane is reproducible without a paid provider or customer data.

## Phase 3 — Replace credential ownership with Supabase Auth

### P3-T01 — Implement managed session verification and refresh

- **Depends on:** Phase 2.
- **Files:** `server/routes/auth.ts`, `server/auth/managed-session.ts` (new),
  `server/lib/web-lambda.ts`, both deployment adapters; managed-session tests.
- **Change:** behind a deployment-level Auth selector, verify managed identities using
  supported Supabase verification, trusted issuer and expected audience. Resolve identity
  mapping and active account state on every request. Use Secure/HttpOnly cookies in deployed
  environments, origin/CSRF protection for mutations, and server-controlled refresh.
  Preserve multiple Set-Cookie headers across adapters. Coordinate concurrent refreshes
  so stale responses cannot overwrite newer credentials. Never accept a decoded-only JWT.
- **Test:** forged/expired/wrong-project tokens, unmapped/deleting account, concurrent refresh,
  cross-origin mutation, cookie transport and provider outage. Outage cannot fall through
  to legacy login for a migrated account.
- **Done when:** authenticated backend ownership checks receive exactly one verified app ID.

### P3-T02 — Route sign-up through existing eligibility and consent gates

- **Depends on:** P3-T01.
- **Files:** `server/routes/auth.ts`, `server/db/users.ts`, identity provisioning service
  (new), AuthGate and registration tests.
- **Change:** enforce DOB/age, Terms version and current sample-demo eligibility before
  activating any application identity. Configure Auth signup so direct provider signup
  cannot bypass application activation. Provision Auth identity + local profile + evidence
  with a resumable workflow; no plaintext password storage or logging. A partial remote
  success must be reconciled, not duplicated.
- **Test:** bypass the frontend and call both provider signup and app signup; an ineligible
  or unprovisioned identity cannot access app routes. Crash/retry at each provisioning
  boundary creates one account and one registration evidence event.
- **Done when:** verified email is not mistaken for consent or eligibility approval.

### P3-T03 — Implement sign-in, recovery and logout against managed Auth

- **Depends on:** P3-T02.
- **Files:** auth routes, managed-session service, `src/components/AuthGate.svelte`,
  recovery UI/route (new), `src/lib/api.ts`, `src/state/controller.ts`.
- **Change:** route credential validation, verification and password recovery to Supabase.
  Allowlist recovery redirects; validate callback/state; keep session tokens out of URLs
  after callback handling and out of JS persistence. Remove client dependence on returned
  bearer tokens for managed sessions. Use generic public credential/recovery errors and
  explicit sign-out semantics. Document access-token expiry versus immediate app revocation.
- **Test:** verification/recovery happy paths, invalid/replayed callback, generic unknown
  email response, refresh after reload, multiple tabs, logout and denied deleted-account
  access. Run cookie tests through Netlify and Vercel adapters.
- **Done when:** the user can complete the Auth lifecycle without the legacy verifier.

### P3-T04 — Prepare an idempotent existing-user migration

- **Depends on:** P3-T03.
- **Files:** `scripts/migrate-auth.ts` (new), rollout runbook; migration fixture tests.
- **Change:** default to dry run; enumerate legacy IDs, duplicate/invalid addresses and
  mapped subjects. Preserve original app IDs/evidence. Existing Node scrypt hashes are
  not presumed import-compatible with managed Auth. Use a verified-email recovery flow
  for existing users unless compatibility is explicitly demonstrated; do not invent
  converted hashes or silently mark emails verified. Prepare counts and recovery manifest
  without sending messages. Record newly created identities for compensation/retry.
- **Test:** interrupted/rerun migration, conflicting email, pre-existing managed identity,
  mapping collision and no-account case. No password/hash in manifests or logs.
- **Done when:** a synthetic migration preserves all ownership and can resume safely;
  actual user inventory and mail readiness gate the operational step.

### P3-T05 — Integrate managed identity revocation into account deletion

- **Depends on:** P3-T04.
- **Files:** `server/privacy/delete-account.ts`, durable deletion job repository/migration
  (new), Auth admin boundary, managed-account deletion tests.
- **Change:** block application access first, retain a minimal retry job independent of
  cascading user rows, revoke sessions/delete the managed identity, and then complete
  local cleanup. Remote failures stay pending with retries. This extends P1's transactional
  DB deletion; do not pretend a transaction spans Supabase Auth and Postgres.
- **Test:** remote outage before/after local deletion, repeated requests and worker crash;
  active JWTs cannot regain app access while deletion is pending.
- **Done when:** neither orphan identities nor deleted-user reactivation are silent outcomes.

### P3-T06 — Rehearse Auth migration and rollback in staging

- **Depends on:** P3-T05.
- **Files:** `docs/evidence/auth-rehearsal.md` (new), rollout runbook.
- **Change:** use synthetic copies of each account state and run migrate → sign-in →
  export → consent → deletion → retry. Rehearse rollback to the compatibility release,
  not an old build that cannot understand managed IDs. Keep an operator-owned manifest
  for compensation; never restore deleted accounts as part of rollback.
- **Verification:** reconcile user/mapping/consent/scan counts, error rates, email delivery
  and refresh behavior. Prove password changes made after migration remain usable on
  the rollback-compatible release.
- **Done when:** rehearsal evidence passes, account-migration strategy is settled, and
  production execution has explicit configuration, recovery and rollback steps.

### P3-T07 — Execute the reviewed Auth cutover

- **Depends on:** P3-T06.
- **Files:** rollout runbook and operational evidence; no unrelated code changes.
- **Change:** take a recoverable backup, pause conflicting signup/migration writes, apply
  the reviewed identity manifest, send only the approved recovery notifications, and
  enable managed Auth. Observe login, callback, refresh, ownership and deletion behavior
  for at least seven days before credential removal. Stop/rollback on duplicate mappings,
  cross-user access, unavailable recovery or sustained auth failures.
- **Verification:** reconcile manifest counts and production smoke checks using dedicated
  test accounts. Record backup ID and rollback-compatible release ID; never log credentials.
- **Done when:** cutover and observation evidence are recorded. Without a configured target
  or operational authorization, this item remains pending; staging is not production proof.

### P3-T08 — Retire legacy credential and session code

- **Depends on:** P3-T07.
- **Files:** `server/db/users.ts`, `server/lib/crypto.ts`, auth routes, demo seed,
  additive removal migration, obsolete auth tests and env/docs.
- **Change:** after the observation gate, remove legacy sessions, password hashes/salts,
  legacy verifier and obsolete flags through a reviewed cleanup migration. Keep encryption
  helpers. Provision demo accounts only in isolated managed test/dev environments; do not
  carry a published demo password into a deployed project.
- **Test:** repo search shows no runtime legacy credential fallback; full gate and managed
  Auth suite pass; missing managed credentials fail safely.
- **Done when:** Supabase alone owns credentials; rollback uses a managed-Auth-compatible
  release. This destructive boundary cannot be reversed by toggling an old env flag.

## Phase 4 — Move encrypted photos to private object storage

### P4-T01 — Extract the ciphertext storage contract

- **Depends on:** Phase 3.
- **Files:** `server/lib/crypto.ts`, `server/storage/blob-store.ts` (new), database store
  implementation, additive location/key-version metadata migration; storage contract tests.
- **Change:** separate encryption/decryption from storage transport. Keep a versioned
  envelope compatible with current IV/tag/ciphertext and a key ID for future rotation.
  Track opaque blob ID, owner, backend, object key and lifecycle state. Existing legacy
  refs remain readable; never turn their presence into progress-photo consent.
- **Test:** old ciphertext decrypts; wrong key/tampering fails; backends never receive
  plaintext; cross-owner ID lookup fails; missing key does not downgrade encryption.
- **Done when:** DB storage satisfies the common contract without changing user behavior.

### P4-T02 — Implement the private Supabase Storage backend

- **Depends on:** P4-T01.
- **Files:** `server/storage/supabase-store.ts` (new), bucket configuration/policies,
  rollout runbook, managed storage contract tests.
- **Change:** upload only ciphertext under opaque owner-scoped keys into a private bucket;
  server generates keys, size limits and no-overwrite behavior. Keep browser access denied.
  Download through the ownership-checked backend and decrypt there with `private, no-store`.
  Treat signed URLs as bearer credentials if ever used internally; never log them.
- **Test:** real local Storage rejects public/user direct listing/download; wrong-owner
  request fails; duplicate object key cannot overwrite; ciphertext round-trip and deletion
  work. Bucket content-type policy must allow encrypted bytes rather than mislabeled JPEG.
- **Done when:** replacing the store does not weaken encryption, consent or access boundaries.

### P4-T03 — Make object upload and metadata attachment recoverable

- **Depends on:** P4-T02.
- **Files:** progress-photo service/repository, upload-intent repository/migration (new),
  cleanup worker (new), photo routes; integration failure tests.
- **Change:** create a durable upload intent, upload ciphertext, and attach metadata only
  after verified completion. Use idempotent operation IDs, recheck account state/consent
  before attachment, and compensate unused objects. Define a scheduled orphan sweeper;
  serverless request completion must not be relied on to run background cleanup.
- **Test:** crash after intent/upload/attachment, duplicate save, withdrawal/deletion during
  upload, worker retry. No attached photo points to a missing object; unused objects are
  eventually removed with retained evidence.
- **Done when:** every partial upload is either resumable or discoverable for cleanup.

### P4-T04 — Extend deletion jobs to object storage

- **Depends on:** P4-T03.
- **Files:** deletion job service/worker, photo deletion routes, account deletion service,
  `DataRightsPage.svelte`, rollout scheduler config; integration deletion tests.
- **Change:** retain object refs in the deletion job before relational cascade. Deny reads
  and writes immediately, then idempotently remove objects, managed identity and DB data;
  mark completion only after all required steps succeed. Store minimal retry evidence
  with a bounded retention policy. Clean both old DB blobs and new objects during migration.
- **Test:** Storage outage, already-missing object, Auth outage, restart, partial completion
  and concurrent capture. Pending status survives process loss; retries cannot target
  another owner. Separate operational backup retention from live deletion claims.
- **Done when:** no retry needs a user row that has already been deleted and the UI does
  not claim complete erasure during pending cleanup.

### P4-T05 — Build a resumable ciphertext backfill

- **Depends on:** P4-T04.
- **Files:** `scripts/migrate-blobs.ts` (new), migration ledger, rollout runbook;
  fixture-backed migration tests.
- **Change:** dry-run inventory first; copy existing ciphertext without decrypting it into
  files/logs. Verify ciphertext checksums and byte counts before changing the location
  pointer. Keep original DB bytes until the rollback window closes; reads follow a single
  authoritative pointer. If dual-read fallback is used, deletion must remove both copies.
  Classify legacy scan image refs separately; preserve their deletion-only restriction.
- **Test:** interruption, duplicate execution, checksum mismatch, delete during backfill,
  missing source and key-version preservation. Resume never resurrects a deleted object.
- **Done when:** counts, bytes and checksums reconcile with zero unexplained objects.

### P4-T06 — Rehearse backup, restore and Storage rollback

- **Depends on:** P4-T05.
- **Files:** `docs/evidence/storage-rehearsal.md` (new), rollout runbook.
- **Change:** restore synthetic database metadata, encrypted objects and encryption keys
  into an isolated environment; prove reads and deletion still work. Rehearse restoring
  previous location pointers while honoring deletion tombstones. Define recovery point,
  recovery time and seven-day minimum rollback observation window.
- **Verification:** object backups are separate from DB backups; new writes during rollout
  remain reachable by a rollback-compatible release. Restore cannot re-enable deleted users.
- **Done when:** measured restore/rollback evidence meets the recorded recovery targets.

### P4-T07 — Execute Storage cutover and reconcile old copies

- **Depends on:** P4-T06.
- **Files:** rollout runbook, backfill/cleanup manifests and operational evidence.
- **Change:** enable new-object writes, execute reviewed backfill, observe reads/cleanup
  for the full window, then prepare explicit deletion of verified redundant DB ciphertext.
  Do not drop encryption keys or delete the only copy. Reconcile old, new and pending
  deletion stores immediately before destructive cleanup.
- **Verification:** counts/checksums, dedicated-account reads/deletes, backup success, zero
  unowned migration objects and functioning scheduled cleanup. Failures stop cleanup.
- **Done when:** managed Storage is authoritative and the reviewed redundant-copy cleanup
  has evidence. Rollback afterwards retains the managed store; an old DB-only build is unsafe.

## Phase 5 — Reduce measured performance and maintenance debt

### P5-T01 — Bound history reads without truncating exports

- **Depends on:** Phase 4.
- **Files:** `server/db/products.ts`, `progress-photos.ts`, `consents.ts`, API routes,
  corresponding client pages; pagination/context tests.
- **Change:** introduce cursor pagination with deterministic timestamp+ID ordering for
  UI history. Query active usage separately with explicit account limits; bound context
  bytes and recent observations. Keep export iterators complete, using batched reads or
  streaming as needed. Never drop active safety-relevant routine entries silently.
- **Test:** large seeded histories, equal timestamps and cursor boundaries; no duplicate
  or skipped rows; context is bounded; export still includes every authorized record.
- **Done when:** normal routes/context do not load an account's entire lifetime history.

### P5-T02 — Index product lookup using measured query plans

- **Depends on:** P5-T01.
- **Files:** `server/db/products.ts`, additive index migration,
  `test/integration/product-query-plans.test.ts` (new), benchmark evidence.
- **Change:** benchmark realistic name/brand substring search and normalized upsert lookup
  after ownership changes. Add suitable functional and `pg_trgm` indexes where justified;
  cap/minimize search input and handle wildcard semantics explicitly. Confirm extension
  support in the real target and plan production index creation without a long write lock.
- **Test:** results/ownership unchanged; `EXPLAIN (ANALYZE, BUFFERS)` on representative
  synthetic volume demonstrates improvement. Do not require tiny-table plans to use indexes.
- **Done when:** before/after plans and p95 latency are recorded; no unsupported extension
  is smuggled into the PGlite-only gate.

### P5-T03 — Bound and cache marketplace offer retrieval

- **Depends on:** P5-T01.
- **Files:** `server/catalogue/picks.ts`, `offers.ts`, `server/ai/context.ts`;
  offer concurrency/cache tests and latency evidence.
- **Change:** select deterministic catalogue winners first, then fetch independent offers
  with concurrency at most two and an overall deadline. Cache non-personal product/query
  results with bounded TTL/size; deduplicate concurrent identical lookups and token refresh.
  Preserve marketplace/currency in cache keys. Personal profiles must not enter shared keys.
- **Test:** delayed stubs prove bounded overlap, deadline fallback, currency isolation,
  correct no-key search links and expiry. One slow marketplace cannot block chat indefinitely.
- **Done when:** results are equivalent and slow-provider p95 improves against P0 evidence.

### P5-T04 — Profile the browser before selecting render optimizations

- **Depends on:** Phase 4.
- **Files:** `docs/evidence/browser-performance.md` (new); inputs include `src/App.svelte`,
  scene/stage, scan/CV, character and voice modules, `vite.config.ts`.
- **Change:** measure cold/warm load, built chunk sizes, long tasks, memory, frame time and
  camera/worker/WebGL cleanup across repeated scan/navigation cycles on a documented low
  tier and desktop configuration. Record capture/voice concurrency and hidden-tab behavior.
  Use synthetic fixtures. Do not call historic architecture figures current measurements.
- **Verification:** reproducible traces and device/browser versions; compare lazy import
  behavior to actual initial requests. For each reproducible breach, add a child task with
  exact hot path, change, regression check and numeric target before editing runtime code.
- **Done when:** measurements exist and identified blocking regressions have independently
  closed child tasks. If no breach is found, record that instead of inventing an optimization.

### P5-T05 — Remove obsolete architecture claims and startup responsibilities

- **Depends on:** P5-T01, P5-T02, P5-T03, P5-T04.
- **Files:** `server/app.ts`, `server/db/index.ts`, deployment scripts,
  `ARCHITECTURE.md`, `RUNBOOK.md`, `deployment.md`, `CONTRIBUTING.md`.
- **Change:** run production migrations as a release step with a dedicated migration role;
  runtime checks compatible schema version instead of taking a migration lock on every
  cold start. Keep convenient explicit local migrations. Schedule cleanup outside cold
  starts. Update diagrams/auth/storage/budget sections to describe implemented behavior.
  Inspect `server/db/index.ts.sqlite.bak` callers/tracking before any dead-code removal.
- **Test:** cold start issues no DDL; wrong schema version fails safely; release migration
  is idempotent; cleanup schedule has a recorded health signal; full deployment smoke passes.
- **Done when:** runtime DB role cannot perform schema migrations and docs match the release.

## Phase 6 — Release evidence and optional next steps

### P6-T01 — Close dependency and operational verification

- **Depends on:** Phase 5.
- **Files:** CI workflow, baseline/evidence docs, runtime monitoring configuration.
- **Change:** run all gates including real Postgres and managed-service lanes; repeat the
  advisory inventory against the final lockfile and split actionable upgrades into child
  tasks. Record p50/p95 API timings, cold start, provider cost units, authorization failures,
  deletion/upload backlog age, backup success and browser performance against the baseline.
  Alerts must contain identifiers/counts rather than personal text or image data.
- **Verification:** stage a limiter failure, expired credential, provider timeout and cleanup
  outage; observe a useful alert and documented recovery. Run export/delete isolation checks.
- **Done when:** no required check is skipped, unresolved risks have an owner/decision,
  and release/rollback commands refer to exact compatible versions.

### P6-T01a — Toolchain and dependency modernization track (scheduled)

- **Depends on:** P6-T01 (runs on a green, defect-closed tree; never interleaved with Phase 1 fixes).
- **Files:** `CONTRIBUTING.md`, `netlify.toml`, `.github/workflows/ci.yml`, `package.json`, lockfile; per-upgrade evidence notes.
- **Change:** evaluate moving the canonical toolchain forward (Node LTS newer than 24),
  upgrading major dependencies (Express, PGlite, Svelte/Vite kits) and refreshing
  pinned CI actions. Each upgrade is its own child item with before/after gate
  evidence (`typecheck`, `check`, `test:local`, `test:pg`, `build`, audit delta).
  No blanket `npm install latest` or `audit fix --force`; PGlite cold-boot cost
  and provider-driver TLS behavior are re-measured per upgrade.
- **Done when:** every adopted upgrade has passing gates on the new toolchain and
  the canonical versions are re-pinned in all three places (CONTRIBUTING, CI, host).
  Deferred upgrades stay listed with a reason, not silently dropped.

### P6-T02 — Decide whether application Postgres should be consolidated

- **Depends on:** P6-T01.
- **Files:** rollout runbook decision record; `scripts/migrate-app-db.ts` only if needed.
- **Change:** compare current provider operations, regional latency, pooling, backups and
  cost against moving the existing schema to Supabase Postgres. If already there or no
  benefit is demonstrated, close as no move. If beneficial, create separate child tasks
  for schema/extension compatibility, dry-run copy, row-count/checksum/FK reconciliation,
  restore, write freeze/final sync, connection cutover and rollback rehearsal. Preserve
  application IDs and identity mappings; Auth/Storage adoption is already complete.
- **Verification:** evidence-backed decision, not a vendor preference. A migration is not
  considered complete merely because `DATABASE_URL` was changed.
- **Done when:** no-move rationale is recorded, or all explicitly approved child migration
  tasks and their observation window are complete.

### P6-T03 — Record the Data API and Edge Functions boundary

- **Depends on:** P6-T01.
- **Files:** `docs/SUPABASE_ROLLOUT.md`, architecture decision section.
- **Change:** default to keeping both deferred. Consider a Data API endpoint only when it
  removes meaningful backend maintenance and cannot bypass consent/cost/business rules;
  require explicit grants, RLS, mapped-subject ownership, A/B/anonymous tests and rollback
  before exposure. Consider an Edge Function only for a small isolated workload with a
  measured hosting advantage and a verified execution budget. Do not move long vendor
  polling merely because its current host times out.
- **Verification:** retained backend responsibilities are enumerated. Any proposed adoption
  becomes a new separately sequenced plan with a concrete benefit; no automatic rewrite.
- **Done when:** the agreed limited migration has a clear stopping point.

## Release stops and rollback boundaries

| Trigger                                                                | Required response                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Cross-account read/write, forged identity acceptance or consent bypass | Stop affected feature rollout; preserve sanitized evidence; fix before resume                    |
| Duplicate/missing identity mappings or recovery unavailable            | Stop Auth cutover; use compatibility release and reconcile manifest                              |
| Ciphertext checksum mismatch, missing key or object backup failure     | Stop pointer switch and all old-copy cleanup                                                     |
| Upload/deletion retry backlog grows or loses references                | Keep cleanup pending; do not report completion or remove retry evidence                          |
| Provider exceeds host deadline                                         | Disable affected synchronous live provider until bounded/asynchronous implementation is verified |
| Legacy hashes or DB blob copies already removed                        | Never roll back to a build requiring them; use managed-service-compatible release                |

Backups are recovery mechanisms, not permission to resurrect deleted accounts/data.
All restores must replay deletion state before serving traffic. Durable deletion jobs
and migration ledgers need their own bounded retention/cleanup rules.

## Execution ledger

All task statuses start **TODO**. Append one row per item as it starts; keep the body
above as the contract and record scoped deviations here before implementation.

| Item    | Status | Commit / artifact                                                                                                                  | Commands and results                                                                                                                                                                                                          | Residual / next action                                                                   |
| ------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Plan    | READY  | `docs/REMEDIATION_PLAN.md`                                                                                                         | Reference format and repository paths inspected                                                                                                                                                                               | Begin P0-T01                                                                             |
| P0-T01  | DONE   | `docs/REMEDIATION_BASELINE.md`                                                                                                     | Gates: install 0, typecheck 0, check 0, test:local 1 (3 PGlite 30s timeouts), build 0, audit 1 (2 moderate qs); Node 26 vs canonical 24                                                                                       | Child tasks P0-T01a/b/c own blockers; P0-T02/P0-T03 may proceed except green-suite deps  |
| P0-T01a | DONE   | `test/consent-migration.test.ts`, `test/facial-geometry-privacy.test.ts`                                                           | Shared 1 PGlite/file + close; full `test:local` 37/37 files 328/328 pass 144.79s Node 26; typecheck 0                                                                                                                         | Closed; cold-boot cost documented, no timeout bump                                       |
| P0-T01b | DONE   | `test/body-store.test.ts` (comment + module warn)                                                                                  | 3 skipIf suites = 8 tests; 10-vs-0 was file-failure cascade, not skipIf; full run 0 skipped                                                                                                                                   | Closed; deterministic: 0 skipped under test:local, 8 bare                                |
| P0-T01c | DONE   | CI `checks` on PR #18 (Node 24, ubuntu-24.04)                                                                                      | test:local + test:pg green on canonical toolchain; Node-26-only variance closed                                                                                                                                               | Closed; local box stays Node 26 for dev, CI is the 24 gate                               |
| P0-T02  | DONE   | `test/helpers/two-accounts.ts`, `test/ownership-boundaries.test.ts`                                                                | Full `test:local` 38/38 files 334/334 pass 150.26s Node 26; typecheck 0; A/B isolation + anon 401 + consent 403→0 calls / grant→1 call                                                                                        | Closed; photo consent seeded via real FK decision; blob bytes stubbed with counter       |
| P0-T03  | DONE   | `scripts/test-postgres.mjs`, `test:pg`, `test/integration/`, CI service, CONTRIBUTING                                              | `test:local` 38 passed +2 skipped / 334+6, exit 0; guards fail fast (no target, remote host, non-test name); PGlite version string proven rejectable                                                                          | Closed; real-PG execution in CI (no local server); integration skips loudly outside lane |
| P1-T01  | DONE   | `server/db/index.ts`, `.env.example`, `RUNBOOK.md`, `test/db-connection-security.test.ts`                                          | typecheck 0; new file 59/59; full `test:local` 39 files 393 tests exit 0                                                                                                                                                      | Closed; CA rotation needs restart; pool ceiling 50 is judgment call                      |
| P1-T02  | DONE   | `server/lib/rate-limit.ts`, adapters, `012_rate_limit_buckets.sql`, `test/rate-limit.test.ts`                                      | typecheck 0; new 9/9; full `test:local` 40 files 402 tests exit 0; dual login buckets; forged XFF ignored                                                                                                                     | Closed; successful logins consume bucket units; Vercel trusts edge x-real-ip             |
| P1-T03  | DONE   | `server/lib/crypto.ts`, `server/db/users.ts`, `server/routes/auth.ts`, `test/passwords.test.ts`, `test/registration-route.test.ts` | typecheck 0; passwords 7/7 + registration caps; full `test:local` 41 files 409 tests exit 0; async scrypt same params; 128-byte cap at route (400) + KDF; dummy derivation; independent audit in `docs/REMEDIATION_STATUS.md` | Closed; bridge retired by P3-T08; Node 24 remains P0-T01c                                |

| P1-T04 | DONE | PR #18: products ownership (`013_product_ownership.sql`, owner_id NULL=shared), assess/attach 404-as-miss, export/delete scoped | CI `checks` pass (Node 24) incl. test:local + test:pg; 7 new tests; branch p1-t04 squash-merged after green CI | Closed; rebrand PR #15 still deliberately deferred to post-Phase-1 |
| P1-T05 | DONE | `server/lib/image-input.ts` (new), app/api/analysis/web-lambda wiring, 2 new test files (44 tests) | CI `checks` pass on branch (Node 24); typecheck+check 0; new 44/44; merged via PR after green CI | Closed; face/label/progress share validated bytes; /api/scans off 12mb |
| P1-T06 | DONE | `shared/boundary-validators.ts` (new), api/users/consents validation, `test/request-validation.test.ts` (16 tests) | CI `checks` pass (Node 24) incl. test:local + test:pg; typecheck+check 0; new 16/16; branch p1-t06 squash-merged after green CI | Closed; server-owned consent evidence; allowlisted writes |
| P1-T07 | DONE | `server/ai/budget.ts`, `016_budget_reservations.sql`, `test/integration/budget-reservations.test.ts` | Atomic reserve→settle, idempotent op IDs, midnight/crash rules; merged via PR after CI | Closed; CI test:pg is the real-engine gate |
| P1-T08 | DONE | Budget gates on every paid dispatch (classifier, label, voice, Perfect Corp) | Merged via PR #22 after CI | Closed; exhausted allowance means zero network calls |
| P1-T09 | DONE | `server/privacy/delete-account.ts`, scan/body/progress repositories, `test/integration/deletion-races.test.ts` | Merged via PR #23; user-verified atomic deletion + write fencing | Closed; transactional store fix, cross-service jobs come in P4-T04 |
| P1-T10 | DONE | `shared/delete-result.ts` (new), api/controller/DataRightsPage wiring, `test/deletion-states.test.ts` (13 tests) | CI `checks` pass (Node 24) incl. test:local + test:pg; typecheck+check 0; new 13/13; branch p1-t10 squash-merged after green CI | Closed; pending path wired but untriggered; App-gate receipt surfacing is follow-up |
| P1-T11 | DONE | `server/voice/stock-lines.ts` (new), tts stock-only cache, `scripts/purge-voice-cache.mjs`, `test/voice-cache-privacy.test.ts` (14 tests) | CI `checks` pass (Node 24) incl. test:local + test:pg; typecheck 0; new 14/14; branch p1-t11 squash-merged after green CI | Closed; guests never write; purge is operator-run dry-by-default |
| P1-T12 | DONE | Per-integration provider/client/host budgets, disconnect abort, vendor-task cleanup + bounded retry, `test/timeout-budgets.test.ts` (10 tests) | CI `checks` pass (Node 24) incl. test:local + test:pg; typecheck 0; new 10/10; branch p1-t12 squash-merged after green CI | Closed; no sync path exceeds host; billable-once via settle-once |
| P1-T13 | DONE | Capability-only public health + admin diagnostics, log redaction, `test/http-errors-health.test.ts` (33 tests) | CI `checks` pass (Node 24) incl. test:local + test:pg; typecheck+check 0; new 33/33; branch p1-t13 squash-merged after green CI | Closed; secrets never in responses/logs; one SELECT 1 per poll |
| P6-T01a | TODO | — | Modernization track: Node LTS, majors, CI actions; per-upgrade gate evidence | SCHEDULED: separate track after P6-T01, never interleaved with Phase 1 |

Allowed statuses: TODO, IN PROGRESS, BLOCKED (named prerequisite), DONE, or DEFERRED
(explicit reason and owner). Do not mark a operational cutover DONE from mocked tests.

## Source notes

Official references checked when preparing this plan; recheck SDK/runtime details when
implementing the affected item. Repository behavior is the basis for defect findings.

- [Supabase Auth architecture](https://supabase.com/docs/guides/auth/architecture): managed
  identity/session services; application ownership mapping remains our responsibility.
- [Password security](https://supabase.com/docs/guides/auth/password-security): managed
  password hashing; do not assume legacy Node scrypt bytes can be imported as equivalent.
- [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api): schema
  exposure, grants, RLS and disabling unused table APIs.
- [API keys](https://supabase.com/docs/guides/getting-started/api-keys): privileged keys
  bypass RLS and must remain server-only.
- [Private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals): private
  access control. Our retained AES-GCM envelope is an additional application choice.
- [Storage downloads](https://supabase.com/docs/guides/storage/serving/downloads): signed
  URLs grant temporary access; initial rollout retains authenticated backend downloads.
- [Database overview](https://supabase.com/docs/guides/database/overview): database backups
  exclude Storage objects, hence the independent restore gate.
- [Edge Functions](https://supabase.com/docs/guides/functions): optional compute primitive;
  this plan retains Express until a concrete workload justifies a separate migration.
