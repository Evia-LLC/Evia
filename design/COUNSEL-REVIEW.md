# Evia: counsel review (consolidated)

**For:** the Founder and counsel.
**From:** engineering, consolidating the six page reviews in [`counsel/`](counsel/) (links in section 4).
**Code reviewed:** branch `evia-visual-rebuild` at commit `1e66cec` plus the retailer-name change (25 September 2026).
**Requirements:** SRS v2.0, the legal-to-engineering baseline (legal pack revised 21 September 2026).

This document flags items for review. It does not reach legal conclusions and it decides nothing.
Anything marked "Suggest" is an engineering suggestion for counsel to accept, change or reject. Nothing
flagged here has been reworded without saying so. Where real mode shows different words, those words
are listed too, so they can be approved as well.

> **Status note: retailer names on Products (landed).** On 25 September the Founder asked that every
> "Shop at …" button name that product's own retailer, never the catalogue's old default store name
> "Ese". This is now in the branch:
> - **Real mode** names the retailer from a per-product `retailer` field in a catalogue import, or from
>   the product's own link (a known retailer on its real domain, the brand's own site, or otherwise the
>   site's address, e.g. "cerave.com"). A configured store name is used only for products synced from
>   that store. The empty shelf says "…when a shop catalogue is connected".
> - **Sample mode** gives each sample product an illustrative retailer: CeraVe, YesStyle, Ulta Beauty,
>   La Roche-Posay, Stylevana, Paula’s Choice, Target or Amazon. The buttons stay switched off.
>
> The affiliate disclosure (row G2) says "these links", so its wording still fits. Naming real retailers
> beside invented sample prices adds to the trademark item (row K8).
---

## 1. Summary: how the app treats sample data and real data

**Why there are two modes.** The design mockups show things the app does not have: a single "Skin health
score" of 82, star ratings and review counts, prices, an adherence streak, a "Premium Member" tier and a
named person. SRS v2 says:
- "Never fabricate scientific-looking measurements or unsupported findings" (§1).
- Findings are "cosmetic observations supported by provider output; no arbitrary beauty/health scores" (§5).
- "No fabricated skin results or diagnostic claims exist" (§15, launch-ready).

Its **authority rule** says that where earlier specs, repository documentation or product preferences
conflict with the final legal pack on consent, age, retention, privacy, medical positioning, subscription
disclosure or data use, "the final legal pack controls until counsel issues a revision". The mockups are a
product preference, so where they conflict with the legal pack, real users must not see them as
fact. The Founder still needs to see the screens as they were designed. So the app has two modes
(BUILD-PLAN decision 2).

**Sample mode** is a labelled preview of the design.
- **How it is turned on:** the "Preview with sample data" button on the sign-in screen, `?sample=1` in the
  address, or the "Sample data" switch in Settings. The device remembers the choice until it is turned off.
- **What it shows:** every page renders from fixed sample files that reproduce the mockups' numbers and
  words exactly. That includes items real mode refuses to show, such as the composite score, ratings,
  unmeasured findings and condition names.
- **The badge:** a "Sample data" badge is visible the whole time, in its own band so it covers no content.
- **No server writes:** it never writes to the server.
- **No account data:**
  - With an account signed in, Settings, Profile, Privacy and Your data set the account aside. They show:
    "Sample data is on, so your account is set aside: nothing on this page is read from it or saved to it."
  - The chat hides the account's stored conversation, and restores it when sample mode goes off.
  - The chat answers from a blank sample profile, not from the account's real readings.
- **No people** (Founder decision 3):
  - No character is drawn anywhere.
  - Avatars are initials.
  - Before/after photos and scan thumbnails are neutral skin-texture tiles.
  - The routine "video" is an abstract drawing.
  - The Scan hologram is a sample face mesh traced from the mockup's own hologram, in a file labelled SAMPLE.
- **Shop links are switched off**, so a sample price never sends anyone to a real shop.

**Real mode** shows only what the app actually has.
- **Data it uses:** stored scans, the server's trend summary, the deterministic routine plan, the user's own
  products and outcomes, the operator's catalogue (empty by default) and, only after a separate opt-in,
  progress photos.
- **Readings:** nine readings, each a 0–100 appearance index, each labelled with which direction is better.
  No composite score, no grade, no percentages. A change counts as a change only when it is larger than that
  reading's measurement noise.
- **Never shown:** ratings, review counts, "Trending", "Popular", "Best Match", invented prices, adherence,
  streaks, membership tiers.
- **Empty states:** honest ones where there is no data. For example, "The shop shelf is empty for now" and
  "Your first scan is your baseline".

**What counsel should know about sample mode.**
1. Rows marked **(S)** below are shown in sample mode only. Their risk is marked Low on the assumption that
   sample mode stays an internal preview.
2. Sample mode includes fabricated reviews and prices under real third-party trademarks, a composite
   "health" score and condition names ("Acne spots"). All of it is labelled, but it is still content that
   real mode is built to refuse.
3. Anyone who can open the app can turn sample mode on today.
4. `origin/main` has a commit allowing a sample-only public demo deployment (`83817a6`, 24 September).
5. Whether sample mode may ever be shown outside the team is open decision 1.

---

## 2. Findings by SRS clause

Each item appears once, under the clause it is closest to. Where it also touches other clauses, those are
named in the action column. "Found while consolidating" marks an item that is not in the page reviews: it
was found in the code while this document was written, and checked in the source.

**Risk** is engineering's triage for ordering the review. It is not a legal assessment.
- **High:** shown to real users and touching a P0 requirement, or a P0 control that is missing.
- **Medium:** shown to real users, and the wording needs counsel's approval.
- **Low:** decorative or already handled, or **(S)** sample-only while sample mode stays internal.

