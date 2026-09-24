# Counsel review: Scan page (consult room, hologram consultation)

Page: `/scan` (`src/pages/ScanPage.svelte`, `src/pages/scan/*`, `src/view/scan.ts`,
`src/sample/fixtures/scan.ts`, `src/scan/ScanCapture.svelte`, `src/hologram/*`).
Reference: `ref4.png` (specs/scan.md section 8, code-scan.md section 7, data-map.md sections 6 and 9).

Two modes:

- **Sample mode** (`?sample=1` or "Preview with sample data"): reproduces the mockup's text and numbers
  exactly, over a sample face mesh traced from the mockup's own hologram (not a person). A "Sample data"
  badge is pinned top-centre the whole time. Nothing is captured or sent.
- **Real mode**: only what the on-device analysis produced for this session. Findings come from
  `observationsFor` / `locusFor` / `severityFor` (src/skin-analysis/observations.ts). Nothing on this
  page is stored; the face mesh and the photo live only while the reading is on screen.

Nothing below has been reworded silently: every flagged sample-mode string is shown verbatim, and the
real-mode wording that replaces it is listed so counsel can approve or change it.

## 1. Header status line

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Title | "Clinical analysis activated" | The real pipeline state: "Scan to see your map" (camera open / no reading), "Reading your skin" (analysis running), "Going through your reading" (her narration lighting regions), "Your reading" (done), "Your body reading" | §6 "Clinical aesthetic must not imply diagnosis"; MED-01; §5 "Progress animation tracks actual pipeline state, never a fake timer" |
| Eyebrow | "3D SKIN MAPPING · AI ANALYSIS · PERSONALIZED INSIGHTS" | Capture, following what the camera is actually doing: "LIVE CAMERA · READ ON THIS DEVICE", "OPENING THE CAMERA", "NO CAMERA ACCESS · A PHOTO WORKS TOO", "PHOTO CHOSEN · READ ON THIS DEVICE", "CAMERA OFF · READ ON THIS DEVICE"; then "{PIPELINE STAGE} · {n}%" (the pipeline's own stage word and progress); "NOW · {METRIC}"; "FACE MAP · {time} · APPEARANCE ONLY"; "FACE MAPS ARE NEVER STORED" | "AI analysis" is inaccurate (the metrics are deterministic pixel statistics); "3D skin mapping" must be technically true (§1 claims; launch checklist marketing review) |
| Status dot | Steady glow (no pipeline runs in a preview, so it does not pulse) | Pulses only while the analysis runs or she is narrating; steady otherwise | §5 fake-timer rule |

## 2. Zone callouts (FOREHEAD / PORES / CHEEKS / UNDER-EYES / CHIN)

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| FOREHEAD lines | "Uneven texture", "Early congestion", "Slight dehydration" | Only metrics whose locus sentence names that place, as "{Metric} · {band}", e.g. "Texture · Moderate". Headings follow the place: FOREHEAD, BETWEEN THE BROWS, T-ZONE, NOSE, CHEEKS, UNDER-EYES, CHIN, AROUND THE MOUTH, CHIN & MOUTH. A place with nothing to say has no callout. | §1 "Never fabricate scientific-looking measurements or unsupported findings"; §5 "Findings are cosmetic observations supported by provider output" |
| PORES lines | "Visible pores", "Oil activity (T-zone)", "Texture irregularity" | (as above; "PORES" is not a region in the code, so the slot shows T-ZONE / NOSE findings; the pores metric has no locus and appears only in the concern list) | same |
| CHEEKS lines | "Mild redness", "Barrier sensitivity", "Uneven tone" | (as above) | "Barrier sensitivity" has no metric: §1, MED-01 |
| UNDER-EYES lines | "Mild dark circles", "Dehydration lines", "Loss of elasticity" | (as above) | "Dehydration lines", "Loss of elasticity": not measured (§1) |
| CHIN lines | "Congestion", "Texture irregularity", "Post-blemish marks" | (as above) | "Congestion", "Post-blemish marks": no metric; "post-blemish" infers a cause (§1, MED-01) |
| Thumbnails | Neutral skin-texture tiles drawn in SVG (no faces; the mockup's eye close-up is replaced by plain texture with its white lid-arc graphic) | Crops of this session's own capture, cut in the browser from the pipeline's own region rectangles, held as object URLs and revoked when the reading leaves; a neutral tile when the capture is no longer in memory. Each tile is one representative region (T-zone and nose: the nose; cheeks: one cheek; under-eyes: under one eye) and its accessible name says only that: "T-zone: the nose, cut from this scan's photo" (not "the part it was measured from": a finding is measured over the face and reported where it is most visible) | RET-01 (raw images session-only), CNS-04, AI-01 (never sent to model providers). The macro "dermatoscope" look can imply clinical imaging (§6) |

## 3. OBSERVED CONCERNS

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Rows | "Dehydration High", "Texture Irregularity Moderate", "Redness / Sensitivity Moderate", "Visible Pores Moderate", "Barrier Weakness Mild" | Every metric that reached a band (so a finding with a callout on the face is always in the list), labelled with the code's metric names (Hydration, Oiliness, Redness, Texture, Pores, Dark spots, Tone evenness, Under-eye, Breakout signs), ordered by how far into its band each reads | §5 "no arbitrary beauty/health scores"; MED-01 (triage-like scale) |
| Severity words | "High", "Moderate", "Mild" | The code's bands only: Slight / Moderate / Marked / Off scale (concern 25-49 / 50-74 / 75+ / pinned at the end of the calibrated range). "High" and "Mild" are never produced. Mapping for reference: Mild ≈ Slight, High ≈ Marked. The code's fifth band, "Clear" (concern under 25), is never displayed on this page: rows and callouts list only flagged metrics, and a card below Slight says "Not flagged" (section 4) | MED-01; §10 |
| Nothing flagged | n/a | "Nothing reached the Slight band in this reading." (never "healthy", "all clear" or "normal range") | §10 "Absence of an escalation message must never be presented as reassurance that skin is healthy" |
| "Barrier Weakness", "/ Sensitivity" | shown | never (no such measurement) | §1 |

## 4. Metric cards (tray on the pedestal)

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Values | "62%", "68%", "54%" | The band word: "Slight", "Moderate", "Marked" or "Off scale". Below Slight the headline is **"Not flagged"**, not the code's band word "Clear": HYDRATION and TEXTURE always have a card, so a quiet reading would otherwise print "Clear" in 20 px headline type, which reads as a clean bill of health (code-scan §7 item 2). Never a percentage: the readings are 0-100 appearance indices, not quantities | §1; §5; §10 "absence of an escalation message must never be presented as reassurance" |
| Gauges | Half-full ring on every card (decorative, labelled "Decorative gauge, not a measurement" for assistive tech) | A plain ring with no arc | §1 (meter imagery implies a reading) |
| Status lines | "Below optimal levels", "Mild irregularity", "Needs care" | The locus sentence ("Most visible on the cheeks.", "Fairly even across the face."), or "In this photo" under "Not flagged" | Norm / treatment-need wording: MED-01 |
| Card set | HYDRATION, TEXTURE, BARRIER SUPPORT | HYDRATION, TEXTURE, and the other metric that reads furthest into its band. No "Barrier support" (no such metric) | §1 |
| Descriptions (Detailed) | "Skin shows signs of dehydration, especially in under-eye area." / "Uneven texture detected across cheeks and chin." / "Signs of a weakened skin barrier and increased sensitivity." | Client-side copy per metric (src/view/scan.ts `FLAGGED_COPY`, `CLEAR_COPY`, `BEYOND_COPY`), e.g. "The surface reads rough, which often goes with dryness. Not a water test." / "Some redness shows in this photo." / not flagged: "This photo did not reach the Slight band. One photo is not a health check." | "Hydration" is a surface-roughness proxy, not water content (code-scan §7 item 3); MED-01; §10 |
| Descriptions (Gen-Z) | Written for the preview (not in the mockup): "Your skin is lowkey thirsty, especially under the eyes." / "A little bumpy across the cheeks and chin." / "Your barrier needs some TLC right now." | e.g. "Giving a little dry. It reads texture, not actual water." / "Looking a little flushed in this pic." / not flagged: "Nothing flagged in this pic. One photo, not a check-up." | §10: the casual register must not reassure; MED-01 diagnostic-wording tests should cover both registers |

## 5. SKIN MAP panel

| Element | Both modes | SRS |
|---|---|---|
| Tabs "Surface / Mid-Layers / Deep View"; layers "Epidermis — Texture, tone, clarity", "Dermis — Collagen, elasticity", "Hypodermis — Support, structure" | Shown as a fixed educational illustration, identical for every user, captioned in the panel: "How skin is layered — illustration, not a reading of your skin." plus one line per tab: "The outer layer: the only one a camera sees." / "Below the surface: a photo cannot see it." / "The deepest layer: no camera can see it." The tabs change which layer is brought forward; no data is involved. | §1 (fabricated scientific depiction if read as the user's result). Decision needed: keep the illustration with this caption, or remove the panel |

## 6. Hologram

| Element | Sample mode | Real mode | SRS |
|---|---|---|---|
| Face | Sample mesh traced from the mockup's hologram (file labelled SAMPLE, `src/sample/fixtures/scan-face-mesh.json`), only with the badge up | This session's own live face mesh only. After a reload, or once her explanation ends and the controller clears the mesh, there is no head: the room shows the rings and a note ("Your face map is gone: it only exists while I explain the reading, and nothing of it is kept."), or the "Scan to see your map" state. Never a stock head. | §6 "never use a generic head as the user's result"; RET-02, RET-03 |
| Head shell, particles, arcs, neck column, rings, orb | Decoration placed from the face's size; no captured data | same | §6 flag 7 (must not look like captured data). The shell is only a broken hairline on the outline that fades toward the crown, a few faint arcs and particles: no fill. The glow behind the head sits behind the face only (it used to wash the crown blue inside the shell's rim), and the forehead dissolves into the lattice along the outline instead of ending at a flat hairline, so the head reads as a floating face, not a face in a hood |
| Zone glows | Mockup's zones | Only regions a localised finding names, glowing more for a higher band | §6 "Supported findings map spatially to relevant facial regions" |

## 7. Explanation toggle and tagline

| Element | Both modes | SRS |
|---|---|---|
| "Detailed" / "Gen-Z explanation" | Switches the card copy on the page. In real mode, for an account, it also makes the choice the user's explanation style through the controller: a quiet `setExplanationStyle` once the controller has one; until then it sends her the old Scan page's request, "Give me the Gen-Z version." / "Give me the detailed version.", through the controller's chat path, which the server stores as the preference; her reply (e.g. "Done. Bestie mode it is.") shows in the reading dock. Guests and sample mode write nothing. | §10 (casual register) |
| Handwritten "Same skin / Deeper answers." | Decorative, both modes | Marketing claim review (launch checklist #13) |

## 8. Environment text (HTML over the Blender plate; decoration, aria-hidden)

"Evia", "HIGHER SKIN STANDARDS", "A BRIGHTER YOU" (left wall); "MORE / THAN / SKIN", "ANALYZE /
UNDERSTAND / PERSONALIZE / IMPROVE / TOGETHER" (right wall); "SCIENCE", "BEAUTY", "A BRIGHTER YOU"
(book spines); "Your skin. Understood." and "Evia" (pedestal). Shown in both modes on the desktop
composition ("Your skin. Understood." is left off on the smaller desktop sizes, where the Detailed /
Gen-Z control sits on that stretch of the pedestal). Implied efficacy/science claims: marketing copy review (launch checklist #13).

## 9. Disclosure, capture and gates

| Element | What the page does | SRS |
|---|---|---|
| AI disclosure | "Evia is an AI. General skincare guidance, not medical advice." always on screen (bottom-right on desktop, in the flow on tablet, pinned under the sheet or panel on phone) in both modes | §6 persistent consultation disclosure |
| Character | None drawn (user decision); her space in the room is left empty | §6 flag 9 (lab coat) is moot for now |
| Facial-scan consent / age gate | Unchanged from main: the page opens the camera on arrival with no consent or age gate (none exists on this branch, code-scan §0.1). Not added here: it needs an approved consent wording and a server-side gate | CNS-01, AGE-01 (open) |
| "Upload a photo" | Kept as it was on main | §5 "Live camera only for V1" (open question) |
| Progress-photo save | Offered only with approved progress-photo consent; otherwise "Progress-photo consent is off. Nothing has been saved." with a link to the consent and "Discard photo" | CNS-04 |
| Removed from the old page | The composite "Skin health {n} Good / Fair / Needs care" ring and the confidence ring | §5 "no arbitrary beauty/health scores" |
| Capture copy kept verbatim | "Even light, face in the oval, hold still. Everything is measured on your device."; "One frame, read on your device …or not now."; the quality-gate refusals | The "nothing leaves this device" style claims need checking against what is sent (numbers and region statistics go to the server for accounts): code-scan §7 item 10 |
