# EVIA SRS v2.0 compliance and functionality audit

**Audit date:** 2026-09-23 (UTC)  
**Repository/branch:** `/workspace/Evia`, `work`  
**Scope:** repository state at the audit commit; SRS v2.0 excerpts supplied in the audit request  
**Evidence standard:** a requirement is not marked Working unless the repository or a rerunnable test proves it. “Not verified” is not a pass.

## Executive summary

This build is **not launch-ready under SRS v2.0 §15**. The largest blocker is that the account and API data model has no DOB, age-verification, Guardian, facial-scan-consent, consumer-health-consent, or subscription state, and the authenticated scan endpoint does not enforce any of those gates. In a fresh local database, a newly registered account with no DOB or consent successfully submitted a fabricated scan and persistent face landmarks to `POST /api/scans` (`HTTP 200`). The product has substantial working prototype functionality—conversation-first lounge, live browser capture, deterministic client-side analysis, real stage progress, temporary rendered panels, dynamic voice paths, and authenticated deletion—but those features do not compensate for the missing P0 legal state machine. There are additional direct conflicts: optional cloud reasoning sends a facial JPEG to Anthropic, landmarks persist indefinitely with scan history, an arbitrary composite is displayed as “Skin health,” and stored progress photos are account-lifetime rather than session-lifetime. The separately referenced skin-metrics PDF was not present anywhere under `/workspace` or `/tmp`; Part 2 therefore audits every metric implemented by the repository, but cannot certify completeness or conformance against an unavailable PDF. The `evia.com`/`@evia.com` search found no occurrences; this does not establish that all required `meetevia.com` wording is published, because no counsel wording pack or product legal-policy pages were supplied.

## Method and reproducible local setup

### Environment and setup

1. Node `v24.15.0` and npm were already installed; dependencies were already present. The documented clean setup is `npm install` followed by `npm run dev`.
2. No environment variables are required locally. With `DATABASE_URL`/`NETLIFY_DATABASE_URL` absent, the launcher uses PGlite at `postgres://postgres:postgres@localhost:5433/postgres`. With `ANTHROPIC_API_KEY` absent, conversation uses the labelled local engine. With `ELOHIM_BLOB_KEY` absent, image persistence is unavailable. `DEMO_MODE` defaults on outside deployment.
3. First launch with `node scripts/dev.mjs` failed because `data/` did not exist and PGlite could not create nested `data/pglite` (`ENOENT`). `mkdir -p data` was required; this undocumented prerequisite is a setup defect. The second launch applied migrations `001`–`010`, seeded `demo@elohim.local / demo1234`, started the API at `127.0.0.1:5196`, and Vite at `127.0.0.1:5195`.
4. `npm run build` could not be completed in the audit environment because prebuild attempted to fetch `storage.googleapis.com` and DNS returned `EAI_AGAIN`. This is an environment-limited result, not a build pass.
5. No production-like database, Stripe account, age provider, Guardian provider, DPA/provider console, mobile device farm, or target-browser list was supplied. Those items remain unverified.

### Commands run

```bash
find .. -name AGENTS.md -print
find /workspace /tmp -maxdepth 4 -type f \( -iname '*.pdf' -o -iname '*srs*' -o -iname '*spec*' \) -print
npm test
npm run check
npm run typecheck
npm run build
node scripts/dev.mjs
mkdir -p data && node scripts/dev.mjs
rg -n -i "evia\.com|@evia\.com|meetevia\.com|@meetevia\.com" . \
  --glob '!node_modules/**' --glob '!dist/**' --glob '!api/index.js' --glob '!docs/SRS_V2_COMPLIANCE_AUDIT.md'
```

Test results: Vitest reported `17 passed | 1 skipped` files and `202 passed | 8 skipped` tests; `svelte-check` reported zero errors/warnings; `tsc --noEmit` passed. None of the existing tests is evidence for the absent age/Guardian/payment/consent state machine.

### Direct gate-bypass reproduction

Run against the local API after setup:

