# Section 1 pause report — Perfect Corp

Section 1 implementation is ready for review on `demo`; live-provider verification remains pending. Sections 2–5 have not started.

## Built

- `server/ai/perfectcorp.ts`: server-only file registration → signed upload → one task submission → bounded polling → nine-score mapping. Uses the requested `/s2s/v2.0/file/skin-analysis` and `/s2s/v2.0/task/skin-analysis` endpoints. No automatic task retries; 23-second request deadline fits inside the existing 30-second Vercel function budget.
- `server/routes/analysis.ts`: authenticated proxy and account consent endpoint. Missing, withdrawn or stale consent blocks provider transfer. Sample acceptance requires `EVIA_SAMPLE_DEMO=1`; production approval stays false. Account events retain account ID, server datetime, wording version, choice, actor, source and IP in the existing immutable consent table.
- `src/skin-analysis/provider.ts`: `ANALYSIS_PROVIDER=perfectcorp|local`, default Perfect Corp; missing keys, service errors, credits/rate limits, incomplete results and timeouts leave the complete local reading intact with a visible `using backup analysis` notice. Guests use local analysis.
- `src/pages/ScanPage.svelte`: consent before mounting the camera component; provider result label and mapping limitations. `src/state/controller.ts` prevents narrated and hologram deltas across model versions. Existing server trend and chart filtering already separate versions.
- Raw captures remain in transient memory; the proxy writes no image/blob, file identifier, signed URL, landmark, mask or vendor response to the database. The mutable request buffer is cleared after success/failure. Scan storage retains scores and model provenance.
- CSP allowlist added to Netlify and Vercel. Metric labels and `server/ai/claude.ts` are unchanged. `Manager/` remains ignored.

## Verbatim confirmation

`test/facial-consent-copy.test.ts` compares all 13 quoted strings in the guide’s Facial Scan Consent section against the displayed copy and wording manifest, without normalization.

- `shared/legal-content.ts:66`: **Before your first scan**.
- `shared/legal-content.ts:68`: complete introductory paragraph and all five body bullets, including **Your facial photographs are not sent to our conversational AI providers.** and the complete session/24-hour retention sentence.
- `shared/legal-content.ts:129`: **I have read the Biometric Data Policy and I give Evia my consent to capture and process my facial images and facial landmark data for skin analysis as described.**
- `shared/legal-content.ts:130`: complete guardian checkbox, unchanged from the guide.
- `shared/legal-content.ts:75`: **Agree and continue** / **Not now**.
- `shared/legal-content.ts:131`: **You can withdraw this consent at any time in Settings, and we will delete the related data.**
- `src/components/legal/FacialScanConsent.svelte:28`: separate checkbox, initially unticked; equally styled agree/refuse actions and exact policy link labels. The guardian variant is explicitly a disabled preview, with no simulated approval.

Copy stays `placeholder` with no effective date. Extra demo disclosures are separate from the verbatim legal wording.

## Deviations and remaining issues

1. No `PERFECTCORP_API_KEY` was available. Tests use synthetic score fixtures and mocked vendor transport, spending zero trial units. No successful live vendor scan or manual browser/camera verification is claimed.
2. The local canonical crop is 288×384, below the vendor’s documented minimum SD dimensions. The provider receives a separate frozen selfie canvas, resized to at most 1280 pixels on its long side, only when its short side is at least 480. The local canonical crop and local formulas remain unchanged. This differs from `demo.md`’s canonical-crop suggestion.
3. Nine SD concerns are requested from the larger vendor taxonomy, avoiding unnecessary paid outputs. Raw scores are used, reversing direction for EVIA metrics where lower is better. Radiance is a disclosed proxy for Tone evenness; Under-eye maps to dark circles only. These mappings and the existing noise floors are not clinically validated.
4. The requested stored tag `perfectcorp-v2.1` identifies this EVIA adapter; the requested HTTP transport is v2.0 SD. It does not claim that v2.1 provider engines were used.
5. Provider raw-image deletion after session/within 24 hours, deletion instructions/audits, DPA terms and possible internally derived skin age remain unverified. No provider deletion guarantee is claimed. Operator must restrict live verification to permitted sample data and pace trial calls; no distributed credit budget exists.
6. Full Biometric and Consumer Health policy publication is pending; link targets honestly show incomplete previews. The existing Privacy Policy page is still a placeholder. Account withdrawal/deletion controls, age/guardian verification and global scan API enforcement remain later-section/pre-production work. Guest choices are tab-memory evidence with a guest identifier, not durable account consent.
7. Added `EVIA_SAMPLE_DEMO=1` as an explicit sample-only consent exception, independent of `DEMO_MODE` fixture seeding. Without it, authenticated draft acceptance fails clearly; missing env never produces a startup crash. Stripe/age services remain scheduled for Sections 4/3.
8. Applied the plan’s PGlite test stability fix with Vitest 4’s supported `maxWorkers:1` / `fileParallelism:false`, plus 30-second timeouts. The plan’s older `poolOptions.singleFork` spelling is no longer appropriate to the installed runner.
9. Re-audit corrected P-01: `describeSkinImage` still contains an Anthropic image payload, but no current caller was found. Its source remains unchanged and the manager decision remains open.

