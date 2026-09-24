# Section 5 report — Remaining legal screens

Section 4 completed its checkpoint with 35 files / 307 tests passing. The user authorized Sections 4 and 5 together; work proceeded in that order on branch `demo`.

## Built

- `shared/legal-screen-copy.ts:2` and `shared/legal-content.ts`: exact guide §2–4 and §8–10 strings, versioned as unapproved demo copy. The health/safety/photo pages now render separate unticked checkboxes, refusal and optional skip controls rather than disabled placeholder shells.
- `src/pages/legal/LegalConsentPage.svelte:14`: WA/NV/CT jurisdiction scenarios require the separate health review choice; Unknown is conservative; Other can continue without it. Safety can be skipped without blocking use. Photo review starts off and cannot enable storage.
- `server/routes/analysis.ts:17` and `src/lib/legal-review.ts`: authenticated, sample-only immutable review events with account identity, server datetime, wording version, actor, source and choice. Stale versions and forged approval/actor fields are rejected or ignored. Review events use their own consent namespace and cannot authorize processing. Guests record tab-only evidence; no account identity is invented.
- `src/components/legal/AIDisclosure.svelte` with `src/chat/ChatPanel.svelte:262`, `src/pages/ScanPage.svelte:152`, progress/body history and accessible result views: persistent consultation notice, cosmetic-result disclaimer, and the exact escalation wording. Assistant messages also carry the cosmetic disclaimer.
- `src/components/legal/CookieBanner.svelte:40`: two layers, equally prominent Accept all / Reject all / Manage preferences, categories, provider names/durations, Save, and a global cookie settings footer. Necessary-on; optional-off. Marketing stays unavailable for everyone; no analytics/marketing provider is configured. GPC additionally keeps analytics off.
- `src/lib/cookie-preferences.ts`: versioned 12-month preference record, malformed/stale/expired record rejection, visible storage failure, functional storage gating and cleanup on withdrawal/observed expiry. Removed all external Google Fonts links from `index.html`; intro/sound persistence requires functional consent. Sign-in cookie is now browser-session duration (`server/routes/auth.ts:32`) to match the guide.
- `src/components/legal/AccountControls.svelte:30`: facial withdrawal records a real withdrawn event, stops current capture and causes the Perfect Corp proxy to refuse subsequent uploads. Offers deletion of past scans/photos rather than claiming an automatic purge.
- Settings includes the default-off photo review toggle, individual owner photo deletion, real export and confirmed account deletion, marketing-off preference, cookie settings and policy history with actual versions/dates/choices. Existing owner-scoped APIs and typed/double deletion confirmation remain in use.
- Required under-18 “Guardian has access” notice appears as an explicitly unverified preview; Step 9 remains available for review. No guardian approval or access is granted.
- Corrected facial and age-flow review logging to treat the synthetic guest profile as a guest, avoiding false authenticated requests.

## Verbatim confirmation

The new copy test extracts every backtick-quoted string in guide §2, §3, §4, §8, §9 and §10 and compares it to the shared constants, without normalization. Examples:

- `shared/legal-screen-copy.ts:3`: “Permission to collect your skin and health information” and the complete body, checkbox and “We never sell consumer health data.”
- `shared/legal-screen-copy.ts:10`: “Optional, and only if it helps your results” and “Skip for now”.
- `shared/legal-screen-copy.ts:17`: “Save this photo to track your progress?” with the complete storage explanation and checkbox.
- `shared/legal-screen-copy.ts:23`: “You are chatting with Evia, an AI assistant. This is general skincare guidance, not medical advice.”
- `shared/legal-screen-copy.ts:24`: “Cosmetic observations only. Evia does not diagnose medical conditions.”
- `shared/legal-screen-copy.ts:25`: “Evia cannot tell whether this needs medical attention. If this area is new, changing, painful or not healing, please have it looked at by a healthcare professional.”
- `shared/legal-screen-copy.ts:29`: the full first-layer cookie text, including “We never send your scan images, skin results or health answers to these tools.”
- `shared/legal-screen-copy.ts:34`: all §10 control descriptions and “Guardian has access”.