```bash
EMAIL="audit-$(date +%s)@example.test"
REG=$(curl -sS -X POST http://127.0.0.1:5196/api/auth/register \
  -H 'content-type: application/json' \
  --data "{\"email\":\"$EMAIL\",\"password\":\"auditpass123\",\"displayName\":\"Audit\"}")
TOKEN=$(printf '%s' "$REG" | node -pe \
  "JSON.parse(require('fs').readFileSync(0,'utf8')).token")
curl -sS -w '\nHTTP_STATUS=%{http_code}\n' -X POST \
  http://127.0.0.1:5196/api/scans \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  --data '{"analysis":{"capturedAt":"2026-09-23T00:00:00.000Z","metrics":{"hydration":1,"oiliness":1,"redness":1,"texture":1,"pores":1,"darkSpots":1,"evenness":1,"underEye":1,"acneIndicators":1},"regions":{},"quality":{"verdict":"pass","score":1,"brightness":1,"sharpness":1,"faceHeightFraction":1,"centeringError":0,"issues":[]},"confidence":1,"modelVersion":"audit-bypass","landmarks":[0.1,0.2]}}'
```

Observed result: registration returned a user containing only profile/preferences and two false consents (`image_storage`, `cloud_reasoning`). The scan request returned `HTTP_STATUS=200`, persisted the nine caller-supplied values and `landmarks:[0.1,0.2]`, and the subsequent `/api/me` returned `scanCount:1`. Thus AGE, GDN, CNS-01, CNS-02, and payment are not server-enforced. The route verifies only authentication and numeric range; it also trusts client-supplied quality, confidence, capture time, model version, metrics, and regions.

## Part 1 — flow verdicts

| Flow | Verdict | Reproducible evidence | Concrete SRS gaps |
|---|---|---|---|
| Signup | **Broken** | `AuthGate.svelte` register mode collects display name, email, and password only. `POST /api/auth/register` accepts exactly those fields and immediately creates a session. The bypass reproduction above creates and scans with a new account. | No DOB, under-16 rejection/data minimisation, 16–17 branch, adult payment, funding-type branch, age provider, checkout disclosure, confirmation email, or cancellation. AGE-01/02 and PAY-01/02 fail. |
| Intake | **Missing** | Repository search finds only `image_storage` and `cloud_reasoning` consent kinds. The schema records only kind/granted/timestamp, not policy version/choice provenance. No Guardian routes, tables, jobs, screens, or state enum exist. | Entire §3 state machine absent; no facial-scan consent, jurisdictional health consent, optional safety/lifestyle consent, Guardian invitation/expiry/verification/consent, Illinois check, 14-day deletion, or turned-18 re-consent. |
| Lounge | **Partial** | The app mounts an animated stage behind the auth gate; Home/Chat provide the conversational entry. The shared FSM implements IDLE, LISTENING, THINKING and SPEAKING. | Not reachable through compliant intake; no persistent AI/general-guidance/not-medical disclosure was found on the lounge/chat surface. Exact target-browser performance was not measured. |
| Clinic | **Partial** | `ScanPage.svelte`, the clinical director, and hologram rig render a room transition and spatial metric panels. The FSM has `CLINICAL_ANALYSIS`, `ANALYSIS_COMPLETE`, and `EXPLAINING`; displayed regions derive from metric mappings. | State names do not implement separately auditable scan-prep/transition/examining states. The visualization is metric panels/face-mesh presentation rather than evidence of a user-specific 2.5D/3D representation. The UI displays an arbitrary “Skin health” composite. No browser visual run was possible with a real camera in this non-interactive environment. |
| Scanning | **Partial** | `analyseFace` reports progress at actual code boundaries (frame, face, lighting, alignment, normalization, mapping, measurement, interpretation). Quality code measures brightness, Laplacian sharpness, distance and centering/crop. `getUserMedia({video:{facingMode:'user'}})` is used and camera errors are shown. | No face-count check, explicit pose/angle check, or obstruction check. The fallback skin-tone ROI does not prove these. `ScanCapture` offers photo upload, contrary to “live camera only for V1.” Server accepts fabricated metrics/quality and requires none of the legal gates. Client emits a JPEG; API can persist it and persists landmarks, conflicting with RET-01/02. |
| Voice | **Partial** | Browser speech recognition and synthesis paths exist; the cloned voice route synthesizes arbitrary text and returns timing chunks. Mouth/viseme animation follows generated audio/timing. Fixed MP3 lines also ship, but conversational replies use dynamic synthesis. | Cloud voice receives consultation text. Provider-contract/training evidence is absent. The consultation disclosure appears on scan results, but not persistently across the conversation/lounge. Mobile audio behavior is described in the runbook but was not independently reproduced. |
| Desktop | **Unverified / Partial by inspection** | Responsive app code, camera API, canvas analysis, and WebGL are present. Local HTML and API loaded with `curl`; automated type/tests passed. | No target browser/version list or interactive Chrome/Edge/Safari/Firefox camera run was supplied. Camera permission denial is caught and displayed, but actual permission UX, WebGL scene, scan, and full gated journey were not run. Under the requested four-value scale this is **Partial**, not Working. |
| Mobile | **Unverified / Partial by inspection** | Viewport metadata, coarse-pointer rendering limits, `facingMode:'user'`, responsive layouts, and iOS audio handling exist. | No physical iOS/Android device or emulator camera run; no Safari/Chrome versions specified. Runbook statements are historical claims, not audit reproduction. Under the requested scale this is **Partial**, not Working. |

