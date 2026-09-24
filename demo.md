# Demo Readiness Plan — Investor Functional Demo (NOT Production)

> Goal: a laptop / single-URL demo that an investor can click through end-to-end and believe the product can work. Functional, honest, no faking. Production compliance is explicitly out of scope here; deployment.md covers it.

> **Legal source for this demo build:** See `docs/LEGAL_IMPLEMENTATION_GUIDE.md` (distilled from `Manager/` — Adams final legal pack + SRS v2.0, effective 1 Oct 2026), `LEGAL_PROMISE_TRACKER.md` (Section 0 — 17 pledges with Enforced / Not yet enforced status), and `docs/DEMO_BUILD_PLAN.md` (agent-executable Sections 0-5). `Manager/` is git-ignored and holds the original `.docx` / `.zip` — never committed.

**Implementation checkpoint (2026-09-24):** Sections 1–5 of `docs/DEMO_BUILD_PLAN.md` are implemented and validated for the sample-data demo: TypeScript passed, Svelte 0 errors/0 warnings, 36 test files / 323 tests passed. Reports: `docs/SECTION_1_REPORT.md` through `docs/SECTION_5_REPORT.md`. The original inventory below is historical; the section reports and `LEGAL_PROMISE_TRACKER.md` describe current behavior and unresolved production gaps. Demo consent review is not legal approval. Metric labels and the Anthropic image capability remain unchanged pending manager decisions.

**Original baseline:** `npm run typecheck` 0, `svelte-check` 0, `vite build` 15–32s; the original test timeout issues were subsequently corrected.

---

## 1. Demo definition of done

An investor can, on a fresh clone or live URL, without reading docs:

1. `npm ci && npm run dev` -> open `http://127.0.0.1:5195` -> see lounge, no setup.
2. Click Sign up -> use sample email/password, DOB and the separate Terms review choice. Under-16 is blocked without storage; 16/17 opens a temporary guardian review rather than an ordinary account. Adult sample registration requires `EVIA_SAMPLE_DEMO=1`; real age verification and payments remain unavailable.
3. Chat with Elohim (real Claude if key, otherwise labelled `Demo Elohim` `server/ai/fallback.ts:11` — badge stays).
4. Trigger scan -> grant camera -> see quality gate, canonical framing `ARCHITECTURE.md:134`, 9 metric holograms, explanation from Elohim.
5. See history / progress deltas (`LongitudinalEngine`) holding-steady vs movement with noise floors.
6. Scan a product label (Tesseract default, photo never uploaded) or type product -> see routine review with family stacking `src/products/inci.ts`.
7. Toggle voice, hear reply (ElevenLabs if key, else browser voice `src/lib/sound.ts`).
8. `DELETE /api/me/data` works (hard delete).

If any of those requires a key/file that isn’t present, the UI states it plainly (`/api/health` honest) — per `README.md:66` / `ARCHITECTURE.md:392`.

---

## 2. What’s real vs what will mislead an investor today

