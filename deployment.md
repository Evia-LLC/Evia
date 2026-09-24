# Deployment Plan — Production Ready (SRS v2.0 §15)

> Goal: sign §15 launch. Every P0 row in `docs/SRS_V2_COMPLIANCE_AUDIT.md:71-97` has a passing production-like artifact (code + migration + test + screenshot/HAR/audit log). No reliance on typed checks or visual prototype alone. Checklist below maps to that audit, plus `COMPLIANCE_AUDIT.md:9` CK-01 and `ARCHITECTURE.md`/`RUNBOOK.md` operational realities.

**Current prod foothold:** Netlify `a00b1489-137e-404c-809c-08babb811fc4` (Vercel parallel `vercel.json`), Neon `aws-us-east-2` direct host `elohim_owner`, Node 24, 13 migrations, `DEMO_MODE=0` required. `RUNBOOK.md:29-106` is accurate as of 2026-09-06.

---

## 1. Phase 0 — containment (2-4 eng days, no Founder/counsel wait to start)

| #   | Action                                                                                                                                                                                                                                                                                                                  | File:line                                                                                    | Why (audit ID)                                                                                                                      | Exit artifact                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0.1 | **Fail-closed scan gate**: reject `POST /api/scans`, `POST /api/scans/:id/progress-photo`, `GET /api/scans` (or any analysis/voice/context that needs face state) unless server-evaluated policy passes — even if client bypasses UI. Add `server/lib/policy.ts` central `canScan(user)` + middleware `requireCanScan`. | `server/routes/api.ts:52` currently only `auth`, `server/app.ts:134` `ready()`               | AGE/GDN/CNS/PAY bypass `docs/SRS:40,99` direct `curl` reproduced `200` with fabricated metrics+landmarks                            | Negative integration test: fresh account DOB-less -> `POST /api/scans` `403` with code `AGE_REQUIRED`; same after each missing gate. |
| 0.2 | **Disable Anthropic face-image branch** `server/ai/claude.ts` `describeSkinImage`                                                                                                                                                                                                                                       | `server/ai/*` `docs/SRS:90` `AI-01`                                                          | Sends `{type:'image', data:imageBase64}` to Anthropic — violates “no facial photo to conversational AI” even with `cloud_reasoning` | Code diff + test proving no base64 image leaves for `consent_events` false. Restore only behind new CNS-01 + DPA (Phase 1).          |
| 0.3 | **Suppress “Skin health” composite** + `acneIndicators` diagnosis wording                                                                                                                                                                                                                                               | `src/holograms/*`, `src/components/ScanPage.svelte`, `server/skin/metrics.ts` `docs/SRS:183` | Arbitrary average, `MED-01` prohibited health score                                                                                 | Screenshot before/after, persona test update.                                                                                        |
| 0.4 | **Freeze landmark persistence** `skin_scans.landmarks_json`                                                                                                                                                                                                                                                             | `server/db/migrations/006_scan_landmarks.sql` + `server/routes/api.ts`                       | `RET-02` indefinite biometric retention                                                                                             | Migration `015` option: delete column or immediate per-scan cleanup + job; document retained rows + deletion audit.                  |

---

## 2. Phase 1 — legal state machine & hard gates (3-5 weeks + counsel/vendor lead time)

This is the largest gap. Existing `users` has no DOB, no `age_status`; `consents` (`user_id,kind,granted,granted_at` `server/db/migrations/001_init.sql`) is not versioned/immutable; no `consent_events`.

**Schema:**