## Part 1 — P0 Working / Partial / Broken / Missing matrix

“Broken” means an implementation exists but fails the acceptance test or directly contradicts it. “Missing” means no implementation was found.

| ID | Verdict | Evidence and acceptance-test result | Gap / risk |
|---|---|---|---|
| AGE-01 | **Missing** | Registration UI/API has no DOB; user schema has no DOB/age state. Direct new-account `POST /api/scans` returned 200. | Under-16 cannot be blocked, 16–17 cannot be scan-locked, and the API gate is bypassable by construction. |
| AGE-02 | **Missing** | No Stripe dependency, route, webhook, payment table, funding-type field, or age-check provider found. | No 18+ credit signal or debit/prepaid alternative check. |
| GDN-01 | **Missing** | No Guardian route/table/UI/state and no relationship or Guardian consent record found. | A 16–17 user cannot enter the required flow; scan API has no approval check. |
| GDN-02 | **Missing** | No state/jurisdiction or Illinois identity-document provider result exists. | Illinois Guardian identity-document requirement cannot pass or be audited. |
| CNS-01 | **Missing** | Existing consent allowlist accepts only `image_storage` and `cloud_reasoning`; scan request succeeds while both are false. | No separate unticked facial-scan consent or account/time/version/choice audit record. Existing `granted_at` is not enough and is overwritten on update. |
| CNS-02 | **Missing** | No location/jurisdiction field and no consumer-health consent kind/screen/log found. | WA/NV/CT flow cannot run or be distinguished. |
| CNS-03 | **Missing** | Profile stores concerns, sensitivities and pregnancy status, but no optional safety/lifestyle consent exists. | Cannot prove that this consent is optional, versioned, or independently skippable. |
| CNS-04 | **Partial** | `image_storage` defaults false and server checks it before storing a submitted photo. Privacy UI exposes a separate toggle. | This is a generic “keep scan photos” switch, not a versioned progress-photo consent. It also permits indefinite storage of every capture rather than a compliant session-only raw image plus separately governed progress photo. |
| RET-01 | **Broken** | With image consent and a blob key, `POST /api/scans` writes the JPEG to the `blobs` table and attaches it to the scan. No TTL, abandoned-session job, 24-hour cleanup, or deletion log was found. | Raw scan/progress-photo semantics are conflated; persisted bytes last until scan/account deletion. |
| RET-02 | **Broken** | `POST /api/scans` stores sanitized landmarks in `skin_scans.landmarks_json`; migration explicitly says they support later comparisons. No cleanup job exists. Bypass reproduced persistence. | Geometry persists with history rather than being deleted when analysis completes. |
| RET-03 | **Partial** | Hologram/metric panels are generated client-side; no artifact/blob/table field for a rendered hologram was found. | Static code supports “not persisted,” but session-end disposal and browser-memory cleanup were not instrumented or measured; no automated acceptance test. |
| RET-04 | **Partial** | `DELETE /api/me/data` immediately shreds known blob refs and cascade-deletes the user; individual scans can also be deleted. | No consent-withdrawal workflow, 30-day scheduled job, processor propagation, deletion audit record, retry/dead-letter behavior, or legal-hold handling. Blob shred failures are logged but deletion continues, leaving possible orphaned bytes. |
| SEC-01 | **Partial** | Production session cookie is HttpOnly/SameSite=Strict/Secure; image blobs are encrypted before database storage; auth and ownership protect image reads; deployment configs contain security headers. | No signed launch checklist, administrator model/MFA/admin audit trail, key rotation, incident-response evidence, at-rest DB attestation, production TLS test, penetration test, or least-privilege evidence. Debug logging intentionally disables redaction. |
| AI-01 | **Broken** | Normal conversation payload is structured text/context, but when a scan includes `imageBase64`, cloud consent is true, and a model key exists, `describeSkinImage` sends `{type:'image',source:{type:'base64',media_type:'image/jpeg',data:imageBase64}}` to Anthropic. | SRS prohibits facial photographs to conversational-AI providers; the actual payload directly conflicts. |
| AI-02 | **Missing** | No checked-in DPA, provider setting export, zero-retention configuration, training opt-out evidence, or contractual prohibition was found. | Cannot verify general-model training is disabled/prohibited. |
| MED-01 | **Broken** | Persona and scan page disclaim diagnosis and deterministic escalation tests exist. However ScanPage labels an average of nine derived scores “Skin health,” presents “Good/Fair/Needs care,” and offers dermatologist-routing language. | “Skin health” is an arbitrary health composite prohibited by §5; “Breakout signs” and metric interpretation need validation/reframing. Direct referral/triage-like wording needs counsel review. Absence-of-message reassurance was not safely established. |
| PAY-01 | **Missing** | No checkout implementation or Stripe dependency; no `$20.99`/`$40` disclosure or confirmation email found. | Acceptance test cannot run. |
| PAY-02 | **Missing** | No subscription state, Settings cancellation, Stripe portal, or cancellation endpoint found. | Acceptance test cannot run. |
| CK-01 | **Missing** | No cookie banner/CMP, cookie preference model, Accept/Reject/Manage controls, or non-essential script gating found. The HTML loads Google Fonts before any consent. | Equal prominence/default-off cannot be tested. Whether Google Fonts is classified essential requires counsel decision, but it is an unconditional third-party request. |
| ADS-01 | **Partial** | No Google Analytics, Meta Pixel, ad SDK, tag manager, or advertising endpoint was found in source; `index.html` loads only Google Fonts externally. Server logs record scan confidence/quality/imageStored, not images/results, at info level. | No runtime network capture, dependency/SBOM policy, CSP report, production tag audit, or analytics governance evidence. Health answers and scan/chat data are persisted in product DB, but no advertising transfer was found. Debug mode can expose sensitive logged values and should never be enabled in production. |
| SET-01 | **Broken** | Privacy screen implements image-storage/cloud toggles and hard account deletion; per-scan deletion exists elsewhere. | Missing facial-scan-consent withdrawal with feature/deletion explanation, data export, marketing/cookie preferences, policy-version history, compliant progress-photo withdrawal/deletion workflow, processor/audit status, and cancellation. |

