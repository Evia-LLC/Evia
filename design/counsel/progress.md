# Counsel review: Progress page

Page: `/progress` (`src/pages/ProgressPage.svelte`, `src/pages/progress/*`, `src/history/*`,
`src/view/progress.ts`, `src/sample/fixtures/progress.ts`). Reference: `ref2.png` (specs/progress.md;
data-map.md sections 4, 8 and 9).

Two modes:

- **Sample mode** (`?sample=1` or "Preview with sample data"): the mockup's numbers and words, verbatim,
  with the "Sample data" badge pinned top-centre the whole time. Nothing is read from or written to the
  server. The mockup's before/after faces and scan thumbnails are replaced by neutral skin-texture tiles
  (no faces; BUILD-PLAN decision 3). The score card's info button says: "Sample data: the design's
  example score. Evia does not calculate a single skin score."
- **Real mode**: only the stored scans (`GET /api/scans`), the trend summary (`GET /api/scans/summary`),
  routine outcome statements (`GET /api/routine/outcomes`, accounts only) and, for someone who opted in
  to progress photos and saved some, those photos. No composite score or grade, no percentages, no
  adherence or streak claims. A change is only called a change when it clears that metric's noise floor
  (`METRIC_NOISE_FLOOR`, the same table the server's trend summary uses), and every metric says which way
  is better (hydration and tone evenness: higher is better; the other seven: lower is better). A guest
  sees their in-tab scans or honest empty states, and no photo invitation.

Nothing below has been reworded silently: every flagged sample-mode string is shown verbatim, and the
real-mode wording that replaces it is listed so counsel can approve or change it.

## 1. Header

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Subtitle | "Real changes. A healthier, brighter you." | "Your scans, compared over time." | §5 / MED-01: "healthier" is a health claim about a cosmetic reading; "Real changes" asserts an outcome |
| Toast | "You're doing great! 🎉 Consistency is working." | Only when the latest scan is under 2 days old and a metric improved past its noise floor since the scan before: "New scan added" / "{Metric} improved by {n} points since the scan before." Auto-hides after 8 s. Otherwise no toast | No adherence data exists behind "Consistency is working" (data-map §9, "Membership and progress claims") |
| Profile pill | "Premium Member" (shell component) | The account's display name only | §8: no subscription tier exists to call "Premium" (shell owner, listed here because it appears on this page) |
| Range note (sample only) | On any range other than 3M: "This sample is one example quarter, May to August 2024, so it looks the same on every range. With your own scans, the range filters each card." | Never shown; the range filters every card by scan date | none (disclosure that sample figures do not respond to the range) |

## 2. Skin comparison card

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Subtitle | "Visible progress from your scans" | Without photos: "Your readings, first and latest scan in this range", or "Your readings: the first scan in this range and the one you chose" when a recent-scan tile was chosen (the date badge then reads "Chosen" instead of "Latest"). With photos: "Your progress photos, first and latest in this range" / "...: the first in this range and the one you chose". Too few scans: "Your first and latest readings, side by side" | "Visible progress" asserts an improvement |
| Before/after | Two neutral skin-texture tiles (heavier speckle "Before", lighter "After"), dated May 12, 2024 / Aug 12, 2024, drag handle, expand | **No photos (most people):** first-vs-latest readings grid, all nine metrics, each "{from} → {to}" with an up or down chevron for its direction, "Improved {±n pts}", "Wrong way {±n pts}" or "Steady within ±{noise floor}", and the key "Higher is better: hydration, tone evenness" / "Lower is better: the other seven". **With consented photos:** the wipe between the first stored progress photo in the range and the newest (or the chosen scan's photo), plus "Original photos, not aligned: pose, distance and light can differ between them." | CNS-04 (photos only after separate opt-in, off by default); RET-01 (scan frames are never shown; only deliberately saved progress photos) |
| Caption | "“Your skin texture looks smoother, and dark marks are less visible.” — Evia" (attributed to Evia) | A generated sentence naming at most three changes past the noise floor, with any change in the wrong direction always among them, e.g. "Breakout signs improved by 19 points, hydration improved by 16 points and texture improved by 15 points; 6 more improved." or "All nine readings held within measurement noise between these two scans." Under photos, the sentence compares the two photos' own scans (never the range's first scan), and is omitted when either photo has no linked scan. Not attributed to Evia | §5 "cosmetic observations supported by provider output"; the sample caption is an AI-attributed cosmetic judgement of photos |
| Photo invitation | Not shown (the sample is the photo variant) | "Progress photos are off. Turn them on to compare side by side. Turn on in Privacy" (links to `/privacy`); when photos are on but none saved: "Progress photos are on. Save a photo after your next scans to compare them here. Privacy settings". Never shown to a guest | CNS-04: is an in-product invitation to opt in acceptable, and is this wording neutral enough? |
| Empty states | n/a | "Your first scan is your baseline" / "After a second scan, this card compares your first and latest readings, metric by metric."; "One scan in this range"; "No scans in {range}" | none |

## 3. Score card (the ring)

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Title and ring | "Skin health score", "82", "out of 100", grade pill "Good", "+18% since May" | "Latest readings", "Each out of 100", a "Latest scan" date, "{n} scans in your history", a "Scan again" button, and the latest scan's nine readings as bars, grouped under "Higher is better" (Hydration, Tone evenness) and "Lower is better" (Oiliness, Redness, Texture, Pores, Dark spots, Under-eye, Breakout signs). No ring, no grade | §5 "no arbitrary beauty/health scores"; §1 never fabricate scientific-looking measurements |
| Bars | Texture 85, Clarity 78, Even tone 72, Hydration 88, Firmness 80 | See above. "Clarity" and "Firmness" are not measured by any analysis and never appear | "Texture 85" drawn as good is the inverse of the stored value (higher texture is worse) |
| Info button | "Sample data: the design's example score. Evia does not calculate a single skin score." | "Each reading is an appearance index from 0 to 100, measured from your scan photo. They are not percentages, and not a health score." | Please confirm this explanatory wording |

## 4. Key improvements

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Figures | "-42% Acne spots", "+36% Hydration", "+28% Even tone", "-31% Redness", "Compared to your first scan" | Up to four metrics that improved past their noise floor between the first and latest scan in the range, in points, biggest first, e.g. "−19 pts Breakout signs (lower is better)", "+16 pts Hydration". Meta: "Compared to your first scan" (or "Compared to {date}" for a shorter range, or "From {date} to {date}" when a scan was chosen). None: "Nothing improved past measurement noise" / "From {date} to your latest scan. Small moves under each reading's noise floor are not called changes." | Percentages of a 0-100 appearance index are precision the camera does not have (data-map §9); "Acne spots" is a condition name (MED-01; §10 allows "breakout-like areas", real label is "Breakout signs") |

## 5. Progress timeline

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Series | "Skin health score" line, tooltip "82 · Aug 12, 2024", subtitle "See how your skin has changed over time" | One real metric at a time from a selector of the nine (it opens on the reading that moved most across the range, whichever way it moved, so the default is not chosen for being flattering), with "{Metric}: higher/lower is better, on a 0 to 100 scale", one point per scan in the range, tooltip on the latest point, and a data table for screen readers. Subtitle "How each reading has changed over time". If older scans used another analysis version: "Only scans from the current analysis version are plotted; earlier ones measured differently." | §5 (composite series) |

## 6. Recent scans

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Tiles | Four texture tiles with dates and "Score: 82 / 76 / 68 / 64" | A date tile (month, day, weekday) with one or two changes since the scan before, e.g. "Redness −4 pts", "Hydration +5 pts", or "Steady" / "First scan". A stored progress photo replaces the date tile only when the person opted in and saved one for that scan. Capture confidence is never shown as a score | §5 (per-scan scores); CNS-04 (thumbnails) |
| "View all" | Read-only sample list | Every kept scan with date, time and capture quality, and each scan and each progress photo deletable individually after a confirmation | §11 (delete individual photos) |

## 7. Milestones

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Items | "You're making great progress!", "Completed 10 scans", "Stuck to routine for 30 days", "Improved skin score by 20%", "Fewer acne spots" (in progress) | "From your scan history", then only scan-count facts: "Completed your first scan", "Completed {3/5/10/25/50/100} scans", optionally "Tracking your skin for {n} days" (first to latest comparable scan), and the next count as in progress at its real fraction ("10 scans: 6 of 10 done") | No adherence data ("Stuck to routine"); composite score ("skin score by 20%"); condition name ("acne spots"); "great progress" asserts an outcome |

## 8. Evia's insights

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Text | "Your consistency is paying off! Your skin is clearer and more balanced. Let's keep focusing on hydration and maintaining your routine. I recommend continuing your current products and re-scanning in 2 weeks." signed "Evia ♡", tagline "SMALL STEPS. REAL RESULTS." | The trend summary's own headline (server `summarise`, e.g. "Nothing moved beyond measurement noise since the last scan."), then at most one routine sentence: a routine outcome statement from the server (which carries its own caveat, e.g. "... That is association, not proof: other things changed in the same window.") or a "While {product} was in your routine ({n} days, {n} scans): ... That is a correlation, not proof the product caused it." sentence. No signature, no tagline. An "Ask Evia about your progress" link opens the chat | No adherence data behind "consistency"; "clearer and more balanced" is an outcome claim; product continuation advice (§10 product suggestions are general); no rescan reminder exists behind "re-scanning in 2 weeks"; product attribution must stay correlational (MED-01) |
| Avatar tile | Rose tile with the "evia" wordmark (no character, decision 3) | Same | none |

## 9. Other

- The sidebar quote "Consistent care creates real change." belongs to the shell (not this lane) and appears on
  this page; it implies an outcome from adherence.
- Body readings: when an account has body scans, a "Body readings" card (existing `BodyHistory`) appears
  under the grid in real mode only.
- Under-18 accounts: nothing on this page is marketing; no change.