- `users` add `dob DATE`, `age_status ENUM('under16','age16_17','adult','unknown')`, `jurisdiction TEXT` (derived, not freeform), `funding_type ENUM('credit','debit_prepaid','unknown')` for PAY, `created_at`, `rejected_at`.
- `guardians (id, minor_user_id FK, relationship TEXT, email, status ENUM('invited','verified','consented','expired','revoked'), illinois_verified BOOL, verified_at, expires_at)` + jobs: `72h invite expiry`, `14d deletion` for under-16, `turned-18` transition.
- `consent_events (id, user_id, consent_type TEXT, wording_version_id TEXT, state ENUM('granted','withdrawn'), recorded_at TIMESTAMPTZ, metadata_json, event_sequence BIGSERIAL, idempotency_key UNIQUE)` — immutable, append-only. See `server/db/migrations/011_versioned_consents.sql` pattern but broaden from 2 kinds to full set. Adds missing `CNS-01` (facial scan, separate unticked), `CNS-02` (WA/NV/CT health, jurisdictional), `CNS-03` (optional safety/lifestyle), `CNS-04` (progress photo session vs keep).
- `subscriptions/payments` (Stripe `customerId`, `status`, `priceId`, `fundingType`, `checkoutSession`, `webhookEventLog` idempotent) for `PAY-01/02` $20.99/$40 disclosure + `ELOHIM_STORE` not enough.
- `policy_versions (wording_version_id PK, consent_type, text, locale, effective_from)` — required because `docs/SRS:110` consent wording pack not supplied; store exact counsel text here.

**Policy & routes (`server/lib/policy.ts`, `server/db/consents.ts`):**

```
canScan(user) = age_status != 'under16'
             && (age_status != 'age16_17' || guardian consented+verified (IL doc if jurisdiction=IL))
             && facialScanConsent granted (CNS-01 versioned)
             && healthConsent granted if jurisdiction in (WA,NV,CT) (CNS-02)
             && (adult? payment succeeded OR funding_type=debit_prepaid via non-biometric check : guardian funding)
```

Enforce on every scan/image/voice-context route. Add `CNS-01` screen (separate unticked checkbox, exact pack wording, timestamp/version/actor/source), `CNS-02` jurisdictional branching, `CNS-03` optional skippable, `CNS-04` session photo opt-in. Reduce `consents` legacy table or keep as view.

**Checkout/Payment (`server/routes/pay.ts`, Stripe):**

- `POST /api/checkout/create` -> Stripe Checkout with price disclosure exact copy (pack), metadata `userId`, `DOB` non-retained for under-16.
- `POST /api/webhooks/stripe` (verified signature, idempotent `event.id` log) -> set `subscriptions.status`, emit `consent_events` if needed, send confirmation email (required per `docs/SRS:61`). Trial: adult `PAY-01`, teen+Guardian `GDN-01` flow.

**Guardian lifecycle (`server/routes/guardian.ts`, cron):**

- Invite -> email with 72h link -> verification -> Illinois doc provider (vendor, e.g., Persona/Onfido — procurement) -> consent screen -> `canScan true`. Sweepers: `every hour` expire invites, `14d` delete under-16 and locked-minor records. Add `turned-18` re-consent job + email.

**Tests:** For every state (`under16`, `age16_17_no_guardian`, `age16_17_guardian_pending`, `age16_17_granted`, `adult_unpaid`, `adult_paid`, `IL_no_doc`, `CNS-01_withdrawn`, `CNS-02_missing`) — negative `POST /api/scans` `403` and positive after fixing, plus direct `curl` bypass from audit `docs/SRS:41` must now `403`. Add `test/age-gate.test.ts`, `test/guardian.test.ts`, `test/consent-matrix.test.ts`.

**Sign-off:** Founder/counsel approve every wording `wording_version_id`, jurisdiction rules, Guardian relationship declarations, turned-18 UX; procurement/security approve age/ID vendors + Stripe config `docs/SRS:205`.

---

## 3. Phase 2 — retention, deletion, user rights, cookies (3-5 weeks)

**Retention split (fixes `RET-01..04`):**

