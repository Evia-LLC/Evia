/**
 * Environment loading. Imported first by server/index.ts, before anything that
 * reads process.env — ES module imports are hoisted and evaluated in order, so
 * this has to be its own module rather than a few statements at the top of the
 * entry point.
 *
 * Node 24 loads .env natively, so there is no dotenv dependency.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEnvGuard } from './env-guard.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = path.join(root, '.env');

if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/*
 * Cross-environment startup guard: refuse to boot when APP_ENV names a lane
 * whose Supabase project ref does not match SUPABASE_URL (staging wired to
 * production credentials or vice versa). APP_ENV unset (local/dev/CI/test) =
 * inactive, zero behavior change.
 *
 * This module is the earliest single point every boot path evaluates:
 * server/index.ts and server/app.ts both import it first, and both function
 * adapters (netlify/functions/api.mts, server/vercel.ts) reach it through
 * server/app.ts — so this one call covers the server and both functions
 * BEFORE migrations/sessions, and ready() carries no second wiring. ready()
 * was deliberately not chosen: both adapters catch ready() failures into a
 * generic 503 "no database" response, which would mute a cross-env refusal;
 * an import-time throw here fails the boot loudly on every path instead.
 */
assertEnvGuard();

/*
 * Demo mode gives a fresh local checkout a working account and a real scan
 * history on first run.
 *
 * Two independent conditions have to hold before it switches itself on, and
 * either alone is not enough:
 *
 *  - no deployment marker. Netlify sets NODE_ENV=production during the *build*
 *    but not in the Functions *runtime*, and `NETLIFY` turned out not to be set
 *    there either - on 2026-09-05 the deployed function believed it was a local
 *    checkout and seeded the demo account, with its published password, into
 *    the production database. The Lambda runtime's own variables are the
 *    reliable marker.
 *  - a database on this machine. The only database a demo account should ever
 *    be written into is the local one; a connection string pointing anywhere
 *    else is production by definition, whatever the markers say.
 *
 * `DEMO_MODE=1` or `DEMO_MODE=0` in the environment still wins outright.
 */
const DEPLOYED = Boolean(
  process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.LAMBDA_TASK_ROOT ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NODE_ENV === 'production',
);
const DATABASE = process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const LOCAL_DATABASE = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DATABASE);
if (process.env.DEMO_MODE === undefined && !DEPLOYED && LOCAL_DATABASE) {
  process.env.DEMO_MODE = '1';
}

export const ENV_FILE_LOADED = fs.existsSync(envFile);
