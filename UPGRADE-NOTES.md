# Ese holographic studio upgrade

This working copy comes from the authenticated GitHub archive of `Cyber-Destiny/Ese`, source commit `08e77acbc54dee8a1938f8063209ae69c6c96cbb`. The local branch is `codex/ese-holographic-studio`; its baseline is a source snapshot, not the original repository's Git history. No changes have been pushed or deployed.

## What changed

- The lounge and clinic now use modeled Three.js geometry: walls, ceilings, shelves, product bottles, furniture, plants, lighting details, and marble floors. Their layouts follow the repository's original room artwork. The old room images are no longer rendered as background planes.
- The face hologram uses the supplied face landmarks to build a shaded translucent surface, a fine lattice, luminous contours, point detail, and localized highlights. Glass information panels have clearer text and illuminated corner rails.
- Ese now uses a real skinned 3D GLB character with authored welcome, listening, empathy, speaking, examining, pointing, idle, and clinical-transition clips. Facial morphs supply expression and approximate lip shapes; measured audio gates mouth motion and closes it during silence or cancellation. The portal and its movement trail belong to the 3D scene.
- `design/ese/` preserves the self-contained Blender source, generation script, and provenance/rig reports. Runtime asset sourcing is documented in `public/character/ese/SOURCES.md`. The rejected 3D homepage-film source is excluded.
- Sign up opens a supportive welcome and a one-question-at-a-time intake on a wood plaque beside Ese. Every question is optional, sensitive answers can be skipped, and the draft stays in page memory before registration. Saving requires an explicit storage choice and an authenticated account; migration `011_consultation_intake.sql` adds the owner-scoped record and deletion cascade. See `INTAKE-NOTES.md` for collection, export, and interpretation limits.
- OpenAI Responses handles consented conversation and image observations. The fixed voice is OpenAI Marin. Credentials stay on the server. The signup welcome discloses its AI-generated narration and provides mute/replay controls; only fixed public prompts are narrated. Personalized account and guest speech require their separate opt-ins.
- Personalized speech bypasses the shared durable voice cache. See `VOICE-UPGRADE.md` for the required review of any cache left by an older deployed version.
- Camera requests now cancel safely on navigation, upload, retry, or unmount. Late streams are released, and a 15-second timeout makes a stalled permission or preview request recoverable.
- `/studio` offers a development-only preview of both rooms, the hologram, character expressions, a room viewing-angle control, and reduced motion. Its sample face is the attributed MediaPipe canonical mesh, visibly labeled as illustrative. It does not capture or upload a face and is excluded from production bundles.

## Run locally

Use Node.js 24 and npm. From this directory:

```sh
npm ci
npm run sync:mediapipe
node scripts/fetch-static.mjs
# For a fresh source download, copy .env.example to .env and configure it.
# The current working copy already has its local server configuration.
npm run dev
```

Open `http://127.0.0.1:5195/` for the app or `http://127.0.0.1:5195/studio?scene=hologram` for the preview. The API uses port 5196. Without a configured database, the development launcher starts local PGlite on port 5433. Keep real deployment database URLs out of local development commands.

Server configuration uses `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_CLASSIFIER_MODEL`, `OPENAI_TTS_MODEL`, and `OPENAI_TTS_VOICE`. Defaults are in `.env.example`; the selected speech voice is `marin`. Never add a `VITE_` prefix to a provider key. For account voice, enable cloud processing in Privacy and speech in Profile. Guest voice has a separate explicit opt-in.

## Verification

```sh
npm run check
npm run test:local
npm run build
```

`test:local` starts and discards a separate in-memory database, overriding inherited database URLs. Its default port is 5434; set `ELOHIM_TEST_DB_PORT` if that port is occupied. It exercises the database suite as well as the other tests without using the running preview's database.

For the September 21 commit review, the full disposable-database suite passed **399 tests across 33 files**. TypeScript passed, Svelte reported zero errors and warnings, and the production build passed. Vite reports a size warning for the 605.28 kB minified Three.js chunk; the build succeeds. A separate targeted run passed 68 tests covering identity and history races, signup hydration, scan presentation reset, intake transmission, playback cancellation, and avatar/portal behavior. The latest login-gate, delayed clinical-entry, and welcome-readiness fixes have not yet received their planned dedicated regression tests.

Earlier live provider checks verified structured OpenAI replies, a cautious image observation using synthetic character artwork, and a five-second Marin audio clip. Browser checks covered the room preview, a basic conversation, navigation, consent-gated voice controls, and leaving a pending camera request. These checks do not establish physical-device camera coverage or completion of the homepage film.

## Deployment status and limits

The running preview is local. Set the deployment's server-side credentials, hosted Postgres connection, `NODE_ENV=production`, and `DEMO_MODE=0` before deployment. Set `ELOHIM_BLOB_KEY` if encrypted image storage is enabled. Review existing deployment data and the legacy voice-cache note before rollout. Existing Vercel build configuration generates the API bundle during deployment.

Configure the OpenAI variables in the hosting provider's environment settings. The older manual `scripts/vercel-prod.sh` helper configures legacy voice credentials and should not be used for this upgrade.

Physical camera and microphone capture have not been verified on the user's devices. No personal face was captured or uploaded during this work. Visible skin observations are not validated medical measurements or diagnoses. The modeled rooms follow the source composition but are not photorealistic reconstructions.

The requested AI-generated homepage film is unfinished. The user rejected the rendered 3D-film approach. The working tree currently includes a poster, but no `public/film/ese-consultation.mp4`; the landing component still references that missing clip and falls back to its unavailable-film state. The poster and current landing integration are work in progress, not a completed replacement film.

The deliverable patch applies source changes to the original archive. It excludes local databases and secrets. Do not push the snapshot branch as a replacement for the repository's history; apply the patch in a normal clone and review it there.
