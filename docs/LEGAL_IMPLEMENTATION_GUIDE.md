# EVIA — Legal Implementation Guide

> **Source:** `Manager/` — Adams final document (21 Sept 2026, effective 1 Oct 2026) + `Evia product requirement 2.docx` (SRS v2.0). This guide extracts every site-facing pledge, verbatim screen, and mindset needed to implement Sections 1-5 without paraphrasing.
> **Manager/ is git-ignored** — this file is the tracked distillation. Always implement from `Manager/` originals; this guide is for orientation only.

**Authority rule (SRS v2.0):** Where SRS, repo docs, or product preferences conflict with the final legal pack (consent, age, retention, privacy, subscription, data use), **the legal pack controls** until counsel issues a revision.

**Domain note (Legal Advisory Memo §1):** All final docs use `www.helloevia.com` / `meetevia.com` and `@meetevia.com` / `@helloevia.com`. Founder has notified counsel of name change. **Use final counsel-confirmed domain/email verbatim in UI** — do not silently edit `www.meetevia.com` → `www.helloevia.com`.

---

## 1. Inventory of source documents

| File in Manager/                                            | What it is                                                                  | Site surfaces                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| `Evia_In_App_Consent_Wording_Pack.docx` v1.0 21-Sept        | **10 verbatim screens** to build in-app (see §3 below)                      | Every consent gate, checkout, banner, settings |
| `Evia_Terms_of_Service.docx` v1.01 1-Oct                    | 25 sections, Wyoming law, 1309 Coffeen Ave STE 1200, Sheridan WY            | Registration checkbox + Guardian flow          |
| `Evia_Privacy_Policy.docx` v1.0 1-Oct                       | 25 sections, GDPR/UK GDPR/state law, EEE+UK rep via Art.27                  | Data collection/use, rights, transfers         |
| `Evia_Biometric_Data_Policy.docx` v1.01 1-Oct               | Public retention/destruction policy for BIPA/Texas/WA/GDPR Art.9/13         | Biometric retention table, written release     |
| `Evia_Consumer_Health_Data_Privacy_Policy.docx` v1.01 1-Oct | MHMDA / NV SB370 / CT DPA policy                                            | Health data categories + sharing               |
| `Evia_Cookie_Policy.docx` v1.01 1-Oct                       | `www.helloevia.com` + app cookie policy                                     | Banner + preferences                           |
| `Evia_Health_Wellness_and_AI_Disclaimer.docx` v1.01 1-Oct   | Not a medical device, not a diagnosis                                       | Consultation disclaimer                        |
| `Evia_Legal_Advisory_Memo.docx` 21-Sept rev.                | 9-point memo + approved minor onboarding architecture (Table §2, 6 changes) | Engineering must build memo Table verbatim     |
| `Evia product requirement 2.docx`                           | SRS v2.0 Final Baseline — P0 ID table + state machine                       | Acceptance tests for every gate                |

---

## 2. Legal pledges that must be true in the running app

### Biometric (Biometric Policy §3-6, Privacy §5, Consent Pack §1)

- **Purpose:** One purpose only — skin analysis you request → temporary holographic visualisation → structured results → personalised routine/product suggestions. Duration = scan session only. **Never background/continuous/idle collection.**
- **Never uses:** Never estimate/verify age from face; never identify/authenticate; never face recognition / DB match; never infer race, ethnicity, age, gender, emotional state; never security/surveillance/law enforcement.
- **Written notice + release before collection:** Dedicated screen separate from registration & Terms, states what, purpose, duration, who processes. Record: account ID + datetime + wording version + choice. **For 16/17, release is executed by verified parent/guardian** after credit-card adulthood verification (+ Illinois ID doc check), and camera not available until recorded.
- **Withdrawal:** Settings or `privacy@helloevia.com` → biometric data destroyed per schedule, scan features unavailable.
- **No profit:** No sale/lease/trade of biometric data; provider only processes under written agreement.
- **Disclosure:** Only to facial analysis provider to perform analysis. **Facial photographs are not sent to conversational AI providers (OpenAI/Anthropic), analytics, advertising, or brands** — `Privacy §11`, `Consumer Health §5` table: AI providers receive **structured results + consultation text only**.
- **Retention table (stricter than 3-year outer limit):**

