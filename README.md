# Elohim

An AI beauty and skincare consultant who happens to have a physical digital presence.

Elohim is conversation-first. You talk to her; she asks about your skin, and when it would
actually help, the room changes and she takes a proper look. She is not a selfie scanner
with a chat box attached.

**Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing anything structural.** It carries
the layering rules, the data model, the character state machine, the skin pipeline and the
reasoning behind each.

---

## Running it

```bash
npm install
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

Demo mode is on by default outside production, so an account already exists:

```
demo@elohim.local / demo1234
```

It comes with six scans across ten weeks and two tracked products, so trends, the noise
floor and the correlation reporting all have real data to work on. Those fixtures are
labelled `DEMO FIXTURE` on every scan.

### Configuration

Copy `.env.example` to `.env`. Everything is optional; each thing you leave unset degrades
in a stated way rather than silently.

| Variable | Effect when unset |
|---|---|
| `ANTHROPIC_API_KEY` | Conversation runs the local **Demo Elohim** engine, badged as such in the UI. Scans, storage and trends are unaffected and fully real. |
| `ELOHIM_BLOB_KEY` | Face images are **not stored at all**, rather than stored unencrypted. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `DEMO_MODE` | Defaults to `1` outside production. |
| `ELOHIM_MODEL` | Defaults to `claude-opus-5`. |

---

## What is real

Per §33 of the brief, nothing fakes. Specifically:

- **The skin analysis is real computer vision**, running on your device. Face regions come
  from YCbCr skin-chroma segmentation; the nine metrics are documented functions of real
  pixels in CIELAB, and the pipeline is deterministic — the same image always produces the
  same numbers. Formulas and their calibration are in `src/skin-analysis/metrics.ts`.
- **The progress bar tracks the actual pipeline**, not a timer.
- **Every number Elohim says comes out of SQLite.** If she says your hydration improved, it
  improved.
- **A change smaller than the metric's noise floor is reported as "holding steady"**, not
  as progress.
- **Product effects are reported as correlation**, in those words, never as cause.
- **Label scanning is real OCR**, running in the browser. Your photo is not uploaded; the
  text recogniser is downloaded once. The read is always shown for you to correct before
  anything is saved.
- **Voice is real in both directions** — speech recognition for input, synthesis for
  output — and the mouth is driven by the engine's actual word-boundary events, not a
  guess laid alongside the audio.

The one labelled exception is Demo Elohim, above. It is a rule-based engine, marked in the UI
on every message, and it reads the same real data the model would.

### Talking to her

Tap the microphone and speak; the composer fills in live with what she is hearing. Turn on
*Let Elohim speak* in Profile and she reads her replies aloud, with her mouth locked to the
audio. You can pick her voice there too — the default is the best feminine voice your
system has installed.

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
server/           API. Express + node:sqlite.
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
