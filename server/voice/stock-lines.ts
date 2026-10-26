/**
 * P1-T11 — the server-defined non-personal stock lines.
 *
 * The ONLY sentences the voice cache may persist. Everything she says that is
 * not one of these is synthesised fresh on every request and never written to
 * `voice_lines` — see `server/voice/tts.ts`.
 *
 * Why this file (and why these strings): the cacheable set must be reviewable
 * in one place by someone who never runs the app, so the allowlist is written
 * out as exact string literals rather than imported from client copy. The
 * strings mirror `src/lib/lines.ts` (`allShippedLines()`): fixed UI copy —
 * greetings, poke replies, the scan all-clear, connection lines and the voice
 * preview — none of which names, quotes or derives from any user. Personalised
 * replies, readings and guest input can never appear here because they are not
 * known at deploy time.
 *
 * Sync rule: if `src/lib/lines.ts` gains, loses or edits a shipped line, this
 * file must be updated in the same change. `test/voice-cache-privacy.test.ts`
 * derives the expected sentence set from `src/lib/lines.ts` and fails on any
 * drift, so a missed sync is a red test, not silent cache behaviour.
 *
 * Admission (implemented in `tts.ts`, documented here so the file reads whole):
 * a sentence is cache-eligible only when it exactly equals one of the cache
 * units below AFTER server-side normalisation — `speakableOf` cleaning
 * (emoji/markdown/bullet strip, whitespace collapse, trim) plus the shared
 * sentence split. The units below are stored pre-split into those cache units
 * at module load; a near-match, a case variant or extra whitespace misses and
 * therefore synthesises fresh without writing. No client-supplied flag
 * (`stock`, `cached`, or anything else) participates in admission: the routes
 * forward only text and prosody neighbours, and unknown fields never reach the
 * cache check.
 *
 * Bounds: entries live at most STOCK_CACHE_TTL_DAYS (rolling, checked on read
 * against `created_at`) and the table holds at most STOCK_CACHE_MAX_ROWS rows
 * (oldest-first eviction on write). Both are enforced in `tts.ts`, not by the
 * database, so no schema change was needed for the bounded cache.
 *
 * Plain-Node safe: only erasable TypeScript (const assertions and type
 * annotations), because `scripts/purge-voice-cache.mjs` imports the sentence
 * list directly under Node's type stripping.
 */
export const STOCK_LINES: readonly string[] = [
  // Intro narrations (src/lib/lines.ts INTRO_LINES, in beat order).
  "Hi — I'm Elohim.",
  "Let me take a proper look at your skin. I'll read nine things, just using your camera.",
  "Everything's measured right here, on your device — nothing leaves it unless you say so.",
  "I'll remember what I see, and next time I'll show you what changed.",
  "Whenever you're ready.",
  // Poke replies, face (src/lib/lines.ts POKE_LINES.face).
  "Careful — that's what I read with.",
  "Hi. Yes, this is my face.",
  "I saw that.",
  "Steady. I'm mid-thought.",
  "You have my attention.",
  "That's one way to say hello.",
  "Go on — ask me properly.",
  // Poke replies, body (src/lib/lines.ts POKE_LINES.body).
  "I'm right here. What do you need?",
  "Mind the coat.",
  "Gently — I'm working.",
  "This coat is dry-clean only.",
  "I felt that.",
  "Careful. I crease.",
  "If you wanted my attention, you have it.",
  // Scan all-clear (SCAN_ALL_CLEAR).
  "Good news — nothing's flagged. Everything's reading comfortably in range.",
  // Connection lines (CONNECTION_LOST_LINE, LONG_THINK_LINE).
  "I lost my connection for a moment. Say that again?",
  "Bear with me — thinking about this one.",
  // Voice picker preview (VOICE_PREVIEW_LINE).
  "Hey, it's Elohim. This is what I sound like.",
];

/** Rolling lifetime of a cached stock line, in days. Enforced on read. */
export const STOCK_CACHE_TTL_DAYS = 30;

/** Upper bound on cached rows. Oldest-first eviction runs on every cache write. */
export const STOCK_CACHE_MAX_ROWS = 200;