### A. §1: never fabricate scientific-looking measurements or unsupported findings

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| A1 | Scan | Findings with no measurement behind them. Callouts: "Early congestion", "Congestion", "Barrier sensitivity", "Dehydration lines", "Loss of elasticity", "Post-blemish marks". Concerns: "Barrier Weakness Mild", "Redness / Sensitivity Moderate". Card "BARRIER SUPPORT" with "Signs of a weakened skin barrier and increased sensitivity." | Yes, verbatim | Never shown. Only metrics that reached a band are listed, under the code's nine names (Hydration, Oiliness, Redness, Texture, Pores, Dark spots, Tone evenness, Under-eye, Breakout signs). A callout appears only where that metric's location sentence names the place. | Low (S) | None for real mode. "Post-blemish" also implies a cause (MED-01). See decision 1. |
| A2 | Progress | Unmeasured metrics: bars "Clarity 78" and "Firmness 80". "Texture 85" is drawn as good, but a higher texture reading is worse. | Yes, verbatim | The nine real readings as bars, grouped "Higher is better" (Hydration, Tone evenness) and "Lower is better" (the other seven). "Clarity" and "Firmness" never appear. | Low (S) | None for real mode. |
| A3 | Scan, Progress | Percentages. Scan cards "62%", "68%", "54%" with half-full gauges. Progress "-42% Acne spots", "+36% Hydration", "+28% Even tone", "-31% Redness", "+18% since May". | Yes, verbatim. Screen readers hear the gauges as "Decorative gauge, not a measurement". | Never a percentage. Scan cards show a band word ("Slight", "Moderate", "Marked", "Off scale") or "Not flagged", on a plain ring. Progress shows point changes larger than the noise, e.g. "−19 pts Breakout signs (lower is better)", "+16 pts Hydration". | Low (S) | None for real mode. |
| A4 | Scan | Eyebrow line "3D SKIN MAPPING · AI ANALYSIS · PERSONALIZED INSIGHTS" | Yes, verbatim | Shows what is actually happening, e.g. "LIVE CAMERA · READ ON THIS DEVICE", "{PIPELINE STAGE} · {n}%", "NOW · {METRIC}", "FACE MAP · {time} · APPEARANCE ONLY", "FACE MAPS ARE NEVER STORED". | Low (S) | Note for marketing (#13): "AI analysis" is inaccurate, because the nine readings are deterministic pixel statistics. "3D skin mapping" would have to be technically true. |
| A5 | Scan | Skin-layer panel. Tabs "Surface / Mid-Layers / Deep View". Layers "Epidermis — Texture, tone, clarity", "Dermis — Collagen, elasticity", "Hypodermis — Support, structure". | Yes, same as real | The same fixed illustration for every user, with no data behind it. Captioned "How skin is layered — illustration, not a reading of your skin." The tabs read "The outer layer: the only one a camera sees." / "Below the surface: a photo cannot see it." / "The deepest layer: no camera can see it." | Medium | Decision 4: keep it with this caption, or remove the panel. |
| A6 | Scan, Progress | The metric name "Hydration" | Yes | One of the nine readings. It measures surface roughness, not water. Scan says so ("The surface reads rough, which often goes with dryness. Not a water test." In Gen-Z style: "It reads texture, not actual water."). Progress does not. | Medium | Decision 11: keep the name with the explanation (and add it on Progress), or rename the metric. |
| A7 | Progress, Routine | Adherence and timing with no data behind them: toast "You're doing great! 🎉 Consistency is working."; milestone "Stuck to routine for 30 days"; insight "Your consistency is paying off! Your skin is clearer and more balanced. … I recommend continuing your current products and re-scanning in 2 weeks." signed "Evia ♡"; routine rows marked done / current / locked; "4 steps • ~6 min"; "30 seconds", "30–60 seconds" | Yes, verbatim | None of these. The toast appears only when the latest scan is under 2 days old and a reading improved by more than its noise: "{Metric} improved by {n} points since the scan before." Milestones count scans only ("Completed {n} scans", "Tracking your skin for {n} days"). The insight is the server's trend headline plus at most one correlation sentence. The routine shows no completion state, no minutes and no order. | Low (S) | None for real mode. No rescan reminder exists behind "re-scanning in 2 weeks". |
| A8 | Progress | Photo caption "“Your skin texture looks smoother, and dark marks are less visible.” — Evia" | Yes, verbatim | A generated sentence naming up to three changes larger than the noise, always including any change in the wrong direction. Example: "All nine readings held within measurement noise between these two scans." It is not attributed to Evia. | Low (S) | Approve the real-mode sentence pattern (§5). |
| A9 | Products | Social proof and prices with no source: "4.8 (12.4k)", "Reviews (12.4k) ★ 4.8"; badges "Best Match", "Trending", "Popular"; prices such as "$14.99" and "$18.00" | Yes. The reviews row says: "Sample ratings. Evia has no review source yet, so ratings and review counts appear only in this preview." | Never shown. The only badge a card carries is its routine step ("Cleanse", "Treat", "Hydrate", "Protect"). Prices come only from the catalogue. | Low (S); High if sample mode goes public | Decision 1. These are consumer-protection concerns (fake reviews) as well as §1. |
| A10 | Routine, Products | Personalisation with nothing behind it: "tailored to your skin, your goals and your lifestyle"; "Products that match your skin, goals and sensitivities."; "It may change over time as we learn more about your skin." | Yes, verbatim | "Suggestions built from your latest skin reading and the details in your profile." (the profile clause appears only when a skin type, sensitivities or a pregnancy answer is set); "Suggested by ingredient from your latest reading. Each one says why."; "It is worked out again from your newest scan each time you open it." | Low (S) | None for real mode. For reference: the app has no "goals" field; lifestyle data is an optional consent (CNS-03); "sensitivities" implies allergy screening (§10); "as we learn more" implies ongoing profiling (RET-04 and the privacy policy). |

### B. §5: no arbitrary beauty or health scores; progress follows the real pipeline

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| B1 | Progress (and the old Scan page) | Composite score: "Skin health score", "82", "out of 100", grade "Good", "+18% since May". Timeline line "Skin health score" with tooltip "82 · Aug 12, 2024". Recent scans "Score: 82 / 76 / 68 / 64". Milestone "Improved skin score by 20%". | Yes, verbatim. The info button says: "Sample data: the design's example score. Evia does not calculate a single skin score." | No ring, grade or composite anywhere. "Latest readings" shows nine bars. The timeline plots one real reading at a time, starting with the one that moved most in either direction. Recent scans show the date and one or two changes ("Redness −4 pts", "Steady", "First scan"). The old Scan page's "Skin health {n} Good / Fair / Needs care" ring and its confidence ring are removed in both modes. | Low (S) | None for real mode. |
| B2 | Scan, Progress | Readings on a 0–100 scale, and the band words "Slight / Moderate / Marked / Off scale" (concern 25–49 / 50–74 / 75+ / beyond the calibrated range). Progress info text: "Each reading is an appearance index from 0 to 100, measured from your scan photo. They are not percentages, and not a health score." | Sample uses the mockup's "High", "Moderate", "Mild" | These are the only values shown. "High" and "Mild" are never produced. The code's fifth band, "Clear", is never displayed: "Not flagged" is shown instead (row C2). | Medium | Counsel to confirm that per-reading indices and these band words count as "cosmetic observations supported by provider output", not "arbitrary scores", and to approve the info text. A four-step scale can also read as triage (MED-01). |
| B3 | Scan | Status line and indicator dot | Title "Clinical analysis activated". The dot glows steadily because no pipeline runs in the preview. | The title follows the real pipeline: "Scan to see your map", "Reading your skin", "Going through your reading", "Your reading", "Your body reading". The dot pulses only while analysis runs or Evia is talking, and the percentage is the pipeline's own. | Low | None: §5's "never a fake timer" rule is met. For the word "Clinical", see D1 and decision 2. |

### C. MED-01 and §10: medical wording (no diagnosis, treatment, triage or referral; no false reassurance; suggestions are general)

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| C1 | Scan, spoken line. Found while consolidating. | After a real scan in which nothing is flagged, Evia says aloud: "Good news — nothing's flagged. Everything's reading comfortably in range." (`SCAN_ALL_CLEAR` in `src/lib/lines.ts`, used by `src/scan/choreography.ts`; also shipped as a pre-recorded clip) | No | Spoken whenever voice is available. For the same case, the screen says "Nothing reached the Slight band in this reading." | High | §10: "Absence of an escalation message must never be presented as reassurance that skin is healthy." Suggest making the spoken line match the on-screen wording. It is scripted voice copy, so this needs the Founder's approval. |
| C2 | Scan | On-screen wording when nothing is flagged: "Nothing reached the Slight band in this reading."; card headline "Not flagged" above "In this photo"; descriptions "This photo did not reach the Slight band. One photo is not a health check." and, in Gen-Z style, "Nothing flagged in this pic. One photo, not a check-up." | Not applicable: the sample always has findings | As listed. Never "healthy", "all clear" or "normal range". | Medium | Approve. This wording was written against §10's reassurance rule. |
| C3 | Scan | Wording that implies a norm or a need for treatment: "Below optimal levels", "Mild irregularity", "Needs care"; "Skin shows signs of dehydration, especially in under-eye area."; Gen-Z "Your skin is lowkey thirsty, especially under the eyes." and "Your barrier needs some TLC right now." | Yes. The mockup's text is verbatim; the Gen-Z lines were written for the preview. | A location sentence ("Most visible on the cheeks.", "Fairly even across the face.") and per-reading copy, e.g. "Some redness shows in this photo." In Gen-Z style: "Looking a little flushed in this pic." | Medium (real copy) | Approve the real per-reading copy in both styles (`src/view/scan.ts`: `FLAGGED_COPY`, `CLEAR_COPY`, `BEYOND_COPY`). MED-01's safety tests should cover the Gen-Z style too. |
| C4 | Progress, Profile | The condition name "acne": "-42% Acne spots" and "Fewer acne spots" (sample). The Profile concerns field placeholder "acne, texture, dark spots" (both modes). | Yes | Progress says "Breakout signs" (§10 allows "breakout-like areas"). The Profile placeholder still says "acne, texture, dark spots". | Medium | Suggest "breakouts, texture, dark spots" for the placeholder. Decision. |
| C5 | Routine, Products | The routine engine's reasons (`Suggestion.why` in `server/skin/recommend.ts`), e.g. "It is oil-soluble, so it clears the inside of pores rather than just the surface.", "The most evidence-backed thing there is for surface texture. Slowly is the whole trick.", "Calms visible irritation and supports the barrier" | No (the sample has its own text, row C6) | Shown prominently: in the Routine step card, and under "Why Evia recommends this" on Products | Medium | Counsel to review every `why` string in `server/skin/recommend.ts` for efficacy language. |
| C6 | Routine, Products | Sample efficacy one-liners: "Prep and rebalance your skin.", "Helps with tone, texture and oil balance.", "Lock in hydration and support your skin barrier.", "Unclogs pores and helps prevent breakouts", "Targets blemishes and helps prevent marks", "Soothes and balances sensitive skin", "Strengthens skin barrier and provides long-lasting hydration". Badges "Good for you", "For concerns", "Gentle option". Benefit labels "Protect barrier", "Skin barrier", "Blemishes · Marks", "Oil control · Pores". | Yes, verbatim | Routine shows "Look for {actives}". A Products shelf item shows the first sentence of the shop's own description. A pick shows "Not on the {store} shelf yet. Picked for your {metric} reading." Ingredient families found in the published list appear as "Contains …". | Low (S); Medium for shop text | Decide whether shop descriptions shown in real mode need to be attributed as the retailer's own words. |
| C7 | Products | The category chip "Treatments". It filters by words such as exfoliant, peel, retinoid, BHA/AHA, mask and spot. | Yes | Yes | Medium | Keep, or rename (the product spec suggests "Targeted care"). Decision. |
| C8 | Products | Hero claims: "Safe for your skin type", "Dermatologist-grade brands", "Ingredient-checked" | Yes, verbatim | The first two are never shown. "Ingredient lists checked against your profile" appears only for a signed-in account with a non-empty shelf. A new line is always shown: "You buy from the shop itself, not through Evia". | Low (S); Medium for the real lines | Approve the two real lines. "Dermatologist-grade" also touches §10 (dermatologist positioning is outside V1). |
| C9 | Products, Routine | Fit verdicts: "Looks like a good fit", "Probably fine", "Be cautious", "Not right now". The good_fit sentence: "Nothing in the ingredient list clashes with your profile or your current routine." A note after every verdict: "General skincare guidance, not medical advice, and not a complete safety check. Read the label and patch test anything new." | The sample describes the feature and shows the same note | As listed. A verdict appears only when the shop has published an ingredient list. | Medium | §10 says suggestions are "not a complete safety check", and the absence of a warning must not read as reassurance. Approve the good_fit sentence and the note. |
| C10 | Routine, Profile | Pregnancy. The routine caution: "Not for use if you are pregnant, trying to conceive, or breastfeeding - tell me if any of those apply and I will swap it." The Profile hint: "This changes what Evia suggests, retinoids in particular. “Prefer not to say” is not read as a no: Evia stays cautious either way." | Routine: no. Profile: same as real. | As listed | Medium | §10 says pregnancy information "is not a complete safety check", and the hint does not say so. Suggest adding it. Decision. |
| C11 | Routine, Progress | Product outcome labels "Working", "Went the wrong way", "No evidence", "Too early", "Not scored", "Unknown". Every statement carries "association, not proof". Footer: "Correlation, not proof: a product is never said to have caused a change. …" Progress: "While {product} was in your routine ({n} days, {n} scans): … That is a correlation, not proof the product caused it." | No | Accounts only | Medium | Approve "Working" as the label for a reading that moved the right way, or change it. |
| C12 | Routine, Products | "Personalised": the Routine subtitle "Your personalised skincare plan" (both modes). Products "Chosen for your skin" (sample) and "Chosen for your latest reading." (real, only when there are real picks). | Yes | The same Routine subtitle. For the description, see A10. | Medium | §10: "Product suggestions are general". Is "personalised" acceptable next to that? |
| C13 | Home, Learn, Routine | General advice lists. Home tips: 8 lines, e.g. "Put sunscreen on every morning, even when it’s cloudy." Learn "Routine basics": 8 entries, e.g. "Sunscreen every morning", "Thin to thick". Notes: "Suggestions are general. Read the label, follow its directions and patch test anything new." and "General cosmetic information for everyday skincare, not medical advice." | Home shows the sample tip "Your evening routine matters too — consistency is key." Learn is the same in both modes. | The full lists are in [home.md §4](counsel/home.md) and [misc.md §1.1](counsel/misc.md). | Low | Approve, change or strike each line. The sunscreen line is general sun-protection advice: confirm it is acceptable for a non-medical service. |
| C14 | Learn (open without an account) | Ingredient glossary, shown exactly as stored in the engine (43 of 46 entries). Flagged entries: Adapalene "…More stable and usually better tolerated than tretinoin, but still a retinoid."; Benzoyl peroxide "Very effective on inflammatory breakouts"; Tea tree oil "Mildly antibacterial"; Azelaic acid "breakouts, redness and pigmentation at once"; Tranexamic acid "Works well on stubborn pigmentation and post-inflammatory marks."; Salicylic acid "The most useful acid for congestion and blackheads."; Glycolic acid "Effective on texture and tone."; Organic UV filter "The single highest-value thing in any routine."; Essential oil "Citrus oils can also be phototoxic."; Sensitising preservative "notable contact-allergy record"; Fragrance "The most common contact irritant in skincare."; Potentially pore-clogging "Reported as comedogenic for some people." Filter chip "Anti-bacterial actives". Label "Irritation risk: None known / Low / Moderate / High". | Yes, same as real | Same | Medium | Approve or strike each entry. Decide whether "Irritation risk" needs a qualifier: it is the knowledge base's rating, not a measurement of the user. For the entries held back, see C15. |
| C15 | Learn | Held back from the glossary: Tretinoin, Topical antibiotic, Hydroquinone. Their notes name a prescription medicine or refer the reader to a clinician or dermatologist. | Not shown | Not shown. The routine engine still uses them to recognise these ingredients on labels. The rule is in `server/skin/glossary.ts`, and `test/ingredient-glossary.test.ts` pins the list. | Low | Decision 6. |
| C16 | Chat, from every page. Found while consolidating. | Escalation wording used by the chat (`server/ai/persona.ts`). `LEGAL_DISCLAIMER`: "I can help you understand what I'm seeing, but this isn't a medical diagnosis. If you're worried about a persistent or serious skin issue, it's worth speaking with a qualified dermatologist." `URGENT_DISCLAIMER`: "This isn't something to wait on, and it isn't something I can read from a photo. Please get seen today — urgent care or your doctor, and A&E if your breathing, throat or tongue is involved." Evia's instructions also tell her to "stop consulting and recommend a dermatologist" when a user describes something that sounds medical. | Yes | Yes. Whether replies stay non-diagnostic depends on these instructions: there is no separate output filter. A search of `test/` found no test that checks replies for diagnostic wording (`test/escalation.test.ts` covers the classifier that reads the user's message). | High | MED-01 forbids triage and clinical-referral claims, and its acceptance test ("Safety tests reject diagnostic wording") is not met yet. §10 keeps dermatologist referral outside V1. These lines exist to send someone with, for example, swelling lips to urgent care. Decision 13: the approved escalation wording. |
| C17 | Intro, sign-in screen | Intro captions: "A beauty consultant who can actually look at your skin."; "She reads nine things." (the "she" is a character who is not shown); "And remembered. Next time, she shows you what changed — and what to do about it." Sign-in lede: "An AI skincare consultant. Ask anything, scan your skin with your own camera, and see what changes over time." | Same as real | Same | Medium | "What to do about it" reads as advice, and "can actually look at your skin" as clinical examination. Approve or change (`src/lib/intro.ts`). |