- Raw capture (session): never persisted beyond analysis, or if must buffer server-side for Perfect Corp, store in `blobs` with `ttl = now+24h` and sweep `every 10m`. Abandoned session -> delete + audit.
- `landmarks_json`: delete synchronously when `analysis` completes (`RET-02`), never store with `skin_scans` history. Audit deletion.
- `skin_scans` metrics/regions: persist (product DB), but `image_ref` only if `CNS-04` granted and `ELOHIM_BLOB_KEY` valid; `thumb_ref` optional; `observations` derived.
- Never-persisted hologram: keep `ARCHITECTURE.md:287` but instrument `src/holograms/*` disposal on session end and assert no blob/field via test.
- Add `deletion_audit (id, user_id, target_type, target_id, reason, performed_at, processor, retry_count)` — non-biometric, not deleted with user; retain `consent_events` per consent duration +5y (not cascade-deleted with user).

**User rights (`server/routes/api.ts`, `src/profile/*`):**

- `CNS-01` withdrawal: explain feature lock (no further scans) + offer “delete past scans/photos?” (separate). Implement `POST /api/consents/withdraw`.
- Progress-photo delete/withdraw `DELETE /api/scans/:id/photo` + bulk.
- Export `GET /api/me/export` (JSON + photo bundle, processor attested).
- Account deletion status: `202` + background propagation with retry/dead-letter (current `DELETE /api/me/data` is immediate shred-or-log-continue `docs/SRS:89` — add job queue).
- Policy history, marketing/cookie preferences in Settings.

**Cookies/CMP (`CK-01` `COMPLIANCE_AUDIT.md:9`):**

- Inventory `index.html` `https://fonts.googleapis.com` + any analytics (none now `docs/SRS:96`). Classify essential vs non-essential with counsel.
- CMP: equally prominent `Accept/Reject/Manage`, preference model `cookie_preferences`, gate `Google Fonts` + future analytics until choice. Block requests pre-choice. Test per `COMPLIANCE_AUDIT.md:49` regional/consent-state verification.

**Logs/transcripts:** 12-month rolling deletion for `messages`, log rotation `server/lib/log.ts:13-22` (currently app-enforced none), 12-month app + infra retention proof.

**Sign-off:** counsel decides legal holds, consent-record survival, exact withdrawal copy, cookie classification, export scope `docs/SRS:212`.

---

## 4. Phase 3 — metric validation & safety (4-8 weeks protocol/tooling; study duration extra)

- Obtain missing metrics PDF `docs/SRS:159` + make traceability matrix code<->spec<->UI label<->validation dataset.
- Harness `scripts/repeatability.mjs` extension, per `docs/SRS:165` protocol: **120 adults, Monk 1-10 (12/tone)**, 4 devices, 5 lighting conditions (lux/CRI/K per `docs/SRS:165`), 3 repeats + 7-day repeat, jig-fixed distance. Pass: `ICC(2,1) >=0.80`, median range <= noise floor (floor per metric `docs/SRS 172-182 table`: hydration 4, oiliness 5, redness 4, texture 4, pores 5, darkSpots 8, evenness 4, underEye 5, breakout 4), bias <=1 floor.
- Reword per table (hydration->“visible surface smoothness”, etc.), gate unsupported metrics as experimental until subgroup pass.
- Expand `server/ai/persona.ts:86` safety + `src/skin-analysis/observations.ts` tests for diagnosis/treatment/triage/reassurance.

**Sign-off:** Founder/counsel approve rewording, privacy/ethics + independent reviewer approve claims `docs/SRS:222`.

---

## 5. Phase 4 — security, providers, production verification (2-4 weeks + external lead time)

**Security:**

- Threat model, least-privilege, admin MFA/audit, `ELOHIM_BLOB_KEY` rotation (dual-key decrypt), `ELOHIM_ADMIN_TOKEN` scoped, `.env` not in repo `docs/CONTRIBUTING.md:62`, demo archive sanitized history.
- At-rest DB attestation (Neon encryption), production TLS test, CSP report `-Report-Only` then enforce (`vercel.json:26`, `netlify.toml:46` `wasm-unsafe-eval` + `fonts.googleapis.com` already, add `connect-src` for Anthropic/Perfect Corp/ElevenLabs/Stripe only), `X-Content-Type-Options` etc already `vercel.json:19`.
- Shared rate limit: replace `server/lib/rate-limit.ts:26` `Map` with Postgres table `_rate_limits(key, count, reset_at)` + `trust proxy` `X-Forwarded-For` first IP; same interface. Keep per-IP/per-email `loginLimiter:10/15m` `server/lib/rate-limit.ts:85`.
- Dependency review `npm audit`, Svelte/Vite pinned, SBOM, pen test, signed launch checklist `docs/SRS:225`.

