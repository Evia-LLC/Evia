# Elohim — operator runbook

What to set where, and what each thing switches on. Nothing here is needed
to run the app on a laptop: `node scripts/dev.mjs` starts a local Postgres,
the API and the web app with no keys at all. These are for the live site.

## The five settings that make the live site whole

Set these in Netlify → Site configuration → Environment variables, then
redeploy. Keep them out of chat, out of the repo and out of screenshots.

| Variable | What it switches on | Where to get it |
| --- | --- | --- |
| `DATABASE_URL` | Accounts, history, trends, memory, the voice cache, the shelf. Without it the site runs in guest mode only. | Any hosted Postgres. Neon and Supabase both give a free project and a connection string. On Neon use the **direct** endpoint, not the `-pooler` one — see "Where things stand" below for why. Migrations run themselves on the first request. |
| `ELOHIM_BLOB_KEY` | Keeping scan photos (encrypted), which is what the before-and-after wipe needs across visits. | Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ANTHROPIC_API_KEY` | The real conversation model (Claude). Without it she runs the labelled local engine, which still scans, reads and recommends. | console.anthropic.com → API keys |
| `ELOHIM_VOICE_API_KEY` + `ELOHIM_VOICE_ID` | Her licensed voice. Both are needed. | ElevenLabs → the voice clone made from the licensed recording. Use a Professional Voice Clone for the licensed recording; the voice id is on the voice's page. |
| `ELOHIM_STORE_URL` | Your own shelf, read straight from the storefront. | The public URL of the shop (Shopify or WooCommerce). Set `ELOHIM_ADMIN_TOKEN` too, then call the sync (below). |

Optional, with sensible defaults:

- `ELOHIM_MODEL` (default `claude-sonnet-5`) — set `claude-opus-5` for the top model.
- `ELOHIM_USER_DAILY_TURNS` / `ELOHIM_DAILY_TURNS` / `ELOHIM_DAILY_TOKENS` — spend caps. Over a cap she answers from the local engine and says so. `/api/health` reports today's spend against them.
- `ELOHIM_GUEST_VOICE` (default on) — set `0` to keep the cloned voice for accounts only.
- `ELOHIM_STORE_NAME` (default `Ese`), `ELOHIM_STORE_CURRENCY` (default `USD`, only for storefronts that do not state one).
- `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` — real, priced marketplace offers for comparison. Without them she links to searches and says she has not compared.
- `ELOHIM_AMAZON_TAG` / `ELOHIM_AMAZON_DOMAIN` — affiliate tag and marketplace for the Amazon search links.

## Where things stand (5 September 2026)

**Database — live (deploy `6a9cb4f1518d4326aa0743e3`, published 2026-09-06 00:35 UTC).**
`DATABASE_URL` is stored on Netlify as a plain (non-secret) variable, production
context, all four scopes, pointing at the **direct** host with `sslmode=require`. The
first attempt had been written as a *secret*, which on this Free plan reports success
and stores nothing. Proof it is attached: `/api/health` answers `ok:true` — the function
awaits `ready()` (migrations) before every request, and only a *failed* database produces
`ok:false, database:false, databaseConfigured, databaseError`, so a healthy answer carries
no `database` key at all. `/api/public/catalogue/status` reads the catalogue table and
answers, Neon's `pg_stat_database` commit counter moved with those requests, and the
function's backend (an AWS-internal client address) is visible in `pg_stat_activity`.
Neon project `elohim` (id `calm-silence-63515149`, organisation
"Boluwatife"), region `aws-us-east-2` — the same Ohio region the Netlify function
runs in, so a query does not cross the country. Postgres 17, branch `production`,
database `elohim`, role `elohim_owner`. All ten migrations were applied on
2026-09-05 through the app's own `migrate()`; 19 tables exist and the demo account
was deliberately **not** seeded.

Two rules learned setting it up:

- **Use the direct host, never the `-pooler` one Neon shows first.** `migrate()`
  takes `pg_advisory_lock` outside a transaction. That is a session-level lock, and
  Neon's pooler is PgBouncer in transaction mode, which may hand the next statement
  to a different backend — the lock would guard nothing. Strip `-pooler` from the
  host and the string is otherwise unchanged.
- **Never put the production `DATABASE_URL` in the local `.env`.** Outside a
  deployment `server/lib/env.ts` turns `DEMO_MODE` on, and the launcher would seed
  `demo@elohim.local` into the live database on its first start. PGlite stays the
  local database.

**Voice — done.** The clone exists in the ElevenLabs workspace as "Elohim's voice",
id `0UFPkz6r4cUaHBRHtegr` (Creator tier, 131k characters a month). `ELOHIM_VOICE_ID` and
`ELOHIM_VOICE_API_KEY` are both set on Netlify (both plain — a secret write would not have stored) and in the local `.env`,
so her composed replies are synthesised on demand with word timings. All thirteen fixed
lines were also synthesised in that voice and ship in `public/voice/` with their manifest;
`node scripts/voice-lines-synth.mjs --voice 0UFPkz6r4cUaHBRHtegr` regenerates any line
that is missing (`--force` redoes them all) with the key read from the environment only.
The shipped lines were made with the model's default delivery; the on-demand route uses
the steadier settings in `server/voice/tts.ts` — if the two ever sound different side by
side, regenerate the files with `--force`.

**Photos — key set and live.** `ELOHIM_BLOB_KEY` was generated on 2026-09-05; that secret
write was silently dropped, so it was set again on 2026-09-06 as a plain production variable
(confirmed in the list) and `/api/health` now answers `imageStorage:true`, so accounts can
opt in to keep encrypted scan photos. A copy is in
`.secrets/production-blob-key.txt` (git-ignored). Losing the key makes every stored photo
unreadable, so keep a copy somewhere safer than this folder.

**Setting Netlify variables from the MCP:** `manage-env-vars` with `newVarContext:
"production"`, the four explicit scopes and `envVarIsSecret: false` works; the `"all"` context
or scope returns 422, and a *secret* write reports success without storing anything. Read the
list back (`getAllEnvVars: true`) after every write.

**Not yet set:** `ANTHROPIC_API_KEY`, `ELOHIM_STORE_URL`.

**Migrations on Netlify (fixed 2026-09-05).** With `DATABASE_URL` finally present the function
failed on every request with `ENOENT … /var/task/netlify/functions/migrations`: `migrate()`
looked for the SQL files next to its own module, but esbuild bundles the whole server into
one file under `netlify/functions/`, while `included_files` delivers the SQL at
`/var/task/server/db/migrations/`. `migrationsDir()` in `server/db/index.ts` now tries the
checkout location, then the task root, and names every place it looked if none exists. The
no-database health answer also carries `databaseConfigured` and a redacted `databaseError`,
so "never configured" and "configured but broken" read differently.

**Express under the Functions v2 runtime (fixed 2026-09-05).** Once the database was reachable,
every request died with `Cannot set property body of #<_Request>`: `serverless-http` expects an
API Gateway event, and Netlify's current runtime hands the function a web `Request`. The
function never got this far before because `ready()` always threw first. `server/lib/web-lambda.ts`
now translates `Request` → event and result → `Response` (bodies base64 both ways, several
`Set-Cookie` lines preserved); `test/web-lambda.test.ts` drives a small Express app through it.