### D. §6: clinical aesthetic, hologram, character and the always-visible AI disclosure

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| D1 | Scan | Title "Clinical analysis activated" | Yes, verbatim | Never shown. Real mode uses the pipeline titles in B3. | Low (S) | Decision 2. |
| D2 | Scan | Region thumbnails in a close-up, "dermatoscope"-like style | Neutral drawn skin-texture tiles | Crops of this session's own photo. They exist only in the page's memory and are released when the reading closes. Screen readers hear each as, for example, "T-zone: the nose, cut from this scan's photo". | Medium | Decide whether the close-up style suggests clinical imaging. |
| D3 | Scan | The hologram head | A sample face mesh traced from the mockup's hologram (file labelled SAMPLE), shown only while the badge is up | This session's live face mesh only, and never a stock head. Once the mesh is cleared, the page says: "Your face map is gone: it only exists while I explain the reading, and nothing of it is kept." The shell, particles and rings are sized from the face; they are not captured data. | Low | Confirm that a labelled sample mesh is acceptable in the preview. §6: "never use a generic head as the user's result". |
| D4 | All pages | The character | None drawn (Founder decision 3); her place in each room is left empty | Same | Low (now) | Decision 3 if a character returns. The Scan mockup has a white lab coat and the Products mockup an ivory blazer with "evia" on the chest. `src/lib/lines.ts` still holds the lines "Mind the coat." and "This coat is dry-clean only.", spoken only when a drawn character is touched. |
| D5 | Home, chat drawer, Routine, Scan, sign-in screen | Disclosure "Evia is an AI. General skincare guidance, not medical advice." It sits under the Home call to action, under the drawer title while the drawer is open, on screen throughout Scan, on Routine, and on the sign-in screen. | Yes | Yes | Medium | (a) Should this be exact text from the Consent Wording Pack (SRS §14)? (b) Progress, Products, Learn, Settings and Profile do not carry this line. Learn and Products have their own "not medical advice" lines. Confirm where the disclosure is required. |
| D6 | Home | The tip's "Play" button | Reads the tip aloud with live speech synthesis, never a recording. "Voice is off." with "Turn it on"; or "Evia can’t read this tip aloud right now." | Same | Low | None. For the pre-recorded clips, see L2. |