| Data                        | Retention                               | Destruction                                                                   |
| --------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| Raw scan images             | Session only                            | After session ends/abandoned, **≤24h** from us + instructed provider deletion |
| Facial landmark/geometry    | Session only                            | Deleted with raw images once analysis complete                                |
| Holographic visualisation   | In-session temporary                    | Not stored; discarded on session end                                          |
| Structured analysis results | While account active (for skin history) | On consent withdrawal or account deletion, **≤30 days**                       |
| Optional progress photos    | Only if opted-in, until delete          | On request / withdrawal / account deletion                                    |
| Consent/destruction records | Duration of consent +5 years            | Kept to prove compliance; contains no biometric data                          |
| Backups                     | Rotation ≤35 days                       | Isolated, not used                                                            |

> **Promise tracker P-01 (direct conflict):** `server/ai/claude.ts:133 describeSkinImage` currently sends face images to Anthropic — conflicts with policy `not sent to conversational AI`. Demo constraint: log only, manager decides disable vs reword via counsel before prod.

### Consumer Health Data (Consumer Health Policy §2-7, Privacy §6)

- **Categories:** Scan images + landmark data + analysis results (redness/texture/pigmentation/hydration/breakout etc.) + skin info you provide + optional safety (allergies/meds/pregnancy) + optional lifestyle (sleep/diet/water) + optional progress photos + health-related messages + identifiers (account/email/DOB).
- **Why:** Only to perform scan, generate/explain results, maintain history, personalise/filter suggestions, support, security, legal. **Not for advertising, not for unrelated profiling, not to infer characteristics beyond service needs.**
- **Where from:** You (onboarding/scans/support), service-generated analysis, facial analysis provider (results on our instructions).
- **Sharing:** We **do not sell** (never have, never will — WA requires signed authorisation). Disclosures only to processors under written agreement:

| Recipient                        | Purpose                 | Data                                             |
| -------------------------------- | ----------------------- | ------------------------------------------------ |
| Facial analysis provider         | Skin analysis           | Scan images, landmarks, results                  |
| AI providers (OpenAI, Anthropic) | Explaining results      | **Structured results + text, not facial photos** |
| Hosting/DB                       | Storing/running service | Account + skin data                              |
| Support/comms                    | Service messages        | Identifiers + message content                    |
| Advisers/authorities             | Legal/compliance        | Only necessary                                   |

No sharing with advertising platforms, data brokers, insurers, employers, brands. Specific sub-processors listed on request.

- **Consent:** Opt-in before collection; collection consent ≠ sharing consent (sharing requires separate checkbox naming recipient/purpose/withdrawable). New category/purpose needs fresh consent. Withdrawal in Settings or `privacy@helloevia.com`, as easy as giving.
- **For 16/17, consents are given/withdrawn by verified Guardian.**
- **How long:** Scan images/landmarks = session only; results/history = while account active; progress photos = until delete. Full table in Privacy §15 / Biometric §6.
- **Rights (WA/NV/CT):** Confirm, access incl. third-party list + contacts, withdraw, delete (propagated to providers/backups ≤35 days). Request via `privacy@helloevia.com` from account email, verified by address; 45 days +45 extension; denial → appeal via `Appeal` subject → AG complaint (WA atg.wa.gov).

### Privacy general (Privacy §3 summary, §13 sell)

- **Key points (verbatim §3):** Express consent before scan; raw images deleted after session (results kept for history); progress photos optional opt-in; face never used to identify/infer race etc.; **no sale of personal data, no sharing for cross-context behavioural advertising**; facial photos not sent to conversational AI, not used to train general models; delete account anytime in Settings; 16/17 cannot scan without verified Guardian.
- **Do not sell health/advertising:** No facial/skin/health data to advertising platforms; advertising tech only on marketing surfaces, only with required consent, **scan events/results/health answers never transmitted** (`Cookie Policy §4`, `Privacy §13`).

