# EVIA Demo Build Plan — Agent-Executable (via Legal Promise Tracker + Implementation Guide)

> **Goal:** Any agent can take this file + `LEGAL_PROMISE_TRACKER.md` + `docs/LEGAL_IMPLEMENTATION_GUIDE.md` and build Sections 0-5 for the **pre-launch demo (no real users, sample data only)** without silent gaps. Every temporarily unenforced pledge is logged as a pre-prod blocker.
> **Sources:** `Manager/Adams final document .zip` (8 docs, effective 1 Oct 2026 V1.01) + `Manager/Evia product requirement 2.docx` (SRS v2.0 P0 table + state machine). `Manager/` is git-ignored — see `docs/LEGAL_IMPLEMENTATION_GUIDE.md:1`.
> **Authority:** Where SRS/repo conflicts with legal pack, legal pack controls until counsel revises.

---

## 0. How to use this plan

1. Read `LEGAL_PROMISE_TRACKER.md` (17 rows P-01..P-17, Enforced / Partially / Not yet, must enforce vs flag to manager).
2. Read `docs/LEGAL_IMPLEMENTATION_GUIDE.md` (§1-10 verbatim screens, retention table, mindset).
3. Read `demo.md` (§1 definition of done, §2 what's real vs misleading, §4 Perfect Corp options A/B/C, §5 runbook) — this is the investor demo contract; legal pack + demo plan must stay consistent with it.
4. Work Sections 0→5 **in order**, pause + report after each (what built, verbatim confirmation, deviation, test result, tracker snapshot). Do not skip logging.
5. Run `npm run typecheck && npm run check && npm run test:local` after each section (expected `typecheck 0`, `svelte-check 0`, `vitest 235/256 pass` with 3 PGlite 20s flakes → 30s fix per `demo.md:40`).
6. Never require Stripe / real age provider / crash on missing env; never rename metric labels; never modify Anthropic image path beyond logging P-01.

**Global constraints (from pack Rules):** Every consent = separate unticked control, no bundling, before processing, refusal as easy as agreement, log account ID + datetime + wordingVersionId + choice. Text in `[]` = merge field.

---

## 1. Stack & file map (what agents will touch)

| Area       | Code                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal copy | `shared/legal-content.ts` (wordingVersionIds), `shared/consent-keys.ts`, `src/components/legal/*`, `src/pages/legal/*`                             |
| Scan       | `src/scan/ScanCapture.svelte`, `src/skin-analysis/pipeline.ts`, `src/state/controller.ts:940 runAnalysis`, `server/routes/api.ts:527 POST /scans`  |
| Consent/DB | `server/db/consents.ts`, `server/db/scans.ts`, `server/db/body-scans.ts`, `server/db/progress-photos.ts`, `shared/types.ts:138 SKIN_MODEL_VERSION` |
| Legal docs | `docs/LEGAL_IMPLEMENTATION_GUIDE.md`, `LEGAL_PROMISE_TRACKER.md`, `CONTRIBUTING.md`, `COMPLIANCE_AUDIT.md`, `docs/SRS_V2_COMPLIANCE_AUDIT.md`      |

---

## 2. Section 0 — Promise Tracker (DONE, verify)

- **Already created:** `LEGAL_PROMISE_TRACKER.md:1` with P-01 (Anthropic direct conflict) .. P-17 (missing-env guard). Statuses reflect current code: P-01 Not yet (direct conflict), P-02 Partially (metrics-only enforced, progress-photos 24h not), P-03 Not yet (camera technically disabled).
- **Agent check:** `git status` shows `LEGAL_PROMISE_TRACKER.md` + `docs/LEGAL_IMPLEMENTATION_GUIDE.md` present, `Manager/` ignored via `.gitignore:35`. Update tracker after each section below and include snapshot in pause report.

---

## 3. Section 1 — Perfect Corp Integration (primary, build for real)

**What demo CAN do:** Full proxy scan, fallback to local, consent-gated demo proceed.

- **Route:** `camera → canvas → server proxy → Perfect Corp /s2s/v2.0/file/skin-analysis → /s2s/v2.0/task/skin-analysis → poll → map response` (`demo.md:75` options B, server-side).
- **Keep local pipeline:** Do not delete `MediaPipe landmarks + CIELAB/HSV metrics`. Demote to `ANALYSIS_PROVIDER=perfectcorp|local` flag, default `perfectcorp`, comment `// DEPRECATED-BUT-RETAINED for rollback/outage/credits`.
- **UI contract:** Keep 9-key metrics `shared/types.ts:17 SKIN_METRIC_KEYS` + labels as-is (separate decision). Map PC 15+ concerns onto 9 keys; store `modelVersion: 'perfectcorp-v2.1' | 'elohim-skin-1.0.0'` per `skin_scans` so history never mixes.
- **Credentials:** Server env `PERFECTCORP_API_KEY` only (trial now, prod via env swap). Never bundle client. Add `CSP connect-src https://yce-api-01.makeupar.com` in `netlify.toml:46` + `vercel.json:26`.
- **Consent gate (verbatim §1 Facial Scan Consent):** Heading `Before your first scan`, body bullets (What we collect / use for / who processes `Your facial photographs are not sent to our conversational AI providers` / how long `deleted after session, ≤24h` / what we never do), checkbox (unticked) `I have read the Biometric Data Policy and I give Evia my consent...`, Guardian variant `I am the parent or legal guardian...`, buttons `Agree and continue / Not now`, link row, footer `You can withdraw...`. Demo may log + proceed after acceptance; log gap as P-04 Not yet enforced — must block server-side before prod.
- **Failure handling:** `429/402 insufficient units` / network → fallback to local with visible `using backup analysis` indicator, no crash/silent fail. Pace live calls — trial = ~1-4 full runs (SD 9u / HD 22u for 13-16 concerns) — use mock fixtures for dev, live only for final verification.
- **Verification:** Working scan→result via Perfect Corp, fallback demo, flag both ways, verbatim consent, tracker updated (P-16, P-02 24h for provider temp blobs).

---

## 4. Section 2 — Minor / Parental Consent Flow (verbatim Steps 1-10)

**What demo CAN do:** All UI with verbatim wording; enforcement chain may stay demo-soft (log gap).

- **Build from Consent Pack §5 verbatim:** Step 1 DOB + `Evia is for people aged 16 and over` + block `Sorry, Evia is only available...` (do not store blocked). Step 2 adults 18+ → checkout, Stripe funding type: credit → unlock after §1 consent; debit/prepaid → `One more quick check... This uses your email address, not your face.` → certified email age check (Section 3 stub) → on fail → Step 3. Step 3 locked 16/17 heading `We need a parent or guardian...` + `deleted if not approved within 14 days` + guardian email. Step 4 email subject `Your approval is needed for Evia.` + body `[first name] has asked...` + `Review and approve` + `expires in 72 hours`. Step 5 Guardian verification fields + `I confirm I am the parent or legal guardian...` + credit-card payor (or nominal refunded) + Illinois ID doc check. Step 6 Terms §6 + scan consent Guardian version + `I accept the Terms on my own behalf and on behalf...` + statement `never used for advertising...` + `Approve`. Step 7 log fields `account ID, Guardian name/email, relationship, verification method/result, card type/last4/fingerprint, Illinois result, wording versions, datetime, IP`. Step 8 unlock `Your parent... You can now scan... privacy@helloevia.com`. Step 9 Guardian login controls `view/download/withdraw/delete/manage subscription`. Step 10 turning 18 `You are now 18... accept Terms and scan consent in own name. Camera stays locked until done.`
- **Also verbatim:** Terms §6 checkbox `I have read and agree to the Terms...` and Checkout §7 `You are subscribing to Evia. 20.99 US dollars for the first month, then 40...` + `Subscribe and pay 20.99 US dollars` + EU/UK `I ask Evia to start... lose 14-day right...`.
- **Demo gap:** Camera `technically disabled, not merely hidden` may not be wired to block scanning yet — log P-03/P-05 as Not yet enforced for demo, must enforce before prod. Never fake `guardian approved`.

---

## 5. Section 3 — Age Verification UI (placeholder)

**What demo CAN do:** Swappable stub, structure correct.

- Single function `src/lib/age-verification.ts: verifyAge(userData) => {verified:false, mock:true, reason:'no provider selected'}` commented `// TEMPORARY — pending certified vendor selection`. Never silent `verified:true`.
- Wire into Step 2 debit/prepaid branch so flow shape is correct; tracker row P-06 `mocked — must replace with certified provider before prod, pending manager selection`.

---

## 6. Section 4 — Payment UI (no live Stripe)

**What demo CAN do:** Realistic checkout with verbatim copy, no charge.

- Build Checkout §7 verbatim: disclosure block same visual block as button, price `20.99 → 40 US dollars per month until you cancel. Cancel any time in Settings or through the Stripe customer portal.`, EU/UK unticked required checkbox, button label `Subscribe and pay 20.99 US dollars` (Guardian heading `You are subscribing on behalf of [first name]` where applicable).
- On click: show `Payments launch soon — check back shortly` (no silent success, no raw error). Guard `PaymentService.isEnabled() === false` when `STRIPE_*` absent, never crash. Log tracker P-07 confirmation-email requirement (repeat intro/renewal price/date/cancel method) as Not yet — needs live payment before prod.

---

## 7. Section 5 — Remaining Legal Screens (verbatim, now unblocked)

**What demo CAN do:** All UI correct verbatim; backend may stay stubbed with gap logged.

- Consumer Health Data Consent §2: `Permission to collect your skin and health information` + `I consent to Evia collecting my consumer health data...` footer `We never sell...` (no sharing checkbox at launch).
- Optional Safety/Lifestyle §3: `Optional, and only if it helps...` + `I choose to share...` + `Skip for now`, skippable.
- Progress Photos §4: `Save this photo to track your progress?` + `Save my progress photos...` default OFF.
- AI Disclosure §8: persistent label `You are chatting with Evia, an AI assistant. This is general skincare guidance, not medical advice.` + under every result `Cosmetic observations only. Evia does not diagnose...` + escalation `Evia cannot tell whether this needs medical attention... have it looked at by a healthcare professional.`
- Cookie Banner §9: first layer `We use strictly necessary cookies... We never send your scan images...` + equally prominent `Accept all | Reject all | Manage preferences` → second layer toggles off by default except strictly necessary + provider names/durations + Save. (Previously deferred `COMPLIANCE_AUDIT.md:9 CK-01`.)
- Account Controls §10: withdraw scan consent (explain what stops), progress photo toggle + per-photo delete, download data, delete account + what is retained, marketing prefs, cookie prefs, policy version history with date, under-18 Guardian-access notice + Step 9 controls.
- Every screen logs account ID + timestamp + wordingVersionId + choice per Rules.

---

## 8. Pause report template (after each section)

Include: what built, verbatim confirmation (quote), deviations, issues, `npm run typecheck / check / test:local` result, `LEGAL_PROMISE_TRACKER.md` snapshot diff.

---

## 9. Related files

- Legal source: `Manager/Adams final document .zip` (8 docs) + `Manager/Evia product requirement 2.docx` — git-ignored, see `docs/LEGAL_IMPLEMENTATION_GUIDE.md` for full distilled pledges.
- Tracker: `LEGAL_PROMISE_TRACKER.md` — single source of truth for Enforced/Not yet/Partially.
- Guides: `docs/LEGAL_IMPLEMENTATION_GUIDE.md` (pledges + verbatim screens + mindset), `ARCHITECTURE.md`, `CONTRIBUTING.md`, `COMPLIANCE_AUDIT.md`, `docs/SRS_V2_COMPLIANCE_AUDIT.md`, `demo.md`, `deployment.md`.