### E. CNS-04: progress photos (with CNS-01, CNS-02 and CNS-03 consent)

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| E1 | Progress | The "Skin comparison" card and recent-scan tiles | The photo version, with neutral skin-texture tiles (no faces) dated May 12 and Aug 12, 2024. Subtitle "Visible progress from your scans" (asserts improvement). | Without photos (most people): a first-versus-latest grid of readings, e.g. "{from} → {to}", "Improved {±n pts}", "Wrong way {±n pts}", "Steady within ±{noise floor}". Only with consented progress photos: a before/after slider plus "Original photos, not aligned: pose, distance and light can differ between them." A tile shows a photo only if the user opted in and saved one. | Low | None for real mode. |
| E2 | Progress | Invitation to opt in: "Progress photos are off. Turn them on to compare side by side. Turn on in Privacy". When photos are on but none are saved: "Progress photos are on. Save a photo after your next scans to compare them here. Privacy settings" | No | Accounts only, never guests | Medium | Decision 10: is an in-product invitation acceptable, and is the wording neutral? |
| E3 | Privacy, Scan | The progress-photo consent switch uses the placeholder text `LEGAL_CONTENT['progress-photo-consent']`. Scan: "Progress-photo consent is off. Nothing has been saved." with "Discard photo". | Same text | The switch stays disabled while its wording is a placeholder, while the server has no image key, and for guests; each reason is shown in full. **So no photo can be saved today.** | Medium | Counsel to supply the CNS-04 consent wording. Photos stay off until then. |
| E4 | Scan | Facial-scan consent and age gate | Not applicable | The camera opens when the page loads, with no consent step and no age gate. None exists on this branch (unchanged from `main`). "Upload a photo" is still offered. | High | CNS-01 and AGE-01 are P0: they need approved consent wording and a server-side gate. §5 says "Live camera only for V1": decide about "Upload a photo". |
| E5 | Privacy | The cloud-reasoning disclosure, kept word for word and still in Evia's first person: "Let me think in the cloud"; "Turning it on lets me send what you type, your name, skin type, stated concerns and sensitivities, anything I have remembered about you, and your scan history to the model I think with (Anthropic)…". Its wording version, `cloud-reasoning-v1`, is a placeholder. | Same (the account is set aside) | Same | Medium | Counsel wording needed (CNS-02, AI-01, AI-02). |