| Area                                              | Current                                                                                                                                                                                                                                   | Investor risk                                                                                                                           | Demo action                                                                                                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Skin metrics** `src/skin-analysis/metrics.ts:1` | Deterministic Canvas2D appearance signals (hydration=high-freq roughness, oiliness=specular, etc.), hand-coded calibrations `metrics.ts:33-52`. Not clinically validated, not sebum/water content. `CONTRIBUTING.md:66` says provisional. | Looks like validated dermatology if we don’t label it. Audit `docs/SRS_V2_COMPLIANCE_AUDIT.md:173-183` flags `High risk` rename needed. | Keep pipeline for demo but **relabel** UI: “visible surface smoothness (capture-based)” etc., drop `Skin health` composite `docs/SRS_V2_COMPLIANCE_AUDIT.md:183` and `MED-01` breakout language. Disclose calibration + noise floor. |
| **ROI** `src/skin-analysis/roi.ts:181-221`        | `SkinToneRegionProvider` default (YCbCr + ellipse), `MediapipeLandmarkProvider` stub throws when model missing. `pipeline.ts:87-95` falls back permanently.                                                                               | Fine for demo, but no pose/angle/face-count/obstruction checks.                                                                         | Keep. Add explicit pose/angle warning text, block `photo upload` `ScanCapture` for “live camera only V1” if you want to claim compliance later.                                                                                      |
| **Conversation** `server/ai/persona.ts:12`        | `PERSONA` frozen prefix + `claude-sonnet-5` with `ANTHROPIC_API_KEY`, else `Demo Elohim` local rules. Legit.                                                                                                                              | Demo without key still chats but is rule-based — must stay badged `demo:true`.                                                          | Keep. Ensure `.env.example:8` `ANTHROPIC_API_KEY` set for demo laptop, or show badge.                                                                                                                                                |
| **Product shelf** `server/catalogue/`             | Empty unless `ELOHIM_STORE_URL`+ sync or JSON import `RUNBOOK.md:193`. Knowledge base `server/skin/ingredient-data.ts` family logic is real.                                                                                              | Investor sees no recommendations if shelf empty.                                                                                        | **Seed 12-20 real products** (`catalogue.json` via `POST /api/admin/catalogue/import`) with INCI lists, or set `ELOHIM_STORE_URL` to a Shopify demo shop before demo.                                                                |
| **Voice** `server/voice/tts.ts`                   | ElevenLabs when `ELOHIM_VOICE_API_KEY`+`ELOHIM_VOICE_ID`, else browser synthesis. Cached per-char. Honest `503` when unavailable.                                                                                                         | Without keys, robotic voice breaks character promise.                                                                                   | Set both keys for demo (`RUNBOOK.md:60` id `0UFPkz6r4cUaHBRHtegr`). Bundle 13 fixed lines `public/voice/` already ship.                                                                                                              |
| **Image storage** `server/lib/crypto.ts:60`       | AES-256-GCM behind `ELOHIM_BLOB_KEY` (64 hex), otherwise refused.                                                                                                                                                                         | Without key, before/after wipe has no persistence.                                                                                      | Generate key `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and set for demo; keep `data/pglite/` for Postgres demo.                                                                                     |
| **Demo fixtures** `server/demo/seed.ts:18,24`     | `demo@elohim.local / demo1234` + 6 scans/10 weeks, 2 products. `DEMO_MODE=1` local only `server/lib/env.ts:39`.                                                                                                                           | Convincing, but leaked into Neon prod 2026-09-05 `RUNBOOK.md:102`, password published.                                                  | Keep for demo, but enforce `DEMO_MODE=0` explicitly on any deployed demo URL; rotate demo password if that URL is public.                                                                                                            |

---

## 3. Minimal demo fixes (P0 — must, P1 — should)

### P0 — demo breaks without this (1-2 days)

1. **Test harness flake** `vite.config.ts:17` / `test/consent-migration.test.ts:9,13` / `test/consents.test.ts:26`
   - Symptom: `npm test` 2-3/28 fail at `20s` (29-38s concurrent vs 6s isolated). CI `ci.yml:38` uses `test:local` (correct) but local `npm test` flakes for investor clone.
   - Fix: `vite.config.ts` add `test:{ testTimeout:30000, hookTimeout:30000, pool:'forks', poolOptions:{forks:{singleFork:true}}}` and bump the two PGlite suites to `30_000` (geometry already `30_000`). Verified: isolated 5-10s, concurrent now <30s. Debugger report §1.
   - Evidence: `npx vitest run test/consent-migration.test.ts` 5.0s pass vs full `45s` 2-fail.

2. **Offline prebuild** `scripts/sync-mediapipe.mjs:118,138`
   - Symptom: fresh clone offline `npm run build` fails fetching `face_landmarker.task`/`pose_landmarker_lite.task`.
   - Fix: make fetch best-effort warn (try/catch + `console.warn` skip) if `public/models/*.task` missing; commit cached `3.6 MB + 5.5 MB` or document `npm run sync:mediapipe` requires network. Keep WASM copy from `node_modules` always succeeds.

3. **Seeded shelf for recommendations**
   - Symptom: `GET /api/public/catalogue/status` empty -> “no recommendations”.
   - Fix: check in `catalogue.json` (12-20 products, diverse families `activeFamilies` vs `coveredFamilies` `server/skin/ingredient-data.ts`) and auto-import in `DEMO_MODE` if table empty; or run one `curl -X POST /api/admin/catalogue/sync -H "X-Admin-Token: $ADMIN"` before demo.

4. **Demo bootstrap UX** `server/lib/env.ts:39` / `README.md:42` / `data/pglite/`
   - Symptom: first `node scripts/dev.mjs` fails `ENOENT data/pglite` (audit `docs/SRS_V2_COMPLIANCE_AUDIT.md:18`).
   - Fix: `scripts/dev.mjs` ensure `mkdir -p data/pglite` before `PGLiteSocketServer` (one line). Document `Node 24` pin (`netlify.toml:16`, `ci.yml:29`).

5. **Metric relabel + composite removal**
   - Symptom: `ScanPage` “Skin health” average + “Breakout signs” `acneIndicators` reads as diagnosis (`MED-01`).
   - Fix: rename per `docs/SRS 172-182` (Hydration->“visible surface smoothness”, Oiliness->“visible shine”, etc.), suppress composite, keep per-metric “holding steady” noise-floor logic. One file: `src/skin-analysis/metrics.ts` labels + `src/holograms/*` titles. Disclose “appearance estimates, not diagnoses” persistently (not just on results).

### P1 — investor polish (2-4 days)

6. **Perf budget proof** `ARCHITECTURE.md:298` `__elohim.inspect()` 19/33 draw calls, 1.5-3k tris, `quality_tier` probe. Run `node scripts/shoot.mjs` capture and keep 3 PNGs in `shots/` for deck.
7. **Voice line coherence** `RUNBOOK.md:63` `public/voice/manifest.json 13/13` shipped with default ElevenLabs; on-demand uses steadier settings `server/voice/tts.ts`. Regen with `--force` so timbre matches.
8. **Empty-state copy** when `ANTHROPIC_API_KEY`/`ELOHIM_BLOB_KEY`/`ELOHIM_VOICE_*` unset, ensure lounge/You page states `modelAvailable:false` / `imageStorage:false` honestly (`server/app.ts:41` health).
9. **Camera fallback story**: if investor device denies camera, show `demo@elohim.local` seeded history path so demo never stalls.
10. **Spend caps** `server/app.ts:52` `todaySummary()` -> show on health so “2000 turns/day” is visible, not a surprise bill.

---

## 4. Perfect Corp AI Skin Analysis — demo integration plan

> Research note: Perfect Corp (YouCam) offers **AI Skin Analysis SDK/API** covering ~15-20 concerns (wrinkles, spots, pores, redness, oil, hydration proxy, etc.), available as mobile SDK, Web SDK, and server API. Pricing is commercial license + per-call/MAU. Integration is **not** a drop-in: it’s a regulated biometric data transfer to a third party. Use as **augmentation**, not wholesale replacement, for demo.

**Options ranked for demo:**

| Option                                                             | What changes                                                                                                                                                                                                                                                                         | Investor impact                                                                                                                                           | Effort                     | Risk                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| **A — Keep current pipeline, label honestly (recommend for demo)** | No code, just relabel `metrics.ts`, keep fallback `SkinToneRegionProvider`. Mention Perfect Corp as “evaluation in progress, gated behind consent”.                                                                                                                                  | Honest, offline, no vendor key, no new consent. Audit `docs/SRS 164` says deterministic signals must be described as appearance signals — this satisfies. | 0.5 day                    | Low                                                                      |
| **B — Server-side Perfect Corp behind `cloud_reasoning` consent**  | New `server/ai/perfectcorp.ts`, `ELOHIM_PERFECTCORP_API_KEY`, `CSP connect-src` allowlist `netlify.toml:46`/`vercel.json:26`, fallback to local metrics on failure, bump `modelVersion`, update `SKIN_MODEL_VERSION`. Client still sends canvas crop (not raw 512px) to server only. | Credible “powered by Perfect Corp” line, investor sees third-party validation path. Adds cost/latency + DPA.                                              | 5-8 days + procurement/DPA | Medium (GDPR biometric transfer, needs explicit consent wording version) |
| **C — Client-side Web SDK**                                        | `src/skin-analysis/perfectcorp-provider.ts` implementing `ROIProvider`/`MetricsProvider` interface, WASM download, 100% in-browser (no upload).                                                                                                                                      | Lowest latency, strongest privacy story, but SDK bundle + license key exposure.                                                                           | 4-6 days                   | Medium (license key in bundle)                                           |

**Demo recommendation:** Ship **A** now; have **B** on a branch with feature flag `ELOHIM_PERFECTCORP_ENABLED=1` and consent gate `cloud_reasoning`. For B: map current 9 keys to Perfect Corp taxonomy (1:1 where possible, flag mismatches), keep longitudinal noise-floor logic, never persist raw face JPEG beyond `blobs` TTL (see deployment). Cost: negotiate trial key, 1000 calls for investor week; latency +400-900ms server call.

**If you pitch “validated by Perfect Corp” without B/C, that is false.** `metrics.ts:1-16` header is correct: no model, no randomness — disclose.

---

## 5. Demo runbook (copy/paste)

```bash
git clone https://github.com/Evia-LLC/Evia.git && cd Evia
nvm use 24 || node -v  # need 24+
npm ci --ignore-scripts --no-audit --no-fund
# optional: set demo keys (else Demo Elohim + browser voice)
cp .env.example .env  # fill ANTHROPIC_API_KEY, ELOHIM_BLOB_KEY (64 hex), ELOHIM_VOICE_API_KEY/ID, ELOHIM_ADMIN_TOKEN
npm run typecheck && npm run check && npm run test:local   # 256 tests, ~10s per PGlite suite at 30s timeout
npm run dev  # -> http://127.0.0.1:5195  API 5196  PGlite data/pglite/
# login demo@elohim.local / demo1234 to show 6-scan history without camera
# or: create new account -> chat -> scan -> history -> product label -> voice
```

Deploy to Netlify/Vercel for sharable URL: set `DATABASE_URL` (Neon direct host, not `-pooler` `RUNBOOK.md:50`), `ELOHIM_BLOB_KEY`, `ANTHROPIC_API_KEY`, `ELOHIM_VOICE_*`, `DEMO_MODE=0`, redeploy. `GET /api/health` must show `demoMode:false`.

---

## 6. What NOT to fix for demo (defer to deployment.md)

- Full production SRS v2.0 enforcement remains deferred. The explicitly authorized Sections 1–5 add DOB routing, guardian/age/payment previews, consent screens, cookie preferences and owner controls for sample data. They do not implement the full verified guardian, retention, payment or consent-enforcement lifecycle; keep production blockers in `LEGAL_PROMISE_TRACKER.md` open.
- 120-person Monk 1-10 repeatability study `docs/SRS 166`, transcript 12-month deletion, processor propagation — production scope.
- Shared rate-limit store, backup rotation, pen test — production scope.

---

## 7. Risks & disclosures for investor

- Metrics are **not** corneometer/sebumeter, not diagnoses, not causal product efficacy (`CONTRIBUTING.md:66`, `metrics.ts:10`). Product correlation = correlation (`ARCHITECTURE.md:189`).
- Face image to Anthropic (`cloud_reasoning`) and to Perfect Corp if B/C is enabled are biometric transfers — require explicit consent + DPA (see deployment).
- `demo1234` is published; any public demo URL must have `DEMO_MODE=0` and no real user data.
- One wry aside per reply, no emoji unless `genz` style `server/ai/persona.ts:43` — character promise holds.

---

_Evidence pooled from: `debugger` PGlite flake triage, `docs/SRS_V2_COMPLIANCE_AUDIT.md` P0 matrix, `ARCHITECTURE.md` layering/perf, `RUNBOOK.md` live Neon, `CONTRIBUTING.md` limitations. Build evidence 2026-09-24: `vite build` 32.05s, `svelte-check` 0, `tsc` 0, `vitest` full 103s (3 flakes) vs isolated 11s pass._
