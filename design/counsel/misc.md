# Counsel review: Learn, Settings, Profile, Privacy, Your data, legal pages, sign-in gate, intro

Key: `misc`. Written for counsel and the Founder (BUILD-PLAN decision 2: flagged wording is listed, not
silently rewritten). None of these pages is in the mockups, so sample mode shows the same wording as real
mode on every page listed here. The only sample-mode difference is the shell's profile pill in the page
header ("Destiny · Premium Member", covered by the shell's own counsel list). Real mode never invents a
value on these pages: every value is the account's own, the server's knowledge base, or a legal record.

SRS references are to `SRS-v2.txt` (clause IDs and section numbers).

## 1. Learn (`src/pages/LearnPage.svelte`, `src/pages/learn/basics.ts`)

### 1.1 Routine basics (evergreen copy written for this page)

Every sentence is meant to be general and cosmetic (MED-01, SRS section 10). Please confirm each one.

| # | Title | Body |
|---|---|---|
| 1 | Cleanse gently | A mild cleanser once or twice a day is usually enough. If skin feels tight afterwards, a gentler formula may suit it better. |
| 2 | Hydrate, then seal | Humectants such as glycerin or hyaluronic acid draw water into the skin's surface; a moisturiser on top helps hold it there. |
| 3 | Sunscreen every morning | A broad-spectrum sunscreen is the last step of a morning routine. Reapply it when you spend long stretches outdoors. |
| 4 | One new product at a time | Introduce new products one by one, a week or so apart, so you can tell what suits your skin. |
| 5 | Patch test first | Try anything new on a small area for a few days before using it more widely, and always read the label. |
| 6 | Thin to thick | A simple order is cleanser, then lighter serums, then moisturiser, then sunscreen in the morning. |
| 7 | Go easy on strong actives | Several exfoliating acids or retinoids at once can leave skin feeling dry or uncomfortable. One at a time is plenty. |
| 8 | Give it time | Most products need several weeks of regular use before any change is visible. Consistency counts for more than quantity. |

Page chrome: title "Learn"; subtitle "Plain guides to the basics of a routine, and to the ingredients that shape
one."; card subtitle "Evergreen habits that suit most routines."

Disclaimer lines (SRS section 6 persistent disclosure; section 10 "read labels and patch test"):
- Under the basics: "General cosmetic information for everyday skincare, not medical advice."
- Under the glossary: "General cosmetic information for everyday skincare, not medical advice. Read product
  labels and patch test anything new."

### 1.2 Ingredient glossary (server text, shown verbatim)

Source: `GET /api/public/ingredients` (new), which returns `label`, `family`, `irritationRisk` and `note`
from `server/skin/ingredient-data.ts` unchanged, plus the family names from `FAMILY_LABELS`. These notes
were written for the routine engine and have never been shown to users as reference text before. They are
reproduced as stored, not rewritten. When the API cannot serve the list (no server, or a deploy with no
database), the page builds the same list in the browser from the same code, so the wording is identical.

**Held back from the public glossary (not shown anywhere on Learn) until counsel clears them.** Their notes
name a prescription medicine or refer the reader to a clinician, which on a page anyone can open without an
account reads as treatment or referral (MED-01; SRS section 10, dermatologist referral outside V1). They
are left out rather than rewritten; the routine engine still uses them to recognise these ingredients on a
product label. The rule is in `server/skin/glossary.ts` (`heldFromGlossary`: a note mentioning
prescription, clinician, dermatologist, doctor or physician), and `test/ingredient-glossary.test.ts` pins
the list. The glossary shows 43 entries while these are held (46 in the knowledge base).

| Ingredient | Engine note (not shown) | Why held |
|---|---|---|
| Tretinoin | "Prescription retinoid. Powerful and reliably irritating at first. Nothing else exfoliating on the same night." | prescription medicine; MED-01 (treatment) |
| Topical antibiotic | "Prescription. Follow the prescribing clinician rather than a routine builder." | prescription and clinician reference; MED-01 (referral) |
| Hydroquinone | "Strong depigmenting agent, regulated in many markets and not for indefinite use. This belongs with a dermatologist, not a routine app." | dermatologist referral (MED-01; SRS section 10) |

Shown, and still needing a MED-01 / SRS section 10 decision:

| Ingredient | Flagged wording in `note` | Why flagged |
|---|---|---|
| Adapalene | "Retinoid aimed at breakouts. More stable and usually better tolerated than tretinoin, but still a retinoid." | treatment framing (breakouts is allowed wording, section 10); names tretinoin, a prescription medicine, in comparison; adapalene itself is prescription-only in some markets |
| Benzoyl peroxide | "Very effective on inflammatory breakouts" | "inflammatory" is condition language; efficacy claim |
| Tea tree oil | "Mildly antibacterial" | antibacterial claim |
| Azelaic acid | "breakouts, redness and pigmentation at once" | efficacy claim |
| Tranexamic acid | "Works well on stubborn pigmentation and post-inflammatory marks." | efficacy claim; "post-inflammatory" |
| Salicylic acid (BHA) | "The most useful acid for congestion and blackheads." | efficacy claim |
| Glycolic acid (AHA) | "Effective on texture and tone." | efficacy claim |
| Organic UV filter | "The single highest-value thing in any routine." | superlative claim |
| Essential oil | "Citrus oils can also be phototoxic." | health-risk statement |
| Sensitising preservative | "notable contact-allergy record" | allergy statement |
| Fragrance | "The most common contact irritant in skincare." | factual health claim |
| Potentially pore-clogging | "Reported as comedogenic for some people." | factual claim |

Family names shown as filter chips (capitalised from `FAMILY_LABELS`): Retinoids, Exfoliating acids,
Vitamin C, **Anti-bacterial actives** (flag: antibacterial claim), Barrier support, Humectants, Occlusives,
Sun protection, Brightening actives, Soothing agents, Peptides, Fragrance, Solvents, Preservatives,
Formulation base.

Each entry also shows "Irritation risk: None known / Low / Moderate / High" (from `irritationRisk`). This is
the knowledge base's own rating, not a measurement of the user; flag for whether "risk" needs a qualifier.

Glossary subtitle: "What Evia knows about the 43 ingredients and ingredient groups that shape its routine
suggestions." (43 is the live count of entries shown; it would read 46 if the held entries are cleared.)

Sample mode: identical to real mode (the glossary is reference data, not user data).

## 2. Settings (`src/pages/SettingsPage.svelte`)

SRS section 11 / SET-01 controls. What exists is linked; what does not exist is a plain-text row marked
"Coming soon" (not a link, not a button), so nothing pretends to work:

| Row | State | Wording | SRS |
|---|---|---|---|
| Profile | live link | "Your skin, the pregnancy question, how Evia explains things, and what it remembers." | SET-01 (preferences) |
| Privacy | live link | "Progress photos and cloud reasoning: two separate choices, both off by default." | CNS-04 |
| Your data | live link | "Download a copy of your data, or delete your account." | section 11 (download, delete) |
| Withdraw facial-scan consent | Coming soon | "Turn scanning off, with a clear account of which features stop and what is deleted, and when." | section 11, CNS-01, RET-04 |
| Marketing preferences | Coming soon | "Choose what, if anything, Evia may send you." | section 11, section 9 (under-18) |
| Cookie preferences | Coming soon | "Accept, reject or manage non-essential cookies." | section 11, CK-01 |
| Policy history | Coming soon | "The policy and consent versions you have accepted, with their dates." | section 11 (server route exists, no client yet) |
| Subscription and billing | Coming soon | "There is no subscription yet. Plans, billing and cancellation will be managed here." | PAY-02, section 8 |

Legal documents card: subtitle "Drafts for review. None of them is accepted by using the app."; each of the
eight records is listed by its own title and audience with a "DRAFT" tag while `status !== 'approved'`.

Account card: real mode shows the account email and "Member since {date}" (from `createdAt`); a guest sees
"Looking around" (or "Sample preview" when sample mode is on) and "No account. Nothing is saved when you leave."

Switches: "Evia's voice" (notes: "Remembered on your account." / "For this visit only. Nothing is saved while
you are looking around." / "This browser cannot speak and no voice is configured, so Evia stays quiet here."),
"Room sound" ("The room tone and the small cues. Remembered on this device."), "Sample data" ("Fill every page
with the design's sample data, labelled on screen the whole time. Nothing is saved.").

Not built: the minor-account Guardian notice (section 11 last line). There is no age or guardian data in the
app yet (AGE-01, GDN-01), so no row is shown; flag for where it should live.

## 3. Profile (`src/pages/ProfilePage.svelte`)

Behaviour unchanged (same fields, same save, same memories list). Page chrome moved from Evia's first person
("What I know about {name}.") to third person. Flagged items:

- Subtitle: "What Evia works from. Correct anything that is wrong, and the next answer uses the correction."
- Concerns field placeholder (unchanged from before): "acne, texture, dark spots" — **"acne" is a condition
  name** (MED-01; SRS section 10 allows "breakout-like areas"). Kept as it was; please decide.
- Pregnancy question (unchanged wording): "Are you currently pregnant, trying to become pregnant, or
  breastfeeding?" Hint: "This changes what Evia suggests, retinoids in particular. “Prefer not to say” is not
  read as a no: Evia stays cautious either way." — SRS section 10 says pregnancy information "is not a complete
  safety check"; the hint does not say that. Flag.
- Voice notes: "Evia reads its replies aloud in its own licensed voice." / "Evia reads its replies aloud in
  this device's built-in voice for now." / "This browser has no speech synthesis and no licensed voice is
  configured, so Evia cannot speak here."
- Memories: "Durable facts, kept apart from the conversation. Delete anything that is wrong or that you would
  rather it forgot." Empty: "As you talk, Evia keeps the things worth keeping — what you use, what flares,
  what you are working towards. They show up here, and you can strike any of them." (guest: "Nothing is
  remembered while you are looking around without an account.")
- Explanation styles (unchanged): Read the room / Keep it simple / Give me the detail / Gen-Z mode.
- Account line: "Member since {date}" from the account's own `createdAt`, written as Settings writes it. When
  no date is on record the line is left out (the old page fell back to today's date, which invented a value).

## 4. Privacy (`src/pages/PrivacyPage.svelte`)

- Subtitle (pronouns changed from Evia's first person, substance unchanged): "Your skin is measured in this
  browser. Unless you choose otherwise, the photo never leaves your device — only the numbers do, and only to
  Evia's own server." Previously: "Unless you tell me otherwise … only to my own server." Privacy claim: flag
  for accuracy against the final Privacy Policy (AI-01, RET-01).
- "On your device: The camera frame, the face detection, all nine measurements, and the label reader. None of
  it needs a network." / "On Evia's server: The numbers, your profile, your conversation, and what Evia
  remembers. Photos only with the first switch below — and encrypted if so." (claims; flag)
- Progress-photo switch: label and body are `LEGAL_CONTENT['progress-photo-consent']` title and body,
  unedited (placeholder draft). The switch is disabled while the wording is a placeholder, when the server has
  no image key, and for guests; each reason is said in full.
- **Cloud-reasoning disclosure kept word for word, still in Evia's first person** ("Let me think in the
  cloud", "Turning it on lets me send what you type, your name, skin type, stated concerns and sensitivities,
  anything I have remembered about you, and your scan history to the model I think with (Anthropic)…"). Its
  wording version `cloud-reasoning-v1` is a placeholder. Needs counsel wording (CNS-02, AI-01, AI-02).
- New status pills: "Progress photos off/on", "Cloud reasoning off/on" (read from the recorded consent).
- New line when photos exist: "You have N saved progress photos. Delete any of them from Progress." (section 11:
  per-photo delete lives on Progress.)

## 5. Your data (`src/pages/DataRightsPage.svelte`)

Flow unchanged: typed "DELETE", then a separate "Final confirmation" ("This cannot be undone. Delete the
account and all attached data now?"), no double submission. Notice text is the centralised placeholder copy
from `src/legal/content.ts`, shown unedited with its "Placeholder legal text · {id}" tag in development:
- `DATA_EXPORT_NOTICE_PLACEHOLDER`: "Your download contains the account data currently held by **Elohim**…"
  (brand name, G5; not changed because it is legal copy).
- `ACCOUNT_DELETION_NOTICE_PLACEHOLDER`: "…Processor propagation, backup handling, and final wording remain
  unresolved." SRS section 11 asks for an "explanation of legally retained records"; the placeholder does not
  give one.
- New guest line: "You are looking around without an account, so nothing is stored to download or delete.
  Both actions work once you sign in."

## 6. Legal pages (`src/pages/legal/*`, `src/components/legal/*`)

Record text, titles, version ids, effective-date labels and action labels are shown exactly as stored in
`shared/legal-content.ts`. The review-build notice is preserved verbatim: "Placeholder · review only — This
draft is not counsel-approved and cannot unlock a production legal gate." The consent decision still has no
pre-selected choice, separate equally prominent Accept and Decline buttons, Skip only for optional records,
and "This placeholder cannot be submitted as consent." New chrome: eyebrow "Consent" or "Legal document",
a "Back" button, and an "Other documents" list. Known gap (data-map G10): decisions POST to
`/api/legal/consents`, which does not exist.

## 7. Sign-in gate (`src/components/AuthGate.svelte`)

Page chrome rewritten for the new design (the old pitch said "A beauty consultant who can actually look at your
skin" and "Ask her anything… she reads your face", which code-shell.md section 7 already flagged for MED-01):
- Title "Welcome to Evia"; lede "An AI skincare consultant. Ask anything, scan your skin with your own
  camera, and see what changes over time." (brand name G5; "see what changes" = stored analysis history).
- Demo note: "DEMO MODE — This server is seeded with a demo account and six scans of history." with the button
  "Use the demo account demo@elohim.local demo1234" (only when the server runs in demo mode).
- Local-engine note: "Conversation runs on Evia's built-in engine rather than the full model. Your scans,
  storage and trends are real either way."
- Offline / no-database notes (unchanged in substance).
- Register step placeholder kept: "Legal review step (not active) — No agreement is collected on this screen."
- Ways in: "Look around without an account — Evia talks (in its own voice), scans and reads. Nothing is saved
  when you leave." Note: when the guest voice is on, the guest's replies are sent to the voice provider; the
  button does not say so (it did not before either). Flag.
- "Preview with sample data — Every screen filled in with clearly labelled sample data."
- Promise (unchanged): "Skin scans are analysed on your device. The photo never leaves it unless you say so."
- Legal line (unchanged): "Review the placeholder Terms and Privacy Policy. These drafts are not accepted by
  signing in or creating an account."
- AI disclosure added (shell component): "Evia is an AI. General skincare guidance, not medical advice."
- Not built, needed before launch: DOB / age gate (AGE-01), guardian flow (GDN-01), facial-scan consent before
  first scan (CNS-01), checkout disclosure (PAY-01), cookie banner (CK-01).

## 8. Intro (`src/components/Intro.svelte`)

Restyled captions only; the beat text lives in `src/lib/intro.ts` and `src/lib/lines.ts` (not in this lane)
and is unchanged. Beat 1 now shows the "evia" wordmark instead of the word "Elohim". Flagged beat wording:
- "A beauty consultant who can actually look at your skin." (MED-01 framing)
- "She reads nine things." + list: hydration, texture, redness, pores, tone, under-eye, dark spots, oiliness,
  **breakouts** (allowed as "breakout-like areas", section 10). "She" refers to a character that is not shown
  (decision 3).
- "Measured here. On your device. The photo never leaves it unless you say so." (privacy claim)
- "And remembered. Next time, she shows you what changed — and what to do about it." ("what to do about it":
  advice framing, MED-01)
- "Say hello."