### Explicit cross-cutting checks

- **Server gate:** only authentication gates `/api/scans`; legal state is absent. The direct request proves age/Guardian/scan-consent/health-consent/payment bypass.
- **Camera before gate:** `startScanFlow` navigates to Scan and `ScanCapture` calls `getUserMedia`; no age/Guardian/facial-consent check appears in the controller or API. An authenticated account can therefore request camera access and submit before gates.
- **Persistent biometric material:** canonical JPEGs can enter `blobs`; face geometry enters `landmarks_json`; analysis metrics/region stats persist in `skin_scans`. No retention scheduler or audit table exists. Hologram render artifacts were not found in storage.
- **Actual Anthropic face payload:** `messages[0].content[0]` is an Anthropic image block with base64 JPEG data, followed by text containing metric summaries. Normal chat sends persona, full structured user context (including scan history), recent transcript, and current message, but no image block. The face-image branch violates AI-01 despite separate cloud consent.
- **Analytics/logging:** no advertising analytics integration was found. Info scan logs contain `confidence`, `quality`, and `imageStored`; these are analysis metadata. Production redaction covers common sensitive keys, but debug mode returns values unchanged. No image bytes are explicitly logged in the reviewed call paths.
- **Advertising technology:** none found on scan/consultation/account-health pages by source search. Runtime production verification was not possible. Google Fonts is loaded globally and is not advertising technology, though it is a third-party request before cookie choice.
- **Settings rights:** hard deletion and two toggles exist; export, scan-consent withdrawal, marketing/cookies, policy history, Guardian controls and cancellation do not.
- **Cookie banner:** absent.
- **Domain check:** source search found neither prohibited `evia.com`/`@evia.com` nor confirmed `meetevia.com`/`@meetevia.com`. The product is branded “Elohim,” so final domain publication remains unverified rather than passed.
- **Consent wording:** the repository has bespoke privacy/disclaimer copy but no supplied Consent Wording Pack or versioned exact-text source. Screens requiring counsel-approved exact wording are signup/checkout, facial scan consent, state health consent, optional safety/lifestyle consent, progress-photo opt-in, Guardian invitation/verification/consent, consultation disclosure, cookie banner, cancellation, and all Settings withdrawal/deletion explanations. Do not change those strings until the pack is supplied and counsel/Founder approves the mapping.