### F. RET-01 to RET-04: retention (with AI-01 and the on-device privacy claims)

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| F1 | Scan, Home, Progress | Raw images and face geometry | Drawn tiles and the sample mesh | Region thumbnails exist only in the page's memory for the session. The face mesh is kept only while the reading is on screen. The eyebrow line says "FACE MAPS ARE NEVER STORED". The avatar is initials, never a scan frame, and profile photos cannot be uploaded. Progress never shows scan frames, only progress photos the user chose to save. | Low | Engineering still owes the P0 evidence: a deletion log (RET-01), a storage audit (RET-02) and proof that no hologram is stored (RET-03). |
| F2 | Scan, sign-in screen, Intro, Privacy | On-device claims: "Even light, face in the oval, hold still. Everything is measured on your device."; "One frame, read on your device …or not now."; "Skin scans are analysed on your device. The photo never leaves it unless you say so."; "Measured here. On your device. The photo never leaves it unless you say so."; spoken: "Everything's measured right here, on your device — nothing leaves it unless you say so."; Privacy: "Your skin is measured in this browser. Unless you choose otherwise, the photo never leaves your device — only the numbers do, and only to Evia's own server." and "On Evia's server: The numbers, your profile, your conversation, and what Evia remembers. Photos only with the first switch below — and encrypted if so." | Same | Same | High | For accounts, the readings and per-region statistics are sent to the server (code-scan §7 item 10). Check each claim against the real data flow and the final Privacy Policy. SRS §15 requires such statements to be technically true; see also AI-01. |
| F3 | Sign-in screen | The button "Look around without an account". Its second line reads "Evia talks in its own voice, scans and reads. Nothing is saved when you leave." when a guest voice is configured, and "Evia talks, scans and reads. Nothing is saved when you leave." otherwise. | Same | When a guest has voice on, Evia's reply text goes to the voice provider. The button does not say so, and it did not before this rebuild either. | Medium | Decide whether the guest button should mention the voice provider. |
| F4 | Your data | Placeholder notices. Deletion: "…Processor propagation, backup handling, and final wording remain unresolved." Export: "Your download contains the account data currently held by Evia. Stored photo files are not included in this JSON export." | The account is set aside | As listed. In development, each carries a "Placeholder legal text · {id}" tag. | High | §11 requires an "explanation of legally retained records", and RET-04 sets a 30-day deletion window. Counsel wording needed. The export notice's brand name changed from "Elohim" to "Evia" in `1e66cec` (row L1). |