**Provider evidence:**

- Retain Anthropic/voice/age/Guardian/hosting DPAs, export provider settings proving `zero-retention`/`no training` (AI-02), hosting DPA/retention.

**Full gated journey on named browsers:** Desktop (Chrome/Edge/Safari/Firefox latest + n-1) + Mobile (iOS Safari, Android Chrome) with real `getUserMedia` allow/deny/revoke, slow/offline, a11y, responsive, payment sandbox, provider failure, cleanup clocks. Capture screenshots, HARs, server audit `consent_events` + `deletion_audit`.

**Domain:** confirm `meetevia.com` publish consistently, scan repo/built asset/runtime for `evia.com` leak (`docs/SRS:109`).

**Infrastructure:**

- Neon: keep `DATABASE_URL` direct (not `-pooler`) `RUNBOOK.md:50` because `migrate()` `pg_advisory_lock` session. Document; never put prod URL in local `.env` `RUNBOOK.md:55`.
- Functions: keep `server/db/index.ts:42` `migrationsDir` fallback + `included_files` `netlify.toml:23` / `includeFiles` `vercel.json:8`, bundle via `scripts/build-api.mjs` for Vercel (`api/index.js`).
- Env: `DEMO_MODE=0` explicitly on prod, `ANTHROPIC_API_KEY`, `ELOHIM_BLOB_KEY`, `ELOHIM_VOICE_*`, `ELOHIM_ADMIN_TOKEN`, `STRIPE_*`, `PERFECTCORP_*` (if B), `ELOHIM_STORE_URL` as plain (Free plan secret write silently dropped `RUNBOOK.md:32`).
- Backups: Neon PITR + daily `pg_dump` to isolated bucket, tested restore drill.

**Launch decision:** only when every P0 row has end-to-end production-like passing artifact `docs/SRS:231`.

---

## 6. Operational checklist (post-Phase 4)

- `GET /api/health` shows `ok:true`, `demoMode:false`, `imageStorage:true`, `clonedVoice:true`, `budget` spend vs caps `server/app.ts:41`.
- `GET /api/public/catalogue/status` serves seeded or synced real products.
- On-call runbook `RUNBOOK.md:270` + incident response exercise.
- Log redaction `server/lib/log.ts` never `ELOHIM_LOG_LEVEL=debug` in prod.
- Deploy via Netlify MCP proxy source-only zip <3MB `RUNBOOK.md:167` or CLI `NETLIFY_AUTH_TOKEN` `RUNBOOK.md:188`.

---

## 7. Timeline & ownership (proposal)

- **Phase 0** 2-4d Eng | Sign-off Founder/counsel on temporary notice wording.
- **Phase 1** 3-5w Eng + counsel/vendor | Owner Counsel/Founder (wording), Eng (gates), Proc/Sec (Stripe/age vendors).
- **Phase 2** 3-5w Eng | Owner Counsel (retention/rewording), Sec/Ops (backup/processor).
- **Phase 3** 4-8w protocol + study | Owner Science/independent reviewer + Privacy/ethics.
- **Phase 4** 2-4w + pen test lead time | Owner Sec/Ops + Eng.

Total **12-22w** eng elapsed excl. vendor/counsel queue. Demo (this repo) is 1-2 days to investor-ready per `demo.md`.

---

_Evidence: `docs/SRS_V2_COMPLIANCE_AUDIT.md` full matrix, `ARCHITECTURE.md` layering/perf, `RUNBOOK.md` live Neon/Vercel/voice, `CONTRIBUTING.md` prohibitions, debugger PGlite triage, `server/lib/rate-limit.ts:26` in-memory admitted. Build 2026-09-24 clean._