**Demo account leaked into production once (2026-09-05, removed the same evening).** With the
database finally reachable, the function's first cold start seeded `demo.local` into Neon:
`NETLIFY` is not set in the Functions runtime, so the deployment test in `server/lib/env.ts` failed
and DEMO_MODE defaulted on. The row was deleted directly, and demo mode now needs two things at
once - no Lambda marker (`LAMBDA_TASK_ROOT`, `AWS_LAMBDA_FUNCTION_NAME`, `NETLIFY`) *and* a
connection string pointing at localhost. `/api/health` must report `demoMode:false` live.

**Sound on iOS (fixed 2026-09-06).** On the iPad her voice was silent while her mouth moved:
`ClonedSpeaker` created its own `AudioContext` inside a fetch, which WebKit leaves suspended
forever (no sound, a stopped clock, no word boundaries), while the director ran the estimated
mouth regardless. Now there is one page-wide context (`audioContext()` in `src/lib/sound.ts`),
unlocked by the first pointerdown/touchend/click/keydown whatever the room-sound switch says;
`audioRunning()` proves it runs before a line plays, otherwise the line fails over to the
browser voice or the mouth stays closed. The mouth only ever moves with sound: her own voice
takes it at the first sample, the browser voice runs on an estimate, no voice means no mouth.
Sending a message plays `swoosh()`; a reply no longer blips. Two more iOS facts, found in review:
WebKit also drops any `speechSynthesis.speak()` made outside a gesture (no events at all), so
`primeSynthesis()` speaks an empty utterance from the same first touch and
`synthesisAvailable()` stays false on iPhone/iPad until then; and the director now starts every
line as a `MutedSpeechTrack` (timing for gestures and the settle-back, lips shut) that the voice
controller replaces with a real track only when audio is actually playing. `ClonedSpeaker` carries
a generation counter so a cancel reaches a line still being fetched, and `VoiceController.say()`
carries one too, because a cancelled browser utterance reports its end a task later and must not
touch the line that replaced it. `primeSynthesis()` only latches when WebKit visibly queued the
empty utterance (`speaking || pending`) and is never attempted from a touch pointer-down; when it
opens, `refreshVoice()` recomputes `canSpeak`. The browser path winds itself down after a generous
allowance because Chromium's network voices can stop mid-line without an event.