### G. ADS-01 and §9: affiliate links, analytics and advertising

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| G1 | Products | Shop buttons. The cart icon (badge "2") and "Add to cart" are gone. Each product has "Shop at {retailer} ↗", which opens a new tab with `rel="sponsored noopener noreferrer"`. | "Shop at {retailer} ↗" naming each sample product's illustrative retailer, switched off ("Sample data: shop links are switched off in the preview") | The catalogue product's own link, tagged for its own retailer. A pick with no shelf product gets "Search Amazon ↗" or "Search Google Shopping ↗", with the server's note "No prices fetched — these are places to look." | Low | Retailer names landed: see the status note at the top. |
| G2 | Products | Affiliate disclosure, over the first grid that has shop links and in the detail panel: "Evia may earn a commission when you buy through these links. It never changes what we recommend." | Yes | Same. It shows even when no affiliate tag is configured, hence "may". | Medium | Decision 5. "It never changes what we recommend" is a promise. It is true today: `server/catalogue/picks.ts` ranks by ingredient fit and never reads commission data. It must stay true. |
| G3 | Products, Routine | What goes into a link: the retailer's URL plus only the operator's fixed affiliate parameters for that retailer (`ELOHIM_AFFILIATE_AMAZON_TAG`, `ELOHIM_AFFILIATE_EBAY_PARAMS`, `ELOHIM_AFFILIATE_STORE_PARAMS`, `ELOHIM_AFFILIATE_LINKS`). A configured parameter whose name looks like personal data (skin, scan, concern, score, email, user…) is refused. Routine's in-app "See products with this" link carries no scan data. | No links | No reading, concern, profile detail or user id is ever added | Low | The ADS-01 acceptance check ("Event audit passes") still has to be run. |
| G4 | Products | Search links contain a term derived from the user's reading, though no reading or concern is named: a marketplace search such as `k=Salicylic Acid cleanser`; "Search Google Shopping ↗" goes to `https://www.google.com/search?tbm=shop&q=...`, which is a results page, not a retailer, and carries no affiliate tag. Screen readers hear "Search Google Shopping for Salicylic Acid cleanser". | No links | As listed | Medium | Decision 12: is a reading-derived product type acceptable in a third-party URL, and is linking to a search engine acceptable? |
| G5 | Products | The heart ("Saved") | A separate sample list on this device | One list per signed-in account, kept on this device only and holding product ids only. A guest's list lasts for the tab. Suggestions named from a reading (e.g. "A low-strength retinoid") have no heart. | Low | None: nothing leaves the device, and another account on the same device never sees the list. |
| G6 | All pages | Analytics and advertising code | None | None. A search of `index.html`, `src/` and `server/` found no analytics or advertising library. Chat text and dictated speech go only to the conversation. | Low | Check again when a cookie banner or analytics is added (CK-01). |

