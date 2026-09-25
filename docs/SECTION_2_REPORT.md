# Section 2 pause report — Age and guardian flow

Section 1 was approved. Section 2 now provides the signup routing and complete ten-step demo walkthrough at `/legal/age-assurance`. Real guardian verification and approval remain unavailable. Sections 3–5 await their individual checkpoints.

## Built

- `src/components/AuthGate.svelte:64` and `server/routes/auth.ts:70`: calendar DOB validation and under-16 rejection before account, session or consent-event storage. The browser clears the rejected signup inputs. A 16/17 signup opens a locked case with email/DOB in tab memory, without submitting credentials or creating an ordinary account.
- `server/db/migrations/015_registration_dob.sql`: optional self-declared DOB on accounts. Existing/seeded users are not assigned invented birthdates. Adult sample signup records DOB and the separate Terms choice in the same transaction (`server/db/users.ts:57`); a failed consent write rolls back creation. DOB is included in owner data export.
- `src/components/legal/AgeGuardianFlow.svelte`: all ten steps, including adult funding branches, guardian invitation preview, guardian verification requirements, separate Terms/relationship/facial choices, the complete approval-record shape, future unlock notice, guardian controls and turning-18 re-consent.
- `server/routes/analysis.ts:70`: authenticated, sample-only review logging. Evidence includes account identifier, server timestamp, version, actor, source, action, choice, IP and unverified guardian record. The server rebuilds verification fields and ignores caller-supplied approval/card identifiers. `approved` and `cameraUnlocked` remain false; last4/fingerprint remain null.
- `src/components/legal/CheckoutPreview.svelte`: the §7 disclosure and button in one block, optional EU/UK scenario with its separate required unticked checkbox, and guardian heading. `PaymentService.isEnabled()` always returns false; the button displays `Payments launch soon — check back shortly` and makes no Stripe call. This preview is required by Section 2; full Section 4 payment work remains pending.
- The review is linked from signup, and adult sample registration opens it. `EVIA_SAMPLE_DEMO=1` is required to accept unapproved registration wording. No real age/payment provider is required, and absent configuration produces a clear refusal rather than a crash.

## Verbatim confirmation

`test/age-flow.test.ts` compares all 25 quoted strings from guide §5–7 against `AGE_FLOW_COPY`, including merge-field spellings and punctuation. The existing facial-copy test continues to cover the full adult and guardian §1 text.

- `shared/age-flow.ts:7`: **Evia is for people aged 16 and over.**
- `shared/age-flow.ts:8`: **Sorry, Evia is only available to people aged 16 and over.**
- `shared/age-flow.ts:9`: the complete debit/prepaid notice, ending **This uses your email address, not your face.**
- `shared/age-flow.ts:10`: **We need a parent or guardian to approve this.**, followed by the complete 14-day body.
- `shared/age-flow.ts:12`: **Your approval is needed for Evia.**, the complete email body, **Review and approve.**, and complete 72-hour expiry notice.
- `shared/age-flow.ts:17`: **I confirm I am the parent or legal guardian of this user.**
- `shared/age-flow.ts:18`: **I accept the Terms of Service on my own behalf and on behalf of this user.**, followed by the complete under-18 advertising statement and **Approve.**
- `shared/age-flow.ts:22`: complete unlock text with **privacy@meetevia.com**, as quoted in the controlling guide.
- `shared/age-flow.ts:25`: complete turning-18 message, ending **The camera stays locked until they do.**
- `shared/age-flow.ts:26`: the complete §6 Terms checkbox and §7 price/renewal/cancellation disclosure, withdrawal checkbox, payment button and guardian heading.
- `src/components/legal/AgeGuardianFlow.svelte:131`: independent unticked Terms/guardian-Terms/facial controls. Guardian and own-name facial variants use the exact Section 1 copy and footer. Explicit event values are recorded so checkbox binding order cannot reverse the recorded choice.

## Deviations and issues