**Speech look and voice policy (2026-09-07, from the iPad).** Real word timing produced a mouth
shape every ~50 ms, and cutting between seven drawings that fast read as her whole face shaking.
`SpriteAvatar.setViseme` now holds a drawing for `MOUTH_HOLD_SECONDS` (100 ms; closing a little
sooner), the measured envelope is smoothed (fast attack, slow release) in `ClonedSpeaker`, and the
audio-locked track gates the open shapes by that envelope so pauses close the mouth. The browser
voice is never a stand-in once her own voice exists (`willSpeak` returns none instead of browser);
a failed line is retried once after 700 ms, then left on the page in silence. A failed voice probe is
no longer remembered for the session (`ClonedSpeaker.prepare`), and the first real gesture re-runs
`refreshVoice()` in case the server was still waking at boot.

**iOS Silent mode (2026-09-07, from the iPad again: mouth moving, nothing heard).** On iPhone and
iPad, Web Audio is an "ambient" sound that Silent mode mutes, while the speech synthesiser is not -
so her voice was playing (the mouth followed its loudness) and could not be heard, and the robotic
voice could. `primeSound()` now also starts a looping, silent `<audio>` element from the first gesture
(`holdMediaSession` in `src/lib/sound.ts`), which moves the page into the playback audio category so
the context is heard regardless; it is nudged again when the page returns to the foreground. The
mouth chart is down to five drawings (IH→EE, OU→OH, L/S→EE) held 130 ms each. The You page has
"Hear my voice" with a status line (`session.voiceStatus`) that says playing / played / why not, with
the audio context state - the first thing to ask a user for when a phone is silent. Not verifiable from a desktop -
check on the iPad after every change to the audio path.

**Vercel (added 2026-09-07).** The same app deploys to Vercel: `vercel.json` (build, `dist`, the
security headers, `/api/*` → one function, everything else → `index.html`) and `server/vercel.ts`,
the Node-style entry that awaits `ready()` and answers health honestly without a database.
Vercel compiles a TypeScript function with tsc file by file and leaves `import './app.ts'` in the
output where only `app.js` exists, so the function died on its first request; `scripts/build-api.mjs`
therefore bundles the entry with esbuild into `api/index.js` (run from `prebuild`, git-ignored) and
Vercel deploys that plain file. `.vercelignore` keeps the upload source-only; the migrations reach the
function through `includeFiles`. With the CLI logged out, `npx vercel deploy --temporary --yes` still
works: it makes an anonymous deployment that lives about an hour unless claimed from the printed
claim link, and `-e`/`-b` flags carry the runtime and build variables (see the deploy script in the
session scratchpad, which reads them from files). After `vercel login`, `vercel deploy --prod` and
`vercel env add` replace all of that. The prebuild fetches the unchanged art from whichever site
`ELOHIM_ASSET_ORIGIN` names (default: the Netlify site).

**Every environment change needs a redeploy** before the function sees it. `dist/`
was rebuilt with the voice files on 2026-09-05 and is ready to upload.

**Deploying through the Netlify MCP proxy: keep the zip small.** The proxy behind the
`deploy-site` command cuts any upload off after about 35 seconds with a bare
`500 Internal Server Error`, and on a slow connection (50–110 KB/s on 2026-09-05) that is
about 3 MB. The `deploy-site` operation uploads nothing itself: it returns an
`npx -y @netlify/mcp@latest --site-id … --proxy-path "<one-time URL>"` command, and that
command zips **its current working directory** and posts it through the proxy — so run it
from a source-only copy (in the session scratchpad, never from this folder). The copy that
works: `index.html`, `netlify.toml`, `package.json`, `package-lock.json`, the svelte/ts/vite
configs, `src/`, `server/`, `shared/`, `scripts/`, `netlify/`, and only `public/favicon.svg`
and `public/robots.txt`. Leave out `data/` (local database files) and every large `public/`
folder — `mediapipe`, `models`, `character`, `demos`, `backdrops`, `art`, `voice` — because
`prebuild` regenerates all of them: `sync-mediapipe.mjs` rebuilds the wasm from `node_modules`
and downloads the models, `fetch-static.mjs` fetches the 30 files listed in
`scripts/static-assets.json` from the last deploy and checks their hashes, and the voice lines
synthesise from the env key. That copy is about 0.6 MB zipped and built in 69 s on 2026-09-06.
Add `--no-wait` to get the deploy id back at once (Node then dies with a libuv assertion on
exit — harmless, the upload is already done), then poll `<proxy URL>/api/v1/deploys/<id>` or
the connector's `get-deploy-for-site`. If it still fails, the fallback is the Netlify
CLI on a logged-in machine (`npx netlify-cli login`, then `npx netlify-cli deploy --prod --build`
from the project folder), which uploads file by file with no time cap. A personal access token works the
same way without a login: `NETLIFY_AUTH_TOKEN=<token> npx netlify-cli deploy --prod --build --site
a00b1489-137e-404c-809c-08babb811fc4` (used 2026-09-07 from `.secrets/netlify.token`; the user revokes
tokens after use, so expect to ask for a fresh one).

