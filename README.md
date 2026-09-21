# Elohim

An AI beauty and skincare consultant who happens to have a physical digital presence.

See [UPGRADE-NOTES.md](UPGRADE-NOTES.md) for the current 3D rooms, hologram preview,
OpenAI voice setup, verification, and deployment status.

Elohim is conversation-first. You talk to her; she asks about your skin, and when it would
actually help, the room changes and she takes a proper look. She is not a selfie scanner
with a chat box attached.

**Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing anything structural.** It carries
the layering rules, the data model, the character state machine, the skin pipeline and the
reasoning behind each.

---

## Running it

```bash
npm ci
npm run sync:mediapipe
```

```bash
npm run dev
```

That starts three processes: a local database, the API on `127.0.0.1:5196`, and Vite on
`127.0.0.1:5195`. Open **http://127.0.0.1:5195**.

The database is Postgres. With `DATABASE_URL` (or `NETLIFY_DATABASE_URL`) set, the API
uses that. With neither set, `scripts/dev-db.mjs` starts PGlite — Postgres compiled to
WebAssembly, run in-process behind a local socket — so a fresh checkout runs with nothing
installed. Its data lives in `data/pglite/` and survives restarts; delete the folder to
start over.

Node 24 is required — the server runs `.ts` directly with native type-stripping, so there
is no build step.

On this machine, `npm` invoked from tooling exits silently; `.claude/launch.json` therefore
calls `node.exe scripts/dev.mjs` directly, which is also what `npm run dev` does.

### First run

Demo mode starts automatically only with a local database outside deployment environments.
It creates this development account:

```
demo@elohim.local / demo1234
```

It comes with six scans across ten weeks and two tracked products, so trends, the noise
floor and the correlation reporting have synthetic example data to work on. Those fixtures are
labelled `DEMO FIXTURE` on every scan.

### Configuration

Copy `.env.example` to `.env`. Everything is optional; each thing you leave unset degrades
in a stated way rather than silently.

| Variable | Effect when unset |
|---|---|
| `OPENAI_API_KEY` | Without either provider key, conversation uses the labeled local engine and speech is unavailable. OpenAI is preferred when configured; `ANTHROPIC_API_KEY` is an optional legacy conversation provider. |
| `ELOHIM_BLOB_KEY` | Face images are **not stored at all**, rather than stored unencrypted. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `DEMO_MODE` | Auto-enabled only for local development databases; explicitly set `0` in deployments. |
| `OPENAI_MODEL` | Defaults to `gpt-4.1-2025-04-14`. |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` | Defaults to `gpt-4o-mini-tts-2025-12-15` / `marin`. |

---

## What is real

The app distinguishes measured image features, model observations, and demo fixtures:

- **The local image pipeline computes visual features from pixels.** These scores are
  appearance proxies, not validated medical or physiological measurements. Lighting,
  camera, pose, and skin tone can affect them; a photo does not measure hydration.
  Formulas are in `src/skin-analysis/metrics.ts`.
- **The progress bar tracks the actual pipeline**, not a timer.
- **Saved scan scores and trends come from Postgres.** A change in an image-derived score
  is not proof of a biological change or a treatment effect.
- **A change smaller than the metric's noise floor is reported as "holding steady"**, not
  as progress.
- **Product effects are reported as correlation**, in those words, never as cause.
- **Label scanning supports local OCR and consented cloud reading.** The read is shown
  for correction before saving. Cloud image observations require the applicable consent.
- **Replies use OpenAI Marin after opt-in.** Mouth activity follows the audio waveform;
  word and phoneme timing is estimated from the clip duration, not provider timestamps.
  Browser speech recognition provides voice input where supported.

The one labelled exception is Demo Elohim, above. It is a rule-based engine, marked in the UI
on every message, and it reads the same stored context the model would.

### Talking to her

Tap the microphone and speak; the composer fills in live with what she is hearing. Turn on
*Let me speak* in Profile to hear her AI-generated OpenAI Marin voice. Account voice
also requires cloud-processing consent in Privacy. Turning voice off stops playback and
clears the browser's decoded speech cache. See [VOICE-UPGRADE.md](VOICE-UPGRADE.md).

Tapping any metric in the clinical room asks her about it, rather than opening a panel. She
is the interpreter; the holograms are her whiteboard.

### What is not built yet

A hosted product catalogue — you scan or type your own products, and there is no shared
database to look them up in. The ingredient knowledge base covers the actives, irritants and
functional ingredients that drive routine decisions, not all ~30,000 INCI names, and it says
so whenever it meets something it does not know.

---

## Layout

```
server/           API. Express + Postgres.
  ai/             persona, classification, context retrieval, orchestrator, fallback
  db/             migrations and repositories
  skin/           longitudinal model, ingredient assessment
  demo/           seeded fixtures