### Terms — age & guardian (Terms §3, Advisory Memo §2 approved version)

- **Eligibility:** 16+ only, under-16 blocked, do not store blocked attempt data.
- **18+:** DOB collected; **no camera until Steps complete.** Credit card → camera may unlock after scan consent. Debit/prepaid → non-biometric age check via certified email-based provider before scan (uses email, not face). On failure → route to 16/17 flow.
- **16/17 locked account:** Holds only email + DOB. Email Guardian → approve within **14 days** or account + data deleted. Guardian must: (a) credit-card payment in own name (subscription as payor or nominal refunded charge), name matches, not already linked to user; (b) confirm parent/guardian relationship (unticked checkbox); (c) accept Terms for self+minor; (d) give biometric/health consents as legally authorised representative; (e) Illinois → ID document check via certified provider. Guardian is account holder for payment, gets login to view/download/withdraw/delete/manage subscription. Minor told `They can see your stored data and can delete your account at any time. privacy@meetevia.com`.
- **Turning 18:** Guardian access ends, notify Guardian, show user `You are now 18. To keep using Evia... accept Terms and give scan consent in own name. Camera stays locked until done.`
- **Under-18 protections:** No behavioural advertising, no marketing audience, no marketing comms, no profiling beyond service, high privacy defaults, no dark patterns to weaken privacy (UK Age Appropriate Design Code).

### Cookie (Cookie Policy §1-3)

- Strictly necessary always active. **All other categories off by default, load only after accept.** Banner on first visit with **equally prominent Accept all | Reject all | Manage preferences**. Change/withdraw anytime via footer `cookie settings`. Non-essential not placed until consent where law requires; honour `Global Privacy Control` where opt-out model.
- Categories table in policy §3: strictly necessary (session/12m for consent records), functional, analytics, marketing — only necessary active by default.

### Disclaimer (Health, Wellness & AI Disclaimer §1-8)

- **Not a medical device/diagnostic:** Wellness/skincare information only, no doctor reviews scan in standard service, no doctor-patient relationship.
- **What analysis tells you:** Cosmetic observations (apparent redness, texture, tone, pigmentation, hydration, breakout-like areas). **Does not identify/confirm/exclude any medical condition, cannot detect cancer/melanoma/infection etc., never use to decide on mole/lesion/rash.** `this area may benefit from professional opinion` is general prompt, not diagnosis/triage/referral; absence is not reassurance.
- **Always seek professional advice:** New/changing/bleeding/painful/non-healing spots → healthcare promptly; emergency → local emergency services.
- **AI limits:** AI (incl. facial analysis + LLMs). You are chatting with automated system, not human. Outputs probabilistic, can be inaccurate/incomplete, vary by session, affected by camera/lighting/makeup/facial hair/skin-tone rendering/device. You are responsible for decisions.
- **Products:** General, not guarantee of suitability/safety; always read label, patch test, stop + seek advice on irritation/rash/swelling/breathing difficulty. Allergy/meds/pregnancy filters are best-effort, not safety check. Commercial arrangements disclosed, not clinical endorsement.
- **No guarantee of results;** 16/17 encouraged to discuss with parent/clinician. Liability per Terms.

### Subscription (Consent Pack §7, Terms §14-15)

- Disclosure in same visual block above button: `You are subscribing to Evia. 20.99 US dollars for the first month, then 40 US dollars per month until you cancel. Charged to your payment method each month. Cancel any time in Settings or through the Stripe customer portal.` EU/UK → unticked required checkbox `I ask Evia to start the service immediately, and I understand that I lose my 14-day right of withdrawal once the service has been fully performed.` Button: `Subscribe and pay 20.99 US dollars`. For 16/17, Guardian subscribes with heading `You are subscribing on behalf of [user's first name].` Confirmation email must repeat intro price, renewal price, renewal date, cancellation method.

---

## 3. Verbatim in-app screens (Consent Wording Pack v1.0) — build exactly

**Rules that apply to every screen (pack header):** Each consent = separate, unticked control; no bundling; request appears before processing begins; refusing as easy as agreeing; every acceptance logged with **account identifier + datetime + wording version + choice**. Text in `[]` = merge field.

