# Evia — Technical Architecture

> Evia is a persistent AI beauty companion who happens to have a physical digital
> presence. Every decision below is downstream of that sentence. If a change makes
> Evia feel more like a dashboard and less like a person, it is the wrong change.

**Status:** Phase 1 (Evia Core) + the skeleton every later phase plugs into.
**MVP art direction:** procedural / low-poly / holographic. Deliberately stylised, never
unfinished. All visual assets sit behind interfaces so they can be replaced wholesale.

---

## 0. Stack and why

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Vite + Svelte 5 + TypeScript | Small runtime, fine-grained reactivity. Matters on the target hardware. |
| 3D | three.js (WebGL2) | Only mature option. Held to a strict budget — see §9. |
| Character | Procedural low-poly hierarchical rig | No asset pipeline, no downloads, swappable for glTF later. |
| Server | Node 24 + Express, `.ts` run via native type-stripping | No build step for the server. |
| DB | `node:sqlite` (built into Node 24) | Real relational DB, zero native modules, zero install friction. |
| AI | Anthropic SDK, `claude-opus-5` | Server-side only. The browser never sees a key. |
| Face/skin CV | In-browser Canvas2D + typed-array kernels | Face images never leave the device unless the user opts into cloud reasoning. |

Two processes in dev: Vite on `5195`, API on `5196`, Vite proxies `/api`.

---

## 1. Layering

```
                          EVIA FRONTEND
                               |
   +---------------+-----------+-----------+---------------+
   |               |                       |               |
 Character      Chat UI                 Scan UI        History/Product UI
 Engine            \                      /                /
   |                \                    /                /
   +-------------- SessionDirector (client orchestrator) -+
                               |
                        HTTP  /api/*
                               |
                       EVIA ORCHESTRATOR (server)
                               |
   +---------------+-----------+-----------+---------------+
   |               |                       |               |
 Conversation   Skin Analysis          Product          Longitudinal
 Engine         Engine (server half)    Engine           Model
   |               |                       |               |
   +---------------+-----------+-----------+---------------+
                               |
                         Repositories
                               |
                        SQLite + encrypted blob store
```

Hard rules, enforced by module boundaries:

- **The character engine contains no business logic.** It accepts a `CharacterDirective`
  and renders it. It cannot read the skin model, call the API, or touch the DB.
- **The skin analysis engine never touches the UI.** It takes pixels, returns a
  `SkinAnalysis`. It has no import from `src/scene` or `src/holograms`.
- **The conversation engine never touches tables.** It receives an assembled
  `EviaContext` and returns an `EviaTurn`. Repositories are injected at the orchestrator.
- **The orchestrator is the only module allowed to know about all of the above.**

The practical test: you can delete `src/character/` entirely and the app still holds a
correct conversation and stores correct scans. That property is what makes the V2 art
upgrade a swap instead of a rewrite.

---

## 2. Data model

SQLite, `data/evia.db`. Migrations are numbered SQL applied in order and recorded in
`_migrations`.

```
users(id, email, display_name, password_hash, password_salt, created_at)
sessions(token, user_id, created_at, expires_at)

skin_profiles(user_id PK, skin_type, fitzpatrick, concerns_json, sensitivities_json,
              current_profile_json, updated_at)

skin_scans(id, user_id, captured_at, image_ref, thumb_ref,
           metrics_json,            -- the 9 normalised metrics
           regions_json,            -- per-ROI raw values
           capture_quality_json,    -- brightness/sharpness/framing + pass|warn|fail
           confidence, model_version, notes)

products(id, name, brand, category, ingredients_json, source, created_at)
product_usage(id, user_id, product_id, started_at, ended_at, frequency, notes)
product_observations(id, user_id, product_id, verdict, note, created_at)

conversations(id, user_id, started_at, last_active_at, title)
messages(id, conversation_id, role, content, emotion, intent, directive_json, created_at)

memories(id, user_id, kind, key, value, confidence, source_message_id, updated_at)
preferences(user_id PK, explanation_style, voice_enabled, reduced_motion,
            quality_tier, locale, updated_at)

consents(user_id, kind, granted, granted_at)   -- image storage, cloud reasoning
```