## Current data-flow diagram and retention conflicts

```text
Camera (getUserMedia, live browser video)
  |
  +--> browser working canvases (512px detection; 288x384 canonical crop)
  |      |
  |      +--> ROI provider: MediaPipe face landmarker, with skin-tone fallback
  |      +--> quality: brightness + Laplacian blur + face size/centering/crop
  |      +--> normalization + deterministic CIELAB/HSV pixel metrics
  |      +--> base64 JPEG + optional flattened landmarks
  |
  +--> POST /api/scans (authenticated, BUT NO AGE/GDN/CNS/PAY GATE)
         |
         +--> PostgreSQL skin_scans:
         |      metrics, per-region statistics, quality, observations,
         |      confidence, modelVersion, LANDMARKS (RET-02 CONFLICT: indefinite)
         |
         +--> if image_storage=true and key configured:
         |      AES-256-GCM ciphertext --> PostgreSQL blobs
         |      (RET-01 CONFLICT: no session/24h TTL; CNS-04 semantics unclear)
         |
         +--> if cloud_reasoning=true and Anthropic key configured:
         |      RAW FACE JPEG base64 + metric text --> Anthropic vision
         |      --> qualitative observations --> skin_scans
         |      (AI-01 CONFLICT: facial photograph sent to conversational AI)
         |
         +--> later conversational turn:
                profile + memories + transcript + scan history/results
                --> Anthropic structured messages (when consent/model/budget allow)
                --> reply --> messages table
                (AI-02 UNVERIFIED; transcripts have no 12-month rolling deletion)

Presentation:
  stored results + landmarks --> browser region panels/face mesh/hologram rig
  (no persisted rendered artifact found; RET-03 cleanup not instrumented)

Deletion:
  DELETE one scan --> delete scan row + shred referenced blob
  DELETE /me/data --> attempt blob shreds --> cascade-delete account rows
  (RET-04 PARTIAL: no consent-withdrawal trigger, processor propagation,
   audit record, 30-day job, abandoned-session cleanup, or retry on shred failure)
```

Other retention mismatches: chat transcripts have no 12-month rolling deletion; technical logs have no application-enforced 12-month rotation; locked-minor and Guardian records do not exist; backup rotation/isolation is not documented in code; consent records are deleted with the user rather than retained for consent duration plus five years; progress-photo deletion is only scan/account deletion rather than an independently governed right.

## Part 2 — skin metric validation

### Scope limitation and common protocol

The referenced metrics/scoring PDF was not in the repository or attachment filesystem. The table below covers the nine `SKIN_METRIC_KEYS` implemented in code and the displayed composite “Skin health.” It must be reconciled line-by-line with the missing PDF before anyone claims metrics-spec completion.

All nine metrics are deterministic transforms of normalized pixels, not outputs from a validated dermatology/skin-analysis provider. MediaPipe or the fallback locates the face/regions; neither provider supplies the findings. Calibration ranges are hand-coded “initial calibration” constants. Therefore the metrics may be described only as capture-dependent appearance signals, not ground-truth skin properties.

