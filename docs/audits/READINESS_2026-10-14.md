# Evia functional-readiness audit and implementation record

Date: 2026-10-14. Applies to **staging** and **experiment/frontend-rebuild**; not main/production.
Baseline staging: `4dea94a19b698f48773e08a817396bb96913a797`. Baseline experiment: `d72aeec1575d49ee6986b3767fa406b535612a0a`.

## Release decision

**Not approved for real-user production use.** Technical repairs below are not an approval of the medical claims, legal drafts, minor onboarding, payment processing, provider contracts, or retention policy. Those documents and their wording have not been changed. Staging's existing visual system is retained. Experimental styling remains experimental; both branches receive the same functional/security changes.

A working build, 200 response, or mocked browser test is not evidence of email delivery or an end-to-end hosted integration. Each verification layer is labelled below. Do not mark a gate passed without its evidence.

## What the audit found

Live SQL confirmed the readiness function raised EV003 because it still required the removed public.sessions table; zero users was not the cause. The repair preserves actual permission/table/function checks rather than replacing health with an unconditional success.

The main failures were functional, not cosmetic: boot still queried the deleted `sessions` table; the application generated custom identities and passwords in old seeding paths; eight RPCs compared text with UUID ownership columns; accounting subjects had been incorrectly converted to UUID; consent was recorded after account creation in a separate request; and deletion removed application data before attempting managed-identity deletion. An email-confirmation link had no complete server-side PKCE callback. Signup confirmation was represented as an exception rather than a pending outcome.

The live staging Auth settings inspected at the start of this audit had email login enabled, signup enabled, and `mailer_autoconfirm=false`. There were zero Auth users and zero application users. This proves email confirmation is configured, not that delivery/redirects work. The staging and experiment Vercel domains redirected an unauthenticated HTTP request to Vercel SSO; an authenticated connector fetch must not be described as proof of public access.

## Questions asked, findings, and implementation decisions

**Legend:** Implemented = code in this change set, not automatically a hosted verification. Preserved = existing constraint retained. External gate = needs an operator/product/legal/provider decision before release. Test = evidence required or supplied by the named test.

### A. Identity, signup, email, and recovery

| # | Question | Finding / disposition |
|---|---|---|
| A01 | Is authentication actually delegated to Supabase? | Yes: signup and password login use Auth APIs, not a custom session table. Old runtime createUser/authenticate/createSession paths removed. |
| A02 | Does submitting signup instantly admit the user? | No: successful signup returns 202 confirmationRequired, user=null. Both frontends keep the user at sign-in with an email notice. |
| A03 | Can someone enter if confirmations are disabled? | Registration checks Auth settings and refuses an auto-confirm configuration. Unexpected immediate sessions are revoked rather than accepted. |
| A04 | Can direct use of the publishable key bypass age/terms validation? | One-use, email-bound, expiring server-issued registration capabilities are consumed by the Auth provisioning trigger. Untrusted metadata alone cannot authorize signup. |
| A05 | Do users/profile/preferences/consent appear together? | The Auth insert trigger writes all four in one PostgreSQL transaction. A forced consent error test confirms rollback, not a partially provisioned account. |
| A06 | Can a duplicate address rewrite someone else's consent? | The trigger consumes only a matching new-registration capability. The route returns the same pending response for duplicate/new addresses and cleans unused capabilities. |
| A07 | Can the confirmation URL send a user to an attacker? | Redirect origin is an exact allowlist/known deployment host. The callback has fixed local destinations; arbitrary next URLs are ignored. |
| A08 | Are confirmation links compatible with HttpOnly sessions? | Server PKCE client stores the verifier and exchanges the code, with SameSite=Lax secure cookies. No implicit token fragment is used. |
| A09 | Is using another browser for the email link supported? | PKCE requires the browser which requested it. Failure is explicit; a confirmed user can subsequently sign in with the password. Cross-device OTP UX remains a future enhancement, not a fake claim. |
| A10 | Can the user request another email or recover a password? | Added resend and password-reset endpoints and controls, a callback recovery path and a password-update form. No token is returned to browser JavaScript. |
| A11 | Can any logged-in session act as a recovery session? | No: a short-lived, one-use server-side recovery grant is bound to the verified Auth user and session. |
| A12 | Are email delivery and the actual hosted callback proven? | External/live-test gate. Requires configured SMTP, allowed callback URLs, usable deployment credentials, and a real confirmation email test. No synthetic inbox success. |