Two deliberate choices:

**`memories` is separate from `messages`.** §7 of the brief demands the system distinguish
durable facts from conversational noise. `messages` is the transcript; `memories` is what
Evia actually *knows*. A fact is promoted into `memories` only by the extraction pass
(§6 below), keyed so a later contradiction updates rather than duplicates.

**`model_version` on every scan.** Metric formulas will change. Comparing a v1 hydration
score to a v2 hydration score is meaningless, so the longitudinal engine refuses to trend
across versions and says so out loud rather than quietly drawing a wrong line.

---

## 3. Skin analysis pipeline

Runs **client-side**. Facial pixels stay on the device; the server receives numbers, plus
the image itself only if the user consented to storage.

```
frame -> CaptureQualityGate -> Normalise -> FaceROI -> Metrics -> SkinAnalysis
            (reject early)    (WB+exposure)  (9 regions)  (9 scores)
```

**1. Capture quality gate.** Mean luminance in range, Laplacian sharpness above floor,
face box at least 28% of frame height, centred, not clipped. Fails fast with a human
reason ("you're a bit backlit") rather than analysing garbage. Longitudinal data is only
worth anything if capture conditions are controlled, so this gate is load-bearing, not
polish.

**1b. Canonical framing.** The face is resampled into a fixed 288x384 buffer, and the
source rect is first grown to that aspect around the same centre rather than stretched
into it. Stretching a variable-aspect detection box scales x and y differently, which
changes horizontal and vertical spatial frequency by different amounts — and texture and
pore density are measured from exactly that frequency. Verified: identical face pixels in
three different frame aspects land within 0.7 points on every metric, against noise floors
of 3-5.

**2. Normalisation.** Gray-world white balance + exposure normalisation to a fixed target
luminance. Without this, "your redness went up" is usually just a different lightbulb.

**3. Face ROI.** Two providers behind one interface:

- `MediapipeLandmarkProvider` — 478 landmarks, used when the model file is present.
- `SkinToneRegionProvider` — YCbCr skin mask, largest component, ellipse fit, anatomical
  subdivision. No model file, no download, works offline. Default.

Nine regions: forehead, glabella, nose, left/right cheek, left/right periorbital,
perioral, chin.

**4. Metrics.** Each is a documented function of real pixels, deterministic, and
reproducible. Full formulas live beside the code in `src/skin-analysis/metrics.ts`.

| Metric | Signal |
|---|---|
| `hydration` | inverse normalised high-frequency luminance roughness on cheeks |
| `oiliness` | specular coverage (high V, low S) weighted to the T-zone |
| `redness` | CIELAB a* elevation vs. the face's own baseline |
| `texture` | local sigma of L* at pore-to-fine-line scale, area-normalised |
| `pores` | band-pass local-minima density at pore scale |
| `darkSpots` | adaptive-threshold dark blob area fraction |
| `evenness` | inverse of inter-region sigma of L* and b* |
| `underEye` | infraorbital vs. cheek L* delta plus b* shift |
| `acneIndicators` | co-located redness blobs and texture elevation |

All scored 0–100. Higher is better for `hydration` and `evenness`; higher is worse for the
rest. `SkinAnalysis.confidence` is the product of capture quality and ROI confidence and
is surfaced to the user when it is low.

**These are appearance measurements, not diagnoses.** The type is literally named
`SkinAppearanceMetrics`, and Evia's system prompt forbids diagnostic phrasing (§11).

**Optional cloud reasoning.** With explicit consent, the image can additionally go to
Claude vision for qualitative observations. It layers *on top of* the deterministic
numbers, never in place of them — the numbers are what makes trends comparable.

---

## 4. Longitudinal model

A scan is never interpreted alone. `LongitudinalEngine` produces, per metric: current,
previous, first, delta vs. previous, delta vs. first, a linear trend slope over the
window, and a significance flag. Deltas below the metric's noise floor are reported as
"holding steady" rather than as movement — a 1-point change is measurement noise, and
presenting it as progress would be a lie the whole product rests on.

