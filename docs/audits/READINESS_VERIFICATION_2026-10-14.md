# Functional readiness verification — 2026-10-14

This is the final verification record for the changes described in [the 72-question audit and implementation plan](./READINESS_2026-10-14.md). It supersedes that report's earlier pending Docker-integration status, not its production-release restrictions.

## Published source

- Staging functional implementation: `5c1de7216f420e1acebbd1e45fe75eef91884430`; integration-fixture corrections: `726c845903e8b131dea86638e1874af48fc3c9d5`.
- Experimental functional implementation: `c1c9ae230083c9ea339dfad257a22dfab825b5cc`; equivalent integration-fixture corrections: `fe026d5ebb4759d51d962dd09f1f7bf99b0929df`.
- Main was not modified: `0880ba093cc6e3e421021b3046441ed3e3288fc8`.
- Production settings and database were not changed. The database migration was applied only to `evia-staging`.

## Preserved boundaries

The original staging visual system and experimental Studio visual system were retained separately. Hash checks found all 40 protected staging files and 39 protected experimental files unchanged. Protected paths cover shared medical/legal content, legal pages/components, stylesheet files, navigation, page frame and home design as applicable. Existing medical/legal wording was not rewritten. New operational recovery/error/confirmation controls use the existing branch presentation.

## Verification results

| Check | Evidence |
|---|---|
| TypeScript | Passed on both functional implementations |
| Svelte | Zero errors and zero warnings on both |
| Unit/contract suite | 525 passed in 43 files on each branch |
| Isolated PostgreSQL contract tests | 14 passed, included in the unit count; migrations, UUID ownership, atomic provisioning, forced deletion failure, session checks and role permissions |
| Browser contracts | Four Playwright tests passed on each branch; signup pending/resend controls, existing routes plus recovery/not-found, guest routine restrictions, and deletion confirmation/unknown-outcome feedback |
| Builds | Production bundle build passed for both designs |
| Migration reconstruction | All eight tracked migrations executed from scratch |
| Real Supabase integration suite | **123 tests passed in 18 files**, using a disposable local Supabase stack, actual Auth APIs, PostgREST and PostgreSQL |
| Hosted staging schema | Applied migration `20261014132127_managed_auth_readiness`; independently queried native UUID identity, timestamptz creation date, date birth date and private lifecycle triggers |

The completed CI run is [Verify managed Auth integration contracts](https://github.com/Evia-LLC/Evia/actions/runs/38574424948). Both its publication and real-integration jobs concluded **success**. The first integration run found nine obsolete expectations in legacy fixtures. They were corrected for the new schema and atomic registration consent; access restrictions, pagination, rollback and ownership checks were retained, not skipped.

The real integration suite exercised request validation, shared rate limits, product ownership, active-account deletion/retry/rollback, scan and body persistence, concurrent transaction fences, binary transport, consent persistence, registration rollback, provider budget reservations and export pagination. Test-owned Auth users existed only inside the disposable local Supabase stack, not the hosted project.

## Live deployment observations

Both functional commits reached READY Vercel preview deployments. An authenticated request to the staging branch alias returned:

```json
{"ok":true,"database":true,"registrationEnabled":true,"emailConfirmationRequired":true}
```

The response also reported modelAvailable=false, clonedVoice=false and imageStorage=true. Browser/CDN caching was disabled for the API response.

The old database=false condition was caused by a readiness contract that still required the removed `public.sessions` table, not by having zero users. A final hosted SQL check returned the managed-auth-v2 contract with zero Auth users, zero app users, zero registration consents and zero pending registration intents.

## Remaining release gates — not passed

1. **Experimental backend configuration:** its alias still reported database=false. Exact-branch metadata did not contain staging's Supabase URL, public key, server key or APP_ENV. Configure those for Preview → experiment/frontend-rebuild using evia-staging, not generic Preview or production. The shared encrypted-image store also needs the matching staging ELOHIM_BLOB_KEY. Sensitive values were not retrieved or printed. EVIA_SAMPLE_DEMO=1 was set only on the two requested Preview branches; the production registration guard remains in code.
2. **Hosted email lifecycle:** the attempted signup using the user's authorized email was blocked by the execution tool's safety check before it ran. No hosted test account or confirmation email was created by that attempt. SMTP delivery, exact allowed callback URLs and a complete real email-confirmation/recovery round trip are therefore unverified. This is not evidence that email delivery failed.
3. **Provider and approval dependencies:** age verification, payments, cloud model/voice/provider connections, medical/legal approval and provider/backup retention need explicit configuration and owner approval. They are not replaced by fake success responses. The documented minor/account/consent restrictions remain in force.
4. **Anonymous preview access:** a 200 from an authenticated Vercel connector does not establish public access. Separate anonymous HTTP checks encountered Vercel protection. No production protection settings were changed.
5. **Device/load evidence:** mocked browser contracts do not prove real camera hardware, paid provider behavior or a 1,000-user load target. Those remain separate tests.

## Interpretation

The managed-Auth and application repairs are implemented and substantially verified, including real Supabase integration. This is **not** a declaration that every external service is provisioned or that the product is ready for real-user production launch. The experimental credential gap and hosted email test are the immediate technical follow-through items; unchanged draft policies and unselected providers remain explicit release restrictions.