### B. Sessions, access boundaries, and transport

| # | Question | Finding / disposition |
|---|---|---|
| B01 | Is getSession trusted as identity? | No. getUser verifies first; getSession is used only afterward to retrieve the refreshed credential. |
| B02 | Does logout invalidate an already issued JWT immediately? | Evia checks session_id against auth.sessions on protected requests, in addition to Auth verification. Deleted/revoked/expired sessions are rejected. |
| B03 | Does logout clear another device unexpectedly? | Normal logout explicitly uses local scope. Password recovery uses global scope. |
| B04 | Are credentials exposed to browser storage? | Access/refresh cookies are HttpOnly, Secure on hosted deployments, host-only, SameSite=Lax. Removed the frontend bearer-token buffer and unconditional analytics injection. |
| B05 | Can a shared warm server reuse another user's Auth client? | No per-user singleton: a fresh SSR client and cookie map are created per request. |
| B06 | Can CDN caching mix user sessions? | Auth and API responses are private/no-store at browser/CDN/Vercel layers, including refresh-cookie writes. |
| B07 | Can an external form or site mutate an account? | Cross-site and null-origin mutations rejected; JSON body type and same-origin evidence/custom header required for cookie mutations. |
| B08 | Can a malformed Bearer header fall back to someone else's cookie? | No. Invalid explicit bearer credentials fail; they do not fall back to cookie identity. |
| B09 | Is the database secret used as an authentication substitute? | No. Auth verifies identity first, then the BFF scopes operations. Database persistence is deliberately service-role server-side; browser roles have no table/RPC access. This is not a claim of user-scoped RLS on server queries. |
| B10 | Is missing data treated as a successful operation? | API transport rejects malformed/HTML responses, reports timeout/network failures, and never automatically retries mutations. Page actions now surface real failures. |
| B11 | Can a late boot request overwrite a guest/new account? | Auth epochs and independent settled preloads prevent stale bootstrap data from replacing the current user. |
| B12 | Are all identity/rate-limit/security invariants tested? | Route/CSRF/PostgreSQL contract tests added. Distributed request races, MFA, abuse controls and a 1,000-user workload remain separate release gates. |

### C. Schema, deletion, and persistence

| # | Question | Finding / disposition |
|---|---|---|
| C01 | Are account IDs native UUIDs? | users.id and owner/user FK columns remain UUID with users.id referencing auth.users(id). The migration reconstructs this from the checked-in baseline as well as existing staging. |
| C02 | Are time and birth-date fields properly typed? | users.created_at becomes timestamptz, users.date_of_birth becomes date. UUIDs correctly serialize as TypeScript strings. |
| C03 | Should every field called user_id be UUID? | No: budget subjects include guest:voice. Those two accounting fields are intentionally text, documented and tested; actual account ownership is UUID. |
| C04 | Do RPCs use the new types? | Recompiled affected scan, photo, body, product and deletion RPC comparisons with UUID casts. |
| C05 | Is the Auth creation trigger privileged safely? | It is in evia_private, SECURITY DEFINER with empty search_path. Browser execute/schema access is revoked. Normal public wrappers remain SECURITY INVOKER. |
| C06 | Does account deletion require two independent destructive calls? | No. One supported Supabase Auth Admin deletion initiates a transaction. A lifecycle trigger erases encrypted blobs and foreign keys cascade account records. |
| C07 | What if a cleanup or identity-delete constraint fails? | Auth's transaction rolls the trigger and cascades back. A forced later-trigger failure test confirms records and blobs remain. |
| C08 | What if the network times out after deletion commits? | A short-lived hashed receipt, committed in the same transaction, reconciles success. Otherwise return an uncertain error, not a fabricated completion. |
| C09 | Can the UI falsely claim nothing was deleted? | The original intact-data sentence is shown only when rollbackConfirmed is true. An unknown outcome uses separate operational feedback; original legal wording is preserved. |
| C10 | Can pressing Using it twice duplicate a routine item? | A unique active-usage index plus a locked, idempotent start-usage RPC returns the existing active record. |
| C11 | Are old custom passwords, sessions and public creation/deletion RPCs still used? | Removed from runtime and types. Deprecated RPCs are removed by the convergence migration; local fixtures use actual Auth APIs. |
| C12 | Are retention, backups and provider erasure fully complete? | External gate. Active DB/blob/identity cleanup is not provider/backup destruction. Hashed reconciliation records expire logically after one day; scheduled physical cleanup and legal retention decisions still require operational sign-off. |