Product correlation is **stated as correlation**. The engine emits
`{ product, overlapDays, metricDeltasDuringUse }`, and the persona prompt requires
"your skin improved during the period you were using it" phrasing. Causal language is
blocked at the prompt level and checked in the persona tests.

---

## 5. Character system

### 5.1 The avatar interface

```ts
interface EviaAvatar {
  mount(scene: THREE.Scene): void;
  update(dt: number, ctx: AvatarContext): void;
  applyDirective(d: CharacterDirective): void;
  setOutfit(outfit: 'casual' | 'clinical', opts?: { transition?: number }): void;
  setViseme(v: Viseme, weight: number): void;
  lookAt(target: THREE.Vector3 | null): void;
  dispose(): void;
}
```

MVP ships `ProceduralAvatar` (hierarchical low-poly parts: root, hips, spine, chest, neck,
head; chest to shoulder, upperArm, forearm, hand on each side). V2 ships `GltfAvatar` with
a real SkinnedMesh and baked clips. Nothing outside `src/character/` knows which is loaded.

### 5.2 Animation state machine

States: `IDLE, LISTENING, THINKING, SPEAKING, HAPPY, CONCERNED, EXCITED, CONFUSED,
CLINICAL_ANALYSIS, ANALYSIS_COMPLETE, EXPLAINING, GOODBYE`.

Transitions are declared in a table of allowed edges with blend durations. A transition
not in the table is dropped and logged. **The model cannot invent animation commands** — it
selects from a closed vocabulary, validated against the state machine before it reaches
the rig. A model emitting `state: "backflip"` produces a logged rejection and the current
state persisting, not a broken UI.

### 5.3 Idle life

Always-on procedural layers, additive over whatever state is active: breathing (0.22 Hz),
weight shift, micro head drift (value noise), saccades and blinks on a stochastic timer
with a natural inter-blink distribution, subtle finger curl.

The tuning target is *believable*, not *busy*. Amplitudes are deliberately small; the
failure mode to avoid is a character that bobs like a toy.

---

## 6. Conversation and memory

Every user turn runs the orchestration pipeline — never a single fat prompt:

```
message
  -> intent + emotion classification
  -> context retrieval (profile, durable memories, recent scan, relevant trend, products)
  -> prompt assembly (frozen persona prefix -> stable context -> volatile turn)
  -> claude-opus-5, adaptive thinking, streamed
  -> EviaTurn { text, directive, intents[], memoryWrites[] }
  -> directive to character; memoryWrites to memories; text to transcript
```

`EviaTurn` is a structured output, not free text, because the character directive and the
memory writes have to be machine-readable and validated. The persona prefix and context
block are ordered stable-first so the prompt cache actually hits.

**Emotional awareness** influences tone, length, expression, and timing only. It is barred
from producing conclusions about the user's mental health, and "my skin is terrible today"
must not trigger a scan — it triggers a question.

---

## 7. Clinical mode

An eight-beat director, not a screen transition. `ClinicalTransitionDirector` owns the
timeline; every beat is interruptible.

| Beat | What happens |
|---|---|
| 1 | Evia says the line. Nothing visual yet. |
| 2 | Lounge key light dims and cools over 1.2 s |
| 3 | Lounge geometry dissolves; clinical room resolves (shared floor plane anchors it) |
| 4 | Outfit cross-fade, casual to clinical, 0.8 s |
| 5 | Holographic frame boots: rails, then panels, staggered |
| 6 | Capture and analysis; scan-line sweep tracks real pipeline progress |
| 7 | Metrics resolve into orbit around the face model |
| 8 | Evia turns to the user and explains |

The clinical environment module is **lazy-loaded** on first entry (§9) — the lounge boots
without paying for it.

---

## 8. Holographic UI