**Runnable repeatability harness:** extend `scripts/repeatability.mjs` to emit per-metric CSV by participant/device/lighting/repeat, pin `SKIN_MODEL_VERSION`, and run the following preregistered protocol. Use at least **120 consenting adults**, stratified evenly across Monk Skin Tone 1–10 (**12 per tone**, and report Fitzpatrick I–VI only as supplementary self-report, not an inferred attribute). For each participant, capture **3 repeats** after re-positioning in every condition on the same day and repeat the reference condition seven days later. Devices: (1) entry Android front/rear (about 720p/12 MP), (2) mid-tier Android front/rear (1080p/12–50 MP), (3) current flagship iOS or Android front/rear (1080p/12–50 MP), and (4) 720p or 1080p desktop webcam. Lock beauty filters/HDR where possible and record focal length, resolution, exposure metadata, OS/browser, camera side and model.

Lighting conditions measured at the face with a lux meter: **daylight 500–1,000 lux, CRI ≥90; warm indoor 300–500 lux at 2700–3000 K; dim 50–100 lux; harsh overhead 700–1,000 lux; mixed 400–700 lux with sources differing by ≥2000 K**. Use a neutral gray card for reference but do not feed it to the algorithm. Randomize condition order, keep camera distance/framing fixed by jig, and do not use identity matching.

Primary pass threshold per metric: within-condition same-session **ICC(2,1) ≥0.80**, median within-person range **≤ that metric's checked-in noise floor**, and 95th-percentile range **≤2× noise floor** in every device × light × Monk subgroup with adequate cell size. Bias from the daylight/reference-device condition must be **≤ one noise floor** per subgroup and 95% bootstrap CI must not cross **2× noise floor**. Failure in any tone/device/light subgroup invalidates unqualified repeatability for that metric; suppress the number in that condition or label it experimental until recalibrated and independently revalidated. This is a proposed validation threshold, not evidence that current metrics pass.

