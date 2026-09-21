/**
 * Every scripted line she speaks, in one place.
 *
 * The same texts used to live in four files - the intro beats, the poke
 * pools, the scan all-clear, the voice preview - plus a fifth copy in
 * scripts/voice-lines.mjs for the offline synthesiser. Shipped audio is keyed
 * by a hash of the exact text, so a one-word edit in any one copy silently
 * orphaned that line's MP3 and dropped her back to the estimated mouth. One
 * list makes that class of bug impossible.
 *
 * The feature modules now import from here: intro.ts takes the narrations,
 * state/controller.ts the poke pools and the error lines, scan/choreography.ts
 * the all-clear, voice/controller.ts the preview. An edit here is an edit
 * everywhere, and the synthesiser sees it on the next run.
 *
 * No imports on purpose: scripts/voice-lines.mjs runs this file under Node
 * directly, so it must not pull in path aliases or anything from the app.
 */

/** The intro narrations, in beat order. Consumed by `INTRO_BEATS` in intro.ts. */
export const INTRO_LINES: readonly string[] = [
  "Hi — I'm Ese.",
  "Let me take a proper look at your skin. I'll read nine things, just using your camera.",
  "Everything's measured right here, on your device — nothing leaves it unless you say so.",
  "I'll remember what I see, and next time I'll show you what changed.",
  "Whenever you're ready.",
];

/** What she says when touched, by where. Drawn at random by state/controller.ts. */
export const POKE_LINES: Record<'face' | 'body', readonly string[]> = {
  face: [
    "Careful — that's what I read with.",
    'Hi. Yes, this is my face.',
    'I saw that.',
    "Steady. I'm mid-thought.",
    'You have my attention.',
    "That's one way to say hello.",
    'Go on — ask me properly.',
  ],
  body: [
    "I'm right here. What do you need?",
    'Mind the coat.',
    "Gently — I'm working.",
    'This coat is dry-clean only.',
    'I felt that.',
    'Careful. I crease.',
    'If you wanted my attention, you have it.',
  ],
};

/** The scan verdict when nothing needs saying. Spoken by scan/choreography.ts. */
export const SCAN_ALL_CLEAR =
  "Good news — nothing's flagged. Everything's reading comfortably in range.";

/** What she says when a reply cannot reach her. Spoken by state/controller.ts. */
export const CONNECTION_LOST_LINE = 'I lost my connection for a moment. Say that again?';

/** Said once when a reply is taking unusually long. Spoken by state/controller.ts. */
export const LONG_THINK_LINE = 'Bear with me — thinking about this one.';

/** The sample line for the voice picker. Used by voice/controller.ts. */
export const VOICE_PREVIEW_LINE = "Hey, it's Ese. This is what I sound like.";

/**
 * Everything above, flat, in the order the voice tooling has always used -
 * these are the lines synthesised once and shipped as files in public/voice/.
 */
export function allShippedLines(): string[] {
  return [
    ...new Set([
      ...INTRO_LINES,
      ...POKE_LINES.face,
      ...POKE_LINES.body,
      SCAN_ALL_CLEAR,
      CONNECTION_LOST_LINE,
      LONG_THINK_LINE,
      VOICE_PREVIEW_LINE,
    ]),
  ];
}