### D. Page and navigation behavior

| # | Question | Finding / disposition |
|---|---|---|
| D01 | Does every existing route remain reachable? | Existing 16 routes preserved; password recovery and an explicit not-found destination added. Direct URL/browser testing is part of the verification suite. |
| D02 | Are query strings, hashes, external links and downloads handled correctly? | Router preserves search/fragment navigation and does not hijack cross-origin, target-blank, download or API links. |
| D03 | Does an unknown path silently show home? | Replaced with an explicit not-found page. |
| D04 | Can one failed preload make a successful login look failed? | Independent Promise.allSettled reads keep the verified account signed in and show partial-load errors. |
| D05 | Can guest Routine make unauthorized writes? | Guest mode does not load/save account routines, and controls communicate the restriction. |
| D06 | Do repeated page clicks issue duplicate mutations? | Routine actions are serialized; profile save and destructive scan/photo actions are guarded. |
| D07 | Does a failed deletion erase only local UI state? | Scan/photo lists update only on confirmed completed responses; error/uncertain outcomes preserve local records and show feedback. |
| D08 | Are destructive actions protected? | Account typed and second confirmation retained. Per-scan/photo deletion now asks for confirmation and disables repeated requests. |
| D09 | Do failures disappear into unhandled promises? | Page-level catches plus an operational API-error notice expose genuine failures. Programming errors are not blanket-swallowed. |
| D10 | Was staging visually redesigned? | No. Existing CSS, navigation, page frame, avatar, typography and existing presentation retained. Added only functional recovery/error/confirmation controls. |
| D11 | Was the experimental theme overwritten? | No. Common logic is ported separately; its studio stylesheet, Nav, Page, Home and legal-document visual layer remain intact. |
| D12 | Are all real camera/provider flows established by mocked UI tests? | No. Browser contracts verify state/navigation/actions, not actual user hardware or paid provider success. Device/camera and live provider tests remain required. |

### E. Stubs, providers, legal/medical boundaries, and operations

| # | Question | Finding / disposition |
|---|---|---|
| E01 | Does age verification really verify an age? | No provider is selected; the service returns an explicit unavailable/mock result. Keep the minor flow blocked; never change it to verified=true. |
| E02 | Are payments real? | Payment service is disabled. Do not manufacture checkout success or charge money while subscription/legal/provider setup is unfinished. |
| E03 | Does the legal-review event equal legally approved consent? | No. Draft wording/version gates and separate review semantics remain unchanged. Sample account registration is non-production only. |
| E04 | Is the displayed medical/measurement language edited here? | No. Medical constants, legal documents, disclaimer strings and copy are protected. Algorithm correctness/clinical validation is not claimed by this audit. |
| E05 | Are local Elohim replies really cloud-model replies? | Preserve local fallback disclosure. Missing provider credentials must not be represented as connected cloud functionality. |
| E06 | Does Perfect Corp/voice/avatar work without credentials? | Existing adapters remain; real provider setup and permitted data transfer are prerequisites. No fake API response is added to the shipped app. |
| E07 | Is a demo account created during every cold start? | No. Boot is read-only readiness. Explicit seeding requires an existing confirmed synthetic Auth account, administrator marker, non-production lane and opt-in. |
| E08 | Is optional tracking started before a valid lifecycle? | Unconditional Speed Insights injection removed. A separately reviewed consent-aware analytics lifecycle is still needed before re-enabling tracking. |
| E09 | Are staging and production credentials interchangeable? | No. APP_ENV declares the allowed Supabase lane; the existing guard is retained. Vercel Preview/staging scoping is not automatic inheritance into experiment. |
| E10 | Is an authenticated Vercel fetch evidence of public availability? | No. Anonymous HTTP protection was checked separately. Use an approved scoped share URL or explicit protection configuration, not a false public-link claim. |
| E11 | Are deployment secrets or Auth URL settings readable/settable through every connector? | No. Secrets may be redacted; do not dump or bypass them. Validate through protected runtime health/requests and require explicit dashboard configuration when unsupported. |
| E12 | Are backups, incident response, email abuse and load capacity signed off? | No. These remain owner-operated release gates with explicit evidence; a unit-test pass is not an SLA or compliance certification. |

