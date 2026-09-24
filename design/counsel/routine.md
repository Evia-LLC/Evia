# Counsel review: Routine page

Page: `/routine` (`src/pages/RoutinePage.svelte`, `src/pages/routine/*`, `src/view/routine.ts`,
`src/sample/fixtures/routine.ts`). Reference: `ref1.png`, right-hand panel (specs/routine.md sections 7-8,
data-map.md section 3).

Two modes:

- **Sample mode** (`?sample=1` or "Preview with sample data"): the mockup's text, numbers and states,
  verbatim, with the "Sample data" badge pinned top-centre the whole time. Nothing is read from or
  written to the server. The mockup's demo video of a person is replaced by an abstract drawing of the
  technique (no face, no figure; BUILD-PLAN decision 3).
- **Real mode**: only what `GET /api/routine/plan` returns (the deterministic plan built from the latest
  scan, the profile and the products in use: steps cleanse / treat / hydrate / protect, each with its
  reason, rationale and cautions), plus the user's own products, outcomes and review. A guest sees the
  plan their in-tab scan produced, or an empty state; nothing is requested for a guest.

Nothing below has been reworded silently: every flagged sample-mode string is shown verbatim, and the
real-mode wording that replaces or accompanies it is listed so counsel can approve or change it.

## 1. Header

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Subtitle | "Your personalised skincare plan" | Same words (the plan is derived from the user's own reading and profile) | §10 "Product suggestions are general" - is "personalised" acceptable next to that? |
| Description | "Step-by-step guidance, tailored to your skin, your goals and your lifestyle." | "Suggestions built from your latest skin reading and the details in your profile." ("and the details in your profile" only when the profile holds a skin type, sensitivities or a pregnancy answer: the plan reads those three, never `concerns`, so concerns alone do not count). No scan: "Scan your skin once and the steps are built from that reading." Guest: "... Nothing is kept after you leave." Scanned but nothing to change: "Your latest reading did not call for any changes." | CNS-03 (lifestyle data is an optional consent: "your lifestyle" is untrue for anyone who skipped it); the app has no "goals" field |

## 2. Time-of-day tabs

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Morning / Evening / Weekly | Tabs; the mockup's morning list; empty states "No evening steps in this sample" / "The sample shows a morning routine only. When a plan says which steps are for the evening, they appear here." and "No weekly steps in this sample" / "When a plan includes something to do once or twice a week, it appears here." | No tabs (the plan has no time-of-day data). A note: "These are suggestions grouped by kind, not steps to do in one go: your plan does not say which are for morning or evening. Read each one’s notes before using two together." Tabs return automatically if the server adds a `slot` per suggestion | No invented timing or order (BUILD-PLAN decision 2). The plan has no order of application: the server sinks already-covered items after SPF, and some `treat` cautions forbid combining ("Never the same night as another acid."), so real mode never claims a sequence |

## 3. Step card

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Counter | "Step 2 of 4" | "Suggestion 2 of 3" (a count, not a sequence) | No invented order (decision 2) |
| Step one-liner | "Prep and rebalance your skin." | "Look for {actives}" (the ingredients the plan names) | MED-01 / §10: cosmetic efficacy claim ("rebalance") needs approved wording |
| Duration | "30 seconds" | Hidden (no durations exist) | Amounts and durations are general usage guidance and must defer to the product label (§10) |
| Instructions | "After cleansing, apply a few drops of toner to your hands or a cotton pad and gently press onto your face and neck." | The plan's own rationale (`Suggestion.why`), e.g. "It is oil-soluble, so it clears the inside of pores rather than just the surface." and, for the retinoid rule, "The most evidence-backed thing there is for surface texture. Slowly is the whole trick." | MED-01: engine copy in server/skin/recommend.ts carries efficacy language ("evidence-backed", "clears the inside of pores", "Calms visible irritation and supports the barrier") - please review the engine's `why` strings, which this page now shows prominently |
| Tip box | "Evia tip" / "Use gentle, patting motions. Don’t rub. Let it absorb for a few seconds before the next step." | "Keep in mind" with the plan's cautions verbatim (e.g. "Once a day at most to start.", "Not for use if you are pregnant, trying to conceive, or breastfeeding - tell me if any of those apply and I will swap it.", "Pointless without daily SPF."). Hidden when there are none | §10 "Allergy, medication and pregnancy information may filter suggestions ... but is not a complete safety check" - the pregnancy caution is a filter, not a safety check |
| Reason | (none) | A "CLEANSE" / "TREAT" / ... chip and "For your {metric} reading". SPF (the one rule with no reading behind it; the server adds it whenever no *logged* product has SPF): account "Added because no product you have logged has SPF"; guest "Sun protection is part of every plan" | Allowed cosmetic observation (§10). The SPF wording must not claim to know what the user actually uses: for a guest or an empty product list the plan's own caveat is "I don't know what you're currently using" |
| Video / 3D View, player, full screen | Shown. The "video" is an abstract drawing (glowing arrows, press ripples, the caption "Gentle, upward motions") on a 0:12 / 0:30 timeline | Not shown (no lesson media exists) | Demo imagery must be synthetic/licensed and labelled; no user face (routine.md §8.6) |
| 3D View | "3D view is not ready yet" / "When it is, it will be a labelled demo model showing the technique, never your own face." | Not shown | SRS §6, RET-02/RET-03 (a hologram of the user's head is never stored, so a later 3D view can only be a demo model) |
| "See products with this" | Not shown | A link to /products when the shelf has a pick for that step | ADS-01 / decision 11 (the Products page owns affiliate links; this is an in-app link and carries no scan data) |

## 4. Routine list

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Heading / meta | "Your morning routine" / "4 steps • ~6 min" | "Your plan" / "{n} suggestions" or "{n} suggestions, {k} already covered" (no minutes: no durations exist) | No fabricated adherence or timing (decision 2; routine.md §8.9) |
| Order / groups | An ordered list 1-4 | Grouped by kind (cleanse, treat, hydrate, protect); anything a logged product already covers is listed separately under "Already covered by your products" | No invented order (decision 2) |
| Row one-liners | "Remove impurities without stripping your skin." / "Prep and rebalance your skin." / "Helps with tone, texture and oil balance." / "Lock in hydration and support your skin barrier." | "Look for {actives}" | MED-01 / §10: cosmetic efficacy claims ("rebalance", "skin barrier" support, "oil balance") need approved wording |
| Amounts | "30–60 seconds", "30 seconds", "2–3 drops", "A pea-sized amount" | The step kind ("Cleanse", "Treat" ...), "· already covered" when a product in use does the job | §10: must defer to the product label (the page footer says so) |
| Row states | done (green tick), current (play), locked (lock) | No completion state at all: every step is "open"; the step shown in the card is highlighted | No fabricated adherence (decision 2) - there are no completion records |
| Product pictures | Unbranded SVG tube, bottle, dropper and jar; the jar's black label carries abstract lines only (no text, no "Evia" mark) | The same unbranded drawings by step kind, or a real catalogue image when a shelf pick has one | routine.md §8.8: no imitation of real trademarks; no fabricated product imagery |
| Reorder | A local reorder ("This sample order is not saved.") | Not shown (no order can be saved) | - |

## 5. "Why this routine?"

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Body | "This routine is based on your skin analysis, your concerns and your goals. It may change over time as we learn more about your skin." | "This routine is built from your latest skin reading[ and the details in your profile]. It is worked out again from your newest scan each time you open it. {plan caveat}" (caveats: "That capture was not a confident one, so treat this as a starting point rather than a verdict." / "I don't know what you're currently using, so some of this may already be covered." / "Ingredients first. A product only earns a mention when it actually carries them." - the server's version goes on "and I say where it is from and what it costs", which this page drops because it names no source or price; chat and Products keep it) | CNS-01 (only when built from a consented scan); "as we learn more about your skin" implies ongoing profiling and must match the privacy policy and RET-04; "your goals" has no data behind it |
| Nothing to change (real only) | - | Card "Nothing to change right now" / "No reading in your latest scan was far enough past its threshold to suggest a new step." with "Scan again"; then "Why no changes?" / "This is worked out from your latest skin reading[ ...] each time you open it. A step is only suggested when a reading is past its threshold by more than the measurement noise. {plan caveat}", opening to any "Not covered yet" gaps | Accurate to `buildRoutinePlan` (noise-floor check) |
| Opened | Each morning step with its one-liner (the same flagged claims as section 4) | Each suggestion in list order with its reason ("For your oiliness reading.", "Added because no product you have logged has SPF.", "Already covered by ..."), and "Nothing in your plan or your products covers {steps}." for gaps | - |

## 6. Notices (both modes)

| Element | Text | SRS |
|---|---|---|
| General-guidance note (under the why card) | "Suggestions are general. Read the label, follow its directions and patch test anything new." | §10 "Product suggestions are general; users should read labels and patch test" (not in the mockup; added) |
| AI disclosure | "Evia is an AI. General skincare guidance, not medical advice." | BUILD-PLAN §4 / SRS §6 persistent AI disclosure |

## 7. Your products (real mode only; unchanged behaviour from the previous Routine page)

| Element | Text | SRS |
|---|---|---|
| Section | "Your products" / "What you use, and whether it is earning its place." | - |
| Guest | "Tracking products needs an account" / "Signed in, you can keep a list of what you use, and each new scan shows whether a product is moving the reading it is meant to." | - |
| Outcomes | "Is it working?" / "Each product against the one reading it is meant to move. A change smaller than the measurement noise is reported as no evidence, not as a small win." plus the server's verbatim `statement` (always carries "association, not proof") and verdict pills "Working", "Went the wrong way", "No evidence", "Too early", "Not scored", "Unknown" | MED-01 ("Working" is a cosmetic-reading association, never a treatment claim) |
| Footer | "Correlation, not proof: a product is never said to have caused a change. Steady means steady; a change smaller than the noise floor is not a change." | - |
| Assessment verdicts | "Looks like a good fit", "Probably fine", "Be cautious", "Not right now" with the server's rationale and per-ingredient reasons | §10 "not a complete safety check" |