### 1. Facial Scan Consent (before first scan)

- Heading: `Before your first scan`
- Body: `To analyse your skin, Evia uses your camera to capture images of your face and creates facial landmark data from them. This is biometric and health-related data, so we need your permission first.` + bullets `What we collect: images of your face captured during the scan, facial landmark data derived from them, and the analysis results.` / `What we use it for: analysing your skin, showing you the holographic visualisation, and personalising your routine and product suggestions.` / `Who processes it: Evia and our facial analysis provider. Your facial photographs are not sent to our conversational AI providers.` / `How long we keep it: your scan images and landmark data are deleted after your analysis and consultation session, and in any event within 24 hours. Your analysis results stay in your account so your skin history works, until you delete them or your account.` / `What we never do: we never use your face to identify you, never infer your race, ethnicity, age or gender from it, and never sell or share it with brands or advertisers.`
- Checkbox (unticked): `I have read the Biometric Data Policy and I give Evia my consent to capture and process my facial images and facial landmark data for skin analysis as described.`
- Buttons: `Agree and continue` / `Not now` | Link row: `Biometric Data Policy | Privacy Policy | Consumer Health Data Privacy Policy` | Footer: `You can withdraw this consent at any time in Settings, and we will delete the related data.`
- **Guardian version (16/17, shown to verified Guardian in §5):** Checkbox reads `I am the parent or legal guardian of this user and, as their legally authorised representative, I give Evia my consent to capture and process their facial images and facial landmark data for skin analysis as described.`

### 2. Consumer Health Data Consent (WA/NV/CT)

- Heading: `Permission to collect your skin and health information`
- Body: `Information about your skin, and anything you tell us about allergies, medications or pregnancy, is treated as consumer health data where you live. We collect it only to provide the service you have asked for.`
- Checkbox (unticked): `I consent to Evia collecting my consumer health data as described in the Consumer Health Data Privacy Policy.` Sharing consent: none shown at launch (no sharing beyond processors). Footer: `We never sell consumer health data.` If sharing added later, add separate unticked checkbox naming recipient/purpose/withdrawable.

### 3. Optional Safety and Lifestyle (skippable)

- Heading: `Optional, and only if it helps your results`
- Body: `Telling us about allergies, medications, pregnancy or breastfeeding, or about sleep, diet and water intake, helps us filter suggestions. You can skip this, and you can delete it later. It is not a safety check, so always read product labels and speak to a healthcare professional where needed.`
- Checkbox (unticked): `I choose to share this information and consent to Evia using it to personalise my suggestions.` Button: `Skip for now`

### 4. Progress Photographs (separate opt-in, default OFF)

- Heading: `Save this photo to track your progress?`
- Body: `By default we delete your scan images after your session. If you would like to compare your skin over time, we can save this photo to your account instead.`
- Checkbox (unticked): `Save my progress photos. I understand they are stored in my account until I delete them or delete my account, and that I can turn this off at any time.` Default off.

### 5. Age Assurance and Guardian Approval Flow (build every step, camera technically disabled until approval)

