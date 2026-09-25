# Merge notes: origin/main into evia-visual-rebuild (2026-09-25)

State: `git merge origin/main --no-ff` is in progress on `evia-visual-rebuild` (MERGE_HEAD = 34ca48e). Every
conflict is resolved and everything is staged, but nothing is committed. Finish with a plain `git commit`; don't
re-add with `git add -A` or `git add .`. Two things are left out on purpose: `.claude/launch.json` (a local tweak
made before the merge, unstaged) and the untracked `.claude/*.workflow.js` files. `node_modules` here is a symlink
to a shared install; `.gitignore` now says `node_modules` (no trailing slash), so it is ignored too.

## What came from main (Ugochukwu Chidera, 3 commits after 5ab075a)

- **7d776c7 "Build EVIA sample-data demo sections 1–5"** (76 files):
  - Section 1: the Perfect Corp skin-analysis adapter (`server/ai/perfectcorp.ts`) and `/api/analysis/*`
    (`server/routes/analysis.ts`). The capture only goes to the provider after facial consent, and the local
    reading is shown as the backup (`src/skin-analysis/provider.ts`).
  - Section 2: date of birth at sign-up (migration `015_registration_dob.sql`, `server/routes/auth.ts`). Under
    16 is blocked. 16 and 17 get the guardian walkthrough. Adults tick a separate Terms box.
  - Section 3: an age-verification stub that never verifies anyone.
  - Section 4: the checkout preview. Payments stay off.
  - Section 5: the verbatim consent screens, the section 8 AI notice, the cookie banner and preferences, and
    the account controls.
  - Also: `/legal/age-assurance`, versioned review logging, docs, and 10 new test files.
- **83817a6 "Allow explicit sample-only Vercel demo deployment from main"**:
  - The `sample_demo` legal release profile in `scripts/check-legal-content.ts`. It needs EVIA_SAMPLE_DEMO=1,
    DEMO_MODE=0 and VITE_SAMPLE_DEMO=1.
  - `vercel.json` build and runtime env.
  - The visible "Pre-launch demo · Sample data only · No real users, payments or verified age checks." notice.
  - `test/legal-build-guard.test.ts`.
- **34ca48e**: `docs/BACKEND_ENV_INVENTORY.md`.

All of it is kept. The server, shared, legal copy, tests and docs came in as they were. There are two
exceptions. `test/scan-view.test.ts` gained one case (see below). `src/lib/cookie-preferences.ts` now clears
this branch's two functional keys along with his (see "Browser storage" under run 3 below).

Legal wording was not touched: a script checked every UI string in his Svelte and TS files against the merged
files. The only differences are that "cookie settings" is now capitalised as a button label, and the
subscription page's "Back to Evia" link became the legal frame's Back control.

## One sample mechanism

"Sample" meant two things. On main it means a hosted demo that only holds sample accounts. On this branch it
means the mockups' own figures, shown under the "Sample data" badge. They are now one mechanism, and this
branch's sample mode drives the UI:

- **The flag.** `VITE_SAMPLE_DEMO=1` becomes `SAMPLE_ONLY_DEPLOYMENT` in `src/sample/mode.svelte.ts`. That is
  the build his guard insists on for `sample_demo`.
- **The notice.** On that build his notice is a fixed strip on every screen
  (`src/shell/DemoDeploymentNotice.svelte`), and his wording is unchanged. The strip's height is added to the
  top safe-area inset, so top bars, the badge and the scan overlays all start below it.
- **Sample mode on arrival.** Visitors start in sample mode unless they have switched it off on that device
  (and that choice is stored only with functional storage allowed).
- **The gate's two ways in stay different.** "Preview with sample data" keeps sample data on. "Look around
  without an account" is the live guest visit (`enterLiveGuest` in `src/state/controller.ts`). On this build it
  sets sample data aside for the visit, so a guest's chat and `/scan` take the live path: facial consent, then
  the camera, then a local reading. That is his DEMO_USER_TEST step 5 as written. Leaving the guest visit returns
  to the deployment default (sample on). On every other build the guest way leaves sample mode as it is, so a
  `?sample=1` review link still previews.
