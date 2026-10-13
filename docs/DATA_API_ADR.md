# Data API access and release contract

Decision: application persistence uses `@supabase/supabase-js` and PostgREST exclusively.
This implements `DATA_API_MIGRATION.md`; Supabase Auth and Storage are separate decisions.

## Runtime boundary

`server/lib/supabase.ts` constructs fresh server-only clients. Application repositories
use the service credential, including session lookup, anonymous rate limiting, and login.
`createRequestClient` remains the anon/request boundary for future Auth work; it cannot
read application tables. Evia session tokens are never forwarded to Supabase.

The variables remain `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY`. Hosted transport uses verified HTTPS; HTTP is allowed only
for loopback. The existing `APP_ENV` project guard remains. Missing configuration or an
incompatible/unreachable schema rejects `ready()`; adapters retain their failure responses.
No `PUBLIC_`/`VITE_` aliases, browser SDK imports, boot DDL, runtime database URL, or `pg` path.

## Repository convention

Routes and orchestration call domain repositories. Repositories use explicit projections,
existing hydrators, and user scoping. SDK results are unwrapped with `result`/`affected`;
transport errors carry `code`, `httpStatus`, `details`, and `hint`, but do not acquire a
public route `status`. Do not log error details or return them to callers. SDK retries
are disabled; a lost write response does not establish whether the transaction committed.
The transport timeout is 10 seconds per database request, matching the previous connection
acquisition ceiling; provider deadlines remain unchanged.

Complete lists use `allPages` with a stable unique ordering. UI limits remain limits.
Text JSON, JSONB, integer booleans, text timestamps, and existing constraints retain their
meaning. `.maybeSingle()` is for unique predicates or explicitly limited first-row reads.
An upsert with `ignoreDuplicates` preserves first-writer/immutable-event semantics.

`blobs.data` and `voice_lines.audio` remain bytea. JSON carries native `\\x` hex strings,
encoded/strictly decoded by one codec. Buffer objects are never passed directly to the SDK.
Application encryption and provider audio base64 are separate from this wire format.

## SQL escape surface and lock rules

Domain RPCs live in the out-of-band migrations. They are `SECURITY INVOKER`, use qualified
object names and a fixed search path, and are executable only by `service_role`.
Mutation functions are `VOLATILE` and called with POST. Private budget helpers are in
`evia_private`, which is not API-exposed. There is no arbitrary SQL/transaction RPC.

- Account-data RPCs take the existing `users FOR UPDATE` fence before child/blob work.
- Erasure discovers refs, deletes referenced blobs, deletes owned products, then deletes
  users and cascades. All of it commits or rolls back together.
- Budget reserve takes the `(day,user_id)` ledger fence, then the **global** day advisory
  lock. Admission reads happen after the wait, using fresh statement snapshots.
- Budget transitions take ledger, global day lock, then reservation. A pending operation
  transitions once. Settlement records actuals on the admitting day; uncertain dispatches
  remain pending. No provider I/O occurs inside an RPC.
- Budget identities have no FK to users. No operation combines both lock families.
- Rate consumption and expiry sweeping remain separate operations. Voice cache insertion,
  eviction, and best-effort counters retain their separate failure boundaries.

`evia_current_consents` groups by `(user_id,consent_type)` and retains timestamp/sequence
ordering. The view is security-invoker. Expression matching remains in read-only lookup
functions: products lowercase name/brand; catalogue lowercases name but preserves brand
case. Search remains parameterized SQL to preserve literal `*` and filter punctuation.
No generated columns, new uniqueness, or new locked `startUsage` algorithm is introduced.

RLS is enabled with zero policies on application tables. Anonymous/authenticated object
grants and PUBLIC function execution are revoked; service grants include the identity
sequence. RLS is defensive denial of direct access; application scoping remains authoritative.

## Local development and verification

Use Supabase CLI 2.120.0 with a running Docker/Podman engine.

```
npm ci --ignore-scripts
npm run dev
npm run test:unit
npm run test:data-api
npm run typecheck
npm run check
npm run build
```

The unit lane has no database dependency. The integration runner creates its own temporary
CLI project, unique project ID/ports, and fixed public schema. It overwrites credentials,
never links a hosted project, and fails rather than skipping/substituting when setup fails.
Files run serially and application data is reset between files; contenders inside lock
tests run concurrently. SQL fixture/admin work uses psql inside that owned container;
application calls and assertions use the real SDK and Data API. Test-only blockers and
failure triggers are never installed in production migrations.

`npm run db:stop` stops the persistent developer stack. To reset it deliberately, run
`supabase db reset --local`; never use a linked/remote reset for a test run.

## Empty-project release and fallback

There are no real users or production data to preserve. Install the final schema through
the CLI in the intended project as an out-of-band release step, then deploy the complete
replacement once. Do not run a schema reset from the application or production build.

1. Run both test lanes and static/build checks against a fresh local stack.
2. Review `supabase/migrations` and target project ref. Link the intended staging project
   and use `supabase db push` to install this fresh schema. Repeat for production only
   after the staging synthetic-data smoke checks pass.
3. Verify the API exposure includes public, service grants, contract RPC, and credentials.
4. Deploy with the three Supabase variables and correct `APP_ENV`.
5. Exercise login, consent, budget denial, chat/memory, photo byte round trip/deletion,
   voice-cache hit, and account erasure using synthetic accounts.

Keep the previous deployment and its original database configuration briefly for fallback.
The new application never accesses that database. Returning to the old deployment returns
to its original empty/regenerable target; this does not roll new Supabase rows back.
Rolling the old build onto Supabase instead requires its old SQL boot metadata and grants;
that is deliberately not this fallback strategy. Do not open registration to real users
until the replacement has passed acceptance and this empty-project fallback is retired.

The old direct SQL helper, placeholder bridge, pool, boot migrator, `_migrations`, PGlite
test lane, and pg test lane are removed. CLI migration history is out-of-band tooling
metadata, never queried by application diagnostics.