Vendor sources used to verify the contract: [official integration guide and score definitions](https://docs.perfectcorp.com/reference/ai_skin_analysis/section/overview), [v2.0 API reference](https://docs.perfectcorp.com/reference/ai_skin_analysis/v2.0). The current overview illustrates the generic file endpoint; this implementation retains the skin-analysis-specific endpoint explicitly required by the build plan, pending live compatibility verification.

## Validation

Final required sequence completed successfully: `npm run typecheck && npm run check && npm run test:local`.

- TypeScript: exit 0.
- Svelte: 0 errors, 0 warnings; exit 0.
- Local tests: **31 files passed; 283 tests passed; 0 failed, 0 skipped**. Vitest duration 151.52 seconds; disposable database stopped and discarded.
- `git diff --check`: clean.
- New coverage: complete fixture upload/task/poll/mapping, missing-key and local flags, credits/rate errors, network errors, unsafe upload URLs, bounded polling, invalid results, authentication/consent rejection, account decision metadata, buffer cleanup, cross-version trends, guest local fallback, and all 13 verbatim legal strings.

The initial sandbox run could not bind the disposable test database on `127.0.0.1:5434` (`EPERM`). Local listener permission resolved that. The first full suite exposed one polling-test fixture error (reusing a consumed Response body); returning a fresh response per poll fixed it. The final full sequence above passed. No trial API calls were made.

## Tracker snapshot diff

| Pledge | Before | After / reason | Owner |
| --- | --- | --- | --- |
| P-01 | Direct conflict; claimed active orchestrator call | Manager decision pending; retained image helper, no current caller found | Engineering + legal + manager |
| P-02 | Partial; progress photos incorrectly treated as 24h raw captures | Partial; transient proxy memory, provider deletion unverified; optional-photo retention corrected to guide | Engineering |
| P-03 | Not enforced | Partial; consent before camera mount, age/guardian enforcement pending | Engineering |
| P-04 | Placeholder screen, no gate | Partial; verbatim screen, account event + proxy gate; global enforcement, policy publication and guest logging gaps explicit | Engineering + legal |
| P-14 | Partial legacy consent support | Partial; facial version/account events added; guest evidence memory-only | Engineering |
| P-15 | Partial retention | Partial; no new persistent provider images; body retention and provider destruction audits pending | Engineering |
| P-16 | Not built | Partial; proxy/fallback/CSP/credential isolation implemented; fixture transport verified; live scan, DPA/deletion, age-output behavior and calibration pending | Manager + engineering + legal |
| P-17 | Existing no-env guard pattern | Section 1 guarded; Sections 3/4 stub/service work pending | Engineering |

P-05 through P-13 remain at their existing stages. No new pledge IDs. `LEGAL_PROMISE_TRACKER.md` contains the full updated reasons, recommendations and ownership.

## Demo setup

Use an isolated sample-data account and set `EVIA_SAMPLE_DEMO=1`. Keep `DEMO_MODE=0` on publicly deployed URLs as required by the demo runbook. Leave `PERFECTCORP_API_KEY` absent to exercise visible local backup; set `ANALYSIS_PROVIDER=local` for intentional local selection. To verify the vendor path, set the server-only trial key and `ANALYSIS_PROVIDER=perfectcorp`, accept the facial screen, and use a permitted sample image meeting SD dimensions. Expect nine readings labelled Perfect Corp and stored under the adapter version. Limit final live verification to the available trial budget.

Paused before Section 2, per the requested section approval checkpoint.