Five procedural primitives, no textures: `HoloPanel`, `MetricRing`, `FaceMesh`,
`TrendGraph`, `HoloRail`. Everything is additive-blended emissive line and triangle
geometry sharing one shader (scanline, fresnel rim, flicker, boot-in reveal).

Layout is a `HoloLayout` solver, not hardcoded positions: it takes N elements plus the
viewport aspect and produces an arc in landscape, a stack in portrait. That is what makes
"recompose, don't shrink" (§29 of the brief) actually true rather than aspirational.

Numbers are deliberately sparse. Evia is the interpreter; the holograms are her whiteboard.

---

## 9. Performance budget

The development machine is an Intel HD Graphics 620 — an integrated GPU roughly an order
of magnitude behind what a three.js scene is usually tuned on. The budget below is not
aspirational; it is the constraint the art direction was chosen to satisfy.

**Measured**, via `__evia.inspect()` in a dev build at 1280×720:

| Scene | Draw calls | Triangles |
|---|---|---|
| Lounge (conversation) | 19 | 1,582 |
| Clinical + holograms | 33 | 2,776 |
| Peak, mid cross-fade | 38 | 3,008 |
| Character alone | 16 meshes | 1,596 |

Ceilings: **40 draw calls, 6k triangles.** The mid-transition peak is the real ceiling
because both environments are alive at once for about a second; that is inherent to
cross-fading rather than cutting, and it was judged worth the draw calls.

Also enforced:

- no post-processing stack, no shadow maps, no volumetrics — depth is faked with additive
  planes and vertex-coloured gradients
- at most 220 particles, one `Points` draw call, dropped entirely on the low tier
- text is DOM, not 3D: no font atlases, no text draw calls, crisp at any DPI
- the clinical environment and the hologram rig are a lazy `import()`, so the lounge
  never pays for them
- `quality_tier` (`low|medium|high`) is resolved from a *measured* frame-time probe over
  the first ~60 frames — not from a device string — and is overridable in preferences.
  `low` caps DPR at 1, drops particles, and paces the loop at 30fps.

The loop is frame-paced rather than free-running: on the low tier it deliberately renders
at 30fps and hands the other half of every 33 ms back to the GPU.

**Headless stepping.** `requestAnimationFrame` does not fire in a tab that is not
compositing, which makes the scene impossible to exercise in a headless or backgrounded
check. `Stage.stepManually()` and `SessionDirector.stepHeadless(n)` advance and render
deterministically without rAF; `__evia` exposes the director in dev builds. That is how the
table above was measured.

---

## 10. Privacy

Face images are treated as sensitive from the first line of code, not retrofitted.

- Analysis is client-side; by default **the image is never uploaded**.
- Storing an image requires explicit, separate consent (`consents.image_storage`).
  Sending it to Claude vision requires a second one (`consents.cloud_reasoning`).
- Stored images are AES-256-GCM encrypted at rest under a key from `EVIA_BLOB_KEY`, written
  outside the served static root, and readable only through an authenticated route that
  checks ownership.
- `DELETE /api/me/data` hard-deletes rows and shreds blobs. It is wired to a real button.
- Logs redact image refs, message bodies, and tokens in production.

---

## 10b. Abuse and cost controls

Three endpoints are billable or attackable, so they are rate limited
(`server/lib/rate-limit.ts`, fixed-window, in memory):

| Route | Limit | Why |
|---|---|---|
| `/auth/login` | 10 / 15 min per (IP, email) | It was an unthrottled password oracle. Keyed by email too, so spraying many accounts is throttled while one user's typo does not lock out everyone behind the same NAT. |
| `/auth/register` | 5 / hour per IP | Account-creation floods. |
| `/chat`, `/chat/event` | 40 / min per user | Calls the model. Billable. |
| `/products/read-label` | 12 / 10 min per user | Vision call — the most expensive thing the server does. |
| `/scans` | 20 / 10 min per user | Multi-megabyte bodies. |

The store is a `Map` because this is a single process with a local SQLite file; more than
one process would need a shared store, and the interface is narrow enough to move.