shared/           the contract both sides import — types and the character FSM
src/
  character/      the avatar, its rig, expressions, speech-driven visemes
  scene/          renderer, environments, the clinical transition director
  holograms/      the five procedural primitives, layout solver, assembly
  skin-analysis/  colour, quality gate, normalisation, ROI, metrics, pipeline
  products/       INCI parsing, label readers, the scanner UI
  voice/          speech recognition, synthesis, the voice pipeline
  chat/ history/ profile/               UI panels
  state/          store and controller
```

The boundaries are load-bearing. The character engine holds no business logic, the skin
engine never touches the UI, the conversation engine never touches tables, and only the
orchestrator knows about all of them. You should be able to delete `src/character/` and
still hold a correct conversation and store correct scans.

---

## Developer tools

```bash
npm run typecheck    # tsc --noEmit
npm run check        # svelte-check
npm run test:local   # full suite with a disposable database
npm run build       # production web build
```

In a dev build the scene director is on `window.__elohim`:

```js
__elohim.inspect()        // draw calls, triangles, tier, scene mode
__elohim.stepHeadless(60) // advance 60 frames without requestAnimationFrame
```

`stepHeadless` exists because rAF does not fire in a tab that is not compositing, which
otherwise makes the 3D layer impossible to exercise or measure automatically.

### Screenshotting the 3D scene

Same problem, worse: a hidden container reports a 0x0 drawing buffer, so the scene renders
nothing while draw-call and triangle counters still look healthy. To actually see it:

```bash
node scripts/shoot.mjs
```

Then from the page console:

```js
fetch('http://127.0.0.1:5199/my-shot', {
  method: 'POST',
  body: __elohim.captureFrame(1100, 780, 150),   // width, height, frames to settle
})
```

The PNG lands in `shots/`. `captureFrame` forces an explicit renderer size, steps the scene
without rAF, and reads the buffer back in the same task — `preserveDrawingBuffer` is off, so
the read has to happen before the compositor can discard it.

Server logs cover AI requests and responses, classification, scan results and timings,
context retrieval and database work. Sensitive fields — message bodies, image refs, tokens,
emails — are redacted unless `ELOHIM_LOG_LEVEL=debug`.

---

## Privacy

Face images are treated as sensitive from the first line of code.

Analysis is client-side and by default the image never leaves the browser. Storing it
requires one explicit consent; sending it to Claude for a qualitative second opinion
requires a separate one. Stored images are AES-256-GCM encrypted, written outside any
served directory, and readable only through an authenticated, ownership-checked route.
`Privacy → Delete my data` hard-deletes every row and shreds the blobs, and it is wired to
the real thing.

## Positioning

Elohim is a beauty and skincare assistant with a clinical *aesthetic*. She is not a medical
device. Observational phrasing is required and diagnostic phrasing is forbidden at the
prompt level; a deterministic escalation check — which does not depend on the model being
reachable — routes anything that sounds medical to a dermatologist instead of to a score.
The disclaimer wording is a placeholder for counsel review and lives in one place,
`LEGAL_DISCLAIMER` in `server/ai/persona.ts`.