### F. Release checks and operational decisions

| # | Question | Finding / disposition |
|---|---|---|
| F01 | Is every live migration present in source control? | Restored the three previously untracked historical migration files from the Supabase migration history and matched the new migration timestamp. |
| F02 | Can a new local database reproduce staging without manual fixes? | All eight migrations are checked by an isolated PostgreSQL reconstruction test. This does not run unapproved production migrations. |
| F03 | Does the live readiness result still depend on a user existing? | No: live staging now returns the managed-auth-v2 contract with zero users. It checks permissions, tables, functions and identity types, not row count. |
| F04 | Is the experimental build accidentally connected to production? | Exact branch environment metadata and APP_ENV must be inspected; no automatic secret copying to generic Preview scope. |
| F05 | Are the two frontend designs still independently preserved? | Separate baseline hashes and manual functional merges prevent staging styling from overwriting experiment, or vice versa. |
| F06 | What happens if the branch changed while the audit ran? | Publication must compare both remote base commits and reject stale writes. No force overwrite of concurrent work. |
| F07 | Can a tested source commit differ from what Vercel deploys? | Verify the exact commit SHA per deployment; inspect a fresh health response after deployment, not a previous build URL. |
| F08 | Do mocked browser responses prove database persistence? | No. Browser contracts and PostgreSQL tests are separate evidence layers. Hosted persistence/email tests are reported separately. |
| F09 | Are failures fixed by weakening tests? | Obsolete custom-auth fixtures are replaced with managed-Auth contracts; no blanket skipping, unconditional success, or retries of destructive operations. |
| F10 | Is a test credential copied into a shipped bundle? | No server secrets or test sessions belong in source, artifacts or browser JavaScript. Synthetic data is confined to test fixtures. |
| F11 | Is a public preview allowed to charge paid APIs unchecked? | Existing consent and budget gates remain; no unlimited provider access is enabled to make demonstrations appear functional. |
| F12 | Who can authorize the remaining nontechnical release gates? | The product/operator must select providers and obtain policy/medical approval. These gates cannot be resolved by renaming a stub or changing its return value. |

## Implementation sequence

1. **Containment:** keep production/main unchanged; snapshot both branch bases; fingerprint existing legal/medical/style files. No credential dumping or live user-data mutation during local testing.
2. **Database/Auth repair:** reproducible UUID migration, timestamp/date types, private one-use registration and recovery grants, transactional provisioning and deletion cleanup, typed RPC comparisons, accounting-subject correction and idempotent routine usage.
3. **Server repair:** per-request PKCE cookies, authoritative identity/session checks, email confirmation pending, fixed callback redirects, resend/recovery, local/global logout scopes, CSRF and private caching. Remove legacy boot/session/password paths.
4. **Frontend repair:** retain visual systems, add recovery controls, preserve pending/failed states, protect guest operations and repeated writes, repair routing, and avoid false success/deletion claims.
5. **Evidence:** TypeScript, Svelte, unit contracts, isolated PostgreSQL migrations/rollback/permissions, explicit mocked browser contracts, and local-only full Supabase integration fixtures. Label each layer honestly.
6. **Promotion gate:** apply the reviewed migration only to evia-staging; deploy exact tested commits to both non-production branches; verify health/real API/email flows. Do not promote production.

## Operator decisions / work that cannot be safely invented

- Which age-verification provider and verification method are approved, and is the initial real launch adults-only?
- Which payment provider, merchant entity, currency, subscription/cancellation configuration and approved terms apply?
- Which SMTP sender/domain is authorized, and have SPF/DKIM and delivery limits been configured?
- Are both exact callback origins configured in staging Supabase Auth? Use the staging branch alias and experimental custom alias, not a wildcard for all Vercel customers. Add localhost only for intentional local access to staging.
- Which versioned policies have approval? No launch flag should circumvent their current draft status.
- What retention/legal-hold/backup/provider-erasure policy supersedes the existing disclosed gaps? Do not fabricate compliance.
- What real device/browser matrix, provider-concurrency limit and acceptable spend ceiling govern load tests?

