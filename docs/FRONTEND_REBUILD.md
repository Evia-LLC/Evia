# Evia Studio — frontend rebuild experiment

**Branch:** [experiment/frontend-rebuild](https://github.com/Evia-LLC/Evia/tree/experiment/frontend-rebuild)
**Baseline:** staging at commit 4dea94a19b698f48773e08a817396bb96913a797 (2026-10-14)
**Scope:** Visual hierarchy, layouts, copy, discoverability, accessibility, and responsive navigation. API, database schema, server routes, scene logic and user data are **not** part of this experiment.
**Status:** Experimental. Do not merge or promote without the checks below.

## 1. Product architecture and user journeys

This is a Svelte 5 + Vite single-page application with an Express API and a Svelte rune-based controller/session store. It is **not** SvelteKit. The application mounts **one WebGL avatar stage**, not a fresh avatar for every route. The route URL chooses an experience while the scene keeps running.

**Unauthenticated:** Initial API health + /me probe → sign-in/register gate. Server-validated signup/login → Supabase Auth session cookies → /me → preload history/scan state. A visitor may enter a guest mode: local face/body measurement and local demo conversation, with no account storage. Legal-review pages remain readable while unauthenticated.

**Conversation:** / is a live chat with Evia. The controller handles a typed or dictated message, assistant thinking, voice output, possible scan offers, local fallback, memory updates and stage directives. The WebGL character runs under the UI.

**Face scan:** /scan triggers the clinic scene and requires the appropriate consent before capture. The camera and on-device analysis use the established scan pipeline; certain cloud analysis/image operations additionally enforce consent server-side. After capture, the 3D reading layer and bottom dock present the result, confidence, next actions and optional, separately consented photo storage.

**Body scan:** Same /scan destination, different measurement path. It requires two capture angles (front and side), builds measurements, and stores body readings separately from facial readings.

**Progress:** /progress is real stored history, not illustrative data. Metric rings select a trend chart, previous scans can be compared, photos/scan atlases are viewed and individually deleted, body-history is present, and data from differing model versions must not be compared as if interchangeable.

**Routine:** /routine holds a product journal: catalogue search, ingredient-label reading, custom product entry, product assessment, start/stop usage, routine overlaps and outcome evidence tied to scans. Unknown or noisy evidence is not presented as improvement.

**Profile / privacy / deletion:** /profile edits skin context, sensitivities, pregnancy-related safety context, explanation style, reduced motion, audio and remembered facts. /privacy separately manages consent and saved photos. /settings/data exports and requests account deletion with a typed keyword and second confirmation. Don't replace this with a one-click destructive action.

## 2. All routes and behavioral contracts

| Route | Destination | Essential behavior retained | Guest or legal considerations |
|---|---|---|---|
| \`/\` | Talk | Live composer, chat transcript, narration/voice, scan offers, next steps | Guest uses local engine; no persisted conversation |
| \`/scan\` | Scan | Face/body selector and capture, face consent, camera, local measurement, results, photo choice | Prevent unauthorized upload; session cleanup on leave |
| \`/progress\` | Progress | Nine skin metrics, selectable chart, compare, scan atlas, body history, per-item deletion | Empty state; missing data; model version warnings |
| \`/routine\` | Routine | Search products, label scan, custom entry, assessment, product usage, outcome review | Must report uncertainty / noise floor |
| \`/profile\` | You | Skin profile, safety context, voice, sound, motion, memories, forget, sign out | Guest cannot persist edits or memories |
| \`/privacy\` | Privacy & consent | Independent consents, withdrawal, progress-photo deletion, navigation to data rights | No claim that draft notices are approved |
| \`/settings/data\` | Your data | JSON export, typed + second-stage deletion, pending/failure/completed receipts | Never show deletion success on backend failure |
| \`/legal/age-assurance\` | Age assurance | Age screening, guardian review preview | Under-16 block, 16–17 restricted preview; no account activation |
| \`/legal/terms\` | Terms | Versioned legal review document | Draft/placeholder disclosures remain visible |
| \`/legal/privacy\` | Privacy policy | Versioned privacy review document | Draft/placeholder disclosures remain visible |
| \`/legal/facial-scan-consent\` | Facial consent | Explicit scan permission and guardian wording | Declining returns home; no hidden approval |
| \`/legal/health-consent\` | Health consent | Jurisdiction scenario and explicit review choices | WA/NV/CT conditional review; unknown conservative |
| \`/legal/safety-lifestyle-consent\` | Safety consent | Independent opt-in, decline or skip | Sample review only; no production assumption |
| \`/legal/progress-photo-consent\` | Photo consent | Independent review of image storage | Not equivalent to enabling production uploads |
| \`/legal/subscription\` | Subscription disclosure | Age/guardian + subscription review preview | No checkout or billing claim |
| \`/legal/cancellation\` | Cancellation | Versioned cancellation notice | Keep links back to subscription review |

## 3. Component and data ownership map

- \`src/App.svelte\`: boots app and 3D scene, selects legal/guest/signed-in route; triggers clinic enter/exit; legal/cookie disclosures; **behavior unchanged**.
- \`src/router/router.svelte.ts\`: authoritative path-to-page table, history and back navigation; **behavior unchanged**.
- \`src/state/controller.ts\`, \`session.svelte.ts\`: auth, reads/writes, speech, scans, scene orchestration; **behavior unchanged**.
- \`src/lib/api.ts\`: typed, same-origin API transport; **behavior unchanged**.
- \`src/components/ElohimStage.svelte\`, \`src/scene/*\`, \`src/scan/*\`, \`src/history/*\`, \`src/products/*\`: camera, scene, analysis and chart internals; **logic unchanged**.
- \`src/components/Nav.svelte\`: **replaced** with a readable studio rail and compact phone tab bar.
- \`src/components/Page.svelte\`: **replaced** with a consistent editorial hero, content canvas, and action placement.
- \`src/pages/HomePage.svelte\`: **replaced** with a conversation-first welcome and direct links to useful next steps.
- \`src/components/AuthGate.svelte\`: **replaced** with a clearer entry flow while preserving exact sign-in/register calls, age guards, legal-review warnings and guest mode.
- \`src/styles/studio.css\`: **new** independent presentation system; imported *after* existing styles by \`src/main.ts\`. Existing feature CSS remains as the implementation substrate for legacy camera, chart, and legal components. It is not removed until full feature parity is demonstrated.
- All other pages still invoke their existing API/analysis/consent actions, now rendered by the new shared visual system.

## 4. New experience design

**Direction:** Quiet editorial skincare studio, not a medical dashboard. Soft porcelain surfaces, dark botanical green, restrained warm clay highlights, generous spacing and serif display typography. The subject is the user and the live Evia character, not gradient effects or neon controls.

**Desktop:** Explicit left rail (wayfinding and audio/status), separate content canvas (information and actions), central live avatar scene, journal-style conversation surface on the right. The scan view can place capture tools on the right to keep the clinical scene visible.

**Mobile:** Five persistent accessible tabs with 44px+ targets; the scene owns the top of the viewport; content rises underneath as a scrollable sheet. Chat keeps its existing peek/full gesture and keyboard accommodation. Additional utility links live on Privacy/Profile; they do not compete with the primary tabs.

**Accessibility and trust:** Actual route links, \`aria-current\`, descriptive labels, strong keyboard focus, reduced-motion support, input placeholders backed by labels, readable empty/error/offline states, explicit consent, no fabricated metrics, and no production-approval claims.

## 5. Verification and merge gate

Do not mistake a successful bundle or a READY deployment for full UI verification. These checks must pass **on the experiment branch**:

1. \`npm ci --ignore-scripts --no-audit --no-fund\`, \`npm run typecheck\`, \`npm run check\`, \`npm run test:unit\`, \`npm run build\`. Note that pre-existing staging authentication/schema regressions may make unrelated tests fail; isolate new failures.
2. Sign-out/login/register: login success and failure, confirmation-email pending state, offline state, legal wording gate, under-16 denial, age 16–17 guardian preview, guest without persistence.
3. Navigation: every above route via button and direct URL; browser back/forward; never remount stage unnecessarily; legal routes accessible from sign-out.
4. Chat: send typed message, multiline composer, microphone state, listening cancellation, audio controls, reading transcript without forced scroll, mobile expand/collapse.
5. Scan: face camera permissions, consent denial and withdrawal, image privacy, body two-angle capture, unreadable image, retake, results, optional photo storage gate and exit cleanup.
6. Progress: empty/single/multiple readings, ring selection, trend chart, atlas/compare, body history, delete confirmations and model-version warning.
7. Routine: search, label read, ingredient unknowns, add, assess, start/stop, outcome explanations, malformed/error API response.
8. Profile, privacy and data: save preferences, memory forget, voice preview, sound toggle, per-consent decisions, export, delete typed + second confirm and pending/error receipts.
9. Desktop widths 1440/1280/1024, phone widths 390/360/320, tablet portrait, landscape; keyboard open, safe areas, browser zoom to 200%, touch target sizes, no horizontal clipping.
10. Axe/keyboard/screenreader smoke check, performance budget and screenshot review. No access to user camera or linked Auth credentials is assumed for automated tests.

**Known unrelated staging blockers to retest before rollout:** the earlier Supabase Auth cutover had legacy demo seeding and generated type mismatches, and the staging /api/health endpoint returned \`database: false\`. This experiment does not silently change those backend conditions.

## 6. Rollout policy

This branch is isolated: no merge into staging/main, no environment-variable changes, no Supabase migration, no deployment promotion. Final acceptance requires functional QA with a real or explicitly consented test account and visual review by a product owner. Preserve the old UX on staging as the reversible baseline until those checks are satisfied.