1. **No persisted minor account.** The 16/17 locked case holds email/DOB in tab memory; the server refuses an ordinary account. A real pending-account schema, minimal credential architecture and 14-day deletion job remain necessary. No real user data should enter this walkthrough.
2. **Invitation is a preview, never sent.** The exact email is displayed; no delivery, token, 72-hour expiry, resend, guardian authentication or real invite acceptance is claimed. A minor case keeps the first-name merge field because the locked signup case intentionally retains no name.
3. **Verification remains unavailable.** Funding type, guardian-card name ownership, linked fingerprint and Illinois are explicitly labelled scenarios. UI rejects incompatible scenarios, but there is no Stripe funding evidence, charge/refund, fingerprint lookup or certified Illinois ID check. Advancing to a consent preview never verifies a guardian.
4. **No fabricated approval/unlock.** `Approve.` records an attempted review and displays the missing verification reason. The future unlock notice is clearly marked wording preview only. The review cannot unlock a camera. The wider app still lacks account-wide age/guardian `canScan()` enforcement, including existing/guest demo paths; this remains a pre-production blocker.
5. **Steps 9/10 are honest previews.** No guardian permissions, delegated export/deletion/subscription action, withdrawal-triggered deletion, birthday scheduler, guardian revocation or notification is implemented. The own-name continuation button stays disabled. These are explicit P-05/P-13 gaps.
6. **Domain conflict requires manager/counsel resolution.** The guide quotes `privacy@meetevia.com`, also mentions `@helloevia.com`, while the shorter build plan asks for the latter. The quoted guide text is preserved verbatim; no replacement was silently chosen.
7. **Legal publication remains incomplete.** Full Terms, Privacy, Disclaimer, Cookie, Biometric and Consumer Health policies are still publication previews. Version evidence records the actual placeholder IDs and explicit publication-pending markers. Sample choices do not make them approved.
8. **Logging limits are explicit.** Signed-in review choices are immutable account events. Guest/minor review choices have a per-tab actor/time/version/choice but no real account ID or server IP and are lost on departure. Pre-account signup refusal is not durably logged; under-16 rejection deliberately produces no stored attempt record.
9. **Later sections remain pending.** Debit/prepaid displays the correct branch and continues to guardian review with no successful age result. The swappable `verifyAge` function is Section 3. Full payment UI/provider work and confirmation email are Section 4. Section 2 includes their required preview surfaces and the payment availability guard only.
10. No live payment/age/guardian provider or manual browser/camera verification was performed. All verification uses sample data, fixture evidence and local automated checks.

## Validation

The required `npm run typecheck && npm run check && npm run test:local` sequence passed:

- TypeScript: exit 0.
- Svelte: 0 errors, 0 warnings; exit 0.
- Local tests: **34 files / 306 tests passed**, no failures or skips, in 184.32 seconds. The disposable database was stopped and discarded.
- Final checkbox-handler and navigation refinements also passed another TypeScript/Svelte check with zero errors or warnings.
- `git diff --check`: clean. `Manager/` remains ignored; metric labels and the Anthropic image path remain unchanged.

New checks cover exact legal strings, birthday boundaries, invalid DOB, funding routing, absent payment service, under-16/no-write behavior, rejection of ordinary minor accounts, stale Terms evidence, sample-only registration, atomic DOB/Terms persistence, rollback on logging failure, and rejection of fabricated guardian approval data.

## LEGAL_PROMISE_TRACKER.md snapshot diff

| Pledge | Section 1 state | Section 2 state / remaining gap | Owner |
| --- | --- | --- | --- |
| P-03 | Consent UI gate; no age gate | DOB signup rejection added; global age/guardian scan gate still not enforced for demo | Engineering |
| P-04 | Adult facial consent; guardian disabled preview | Exact interactive guardian/turning-18 review choices; no verified consent or production approval | Engineering + legal |
| P-05 | Age/guardian flow not built | Steps 1–10 UI implemented; persistent minor account, invite lifecycle, verification, permissions and birthday/unlock chain remain unenforced | Engineering + legal; manager for vendors/domain |
| P-06 | Stub/provider pending | Debit/prepaid branch visible; typed stub still Section 3 | Manager + engineering |
| P-07 | Checkout not built | Exact Terms/checkout preview and disabled payment guard; no subscription or confirmation email | Engineering + legal |
| P-13 | Partial owner data controls | Guardian controls previewed; no real delegated access/actions | Engineering |
| P-14 | Account facial events; guest limits | Atomic adult registration evidence and account review events added; guest/pre-account limits remain | Engineering |
| P-17 | Section 1 no-env guards | Sections 1–2 guarded; no Stripe/age provider required; age stub pending | Engineering |

All 17 pledge IDs remain. Other pledge states are unchanged. Full reasons, recommendations and owners are in `LEGAL_PROMISE_TRACKER.md`.

Paused before Section 3, as requested by the section approval checkpoint.
