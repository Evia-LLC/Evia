# Backend environment inventory — hosted sample demo

Audited 2026-09-24 against application code, scripts, `.env.example`, Netlify/Vercel configuration, including dynamically named budget variables. This describes configuration, not verified cloud credentials or live integrations. No private `.env` values were read for this audit.

## Configure on Vercel

Use Project Settings → Environment Variables → **Production** for the current deployment from `main`, then redeploy. The local `.env` does not transfer through GitHub. Do not import `.env.example` unchanged: it is a laptop template with `DEMO_MODE=1` and debug logging.

| Variable | Requirement / default / behavior |
| --- | --- |
| `DATABASE_URL` | **Required for hosted backend functionality.** Dedicated sample-only Postgres connection string. Use Neon's direct/unpooled endpoint with SSL; startup migrations use session-level advisory locks. Tables are created automatically. Without a reachable DB, the Vercel API returns 503 except `/api/health`, which reports `ok:false`. |
| `NETLIFY_DATABASE_URL` | Alternate connection string, taking precedence over `DATABASE_URL` even if empty. Leave absent on Vercel unless deliberately used. |
| `ELOHIM_DB_POOL` | Optional; default `3` connections per function instance. Positive integer. Local disposable DB uses `1`. |
| `PERFECTCORP_API_KEY` | Required only for live Perfect Corp analysis; server-only trial/commercial key. Missing/failed provider falls back visibly to local analysis. Guest scans remain local. |
| `ANALYSIS_PROVIDER` | `perfectcorp` (default) or `local`. Use `local` to avoid trial calls during UI walkthroughs. |
| `ANTHROPIC_API_KEY` | Required only for live Claude conversation and cloud AI features. Missing key uses labelled Demo Elohim. Key presence is not proof of model access; consent and budget gates still apply. |
| `ELOHIM_MODEL` | Optional conversation model override. Current code default: `claude-sonnet-5`. This audit has not verified that model's availability to your Anthropic account or exercised a live request. |
| `ELOHIM_MODEL_CLASSIFIER` | Default off; only `1` enables optional model-based intent classification. Leave `0` for initial demo. |
| `ELOHIM_CLASSIFIER_MODEL` | Default `claude-haiku-4-5`; used when model classification is enabled. |
| `ELOHIM_USER_DAILY_TURNS` | Default `80` cloud turns per user/day. |
| `ELOHIM_DAILY_TURNS` | Default `2000` cloud turns across users/day. |
| `ELOHIM_DAILY_TOKENS` | Default `4000000` tokens/day. These are application usage gates, not a provider-enforced dollar ceiling and not Perfect Corp/voice budgets. |
| `ELOHIM_VOICE_API_KEY` | ElevenLabs key; requires `ELOHIM_VOICE_ID` as well. Without both, on-demand provider voice is unavailable; browser voice fallback remains. |
| `ELOHIM_VOICE_ID` | ID of a voice accessible to your ElevenLabs account. |
| `ELOHIM_VOICE_MODEL` | Optional. Runtime default `eleven_turbo_v2_5`; offline voice generation script defaults to `eleven_multilingual_v2`. |
| `ELOHIM_VOICE_ENDPOINT` | Optional; default `https://api.elevenlabs.io/v1/text-to-speech`. Leave unset for ElevenLabs. |
| `ELOHIM_GUEST_VOICE` | Set `0` to disable paid guest voice. Otherwise allowed when both voice credentials exist. |
| `ELOHIM_BLOB_KEY` | Optional 64-character hexadecimal encryption key (32 random bytes) for stored image blobs. Not needed for auth, text chat, scan metrics/history, or transient Perfect Corp uploads. A key alone does not bypass the current progress-photo consent gate. Keep stable for existing encrypted images. |
| `ELOHIM_ADMIN_TOKEN` | Optional secret protecting catalogue import/sync. Required if preparing a product shelf through admin endpoints. |
| `ELOHIM_STORE_URL` | Optional Shopify/WooCommerce storefront URL for catalogue sync. Not required for manual JSON catalogue import. Setting it does not itself populate the shelf. |
| `ELOHIM_STORE_NAME` | Display name; default `Ese`. Set your demo shop name if needed. |
| `ELOHIM_STORE_KIND` | Optional `shopify` or `woocommerce`; otherwise autodetected during sync. |
| `ELOHIM_STORE_CURRENCY` | Default `USD` when an imported product has no explicit currency. |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | Optional pair for live eBay price comparison. Not required for the demo. |
| `EBAY_MARKETPLACE` | Default `EBAY_US`. |
| `ELOHIM_AMAZON_DOMAIN` | Default `www.amazon.com`; used for search links. |
| `ELOHIM_AMAZON_TAG` | Optional affiliate tag for those links, not an Amazon price API key. |
| `ELOHIM_LOG_LEVEL` | Default `info`; accepted `error`, `warn`, `info`, `debug`. Use `info` for hosted demo. |