- **Sign-in.** The gate carries a "Sample-only demo" note. The note's text was written during the merge, so it
  needs confirming. Signing in or registering a sample account puts sample data aside, so the account is shown
  as it is actually stored. It stays aside when a reload finds the account still signed in
  (`sampleForRestoredAccount`), unless the address says `?sample=1`. Signing out goes back to the deployment
  default.
- **His walkthroughs still run.** Sign-up with a DOB, the guardian review, a guest scan (straight from the
  guest way, with no need to turn sample data off first) and the account controls all work on their live
  paths.
- **Sample mode never writes to the server** (`src/lib/review-account.ts`). While sample data is on, review,
  consent and cookie choices are kept in the tab the way his guest path keeps them. A sample visit does not ask
  which analysis provider is configured, so its capture never reaches Perfect Corp.

## Conflicts (13) and how each was resolved

| file | resolution |
|---|---|
| index.html | Kept this branch's head (Evia meta, theme colour). Took main's removal of the Google Fonts links (P-12: nothing optional loads before a cookie choice). The type now falls back to the metric-matched local fonts; see decision 1. |
| src/App.svelte | Kept this branch's shell, director and sample badge. Added main's CookieBanner, the `/legal/age-assurance` route and the sample-only notice (as DemoDeploymentNotice). |
| src/router/router.svelte.ts | This branch's route table plus `legal-age-assurance`. |
| src/components/AuthGate.svelte | This branch's gate, with main's Section 2 logic unchanged: DOB first with the eligibility line; under 16 clears the fields and disables both ways in without an account; 16/17 opens AgeGuardianFlow at step 3 inside the card; 18+ sees name, password and the unticked Terms box with "Not now"; registration goes on to `/legal/age-assurance`. Restyled. |
| src/chat/ChatPanel.svelte | This branch's panel. The section 8 consultation notice sits above the log, and the result line sits under every one of Evia's messages. ChatDrawer's old one-line disclosure was removed, so the drawer doesn't show it twice. |
| src/pages/ScanPage.svelte | This branch's consult room. The camera stays unmounted until FacialScanConsent is answered, and "Not now" goes Home. Main's copy replaced the on-device claims. The section 8 notice appears in every state: under the consent (in the flow, in the consent's own column or phone scroller), in the capture panel's foot, and on the consultation, body and empty views. Main's capture-phase lede ("After your consent, Perfect Corp can analyse…") stands above the consent at every size and in the capture panel's foot on desk and tablet. On the phone it stays on the consent step, because the fixed capture sheet would cut the face oval from 207 to 134 px at 390x844. Main's ready-card sentence ("Even light, face in the oval, hold still. Your capture is sent to Perfect Corp only after your consent. Local backup analysis is available.") is in the empty state word for word. The provider status line sits in ReadingDock. |
| src/scan/ScanCapture.svelte | This branch's capture UI with main's two changed lines. |
| src/pages/PrivacyPage.svelte | Main replaced this page with AccountControls, and that is kept, inside this branch's PageFrame. The "Where things go" cards and the cloud-reasoning switch went with main's replacement; see decision 7. With sample data on, a signed-in account sees the sample note instead. |
| src/pages/DataRightsPage.svelte | This branch's page, with main's section 10 headings, the retention-gap disclosure and export/delete review logging. A logging failure never blocks either action. |
| src/pages/ProfilePage.svelte | This branch's page plus main's two links ("Account controls and consent", "Optional safety and lifestyle consent"), as secondary buttons. |
| src/pages/ProgressPage.svelte | This branch's dashboard plus the section 8 result notice under the grid. |
| src/pages/legal/LegalConsentPage.svelte | Main's Section 5 decision logic in this branch's LegalShell: the WA/NV/CT scenario, the unticked box, accept only when ticked, refuse and skip equally prominent. |
| src/pages/legal/SubscriptionDisclosurePage.svelte | Main's version (AgeGuardianFlow at the adult-checkout step, then the cancellation link) in the LegalShell. |

Migrations: main's `015_registration_dob.sql` comes before this branch's `016_catalogue_retailer.sql` (numbered
016 on purpose). A fresh PGlite, the simulated sample-only deployment, applied all 16 files in order (001–016).
`integrated-migrations.test.ts` passes.

## Problems the two sides caused together, fixed in the merge

- **Greeting held back 90 s.** Main gated the stored "intro seen" key behind functional-cookie consent. Without
  that consent, `introSeen()` stayed false, and the controller waits for the intro before greeting. So Evia's
  greeting waited up to 90 s, and a stage-controller test failed. Fix in `src/lib/intro.ts`: the tab remembers
  "seen" in memory (memory isn't storage), and storage that can't be read counts as seen, as it always did.
  Main's gating of the stored key is unchanged.
- **Sample visit contacted the server.** A sample visit fetched `/api/public/analysis`, which breaks this
  branch's no-server rule for sample mode, and a test failed. The controller now skips provider selection while
  sample data is on and labels the reading "Local analysis" (main's own fallback label).
- **"Read on this device" was untrue for accounts.** The scan capture header said so while main's line under it
  says the provider will read the capture. For a signed-in account the header now just says what the camera is
  doing. One test case was added.
- **Consent screen cut off on the scan page.** The facial-consent screen was centred inside a non-scrolling
  phone view: 1268 px of content in 844 px, heading and footer unreachable. On desktop and tablet, flex
  centring hid its top under the status header. It now scrolls, starts below the header, and is centred only
  when it fits. The same fix applies to the capture view.

## Fixed after the independent review (run 3)

- **Section 8 notice missing on the scan consent step.** It was guarded out while capturing, and the capture's
  own copy only mounts after consent. It now sits under FacialScanConsent at every size, in the flow and never
  pinned over the room. Checked at 1672x941, 1366x768, 1024x768, 390x844 and 360x740: it is in view when
  scrolled to the end, there's no overlap with the status header, Back or the cookie pill, no x-overflow, and no
  text under 12 px.
- **Sample-only build: the guest way stayed in sample mode.** See "The gate's two ways in" above. Checked on the
  simulated deployment (5497):
  - gate: notice strip and sample badge
  - guest way: sample off, and `/scan` shows the consent with the lede and the notice
  - Leave: back to the gate with sample on
  - preview way: `/scan` shows the sample consultation.
- **Main's scan copy restored.** The capture lede and the ready-card sentence (see the ScanPage row).
- **Browser storage and main's cookie categories.** This branch's `evia.sample` (the sample choice) and
  `evia.products.saved.*` (the Saved hearts) are now written only with the Functional category allowed. Without
  it they are held in the tab:
  - The sample choice lasts for the visit.
  - The preview's and each account's Saved list survive switching sample data on and off.
  - A guest's list never outlives the visit.
  - `cookie-preferences.ts` clears both keys wherever it already cleared main's intro and sound keys (on refusal
    and on expiry).
  - The Saved section says "Kept for this visit…" when the list isn't stored.
  - Tests: `test/sample-mode.test.ts` (updated), `test/saved-products.test.ts` (new) and
    `test/products-view.test.ts` (one case).
  - The banner's wording is unchanged (it is change-controlled): see decision 9.
- **`node_modules` symlink.** See State above.

## Restyled into the design system (logic and legal wording unchanged)

- **Components:**
  - AgeGuardianFlow: light and dark tones.
  - FacialScanConsent: light and holo.
  - CheckoutPreview: its button wraps inside the block on phones.
  - AccountControls: dashboard cards, two columns from 1024 px. Its long button labels wrap inside the card on
    phones.
  - AIDisclosure: light, dark and holo tones, 12 px floor, info glyph.
  - CookieBanner: glass panel, equally prominent buttons, 44 px targets.
- **Pages:** AgeAssurancePage, FacialScanConsentPage, SubscriptionDisclosurePage and LegalConsentPage, all in
  LegalShell. The gate's DOB step, Terms step and the 16/17 walkthrough.
- **Other screens:**
  - ReadingDock: the provider line ("Perfect Corp analysis" / "using backup analysis — …").
  - BodyHistory: spacing for the notice.
  - The shell's one-line AI disclosure now shows the section 8 consultation label word for word.
- **Checked in the built-in pane:**
  - All nine `/legal/*` routes, every app page and `/scan`, at 360 and 390 wide: no horizontal overflow and no
    text under the size floors.
  - All ten AgeGuardianFlow steps at 360.
  - Desktop at 1024, 1280, 1440 and 1536 for the sidebar and rail.

**Cookie settings moved (decision 2).** A floating pill covered page content: the rail's Talk button at
1024 wide, the tip card, legal lines at the end of Routine and Progress, and gate form fields. The "Cookie
settings" control now lives in the navigation:
- the sidebar's foot (full sidebar and rail)
- a row in the phone's More sheet
- the gate footer
- the LegalShell footer.

The floating pill remains only in the scan room: bottom right on desktop, top right on tablet, and hidden on
the phone's scan flow.

## QA regression: /scan at 1672x941, OBSERVED CONCERNS over the UNDER-EYES and CHIN text

Fixed in `src/pages/scan/Consultation.svelte` (`fitRight`) and `src/pages/ScanPage.svelte`:

- **The right column is measured after layout.** The two callouts step down clear of the SKIN MAP card, and
  OBSERVED CONCERNS shifts right, into the free wall under the SKIN MAP, as far as the callouts need (12 px
  gap). At 1672x941 it moved 23 px and the callouts dropped 6 px.
- **Fallback when it can't fit.** If nothing can move far enough (for example the chin callout would sit on
  the card tray), the page switches to the tablet composition for that window size and smaller. The check
  waits for fonts and uses boxes the entrance animations don't shift sideways.
- **Desk threshold raised from 0.76 to 0.8 of ref4.** Below that, the readable callouts cannot clear the
  panel; 1280x720 and 1280x800 now use the scrolling tablet composition.
- **The section 8 notice moved on the desk scan.** It is three sentences, and in the bottom-right corner it
  overlapped the tray and the toggle at 1280–1440. It now sits on the lower-left floor under the left callouts
  (the character's place), with the reading dock above it in real mode. On tablet, the scroll is padded by the
  disclosure bar's measured height.
- **Measured with no overlaps** among callouts, panels, tray, toggle, notice, status header, Back and the
  cookie pill at 1672x941, 1920x1080, 1536x1024, 1440x900, 1366x768 and 1400x1050. At 1340x755 and 1280x720 it
  switches to tablet as intended.
- **Left as it was:** the handwritten tagline's rotated box touches the tray card's lower-right glass edge at
  1672 and 1920. It doesn't cover any text, and the design has always been this way.

## Verification

- **Tests:** `vitest run --no-file-parallelism`: 53 files passed, 1 skipped (`body-store`, which needs
  Postgres). 553 tests passed, 8 skipped. All of main's new tests pass, as do all of this branch's. That
  includes the new `test/sample-deployment.test.ts`, which builds with VITE_SAMPLE_DEMO=1 and covers the two
  ways in, sign-out and a restored account.
- **Types:** `svelte-check`: 0 errors, 0 warnings, 823 files.
- **Build:** `vite build` succeeds. With `VITE_SAMPLE_DEMO=1` it also succeeds, and only that bundle contains
  the demo notice.
- **Legal guard (`scripts/check-legal-content.ts`):**
  - local build: passes
  - production without a release: blocked
  - `public_web` with draft documents: blocked
  - the vercel.json `sample_demo` profile: passes with its warning
  - `sample_demo` missing `VITE_SAMPLE_DEMO`, or with DEMO_MODE=1: blocked.
- **App in the browser (dev server on port 5495):**
  - the gate
  - the guest visit
  - the sample preview: every page, `/scan` at desktop, tablet and phone sizes, no runtime errors.
- **Simulated sample-only deployment** (a second stack, `work/merge/run-sample-deploy.sh`: EVIA_SAMPLE_DEMO=1,
  DEMO_MODE=0, VITE_SAMPLE_DEMO=1, local analysis, fresh PGlite):
  - notice strip on every screen, sample mode on at arrival
  - registration with DOB 1990 → `/legal/age-assurance` at step 2, account shown as stored
  - DOB 2010 → guardian walkthrough, no account created
  - DOB 2015 → blocked, fields cleared, both ways in without an account disabled
  - `/privacy` account controls, the phone More sheet → cookie preferences, and `/scan`: consent → capture.

## Needs a decision (Ugochukwu, Founder, counsel)

1. **Fonts (Founder + Ugochukwu). Still open; this is the one review finding not fixed here.**
   - Main removed Google Fonts, and the cookie banner says "Google Fonts requests have been removed". So the
     three design faces (Newsreader, Google Sans Flex, Oooh Baby) now render in their local stand-ins
     (Georgia, Arial, Snell Roundhand) on every screen. The look has moved away from the mockups (binding
     decision 1).
   - Putting the Google links back, even after consent, would make the banner's change-controlled sentence
     false. The fix is to self-host.
   - No copy of the three fonts exists on this machine (searched the home folder, the work folders and
     Spotlight). Fetching them means downloading third-party files, which needs the user's go-ahead, and a
     licence check (Newsreader and Oooh Baby are OFL on Google Fonts; confirm Google Sans Flex's licence).
   - Steps once approved:
     1. Put the woff2 files under `public/fonts/`.
     2. Add `@font-face` rules with `font-display: swap` ahead of the existing fallback faces in
        `src/styles/tokens.css`.
     3. Drop `fonts.googleapis.com` and `fonts.gstatic.com` from the CSP in netlify.toml and vercel.json.
   - Nothing requests those hosts today, so the CSP entries are harmless until then.
2. **Cookie settings placement (Ugochukwu).** It is now in the sidebar foot, the More sheet, the gate and legal
   footers, and the scan room; there is no floating footer on app pages. Please confirm this still meets P-12,
   "Cookie settings footer works before and after sign-in", and update LEGAL_PROMISE_TRACKER if so.
3. **Claims about scans staying on the device (Ugochukwu + counsel).** For a signed-in account with Perfect
   Corp configured, these are no longer strictly true. Main left them as they were, and they were not
   reworded here:
   - the gate: "Skin scans are analysed on your device. The photo never leaves it unless you say so."
   - intro beat 3: "Measured here. On your device…"
   - the narration in `src/lib/lines.ts`
   - the ScanAtlas note.
4. **Section 8 notice and the SRS line (counsel + Founder).**
   - The pack's consultation label replaced this branch's paraphrase ("Evia is an AI. General skincare
     guidance, not medical advice.") on Home, chat and Scan.
   - The gate no longer shows an AI line, because "You are chatting with Evia" doesn't fit there.
   - The full three-sentence notice now appears on every scan view and under each of Evia's chat messages
     (main's choice).
5. **Intro and functional cookies (Ugochukwu + Founder).** Without functional consent the intro plays once
   per visit, remembered only in the tab. Should "intro seen" count as strictly necessary?
6. **Sample-only deployment (Ugochukwu).**
   - Visitors start in sample mode, and signing in sets it aside.
   - The gate note "Every account here is a sample account. Use sample details only (an example.test email, a
     sample date of birth), never real personal data." was written during this merge; please confirm it.
   - Once this branch is merged to main, the Vercel production URL will build the new design in this mode
     until the `sample_demo` profile is removed.
7. **Privacy page (Founder).** Main's AccountControls replaced this branch's "Where things go" page, and with
   it the cloud-reasoning switch, which was disabled because its wording is unapproved. Confirm the switch
   should stay out.
8. **Desk scan threshold (Founder).** Windows below 0.8 of 1672x941 (about 1340x755) now get the tablet
   composition on `/scan`.
9. **Cookie wording for this branch's storage (Ugochukwu + counsel).** The banner's Functional line names only
   "room-sound and introduction preferences".
   - The sample-data choice and the Saved product lists are now gated under Functional, but the line doesn't
     name them. Either add them to that line, or classify them otherwise.
   - This branch's own "Remembered on this device" (Settings, Room sound) and "Kept on this device" (Saved)
     are true only with that category allowed. Saved now says so; the Settings line was left as it was.
10. **Real-mode QA needs the sample-demo server flag (for whoever tests).** Main's server refuses registration
    and facial-consent acceptance unless `EVIA_SAMPLE_DEMO=1`, because the wording is awaiting approval
    (`server/routes/auth.ts`, `server/routes/analysis.ts` POST /consent, 403).
    - The rebuild's usual dev server (5495: DEMO_MODE=1, no EVIA_SAMPLE_DEMO) therefore can't register. A
      signed-in account there can't get past the scan consent. Guests are unaffected, because their consent
      stays in the tab.
    - Signed-in scan QA needs `work/merge/run-sample-deploy.sh` or EVIA_SAMPLE_DEMO=1. This is main's intended
      gate, not a merge defect.
