/**
 * Her fixed lines, synthesised once.
 *
 * Reads the line list from `src/lib/lines.ts`, asks ElevenLabs for each line
 * that has no file yet, and writes `public/voice/<key>.mp3` with a
 * `<key>.json` sidecar of measured word timings. Then rewrites the manifest.
 * Run it whenever a scripted line changes; lines already on disk are
 * skipped, so a rerun costs nothing.
 *
 * Uses the with-timestamps endpoint - the same one server/voice/tts.ts calls
 * - so shipped lines carry the same measured word starts and ends as lines
 * synthesised live, and the client lip-syncs both from measurement.
 *
 * Usage:
 *   ELOHIM_VOICE_API_KEY=… node scripts/voice-lines-synth.mjs --voice <voice_id> [--force]
 *
 * The key is read from the environment only — it never appears on a command
 * line or in this file. `--force` regenerates every line.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineKey } from './voice-lines.mjs';
import { INTRO_LINES, allShippedLines } from '../src/lib/lines.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public', 'voice');

const argv = process.argv.slice(2);
const voiceArg = argv.indexOf('--voice');
const voiceId = voiceArg >= 0 ? argv[voiceArg + 1] : process.env.ELOHIM_VOICE_ID;
const force = argv.includes('--force');
const apiKey = process.env.ELOHIM_VOICE_API_KEY;
// The offline batch stays on the multilingual family (or v3, via the env
// override) while the live server defaults to turbo: these lines are made
// once and shipped, so render quality wins and latency is free.
const model = process.env.ELOHIM_VOICE_MODEL || 'eleven_multilingual_v2';

/**
 * Fixed seed, so a rerun of one changed line comes back in the same take as
 * the neighbours it will play between, instead of a new performance.
 */
const SEED = 4144;

if (!apiKey) {
  console.error('ELOHIM_VOICE_API_KEY is not set in the environment.');
  process.exit(2);
}
if (!voiceId) {
  console.error('Pass --voice <voice_id> or set ELOHIM_VOICE_ID.');
  process.exit(2);
}

/**
 * Word timings from a character alignment. Mirrors `wordsFromAlignment` in
 * server/voice/tts.ts, normalisation fallback included, so shipped timings
 * and live timings are reduced identically.
 */
function wordsFromAlignment(text, alignment) {
  const words = [];
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i])) {
      i++;
      continue;
    }
    const from = i;
    while (i < chars.length && !/\s/.test(chars[i])) i++;
    words.push({
      word: chars.slice(from, i).join(''),
      charIndex: from,
      charLength: i - from,
      start: starts[from] ?? 0,
      end: ends[i - 1] ?? starts[from] ?? 0,
    });
  }
  if (words.length && chars.join('') !== text) {
    const own = [...text.matchAll(/\S+/g)];
    if (own.length === words.length) {
      own.forEach((m, k) => {
        words[k].charIndex = m.index ?? 0;
        words[k].charLength = m[0].length;
        words[k].word = m[0];
      });
    }
  }
  return words;
}

const lines = allShippedLines();
/** Beat position of each intro line, for the previous_text chain below. */
const introIndex = new Map(INTRO_LINES.map((text, i) => [text, i]));

fs.mkdirSync(outDir, { recursive: true });

let made = 0;
let kept = 0;
let chars = 0;
for (const text of lines) {
  const key = lineKey(text);
  const target = path.join(outDir, `${key}.mp3`);
  if (!force && fs.existsSync(target) && fs.statSync(target).size > 0) {
    kept++;
    continue;
  }

  // The intro is one speech delivered in five beats. Chaining each request
  // to everything said before it makes the sequence read as one take -
  // intonation carries across the cuts - instead of five cold starts.
  const beat = introIndex.get(text);
  const previous = beat !== undefined && beat > 0 ? INTRO_LINES.slice(0, beat).join(' ') : undefined;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: model,
        seed: SEED,
        ...(previous ? { previous_text: previous } : {}),
        // Looser than the launch settings on purpose: these are her scripted
        // moments, and a consultant who greets every visitor in the same
        // flat take reads as a recording. Still anchored - the style stays
        // well short of theatrical.
        voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.4, use_speaker_boost: true },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`FAILED ${key}: ${res.status} ${detail.slice(0, 200)}`);
    process.exitCode = 1;
    continue;
  }
  const payload = await res.json();
  const buf = Buffer.from(payload.audio_base64, 'base64');
  const alignment = payload.alignment ?? payload.normalized_alignment ?? null;
  const words = alignment ? wordsFromAlignment(text, alignment) : [];
  // The alignment's last end time is the duration; ~128 kbps as a rough
  // floor when the provider returned audio and nothing else.
  const duration = words.length ? words[words.length - 1].end : buf.length / 16_000;

  fs.writeFileSync(target, buf);
  fs.writeFileSync(path.join(outDir, `${key}.json`), JSON.stringify({ text, words, duration }, null, 1));
  made++;
  chars += text.length;
  console.log(
    `${key}.mp3  ${(buf.length / 1024).toFixed(0)} KB  ${duration.toFixed(1)}s  "${text.slice(0, 48)}${text.length > 48 ? '…' : ''}"`,
  );
}

console.log(`made ${made}, kept ${kept}, ${chars} characters billed`);
try {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'voice-lines.mjs'), '--manifest'], { stdio: 'inherit' });
} catch {
  // The manifest step already printed which lines are missing.
  process.exit(1);
}