Two related fixes: the 12 MB JSON body limit now applies only to the two routes that
actually carry an image, and expired sessions are swept on boot and every six hours rather
than only when that exact token happens to be presented again.

## 11. Safety positioning

Evia is a beauty and skincare assistant with a clinical *aesthetic*. She is not a medical
device and the product must never imply she is. Enforced in three places, because a system
prompt alone is not a control:

1. Persona prompt: observational phrasing required ("I'm seeing signs of…"), diagnostic
   phrasing forbidden ("you have…").
2. A concern-escalation rule: flagged patterns (rapid change, pain, bleeding, spreading
   lesions, asymmetric moles) route to a dermatologist referral, not to a score.
3. A persistent, non-dismissible disclaimer in clinical mode.

Final legal wording is a placeholder for counsel review; the hook is `LEGAL_DISCLAIMER` in
`server/ai/persona.ts` so it can be replaced in one place.

---

## 12. What is real vs. what is demo

Per §33 of the brief, nothing fakes. Buttons run pipelines; history reads the DB.

The one labelled exception: with no `ANTHROPIC_API_KEY` present, the conversation engine
falls back to `server/ai/fallback.ts`, a local rule-based Evia. It is marked in the UI as
*Demo Evia*, it never claims to be the model, and every response is generated from the
user's **real** stored profile and scan data. Set a key and the real engine takes over with
no other change.

`DEMO_MODE=1` additionally seeds a demo user with a real scan history so the full loop —
conversation, clinical transition, analysis, holograms, explanation, progress comparison —
can be exercised without a face and without re-scanning on every reload.

---

## 13. Phase map

| Phase | Scope | State |
|---|---|---|
| 1 | Auth, profile, character, chat, idle/speaking/listening, AI conversation, persistent context | built |
| 2 | Capture, ROI, metrics, results, scan history | built |
| 3 | Clinical room, outfit, transition, holo UI, animated analysis, explanation | built |
| 4 | Longitudinal comparison, adaptive explanation, preferences, progress | built |
| 5 | Product label scanning, ingredient analysis, routine review, compatibility | built |
| 6 | Voice in and out, audio-locked lip-sync, interactive holograms, product-response tracking | built |

### Phase 5 — product intelligence

Label reading uses the same two-provider shape as the face ROI detectors:
`OcrLabelReader` runs Tesseract in the browser (default — the photo is never uploaded,
though the recogniser itself is fetched once), and `VisionLabelReader` posts the crop to
the server for Claude, gated behind the same cloud-reasoning consent as a face scan.

`src/products/inci.ts` is the cleanup between OCR and usable data: it finds where the list
actually starts, rejoins words broken across lines, protects commas inside parentheses, and
drops fragments that are not ingredients. It is deliberately conservative — a slightly odd
ingredient name is recoverable, a dropped one is a missed warning.

`server/skin/ingredient-data.ts` carries the knowledge base, keyed by `family`, which is
what drives the stacking logic. Two products in the same family are doing the same job, and
that is the most common routine mistake. Two family sets exist and the distinction matters:
`activeFamilies` answers "am I doubling up?", `coveredFamilies` answers "is anything doing
this job?" — collapsing them is how a routine containing a daily SPF got told it was
missing sun protection.

Coverage is finite and stated: an unrecognised ingredient is reported as unrecognised, and
silence never reads as approval.

### Phase 6 — voice and interaction

`SpeechTrackLike` has two implementations. `EstimatedSpeechTrack` derives visemes from the
letters, used when there is no audio. `AudioLockedSpeechTrack` is driven by the speech
engine's word-boundary events and continuously corrects its pace from the observed interval
between them, so the mouth locks to the real voice within about two words. If a voice
reports no boundaries — some do not — the estimated track keeps playing rather than the
face freezing.

Holograms are real controls: each metric is a focusable `<button>`, and tapping one asks
Evia about that metric rather than opening a detail panel. She stays the interpreter. The
slot solver guarantees that whatever she is about to name — the biggest mover and the
biggest one going the other way — is on screen, because otherwise she points at a ring that
is not there.