| Metric | What it measures | Computation | Limitations | Repeatability protocol | Compliance flag |
|---|---|---|---|---|---|
| Hydration | Fine luminance detail on forehead/cheeks; a visual roughness proxy, **not water content**. | Mean `abs(L* - radius-3 box blur(L*))`; linear inverted mapping 1.1→100 to 6.5→0, clamped/rounded. Derived score. | Strongly affected by focus, denoising, makeup, facial hair, compression and light direction; no corneometer; cannot establish dehydration or barrier function. | Common protocol; noise floor 4. Add corneometer only as a separate criterion-validity study, never to rename this camera signal. | **High risk:** “Hydration” implies physiological measurement. Reframe as “visible surface smoothness (capture-based)” with limitations; no health interpretation. |
| Oiliness | Bright, low-saturation (specular) pixel coverage, weighted toward T-zone. | HSV `v>0.8 && s<0.2`; `0.72*T-zone + 0.28*cheeks`; linear 0.004→0 to 0.16→100. Derived score. | Measures reflections, not sebum; changes with lamp geometry, moisturizer, sweat, makeup, exposure and tone; cannot determine oily skin type. | Common protocol; noise floor 5. Add cross-polarized/non-polarized paired captures to quantify specular dependence. | **High risk:** rename “visible shine” or “specular shine in this capture.” |
| Redness | Relative CIELAB a* elevation in cheeks/nose/chin versus median a* across sampled face regions. | `mean(a* inflammation-prone) - median(all-region a*)`; 0.6→0 to 9.0→100. Derived score. | White balance, cosmetics, vascular visibility and segmentation affect it; within-face baseline can hide diffuse redness; cannot distinguish irritation, acne, rosacea, allergy, sun exposure or disease. | Common protocol; noise floor 4. Report bias and failure separately for all Monk groups and mixed-temperature light. | **Medium/high risk:** “visible redness contrast” is safer; explicitly not inflammation or a condition. |
| Texture | Local variation of L* across forehead/cheeks. | Mean per-region population SD of L*; linear 1.4→0 to 8.0→100. Derived score. | Confounded by lighting direction, pores, hair, makeup, sensor sharpening/noise and focus; not tissue structure. | Common protocol; noise floor 4. Include controlled grazing versus frontal illumination as an additional stress test. | **Medium risk:** “visible surface variation” avoids clinical-sounding interpretation. |
| Pores | Count of pixels that are darker than all eight neighbors by 1.4 L* units in nose/cheeks. | Local-minimum count per 1,000 ROI pixels; linear density 1→0 to 26→100. Derived score. | Counts freckles, hair, noise and compression artifacts; misses pores below resolution; distance/optics/processing dominate; cannot measure pore size or blockage. | Common protocol; noise floor 5. Require resolution/downsampling and front/rear equivalence; include clean-shaven/hair/makeup strata. | **High risk:** rename “pore-like dark detail” and avoid “clogged/enlarged” claims. |
| Dark spots | Fraction of pixels below a per-region adaptive lightness threshold. | Threshold `mean L* - max(2.2, 1.25*SD)` in forehead/cheeks/perioral/chin; mean fraction; 0.004→0 to 0.11→100. | Threshold crosses with exposure/8-bit quantization; code acknowledges tone inconsistency. Includes shadows, hair, freckles, moles and makeup; cannot classify lesions or pigmentation cause. | Common protocol; noise floor 8. Add repeat analysis with ±12% controlled exposure and require subgroup parity; any lesion classification is out of scope. | **High risk:** “dark spots” may invite lesion interpretation. Reframe “relative dark-pixel variation”; never reassure or classify. |
| Tone evenness | Between-region variability in average lightness and yellow/blue color. | `0.65*SD(region L*) + 0.35*SD(region b*)`; linear 1.2→0 to 9.5→100, inverted. Derived score. | Captures illumination gradients, shadows, makeup and camera color processing; “tone” can be misconstrued as skin-tone ranking. No color-uniformity ground truth. | Common protocol; noise floor 4. Mixed-light and left/right illumination are primary stress conditions; report Monk subgroup bias. | **High risk:** rename “within-capture color uniformity,” not “better tone”; remove attractiveness/health valence. |
| Under-eye | Relative darkness/blueness of periorbital regions compared with cheeks. | `(cheek L* - orbital L*) + max(0, cheek b* - orbital b*)*0.4`; linear 0.5→0 to 11→100. Derived score. | Confounded by eye-socket shadow, gaze, glasses, makeup, anatomy, sleep-independent variation and light position; cannot infer fatigue, anemia or health. | Common protocol; noise floor 5. Add glasses/no-glasses and controlled gaze/head-pose repeats; do not recruit around medical status. | **High risk:** rename “under-eye contrast in this capture”; prohibit fatigue/health causal language. |
| Breakout signs (`acneIndicators`) | Pixels that are simultaneously redder than baseline and high-frequency in selected regions. | Fraction with `a*>baseline+4.5` and `highFreq>4.0`; linear 0.002→0 to 0.075→100. Derived score. | Not an acne model; can count irritation, makeup, hair, shadows or noise and miss non-red lesions. Cannot diagnose acne, infection or severity. | Common protocol; noise floor 4. Include blinded cosmetic-observation annotation only (not diagnosis) and report false-positive disparity by tone/device/light. | **Critical MED-01 risk:** remove acne semantics. Reframe “localized red-texture overlap” with prominent uncertainty, or suppress pending validation. |
| Skin health composite | No direct signal. It averages direction-adjusted versions of the nine scores and assigns Good/Fair/Needs care. | `averageGoodness(scan)`, rounded; higher-is-worse metrics are inverted before averaging (as evidenced by the presenter and ScanPage use). Composite/derived score, not provider output. | Arbitrary weighting and thresholds; mixes incomparable proxies, can conceal severe instability, and makes a health judgment. No clinical or cosmetic validation. | Do not validate as a health metric. If retained only for research, common protocol plus sensitivity/weighting analysis and prespecified construct validation would be required; repeatability alone cannot establish validity. | **Fail:** violates no-arbitrary-score and MED-01. Remove from product presentation; describe individual supported observations instead. Founder/counsel approval is required for any replacement wording. |

## Proposed remediation phasing (proposal only; no implementation in this audit)

Estimates are engineering elapsed effort for a small experienced team and exclude provider procurement/counsel turnaround.

### Phase 0 — stop-ship containment and decisions (2–4 engineering days)