## Evidence and limitations

The companion automated suites distinguish HTTP-route mocks, isolated PostgreSQL, and browser contracts from actual hosted email/identity/provider tests. See `test/registration-route.test.ts`, `test/request-security.test.ts`, `test/managed-schema.test.ts`, `e2e/app.spec.ts`, and `scripts/check-managed-schema.mjs`.

All Auth records in the database-contract tests belong to an isolated synthetic test schema; no test uses SQL to create a hosted Supabase Auth user. The local integration fixture refuses non-loopback Supabase targets and uses the supported Auth APIs.

A numerical test/build report and hosted rollout record should accompany the exact final commits. Any unavailable provider, blocked email flow, incomplete integration run or protected preview remains a failed/unverified release gate, not an inferred pass.

## Primary references

- Supabase SSR/PKCE: https://supabase.com/docs/guides/auth/server-side/advanced-guide
- Server Auth verification: https://supabase.com/docs/guides/auth/server-side/creating-a-client
- Session IDs and revocation: https://supabase.com/docs/guides/auth/sessions
- Auth-managed user data/triggers: https://supabase.com/docs/guides/auth/managing-user-data
- Source contracts: `server/routes/auth.ts`, `server/lib/auth-session.ts`, `server/privacy/delete-account.ts`, `supabase/migrations/20261014132127_managed_auth_readiness.sql`.

### Hosted schema verification

Migration `20261014132127_managed_auth_readiness` was applied only to evia-staging and independently queried: native UUID identity, timestamptz creation date, date birth date, private Auth lifecycle triggers, no browser registration-RPC permission, and `evia-managed-auth-v2` readiness with zero Auth/application accounts. No account was created or email sent by that migration.

## Verification results before publication (2026-10-14)

| Layer | Staging | Experimental |
|---|---|---|
| TypeScript | Passed | Passed |
| Svelte checks | 0 errors, 0 warnings | 0 errors, 0 warnings |
| Unit/contract tests | 525 passed in 43 files | 525 passed in 43 files |
| Production bundle build | Passed | Passed |
| Playwright browser contracts | 4 passed | 4 passed |
| PostgreSQL schema/rollback/permissions suite | 14 passed, included above | Same SQL and tests |
| Eight tracked migrations reconstructed from scratch | Passed | Same migration files |
| Existing protected legal/medical/style hashes | 40 unchanged | 39 unchanged, including experimental frame/nav/home |
| Hosted staging migration/readiness | Applied and independently verified | Shared staging project; deployment credentials still need verification |
| Hosted signup/email/callback/login | Not yet verified | Not yet verified |
| Full Docker Supabase integration suite | Not yet run in sandbox | Not yet run in sandbox |

Browser tests use explicitly mocked API responses. PostgreSQL tests use a disposable synthetic Auth schema, not live users. Neither is represented as proof of email delivery, camera hardware, payment, age verification, or paid provider success. A scoped deployment read may bypass Vercel protection; it is not proof of anonymous public access.

### Live deployment and integration follow-through

Both exact functional commits were deployed READY. The staging branch alias returned HTTP 200 with database=true, registrationEnabled=true and emailConfirmationRequired=true; its responses were private/no-store. This verifies actual staging Data API credentials/readiness without reading secrets.

The experimental alias still returned database=false. Its exact branch did not contain the three Supabase credentials or APP_ENV metadata; it needs the evia-staging configuration explicitly scoped to experiment/frontend-rebuild, not generic Preview and not production. EVIA_SAMPLE_DEMO=1 was added as a non-secret only on the two requested Preview branches; production registration remains blocked by the code gate.

The live signup request to the user's email was blocked by the tool safety check before execution. No live test identity or email was created by that attempt, and hosted email delivery/callback cannot be marked passed.

The first real Docker Supabase integration execution passed 114/123 tests. Its nine failures were traced to obsolete text-ID/password-column fixtures, registration-consent baseline counts, old frontend token-buffer assertions, and raw-error/retry-receipt expectations. These tests have been corrected to assert the managed-Auth contracts, keeping permission/ownership/rollback and pagination checks in place. The follow-up CI result is recorded separately; do not infer a pass until that run completes.
