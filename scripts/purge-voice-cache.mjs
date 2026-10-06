#!/usr/bin/env node
/**
 * P1-T11 — purge legacy non-stock rows from the voice cache.
 *
 * Migration-or-script decision (REMEDIATION_PLAN P1-T11 allows either): this
 * is a SCRIPT, not a migration, because the new bounded cache needs no schema
 * change. Stock entries are ownerless by design (server-defined fixed copy),
 * so no owner column is required; the TTL is enforced against the existing
 * `created_at` text column and the row cap by oldest-first eviction, both in
 * `server/voice/tts.ts`. What remains is a data-only purge of rows the fixed
 * code can never have written — personalised replies, quoted readings and
 * guest input cached globally by the pre-P1-T11 code — plus an operational
 * checkpoint. A script gives both: it deletes only on explicit `--apply`,
 * reports what it did, and never runs implicitly as part of a deploy (a
 * destructive auto-migration would make every production deploy a deletion
 * event with no operator in the loop).
 *
 * What it does: deletes every `voice_lines` row whose `text` is not exactly
 * one of the allowlisted stock sentences (`stockSentences()` from
 * `server/voice/tts.ts`, derived from `server/voice/stock-lines.ts`). Exact
 * match, fail-closed: near-matches, case or whitespace variants are deleted,
 * never inferred as owned. Re-runnable and idempotent — a second run deletes
 * zero rows. The report carries counts only, never sentence text or audio.
 *
 * Usage:
 *   node scripts/purge-voice-cache.mjs            # dry run (default): report only
 *   node scripts/purge-voice-cache.mjs --dry-run  # same, explicit
 *   node scripts/purge-voice-cache.mjs --apply    # delete non-allowlisted rows
 *
 * Connection: NETLIFY_DATABASE_URL (or DATABASE_URL), same convention as the
 * server. Exit codes: 0 done (report on stdout as JSON), 1 failure, 2 no
 * database configured.
 */
import pg from "pg";
import { stockSentences } from "../server/voice/tts.ts";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");

const connectionString =
  process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!connectionString) {
  console.error(
    "[purge-voice-cache] No database configured. Set NETLIFY_DATABASE_URL (or DATABASE_URL).",
  );
  process.exit(2);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const tables = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name = 'voice_lines'",
  );
  if (tables.rowCount === 0) {
    console.log(
      JSON.stringify({
        dryRun: !apply,
        preserved: 0,
        condemned: 0,
        deleted: 0,
        note: "no voice_lines table; nothing to purge",
      }),
    );
    process.exit(0);
  }

  const allowlist = stockSentences();
  const preserved = await client.query(
    "SELECT COUNT(*)::int AS n FROM voice_lines WHERE text = ANY($1)",
    [allowlist],
  );
  const condemned = await client.query(
    "SELECT COUNT(*)::int AS n FROM voice_lines WHERE NOT (text = ANY($1))",
    [allowlist],
  );

  let deleted = 0;
  if (apply) {
    const result = await client.query(
      "DELETE FROM voice_lines WHERE NOT (text = ANY($1))",
      [allowlist],
    );
    deleted = result.rowCount ?? 0;
  }

  // Counts only: sentence text and audio must never appear in operator output.
  console.log(
    JSON.stringify({
      dryRun: !apply,
      preserved: preserved.rows[0].n,
      condemned: condemned.rows[0].n,
      deleted,
    }),
  );
} catch (err) {
  console.error(`[purge-voice-cache] failed: ${err?.message ?? err}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