1. Disable scan/camera/analysis submission in deployable environments until server gate records exist; reject all scan routes fail-closed. Do not rely on hidden buttons.
2. Disable the Anthropic face-image branch to meet AI-01; retain on-device analysis and send structured, allowlisted cosmetic results only.
3. Remove/suppress the “Skin health” composite and diagnostic-sounding breakout presentation pending counsel-approved reframing.
4. Freeze biometric persistence and document/execute deletion for existing `landmarks_json` and ambiguous scan photos, with an evidence-preserving, non-biometric deletion audit.

**Sign-off:** Founder/counsel must approve any user-facing temporary notice, metric/disclaimer wording, scope of legacy-data deletion, and whether service is paused. Counsel must supply the exact Consent Wording Pack and confirm progress-photo versus raw-scan classification.

### Phase 1 — legal state machine and hard API gates (3–5 weeks)

1. Add versioned DOB/age status, non-retained under-16 rejection, adult checkout result, debit/prepaid non-biometric check, full Guardian lifecycle, Illinois result, 72-hour link, 14-day deletion, turned-18 re-consent, and immutable consent-event records.
2. Implement separate CNS-01/02/03/04 records and screens with exact approved text, jurisdiction logic, timestamps/version/actor/source, and optionality.
3. Centralize server authorization policy and enforce it on scan creation, analysis, image, voice/context, and any future scan route; add negative integration tests for every state transition and direct API bypass.
4. Add payment checkout/webhooks/confirmation and Settings/Stripe cancellation with exact price disclosure.

**Sign-off/dependencies:** Founder/counsel approve exact copy, version identifiers, jurisdiction rules, Guardian relationship declarations and turned-18 experience. Procurement/security approve certified age/ID vendors and Stripe configuration.

### Phase 2 — retention, deletion, user rights and cookies (3–5 weeks)

1. Split ephemeral raw capture from separately consented progress photos. Introduce session expiry/24-hour cleanup, immediate landmark cleanup, never-persisted render enforcement, abandoned-session sweeper, idempotent processor propagation, retry/dead-letter handling, and non-biometric deletion audit records.
2. Implement scan-consent withdrawal, feature-lock/deletion explanation, progress-photo delete/withdraw, export, account deletion status, marketing/cookie controls, policy history, transcript rolling deletion, consent evidence retention, log rotation and backup controls.
3. Add CMP with equally prominent Accept/Reject/Manage and block all non-essential requests until choice. Add automated tag/network audits on sensitive pages.

**Sign-off:** counsel decides legal holds, consent-record survival after account deletion, exact withdrawal/deletion copy, cookie classification and export scope. Security/operations attest backup and processor deletion.

### Phase 3 — metric validation and safety (4–8 weeks for protocol/tooling; study duration additional)

1. Obtain the missing metrics PDF and make a traceability matrix from every specified metric to code, UI label, provider output and validation dataset.
2. Run the preregistered repeatability protocol above across lighting, device and Monk 1–10 strata; publish per-subgroup uncertainty and disable metrics that miss thresholds.
3. Commission appropriate scientific review for construct validity. Repeatability alone does not make a score meaningful.
4. Expand deterministic and model-output safety tests for diagnosis, treatment, triage, referral, false reassurance, pregnancy/allergy limitations and unsupported measurements.

**Sign-off:** Founder/counsel approve all rewording and whether any metric is supportable; privacy/ethics review the study and biometric handling; a qualified independent reviewer approves validation claims.

### Phase 4 — security, provider and production-like launch verification (2–4 weeks plus external lead time)

1. Complete threat model, least-privilege roles, admin MFA/audit logs, key rotation, incident-response exercise, TLS/at-rest attestations, vulnerability/penetration testing, dependency review and signed launch checklist.
2. Retain Anthropic/voice/age/Guardian/hosting DPAs and settings evidence proving training prohibition/retention behavior.
3. Run the entire gated journey on named desktop/mobile browser versions with real camera allow/deny/revoke, slow/offline paths, accessibility, responsive views, payment sandbox, provider failures, cleanup clocks and processor deletion. Capture screenshots, HARs and server audit records.
4. Publish counsel-confirmed `meetevia.com`/`@meetevia.com` consistently and rerun a repository/built-asset/runtime scan for prohibited domains.

**Launch decision:** only after every P0 row above has an end-to-end production-like passing artifact should §15 be signed. Unit/type checks and a visually complete prototype are not substitutes for those acceptance tests.