- Step 1 sign-up: Fields `email, password or Google or Apple sign-in, date of birth`. Line under DOB: `Evia is for people aged 16 and over.` Blocked <16: `Sorry, Evia is only available to people aged 16 and over.` Do not store blocked attempt.
- Step 2 adults 18+: Proceed to checkout. Stripe reports funding type. Credit → camera may unlock after §1 scan consent. Debit/prepaid → show `One more quick check. Because your card could belong to someone under 18, we need to confirm your age before you can scan. This uses your email address, not your face.` → run certified email-based age check. On failure → Step 3 as under-18.
- Step 3 locked 16/17: Heading `We need a parent or guardian to approve this.` Body `Because you are under 18, a parent or legal guardian has to confirm who they are and agree before you can use the camera. Enter their email address and we will send them the details. Your account will be deleted if they have not approved it within 14 days.` Field: guardian email. Holds only email+DOB.
- Step 4 email: Subject `Your approval is needed for Evia.` Body `[User's first name] has asked to use Evia, an AI skincare app that scans the face to analyse skin and suggest routines and products. Because they are under 18, Evia needs a parent or legal guardian to confirm who they are and approve before any scan. Evia is a wellness app, not a medical service. We never sell your child's data, never use it for advertising and never use their face to identify them.` Button `Review and approve.` Line `This link expires in 72 hours. If you did not expect this email, you can ignore it and the account will be deleted.`
- Step 5 Guardian verification: Fields `Guardian full name` + declaration (unticked) `I confirm I am the parent or legal guardian of this user.` Then payment: Guardian subscribes as payor on credit card in own name (preferred) or nominal refunded verification charge. Rules credit-only, name matches, reject card fingerprint already linked to user. Illinois → add ID document check via certified provider.
- Step 6 Guardian consent: Show **Terms §6** + **Scan consent §1 Guardian version**, plus unticked `I accept the Terms of Service on my own behalf and on behalf of this user.` Statement `Accounts of users under 18 are never used for advertising, never included in marketing audiences and never sent marketing messages.` Button `Approve.`
- Step 7 approval record (log): `user account ID, Guardian name+email, relationship declaration, verification method+result, card type, last4, fingerprint token, Illinois ID result where applicable, wording version of every doc shown, date, time, IP address.`
- Step 8 unlock notice: `Your parent or guardian has approved your account. You can now scan. They can see the data stored in your account and can delete your account at any time. You can also contact privacy@meetevia.com about your data.` (also show `@helloevia.com` per current pack — use final domain after counsel confirm).
- Step 9 Guardian login controls: `view stored data, download it, withdraw consent, delete account, manage subscription.` Withdrawal locks account and triggers deletion.
- Step 10 turning 18: End Guardian access, notify Guardian, show user `You are now 18. To keep using Evia, please accept the Terms and give your scan consent in your own name. The camera stays locked until they do.`

### 6. Terms Acceptance at Registration

- Checkbox (unticked, required): `I have read and agree to the Terms of Service, and I have read the Privacy Policy, the Health, Wellness and AI Disclaimer and the Cookie Policy.` Note: Privacy, Cookie, Disclaimer are notices (links to read), not contracts bundled with Terms. Record version of each doc shown.

### 7. Checkout and Subscription Disclosure

- Same visual block above button: `You are subscribing to Evia. 20.99 US dollars for the first month, then 40 US dollars per month until you cancel. Charged to your payment method each month. Cancel any time in Settings or through the Stripe customer portal.` EU/UK checkbox (unticked, required): `I ask Evia to start the service immediately, and I understand that I lose my 14-day right of withdrawal once the service has been fully performed.` Button: `Subscribe and pay 20.99 US dollars` (Guardian checkout heading: `You are subscribing on behalf of [user's first name].`) Confirmation email must repeat intro price, renewal price, renewal date, cancellation method.

### 8. AI Disclosure Inside Consultation

- Persistent label top: `You are chatting with Evia, an AI assistant. This is general skincare guidance, not medical advice.`
- Line under every analysis result: `Cosmetic observations only. Evia does not diagnose medical conditions.`
- Escalation where concerning feature appears: `Evia cannot tell whether this needs medical attention. If this area is new, changing, painful or not healing, please have it looked at by a healthcare professional.`

### 9. Cookie Banner (two layers)

- First layer: `We use strictly necessary cookies to run Evia. With your permission we also use analytics and marketing cookies. We never send your scan images, skin results or health answers to these tools.` Buttons equally prominent: `Accept all | Reject all | Manage preferences`
- Second layer: toggles by category, off by default except strictly necessary, with provider names + durations + Save button.

### 10. Account Controls in Settings

- `Withdraw scan consent, with plain explanation of what stops working and what is deleted.`
- `Turn progress photos on or off, and delete individual photos.`
- `Download my data.` `Delete my account and all data, with confirmation and statement of what is retained for legal reasons.` `Manage marketing preferences.` `Manage cookie preferences.` `View version of each policy accepted, with date.` For under-18: visible `Guardian has access` notice + Step 9 controls.