### H. §8: subscription and membership (PAY-01, PAY-02)

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| H1 | Home, profile pill (every page with a sidebar), Products | "Premium Member" (the sample profile reads "Destiny · Premium Member") | Yes | Hidden. The pill shows the display name only, or "Guest", or "Your profile" when there is no name. | Low (S) | Decision 3b. SRS §8 has a single plan with no free tier and no trial, so "Premium" implies a tier that does not exist. |
| H2 | Settings, Profile | "Member since {date}", taken from the date the account was created. The line is left out when no date is on record (the old page used today's date instead). | The account is set aside | As listed | Low | Confirm that "Member" does not imply a tier. |
| H3 | Settings | "Subscription and billing — Coming soon — There is no subscription yet. Plans, billing and cancellation will be managed here." | Same | Same: plain text, not a link | High (launch gap) | The PAY-01 checkout disclosure and PAY-02 cancellation are not built. "Plans" is plural, but SRS §8 describes a single plan. |
| H4 | Products | "In stock" | Shown | Shown only for a catalogue product, from the shop's own stock flag ("In stock" / "Out of stock") | Low | None: this meets §8's rule against artificial scarcity. |

### I. §9: under-18 accounts

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| I1 | Products | Affiliate links and marketing copy ("Skincare that works for you.", the quote) are shown to everyone | Not applicable | The same for every account. The app has no date of birth or age signal: AGE-01 and GDN-01 are not built. | High (once 16–17 accounts exist) | Decision 8: must affiliate links and merchandising be hidden from 16–17-year-olds? §9 rules out behavioural advertising and marketing messages to under-18s. |
| I2 | Settings | "Marketing preferences — Coming soon — Choose what, if anything, Evia may send you." | Same | Same | Medium | Needed before launch, for §11 and the under-18 rule. Approve the wording. |

### J. SET-01 and §11: settings and user rights

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| J1 | Settings | Working rows: Profile ("Your skin, the pregnancy question, how Evia explains things, and what it remembers."), Privacy ("Progress photos and cloud reasoning: two separate choices, both off by default."), Your data ("Download a copy of your data, or delete your account.") | The account card shows the account set aside, or "Sample preview" for a guest | Links to working pages | Low | Approve the wording. |
| J2 | Settings | Rows marked "Coming soon", shown as plain text and not as links: "Withdraw facial-scan consent" ("Turn scanning off, with a clear account of which features stop and what is deleted, and when."); "Cookie preferences" ("Accept, reject or manage non-essential cookies."); "Policy history" ("The policy and consent versions you have accepted, with their dates."; the server route exists but no screen uses it); plus Marketing (I2) and Subscription (H3) | Same | Same | High (launch gap) | SET-01 (P0) requires withdraw, preferences and policy history, and CK-01 requires cookie choices. Approve the row wording now; build these before launch. |
| J3 | Settings | The Guardian access notice for minor accounts | Not built | Not built: the app holds no age or guardian data | High (launch gap) | §11 (last line): decide where the notice lives. |
| J4 | Legal pages, Settings | Consent records. A consent decision is sent to `/api/legal/consents`, which does not exist. The pages show "Placeholder · review only — This draft is not counsel-approved and cannot unlock a production legal gate." and "This placeholder cannot be submitted as consent." The Settings legal card says "Drafts for review. None of them is accepted by using the app.", with a "DRAFT" tag on each document. | Same | Same | High (launch gap) | Consent logging (SRS §4) is not connected. |
| J5 | Progress, Privacy, Your data | Deletion controls. Each scan and each progress photo can be deleted after a confirmation ("View all"). Privacy: "You have N saved progress photos. Delete any of them from Progress." Account deletion needs "DELETE" typed, then a "Final confirmation": "This cannot be undone. Delete the account and all attached data now?" | A read-only sample list; the account is set aside | As listed | Low | None. For the notices, see F4. |
| J6 | Settings, Profile, Privacy, Your data | While sample mode is on with an account signed in, these pages show "Sample data is on, so your account is set aside: nothing on this page is read from it or saved to it. Turn sample data off to {action}." with a "Turn off sample data" button | Yes | Not applicable | Low | Confirm it is acceptable that rights actions pause during a sample preview. Turning them back on takes one tap. |

### K. Launch checklist #13: marketing copy

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| K1 | Home (wall), sidebar logo (every page with a sidebar), Scan (left wall and book spines), Progress | "A BRIGHTER YOU"; "Your skin. A brighter you."; "Real changes. A healthier, brighter you." | Yes | Same, except that the Progress subtitle becomes "Your scans, compared over time." | Medium | Decision 9. "Brighter" can be read as a skin-lightening claim, and "healthier" is a health claim. |
| K2 | Home | Bottom tagline "WELLNESS \| CONFIDENCE \| LONG-TERM SKIN HEALTH" (desktop and tablet) | Yes | Same | Medium | "Skin health" ties a cosmetic service to a health outcome (MED-01, §10). Suggest "WELLNESS \| CONFIDENCE \| CONSISTENT CARE". Part of decision 9. |
| K3 | Home | Wall niche "REAL INSIGHTS" / "REAL PROGRESS"; lit sign "CONFIDENCE" / "LOOKS GOOD" / "ON YOU" | Yes | Same. The text is laid over the room image, so it can change without re-rendering the room. | Low to Medium | "Real insights" suggests evidence-based analysis, and "real progress" depends on repeat scans. Approve or change. |
| K4 | Scan | Room text: "HIGHER SKIN STANDARDS", "MORE / THAN / SKIN", "ANALYZE / UNDERSTAND / PERSONALIZE / IMPROVE / TOGETHER", "SCIENCE", "BEAUTY", "Your skin. Understood."; handwritten "Same skin / Deeper answers." | Yes | Same | Medium | These imply efficacy and scientific claims. Approve or change. |
| K5 | Products | Headline "Skincare that works for you."; subtitle "Curated by Evia. Backed by science. Chosen for your skin."; quote "“The right products make all the difference.” — Evia" | Yes | The headline and quote are the same. The subtitle becomes "Curated by Evia, ingredient first.", plus " Chosen for your latest reading." when there are real picks. | Medium (headline and quote); Low (S) for "Backed by science" | Approve the headline and quote. "Backed by science" has nothing behind it and appears in sample mode only. |
| K6 | Sidebar (every page with a sidebar) | Talk card "I'm here to help you on your journey." and quote "“Consistent care creates real change.” — Evia" | Yes | Same | Low | The quote implies that following a routine produces a result. Approve or change. |
| K7 | Progress | "SMALL STEPS. REAL RESULTS."; "You're making great progress!" | Yes | Never shown | Low (S) | None. |
| K8 | Products | Real third-party brands and drawn packaging (CeraVe, Anua, The Ordinary, La Roche-Posay, Beauty of Joseon, Paula's Choice), with invented prices and ratings. Once the retailer change lands, sample cards also name a real retailer per product (status note at the top). | Yes | Never. Real mode draws unbranded bottles by category, or uses the shop's own image. | Low (S); High if sample mode goes public | Decision 1: trademark and trade-dress review before any public use of sample mode. |

### L. SRS domain note, and naming

| # | Page(s) | Exact wording or element | Shown in sample mode | Real-mode behaviour | Risk | Recommended action / decision needed |
|---|---|---|---|---|---|---|
| L1 | App-wide | The product name "Evia". Commit `1e66cec` changed the user-facing "Elohim" copy to "Evia", including the placeholder data-export notice (F4). The demo account is now `demo@evia.local`. "Elohim" remains in environment variables (`ELOHIM_*`), the session cookie (`elohim_session`) and code names. Conversations stored before the rename may still say "Elohim". | Same | Same | Medium | SRS domain note: counsel's final documents use meetevia.com and @meetevia.com, and the Founder has told counsel the name and domain are changing. Engineering must use the counsel-confirmed domain and email wording, and must not edit legal wording without saying so. Decision 7. |
| L2 | Intro, voice preview | Two shipped voice clips still say the old name: "Hi — I'm Elohim." (`public/voice/2d425f0c565f1699.mp3`) and "Hey, it's Elohim. This is what I sound like." (`public/voice/1f766d21d7aef5cc.mp3`). The text now says Evia, so the app no longer matches these clips and uses live speech synthesis instead; the files are still shipped. | Not applicable | Same | Low | Re-synthesise the two clips (`scripts/voice-lines-synth.mjs`) or remove them. Related: `public/voice` holds 27 pre-recorded clip files for fixed lines, and §6 asks for "dynamic TTS … rather than prerecorded conversational clips". Decision 7b. |

---

## 3. Open decisions for the Founder

Decision 1 comes first because many sample-only rows depend on it. Decisions 2 to 8 are the items the
Founder asked about, in that order. "Now" is what the app does until the decision is made.

1. **Who may see sample mode.**
   - Now: anyone who opens the app can turn it on. See the sign-in button, `?sample=1` and the Settings
     switch in section 1. It carries the rows marked (S), including fabricated reviews and prices under
     real brands (A9, K8), a composite "health" score (B1) and condition names (C4).
   - `origin/main` has a commit allowing a sample-only public demo deployment (`83817a6`).
   - Decide: internal only (for example, hidden in production builds), or public. If public, rows A9, B1,
     C4 and K8 need review first.
2. **"Clinical analysis activated"** (D1).
   - Now: sample mode only. Real mode shows the pipeline's state instead.
   - The SRS core flow itself describes a "clinical-room transformation", and §6 says the clinical look must
     not imply diagnosis or a doctor–patient relationship.
   - Decide: keep it in the sample, replace it there too, or approve a real-mode title with a clinical flavour.
3. **Lab-coat framing if a character returns** (D4), and **"Premium Member"** (H1, listed as 3b).
   - Lab coat, now: no character is drawn, so the question is moot for the moment. The mockups show a white
     lab coat (Scan) and an ivory blazer with "evia" on the chest (Products). Two scripted lines
     reference "the coat".
   - Lab coat, decide: the rule for her clothing and any on-garment logo, and whether the coat lines go.
   - 3b "Premium Member", now: sample only; real mode hides it.
   - 3b, decide: whether real mode ever shows a membership line, and its wording. §8 describes one plan
     with no free tier and no trial.
4. **Skin-layer illustration** (A5).
   - Now: shown in both modes as a captioned illustration that is identical for everyone.
   - Decide: keep it with the caption, or remove the panel.
5. **Affiliate disclosure wording** (G2).
   - Now: "Evia may earn a commission when you buy through these links. It never changes what we recommend.",
     shown above the grid and in the detail panel, even when no affiliate tag is configured.
   - Decide:
     - the exact words;
     - where they appear;
     - whether to show them when no programme is active;
     - whether to keep the promise "It never changes what we recommend" (engineering can add a test to hold
       it true).
   - Also confirm "You buy from the shop itself, not through Evia" (C8).
6. **Glossary entries held back** (C15, with C14).
   - Now: Tretinoin, Topical antibiotic and Hydroquinone are left out of the public glossary. The 12
     flagged entries in C14, the "Anti-bacterial actives" chip and the "Irritation risk" labels are shown.
   - Decide: clear, rewrite or keep out each held entry, and approve or strike the flagged ones.
7. **"Evia" naming and the counsel domain note** (L1), and **voice clips that still say "Elohim"** (L2, listed as 7b).
   - Naming, now: the UI says "Evia" everywhere a user can read it. That includes one placeholder legal
     notice that was edited from "Elohim".
   - Naming, decide: confirm the final product name, domain and email (meetevia.com or otherwise). Confirm
     the placeholder edit is acceptable, or restore it until counsel issues the revised text.
   - 7b voice clips, now: two shipped clips say "Elohim" and are no longer played.
   - 7b, decide: re-synthesise or delete them. Also decide whether pre-recorded fixed lines are acceptable
     under §6. The "all clear" line in C1 is one of those clips.
8. **Under-18 exposure to affiliate links and merchandising** (I1).
   - Now: not handled, because the app has no age data.
   - Decide: what 16–17 accounts see on Products once age exists.
9. **The brand line "A brighter you" and the tagline "LONG-TERM SKIN HEALTH"** (K1, K2).
   - Now: both appear in both modes on Home, the sidebar and Scan.
   - Decide: keep or change them. "Brighter" can be read as skin lightening, and "skin health" is a health
     outcome.
10. **Invitation to turn on progress photos** (E2).
    - Now: shown to signed-in users on Progress.
    - Decide: whether an in-product invitation is acceptable, and its wording.
11. **The "Hydration" label** (A6).
    - Now: shown as a reading, although it measures surface roughness.
    - Decide: keep the name and explain it everywhere, or rename it.
12. **Reading-derived search terms in outbound links** (G4).
    - Now: "Search Amazon" and "Search Google Shopping" links contain the suggested product type.
    - Decide: acceptable or not, and whether to link to a search engine at all.
13. **Escalation wording in the chat** (C16).
    - Now: the chat points people to "a qualified dermatologist", or to "urgent care or your doctor, and A&E".
      No test checks replies for diagnostic wording.
    - Decide: the approved escalation wording, since MED-01 forbids triage and referral claims and §10
      keeps dermatologist referral outside V1. Engineering then adds the MED-01 safety tests.
14. **"Upload a photo" on Scan** (E4).
    - Now: offered alongside the live camera.
    - Decide: §5 says "Live camera only for V1".

**P0 items this review found not built.** These are not wording decisions. They are listed so that they
are not mistaken for settled items:
- age and guardian gates (AGE-01, GDN-01; E4, I1, J3);
- facial-scan consent before the first scan (CNS-01; E4);
- progress-photo and cloud-reasoning consent wording (CNS-04, CNS-02; E3, E5);
- consent logging (§4; J4);
- checkout disclosure and cancellation (PAY-01, PAY-02; H3);
- cookie choices (CK-01; J2);
- withdrawing consent, marketing preferences and policy history (SET-01; J2);
- the account-deletion explanation (§11, RET-04; F4);
- MED-01 safety tests (C16);
- deletion and storage audit evidence (RET-01 to RET-03; F1);
- the ADS-01 event audit (G3).

---

## 4. The page reviews

Each file lists every flagged string on its page(s), with the sample-mode and real-mode wording side by side.

| File | Covers |
|---|---|
| [counsel/home.md](counsel/home.md) | Home (`/`) and the chat drawer: decor text, greeting, "Premium Member", the AI disclosure, the tip list, chat copy |
| [counsel/routine.md](counsel/routine.md) | Routine (`/routine`): plan wording, step cards, the list, "Why this routine?", notices, "Your products" and outcomes |
| [counsel/progress.md](counsel/progress.md) | Progress (`/progress`): header, skin comparison, score card, key improvements, timeline, recent scans, milestones, insights |
| [counsel/products.md](counsel/products.md) | Products (`/products`): commerce model, affiliate links and disclosure, hero, chips, cards, detail panel |
| [counsel/scan.md](counsel/scan.md) | Scan (`/scan`): status line, zone callouts, observed concerns, metric cards, skin-layer panel, hologram, room text, capture and gates |
| [counsel/misc.md](counsel/misc.md) | Learn (basics and glossary), Settings, Profile, Privacy, Your data, legal pages, sign-in screen, Intro |

**What has changed since the page reviews were written** (checked against `1e66cec`):
- [home.md §6](counsel/home.md) lists a "still open" item: sample-mode chat replies could quote the signed-in
  account's real readings. **This is fixed.** In sample mode, replies now come from a blank sample profile
  (`src/lib/local-engine.ts`).
- [misc.md](counsel/misc.md) says the only sample-mode difference on its pages is the profile pill.
  **This is out of date.** Settings (the account card), Profile, Privacy and Your data now set a signed-in
  account aside in sample mode (row J6).
- [misc.md §5](counsel/misc.md) quotes the data-export notice as "…held by **Elohim**…" and says it was
  left unchanged because it is legal copy. **This is out of date.** `1e66cec` changed it to "Evia"
  (rows F4 and L1).
- [misc.md §7](counsel/misc.md): the demo account is now `demo@evia.local`.
- [products.md](counsel/products.md) is updated for the retailer names (status note at the top),
  including a row for the illustrative retailers on sample products.
- Found while consolidating, and not in any page review: C1 (the spoken "all clear" line), C16 (the chat's
  escalation wording and the missing MED-01 reply tests), D5(b) (pages without the AI disclosure), the
  coat lines in D4, L2 (the pre-recorded clips) and the sample-only deployment commit in decision 1.

**How to see each mode.**
- Sample mode: on the sign-in screen, choose "Preview with sample data", or add `?sample=1` to the address.
  Turn it off with the "Sample data" switch in Settings, or with `?sample=0`.
- Real mode without an account: choose "Look around without an account". Nothing is saved.
- Real mode with an account: sign in. On a demo server, the demo account `demo@evia.local` has six scans of
  history.