## Deviations and remaining issues

1. Consent review choices are deliberately not production grants. Full policy publication, legal approval, real jurisdiction determination, collection/API gates and verified guardian authority remain incomplete. Existing profile/chat health inputs are not yet guarded by these review choices. No sharing checkbox was introduced.
2. Photo storage remains blocked by the existing approved-consent check. The settings toggle is labelled a sample preference; turning it on does not save or authorize a photo. Per-photo deletion is real for existing owner records. Automatic deletion upon consent withdrawal remains unimplemented.
3. Escalation text is displayed conservatively on all consultation/result views. No medical-feature detector or claim of clinical detection was introduced. Safety-output validation and visual/browser review remain pending; metric labels are unchanged.
4. Cookie preferences express choices, but no analytics or marketing processor is installed. Marketing is unavailable rather than allowing unverified/minor users into an audience. Guest cookie evidence is local; it is not retroactively assigned to a later account. Full Cookie Policy publication and a production network inventory audit remain required.
5. Withdrawal stops current capture and revokes Perfect Corp upload consent, but does not establish global age/guardian enforcement or automatically delete history/provider copies. Settings explains this and offers existing owner deletion controls.
6. Guardian permissions, invitation lifecycle, turning-18 automation, legal evidence retention and provider/backup deletion remain absent. The current account-delete operation cascades consent records; it does not yet preserve the guide's duration-of-consent +5-year legal-record exception or prove backup removal within 35 days. The UI and tracker disclose this.
7. Guest review evidence is tab-only. Export/deletion attempts log when possible; these rights are not blocked by review-log failures. Account deletion also removes its account-linked audit evidence. Production audit retention remains a gap.
8. No live provider, browser camera or manual browser-layout validation was performed. No Stripe/age provider/environment dependency was added. `Manager/` stays ignored; Anthropic image capability was not modified and P-01 remains unresolved.

## Validation

Required sequence `npm run typecheck && npm run check && npm run test:local` passed: TypeScript exit 0; Svelte 0 errors/0 warnings; **36 files / 323 tests passed**, no skips, in 56.44 seconds. The disposable database was stopped and discarded. `git diff --check` is clean. A final TypeScript check covers the storage-failure refinement made before the full test suite started.

New tests cover verbatim strings, jurisdiction scenarios, refusal/skip evidence, review grants never authorizing processing, stale/unauthenticated/production request rejection, forged identity/approval/marketing fields, cookie defaults, GPC, version/expiry validation and functional-storage withdrawal.

## LEGAL_PROMISE_TRACKER.md snapshot diff

| Pledge | Before Section 5 | After / remaining gap | Owner |
| --- | --- | --- | --- |
| P-04 | Facial UI/proxy gate; withdrawal pending | Settings withdrawal connected; global blocking and deletion remain incomplete | Engineering + legal |
| P-08 | Health placeholder | Exact UI, jurisdiction scenarios and review events; collection gate/policies pending | Engineering + legal |
| P-09 | Safety placeholder | Exact optional UI and skip; profile/chat collection gates and category deletion pending | Engineering |
| P-10 | Partial photo gate | Exact default-off UI and deletion controls; storage still requires approved wording | Engineering |
| P-11 | Disclosure absent | Exact consultation/result/escalation UI; clinical safety/browser validation pending | Engineering + legal |
| P-12 | No banner; external fonts | Preferences, GPC and functional gate; fonts removed; policy/network audit pending | Engineering + legal |
| P-13 | Owner controls partial; guardian previews | Owner controls connected; guardian/retention/automatic deletion gaps remain | Engineering |
| P-14 | Account review logging partial | Section 5 versioned review evidence/history added; guest/lifecycle retention gaps remain | Engineering |
| P-17 | Sections 1–3 guarded, payment guard confirmed | Sections 1–5 demo paths need no live payment/age provider | Engineering |

All 17 pledges, their wording/source columns and ownership are retained. Other pledge states remain unchanged. Sections 1–5 of the requested demo build are implemented after successful validation; this does not resolve production blockers or constitute legal approval.