---

## 4. Mindset / framing when approaching those sides

**This is a high-risk biometric + health-data product, not a normal SaaS:**

- Break the product by bad consent wording more often than by bad policy — make each consent separate, unticked, before processing, refusable, logged with account/version/timestamp/IP.
- **Never use face as age oracle.** DOB + payment card + certified email/ID provider are the age signals; biometric is never the age check.
- **Vault mindset for raw images:** Raw images + landmarks are transient session fuel, not content. Delete after session, ≤24h absolute, instruct provider to delete, audit destruction. Only structured results are durable (for history). Progress photos are explicitly opt-in, off by default.
- **Language is load-bearing:** Wellness observations only — `apparent redness/texture/pigmentation/hydration/breakout-like areas`. Never diagnose, triage, refer, infer race/ethnicity/age/gender/emotion, identify, or guarantee product efficacy/safety.
- **Minors are 16+ only everywhere, with Guardian as account holder for 16/17.** Apply strictest rule globally (Illinois BIPA, Age Appropriate Design Code high privacy defaults) even where local law allows more.
- **No age inference, no behavioural advertising to minors:** Do not use under-18 data for marketing audiences, profiling, or ad sharing; high privacy defaults; no dark patterns to encourage more data.
- **No silent gaps for demo:** Demo may show screens and log choices but not hard-block camera; every such gap = `Not yet enforced for demo, must enforce before prod` in `LEGAL_PROMISE_TRACKER.md` — never hide, never fake approval.
- **Provider discipline:** Facials → facial analysis provider only; structured results → OpenAI/Anthropic only (never photos); never to analytics/ads/brands. Training of general models disabled; DPA + processor list on request.

## 5. P0 SRS v2.0 — engineering acceptance mapping (what must pass before launch)

| ID              | Requirement                                                                        | Gate before prod                            |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| AGE-01          | 16+ routing, under-16 blocked, 16-17 locked                                        | Server-side camera/API 403 without approval |
| AGE-02          | Credit = adult, debit/prepaid → certified non-biometric check                      | Debit without check cannot unlock scan      |
| GDN-01/02       | Guardian verification + declaration + consents + IL ID check                       | No scan until full approval record exists   |
| CNS-01          | Facial scan consent separate unticked                                              | Logged account/date/time/version/choice     |
| CNS-02          | Health consent WA/NV/CT                                                            | Distinct flow, logged                       |
| CNS-03          | Safety/lifestyle optional                                                          | Skippable, not blocking                     |
| CNS-04          | Progress photo opt-in off                                                          | No photo persists without opt-in            |
| RET-01/02/03/04 | Session deletion, landmarks, hologram, history 30d after withdrawal/deletion       | Deletion log + abandoned-session job        |
| SEC-01          | TLS, encryption at rest, least privilege, admin MFA/log, incident response         | Signed launch checklist                     |
| AI-01           | Photos not to AI providers                                                         | Payload audit shows no image                |
| AI-02           | No training of general models                                                      | Provider settings/DPA retained              |
| MED-01          | No diagnosis/treatment/triage                                                      | Safety tests reject diagnostic wording      |
| PAY-01/02       | Disclosure $20.99→$40, confirmation email, cancellation via Settings/Stripe portal | Same-block disclosure + email               |
| CK-01           | Non-essential cookies off, Accept/Reject/Manage equally prominent                  | No tech pre-consent                         |
| ADS-01          | No scan/analysis/health to ad platforms                                            | Event audit                                 |

## 6. How to update this guide

When `Manager/` receives a counsel revision (new Version `1.x` date), re-run `python3 scripts/extract_manager_docs.py` (or the `unzip -p word/document.xml` extract above) and update this file + `shared/legal-content.ts` wordingVersionIds together, keeping `status:'approved'` only after counsel signs.

---

_Generated 2026-09-24 from `Manager/Adams final document .zip` (8 docs) + `Manager/Evia product requirement 2.docx` (SRS v2.0). Domain finalisation pending — do not publish with draft domain._