## Already supplied by the tracked Vercel sample profile

Do not duplicate or override these in the dashboard:

| Variable | Value | Scope |
| --- | --- | --- |
| `EVIA_SAMPLE_DEMO` | `1` | Build and runtime; sample registration and review events. |
| `DEMO_MODE` | `0` | Build and runtime; prevents seeding the publicly known demo login. |
| `LEGAL_RELEASE` | `sample_demo` | Build; explicit temporary sample release, not legal approval. |
| `VITE_SAMPLE_DEMO` | `1` | Build; visible sample-only notice. |

No Stripe key, certified-age-provider key, Supabase key, JWT secret or separate session secret is required by the current implementation. Sessions are random tokens backed by Postgres. PaymentService remains disabled even if Stripe variables are present. Missing features cannot be activated just by inventing env variables.

## Development, build and platform variables

These are not credentials to collect for the hosted backend:

- `ELOHIM_PORT=5196`, `ELOHIM_WEB_PORT=5195`: local API/Vite ports.
- `ELOHIM_DEV_DB_PORT=5433`, `ELOHIM_TEST_DB_PORT=5434`: local/disposable database ports.
- `ELOHIM_SHOT_PORT=5199`: screenshot script port.
- `ELOHIM_ASSET_ORIGIN`: optional static-asset download origin, default `https://elohim-consultant.netlify.app`; used during prebuild for missing manifest assets.
- `VITE_DEPLOY_ENV=review`: optional legal placeholder presentation setting. Not needed by the current hosted sample profile.
- `LEGAL_PRODUCTION=true`: additional strict-production detection for ordinary legal releases; not needed for this demo.
- `VERCEL`, `VERCEL_ENV`, `NETLIFY`, `CONTEXT`, `LAMBDA_TASK_ROOT`, `AWS_LAMBDA_FUNCTION_NAME`, `NODE_ENV`: host/runtime-provided signals. Do not spoof them to change the deployment type. `NODE_ENV=production` also enables secure auth cookies.
- `NODE_VERSION=24`: Netlify build setting. Vercel Node version is configured in project settings.
- Vite's built-in `DEV` and `MODE` are referenced by UI code; they are not backend secrets.

The Anthropic SDK may recognize additional SDK-specific environment variables; those are not project-required configuration and were not inventoried as custom EVIA settings.

## Verification after redeployment

1. `/api/health`: expect `ok:true`, `demoMode:false`. `modelAvailable`, `clonedVoice` and `imageStorage` indicate configuration presence, not successful provider requests or permission to save a photo.
2. `/api/public/analysis`: expect `sampleDemo:true`; provider and key availability should match your configuration. Again, availability is not a live provider test.
3. Register a sample adult account, sign out/in, save and reload a scan. This tests auth and persistent database writes.
4. Test one live provider operation at a time if enabled. Guest chat/scans use local paths; use an authenticated sample account for live Claude/Perfect Corp.
5. Import/sync a sample catalogue separately if demonstrating recommendations. No env variable creates demo products or historical scans automatically while `DEMO_MODE=0`.

Sources: `server/db/index.ts`, `server/routes/auth.ts`, `server/ai/{claude,classify,budget,perfectcorp}.ts`, `server/voice/tts.ts`, `server/lib/{crypto,env,log}.ts`, `server/catalogue/{store,offers}.ts`, `server/routes/admin.ts`, `server/vercel.ts`, `server/app.ts`, `scripts/`, `vite.config.ts`, `src/App.svelte`, `vercel.json`, `netlify.toml`, `.env.example`.