## The shelf

She recommends an ingredient first, then a product that carries it. Products
come from `catalogue_products`, filled one of two ways.

**From the storefront.** With `ELOHIM_STORE_URL` and `ELOHIM_ADMIN_TOKEN` set:

```bash
curl -X POST https://elohim-consultant.netlify.app/api/admin/catalogue/sync -H "X-Admin-Token: $ELOHIM_ADMIN_TOKEN"
```

Shopify shops are read from `/products.json`, WooCommerce shops from the
Store API. Prices, stock, pictures and links follow the shop on every sync;
products the shop no longer lists are removed. Ingredient lists are pulled
from descriptions that carry an "Ingredients:" panel — put one in each
product's description and the matching gets much sharper. Run the sync again
whenever the shop changes (a daily schedule is a one-line addition).

**From a file.** For any other shop, or a hand-kept list:

```bash
curl -X POST https://elohim-consultant.netlify.app/api/admin/catalogue/import -H "X-Admin-Token: $ELOHIM_ADMIN_TOKEN" -H "Content-Type: application/json" --data-binary @catalogue.json
```

with `catalogue.json` shaped as `{ "products": [ { "id", "name", "brand", "category", "price", "currency", "url", "image", "ingredients", "inStock" } ] }` — `price` in major units, `ingredients` either an array or a comma-separated string. `.sc/sample-catalogue.json` in the repo is a worked example.

Check what is on the shelf at any time: `GET /api/public/catalogue/status`.

## What she says about prices

The price line on every pick is written from what was actually fetched:

- one price (the shelf) → "$32.00 on the Ese shelf. I have not compared other shops."
- two or more priced sources (the shelf plus marketplace offers) → "Best price of the 3 I checked: …" or, honestly, "Cheapest of the 3 I checked is eBay at …; the Ese shelf has it at …"

She never claims a comparison that was not made. Search links (Amazon, Google
Shopping) are offered as places to look, never counted as prices.

## Her voice

Every line is synthesised on demand in the cloned voice and cached in the
database with its word timings, so a line is paid for once. The scan
choreography, the greeting and the region narration are therefore fixed
strings on purpose — after the first play they are free and instant. There is
no need to pre-record clips.

Guests hear her too (`ELOHIM_GUEST_VOICE`), rate-limited per address; accounts
need the cloud-reasoning consent on, because the line she speaks carries their
readings and goes to the voice provider.

**Her fixed lines can ship as files.** The introduction, the greetings, what she
says when touched and the all-clear are scripted, so they can be synthesised
once and served from `public/voice/` with no runtime key at all:

```bash
node scripts/voice-lines.mjs              # the lines, with the file name each one expects
node scripts/voice-lines.mjs --manifest   # after dropping the MP3s in, writes public/voice/manifest.json
```

The client plays a shipped file when it has one, asks the server for anything
else, and falls back to the browser voice only when neither can speak. As of
2026-09-05 all thirteen lines ship (`manifest: 13/13`). If a line's text changes
in the source, its hash changes with it — run the first command, synthesise the
new line, drop it in, and run the second.

## Production notes

- `DEMO_MODE` must not be set on the live site. It seeds a demo account with a
  published password; the launcher sets it locally and nowhere else. It was
  removed from Netlify on 2026-09-05.
- `netlify.toml` sends a strict Content-Security-Policy: scripts only from
  this origin (plus WebAssembly for the vision model), fonts from Google
  Fonts, product images from any https host, connections only to this origin.
  If a future feature loads a third-party script or API, it has to be added
  there deliberately.
- The introduction (`src/components/Intro.svelte`) plays once per device and
  can be replayed from the You page. Its copy lives in `src/lib/intro.ts`.

## Checking the live site

- `GET /api/health` — model, voice, storage, database, today's spend.
- `GET /api/public/catalogue/status` — the shelf.
- The entry screen says plainly when there is no database, no model or no voice.
