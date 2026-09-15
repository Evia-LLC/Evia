/**
 * Her fixed lines, listed.
 *
 * Everything she says that is scripted rather than composed - the introduction,
 * the greetings, what she says when touched, the all-clear after a scan - can
 * be synthesised once in her licensed voice and shipped as files, so those
 * lines play on the live site with no runtime key at all. This prints the
 * list as JSON so a generator (ElevenLabs, by hand or through a connector)
 * can produce one MP3 per line into `public/voice/`, and it writes the
 * manifest the client reads.
 *
 * The lines themselves live in `src/lib/lines.ts` - the same module the app
 * reads - so this script can no longer drift from what she actually says.
 * Node runs the TypeScript directly, the same way `scripts/dev.mjs` runs
 * `server/index.ts`.
 *
 * Usage:
 *   node scripts/voice-lines.mjs            # prints the lines as JSON
 *   node scripts/voice-lines.mjs --manifest # scans public/voice/ and writes manifest.json
 *
 * `--manifest` exits nonzero when any line has no audio: a missing file
 * means a scripted moment silently loses her voice on deploy, and that is a
 * build failure, not a statistic.
 *
 * File naming: `<sha256 of the exact text, first 16 hex chars>.mp3`. A
 * `<key>.json` sidecar written by voice-lines-synth.mjs carries the measured
 * word timings; when present, they go into the manifest entry so the client
 * can lip-sync shipped lines from measurement instead of estimate.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allShippedLines } from '../src/lib/lines.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const LINES = allShippedLines();

export function lineKey(text) {
  return createHash('sha256').update(text.trim()).digest('hex').slice(0, 16);
}

const dir = path.join(root, 'public', 'voice');

// Guarded so voice-lines-synth.mjs can import `lineKey` without running the
// CLI. Compared by basename: robust to how the path was spelled on Windows.
const invokedAsMain =
  process.argv[1] && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url));

if (invokedAsMain && process.argv.includes('--manifest')) {
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {};
  const missing = [];
  for (const text of LINES) {
    const key = lineKey(text);
    const mp3 = path.join(dir, `${key}.mp3`);
    if (!fs.existsSync(mp3) || fs.statSync(mp3).size === 0) {
      missing.push({ key, text });
      continue;
    }
    const entry = { file: `${key}.mp3`, text };
    // Timings measured at synthesis time, when the sidecar exists. Audio
    // made before sidecars still ships; the client falls back to estimating.
    try {
      const side = JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8'));
      if (Array.isArray(side.words) && side.words.length) {
        entry.words = side.words;
        entry.duration = side.duration;
      }
    } catch {
      // No sidecar; the entry ships without timings.
    }
    manifest[key] = entry;
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`manifest: ${Object.keys(manifest).length}/${LINES.length} lines have audio`);
  if (missing.length) {
    // The manifest above still ships what exists - a partial voice beats
    // none - but the build must not pass while a scripted line is mute.
    console.error(`MISSING audio for ${missing.length} line(s); run scripts/voice-lines-synth.mjs:`);
    for (const m of missing) console.error(`  ${m.key}.mp3  "${m.text}"`);
    process.exit(1);
  }
} else if (invokedAsMain) {
  console.log(
    JSON.stringify(LINES.map((text) => ({ key: lineKey(text), file: `${lineKey(text)}.mp3`, text })), null, 1),
  );
}
