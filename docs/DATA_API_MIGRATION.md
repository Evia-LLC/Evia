# Data API migration — decision record

**Item:** supersedes `docs/REMEDIATION_PLAN.md` "Agreed architecture and scope" and
item P2-T04. **Status:** Implemented and CI acceptance passed 2026-10-13. Owner: operator.
Runtime/release conventions: [DATA_API_ADR.md](DATA_API_ADR.md).
Acceptance: [GitHub CI run 38382266377](https://github.com/Evia-LLC/Evia/actions/runs/38382266377)
verified runtime commit `285f2ca`: 496 unit tests and 123 real PostgREST integration tests,
plus TypeScript, Svelte checks, and production build. No hosted schema or deployment was changed.
**Inspected baseline:** `38a4544` ("APP_ENV cross-environment boot guard (#39)").

## 1. The problem being solved

Operator comprehension.

Evia's data layer is roughly 1,400 lines of hand-written SQL executed over `pg`,
with a custom placeholder bridge, a hand-rolled connection pool, a migration
runner, and row-level locking expressed inline at 17 call sites. It works. The
operator does not own it fluently, and every schema question, new query, and
incident investigation costs more than it should because the access path is
second-order knowledge for the person accountable for it.

PostgREST is better documented than the thing it replaces. Adopting it is a
comprehension decision, not only a technical one, and it is the operator's to
make.

**Single most important deliverable:** Evia runs end-to-end on the Supabase Data
API with no direct Postgres connection at runtime, a test suite that verifies
that, and the product behaviour a user sees today unchanged.

## 2. What this supersedes, stated plainly

`docs/REMEDIATION_PLAN.md` currently records, under "Agreed architecture and
scope":

> Continue using SQL over `pg` for application data. A Postgres URL remains a
> valid connection method; replacing it everywhere is not an objective.

and under P2-T04:

> Leave the Data API disabled or the application schema unexposed. No browser
> table access until a later, explicit RLS-backed endpoint decision.

Both statements are withdrawn. The Data API becomes the sole runtime data path
for application data. The second sentence of the P2-T04 quotation survives on
its own terms and is **not** withdrawn: the browser still never talks to Supabase
directly. See §5.

This record does not by itself reopen P3/P4 Auth and Storage work, which remain
as planned.

## 3. Why the cost is low today

The migration is destructive-and-recreate rather than data-preserving, which is
what makes it affordable:

- **No real users.** Evia has no production user accounts.
- **No production data.** Neon was never used to serve real traffic.
- **Demo data is synthetic and regenerable.** `server/demo/seed.ts` and
  `DEMO_MODE` create the sample demo account from a fixed constant. It is not
  user data and does not constrain the migration.

Therefore: the schema may be dropped and recreated freely. There is no backfill,
no dual-read window, no compatibility shim, no legacy column to carry forward,
no data-migration script, and no data rollback plan to write. The only rollback
that matters is redeploying the previous build with its original database configuration,
not running that build against the replacement schema. See the ADR's fallback contract.

This is the whole reason the migration is cheap, and it stops being true the
moment Evia takes its first real account. Anything that would later make this
migration expensive — a column added under the old access pattern, a backfill
needed to preserve meaning — is cheaper to never create.

## 4. Scope

**In scope — application data moves to the Data API:**

- All of `server/db/*.ts` (`users`, `products`, `chat`, `body-scans`, `scans`,
  `consents`, `progress-photos`) rewritten to `supabase.from()` / `supabase.rpc()`.
- `server/ai/budget.ts` rewritten too, and it is the single largest item: it
  holds 25 of ~122 production SQL statements, 4 of 12 transactions, and 5 of 17
  lock sites, and it sits outside `server/db/`. Also in scope: `server/privacy/
  delete-account.ts`, `server/lib/rate-limit.ts`, `server/catalogue/store.ts`,
  `server/voice/tts.ts`.
- The 17 lock sites and 12 `transaction()` blocks become Postgres functions.
  Row locks and multi-statement atomicity do not exist outside a function body
  under PostgREST; this is the substance of the work, not a detail.
- Migrations become an out-of-band release step. Boot-time `migrate()` and its
  advisory lock are deleted, along with `_migrations` bookkeeping.
- `server/lib/supabase.ts` becomes the only runtime data access path. It already
  exists, is already server-only, and already has the request-scoped and
  privileged split this needs (P2-T02). It is extended, not replaced.
- The test suite is rewritten against the Data API. Existing tests that assert
  `pg`-layer internals are replaced, not preserved.

**Out of scope — unchanged:**

- Elohim orchestration, avatar streaming, consent enforcement, budgets, memory.
  Behaviour here is preserved exactly; this is a transport migration.
- **Supabase Auth adoption is a separate, later decision.** Sessions and users
  are ordinary Postgres rows and reach the Data API like everything else. Auth
  migration is not a prerequisite and is not bundled here.
- The browser never contacts Supabase. The P2-T02 boundary stands: `server/`
  only, no `PUBLIC_`-prefixed Supabase variable, no `VITE_` alias.
- Env var names stay `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`. The newer `sb_publishable_` / `sb_secret_` values
  are accepted as key *shapes* by `server/lib/supabase.ts`; the variable *names*
  are not changed, because `server/lib/env-guard.ts` and the documented inventory
  depend on them.

**Not claimed:** this document is not a migration plan, not an estimate, and not
evidence that any part of it has been built. The work map is produced separately.

## 5. Authorization does not change with the transport

Worth stating because the Data API's selling point is usually RLS, and RLS is not
the reason for this migration.

Authorization in Evia is application-level: every repository function scopes by
`user_id` in its own predicate, and `requireAuth` (`server/routes/auth.ts:55`)
establishes identity. That continues unchanged. RLS is **not** being added as a
second authorization layer at this time — two layers means two places for a bug
to hide and one more thing to keep honest, and the browser never reaches the Data
API anyway, so every request would arrive on a service-role key with RLS
bypassed by construction.

Consequence to hold onto: `createAdminClient` and `createRequestClient` both
continue to exist, and the choice between them is an application-level decision
about *whose* data is being read, not a mechanism that enforces it.

**But RLS is still switched on — with zero policies.** These are different things
and the distinction matters. No *policies* means RLS is not an authorization
layer; application scoping remains the only one, as decided above. But every
table must still run `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, because
`SUPABASE_ANON_KEY` is a real functioning credential and once `createRequestClient`
can read a table, "anon key + RLS disabled" means *every row in the database*
returned to anyone presenting the key. Enabled with no policies, that mistake
returns nothing instead of everything. It costs one line per table, changes no
application code, and keeps the authorization story single-layered.

Grant `service_role` full table and function privileges alongside it; PostgREST
functions default to `SECURITY INVOKER`, so they inherit that role's
`BYPASSRLS` and grants.

## 5a. Hazards found during the work map, recorded here so they are not rediscovered

- **The proposed products deadlock is a hypothesis.** A disposable replay
  created FK insert triggers checking users before products, which does not
  support the stated inverse lock order. The real-engine suite inspects the
  target trigger order and races usage against deletion. A new locked
  startUsage algorithm would also close a separate TOCTOU and is not part
  of this transport migration.
- **`budget.ts` takes a *global* per-calendar-day advisory lock.** Every user's
  reservation on a given day serializes against every other user's. Under `pg`
  that was bounded by `DB_POOL_MAX=50`; over the Data API each waiter holds an
  open HTTP request and an open Postgres transaction inside a 30 s route budget.
  Narrowing the key to `(user, day)` is a budget-design change, not a transport
  change, and should be decided deliberately rather than discovered in load test.
- **Two bytea columns exist, not one.** blobs.data and voice_lines.audio.
  Native PostgreSQL JSON uses a backslash-x hex representation, not automatic
  base64. Both paths now use one strict hex codec and real-transport
  byte-equality assertions. Explicit base64 conversion is a different wire contract.
- **`privacy/delete-account.ts:43` forks on `dependencies === defaults`** to pick
  an atomic or a non-atomic erasure path. Deleting `transaction()` without
  deleting this fork silently leaves GDPR erasure non-atomic.
- **`server/app.ts` `ready()` must keep rejecting.** `vercel.ts` and `api.mts`
  branch on it for 503s and `server/index.ts:18` is a bare top-level await that
  crashes the process. Once `migrate()` is gone, `sweepExpiredSessions()` is the
  only always-executed database call; if its error is swallowed, all three
  failure paths die silently.
- **`007_usage_ledger.sql` and `016_budget_reservations.sql` deliberately have no
  foreign key to `users`.** That is why the budget lock family and the
  user-data lock family cannot deadlock each other. Preserve the missing FKs;
  adding them would create the cycle.

## 6. What gets deleted

| Removed | Where | Why |
| --- | --- | --- |
| `migrate()`, advisory lock, `_migrations` bookkeeping | `server/db/index.ts:417` | PostgREST cannot run DDL |
| `migrationsDir()`, `connectWithRetry()`, `getPool()` | `server/db/index.ts` | No connection pool |
| `?` → `$n` placeholder bridge | `server/db/index.ts` | PostgREST has its own parameter binding |
| `transaction()` helper and its `BEGIN`/`ROLLBACK` | `server/db/index.ts:350` | Becomes Postgres functions |
| `@types/pg` / `pg` runtime dependency | `package.json` | No direct connection at runtime |
| PGlite test lane | `scripts/test-local.mjs` | PGlite speaks SQL, not PostgREST |
| Real-Postgres test lane | `scripts/test-postgres.mjs` | Same |

## 7. Binary storage decision

Keep encrypted photos and cached audio in bytea. Native hex JSON makes the
768,032 B planning object roughly 1.536 MB. Test the Data API leg separately
from browser/function payload envelopes. Storage adoption remains a later
decision requiring B5 and a deletion/recovery contract across two systems.

## 8. Empty-project cut and fallback

There are no real accounts or production data. The accepted cut is one complete
application replacement after out-of-band schema installation. Keep the previous
deployment and its original empty/regenerable database configuration briefly for
fallback. The new build never accesses that target. Returning to the old deployment
returns to its original database; it does not roll new Supabase rows back. No
common-schema compatibility implementation is maintained. Verify the replacement
before allowing real registration; see DATA_API_ADR.md.
