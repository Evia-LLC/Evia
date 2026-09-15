/**
 * Demo Elohim — the local conversation engine used when no ANTHROPIC_API_KEY is set.
 *
 * This exists so the experience loop is testable without credentials. It is not
 * pretending to be the model: the API marks every turn `demo: true` and the UI
 * badges it. What it does not do is fake *data* — every number it says comes out
 * of the user's real profile, real scans and real trends, so if it tells you your
 * hydration improved, it improved.
 *
 * Setting a key switches the orchestrator to claude-opus-5 with no other change.
 */
import {
  METRIC_HIGHER_IS_BETTER,
  METRIC_LABELS,
  METRIC_NOISE_FLOOR,
  PREGNANCY_RESTRICTED,
  type CharacterDirective,
  type ChatMessage,
  type ElohimAction,
  type ElohimTurn,
  type Emotion,
  type MemoryWrite,
  type SkinMetricKey,
  type TurnClassification,
} from '../../shared/types.ts';
import type { ElohimContext } from './context.ts';
import { BODY_READING_LABELS } from '../../shared/types.ts';
import { LEGAL_DISCLAIMER, URGENT_DISCLAIMER } from './persona.ts';

/**
 * The slice of the transcript this engine reads. Structurally a subset of
 * ChatMessage so both callers can hand their messages over unchanged — the
 * orchestrator its database rows, the browser its session state.
 */
export type TranscriptTurn = Pick<ChatMessage, 'role' | 'content'>;

/**
 * Deltas are spoken as whole points. A tenth of a point is false precision on a
 * measurement whose noise floor is several points wide, and reading it aloud
 * implies an accuracy the pipeline does not have.
 */
function points(delta: number): string {
  const n = Math.round(Math.abs(delta));
  return `${n} point${n === 1 ? '' : 's'}`;
}

/**
 * Deterministic pick so repeated identical input gives repeatable output.
 * Seeds fold in the day stamp, so "repeatable" means within a day: the same
 * message tomorrow lands on a different variant, which is the difference
 * between consistent and canned.
 */
function pick<T>(options: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return options[h % options.length];
}

/** Day-granular stamp for seeds: stable today, different tomorrow. */
function dayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function directive(
  state: CharacterDirective['state'],
  expression: CharacterDirective['expression'],
  gesture: CharacterDirective['gesture'] = 'none',
  intensity = 0.5,
): CharacterDirective {
  return { state, expression, gesture, intensity };
}

/*
 * Whether the display name is a real name. Guests carry the placeholder
 * "there" (set in the client's guest mode so untouched copy still scans), and
 * the session getter falls back to "friend" — interpolating either produces
 * lines like "there! Good to see you." A null here routes every line to its
 * nameless variant.
 */
function knownName(displayName: string): string | null {
  const name = displayName.trim();
  if (!name || name === 'there' || name === 'friend') return null;
  return name;
}

/** "Hello, Maya." when there is a name to use; "Hello." when there is not. */
function greet(name: string | null): string {
  return name ? `Hello, ${name}.` : 'Hello.';
}

/*
 * Ten emotions times a dozen intents is a copy matrix nobody maintains, so
 * emotion collapses to what actually changes her delivery: whether the user
 * arrived low, high, ashamed, or level.
 */
type EmotionFamily = 'down' | 'up' | 'embarrassed' | 'level';

function familyOf(emotion: Emotion): EmotionFamily {
  switch (emotion) {
    case 'worried':
    case 'sad':
    case 'frustrated':
      return 'down';
    case 'excited':
    case 'happy':
    case 'playful':
      return 'up';
    case 'embarrassed':
      return 'embarrassed';
    default:
      return 'level';
  }
}

/** The pool for this family, falling back to the level one. */
function variants(
  family: EmotionFamily,
  pools: Partial<Record<EmotionFamily, string[]>> & { level: string[] },
): string[] {
  const found = pools[family];
  return found && found.length ? found : pools.level;
}

/**
 * Default body language per family. Intents override this when they know
 * better — a scan request is focused regardless of arrival mood.
 */
function familyDirective(family: EmotionFamily, base: CharacterDirective): CharacterDirective {
  switch (family) {
    case 'down':
      return directive('CONCERNED', 'concerned', 'head_tilt', 0.65);
    case 'up':
      return directive('HAPPY', 'smile', 'nod', 0.65);
    case 'embarrassed':
      return directive('LISTENING', 'reassuring', 'lean_in', 0.55);
    default:
      return base;
  }
}

/**
 * The most recent concern the user named in the turns before this one, kept in
 * their own words — so she can say "the chin breakouts", not "that". Pronouns
 * flip so the phrase survives being spoken back ("on my chin" → "on your chin").
 */
const RECALLABLE_CONCERN =
  /\b((?:chin|jaw(?:line)?|forehead|cheek|nose|hairline|t-?zone|under-?eye)[- ](?:breakouts?|acne|spots?|pimples?|redness|dryness|bumps?|flaking|congestion)|(?:breakouts?|acne|spots?|pimples?|redness|dryness|flaking|congestion|dark spots?)\s+(?:on|around|along)\s+(?:my|the)\s+(?:chin|jaw(?:line)?|forehead|cheeks?|nose|hairline|t-?zone|neck|back|chest))\b/i;

function recalledConcern(history: TranscriptTurn[], current: string): string | null {
  const now = current.trim().toLowerCase();
  // Newest first. The current message may already sit at the tail — the client
  // pushes it into the transcript before asking for a reply — so an exact echo
  // of it is skipped rather than "recalled".
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.role !== 'user') continue;
    if (entry.content.trim().toLowerCase() === now) continue;
    const m = RECALLABLE_CONCERN.exec(entry.content);
    if (m) return m[1].toLowerCase().replace(/\s+/g, ' ').replace(/\bmy\b/g, 'your');
  }
  return null;
}

/** Actives and product words worth mirroring back in a routine update. */
const KNOWN_PRODUCT =
  /\b(retinol|retinoids?|retinal(?:dehyde)?|tretinoin|adapalene|tazarotene|niacinamide|vitamin c|salicylic(?: acid)?|glycolic(?: acid)?|lactic(?: acid)?|azelaic(?: acid)?|benzoyl peroxide|hyaluronic(?: acid)?|ceramides?|sunscreen|spf|moisturi[sz]er|cleanser|exfoliant|toner|serum)\b/i;

const RETINOID = /\b(retinol|retinoids?|retinal(?:dehyde)?|tretinoin|adapalene|tazarotene)\b/i;

export function respond(
  message: string,
  classification: TurnClassification,
  ctx: ElohimContext,
  history: TranscriptTurn[] = [],
): ElohimTurn {
  const name = knownName(ctx.user.displayName);
  const family = familyOf(classification.emotion);
  const seed = `${message.toLowerCase().trim()}|${dayStamp()}`;
  const actions: ElohimAction[] = [];
  const concern = recalledConcern(history.slice(-8), message);

  // Safety first — this path must behave identically to the real engine.
  if (classification.escalate) {
    return {
      text: classification.urgent
        ? `Stop for a second — I'm not going to talk about scores here. ${URGENT_DISCLAIMER}`
        : `Okay, I want to be straight with you about this one. What you're describing isn't ` +
          `something I should be reading from a photo. ${LEGAL_DISCLAIMER}`,
      directive: directive('CONCERNED', 'concerned', 'lean_in', 0.8),
      classification,
      memoryWrites: [],
      actions: [],
      demo: true,
    };
  }

  const hasScans = ctx.summary.scanCount > 0;

  // A question about one specific metric — typed, or from tapping its hologram.
  // Handled before intent routing because "tell me about my hydration" is a
  // question, a results request and a concern all at once, and what the user
  // actually wants is that number explained.
  const named = namedMetric(message);
  if (named && hasScans) {
    return turn(
      explainMetric(named, ctx),
      directive('EXPLAINING', 'focused', 'point_to_hologram', 0.6),
      classification,
      actions,
    );
  }

  switch (classification.intent) {
    case 'greeting': {
      const openers = hasScans
        ? variants(family, {
            level: [
              `${greet(name)} Let me look at you — how's the skin been?`,
              `Good to see you. What's going on today?`,
              `${greet(name)} What are we looking at today?`,
            ],
            down: [
              `${greet(name)} You don't sound like it's a good skin day. Tell me.`,
              `${greet(name)} Something's up — I can hear it. What's going on?`,
            ],
            up: [
              `${greet(name)} You sound bright today. What's the occasion?`,
              `${greet(name)} Good energy. How's the skin holding up?`,
            ],
            embarrassed: [
              `${greet(name)} Whatever it is, I've seen it before and thought nothing of it. What's going on?`,
            ],
          })
        : variants(family, {
            level: [
              `${greet(name)} We haven't done a scan yet, so tell me what's been going on — or I can just take a look.`,
              `Good to see you. I haven't seen your skin yet, so start me anywhere — what's been on your mind about it?`,
            ],
            down: [
              `${greet(name)} Something's bothering you about it — tell me what's been going on.`,
            ],
            embarrassed: [
              `${greet(name)} No judgement in this room — that's rather the point of me. What's going on?`,
            ],
          });
      return turn(
        pick(openers, seed),
        familyDirective(family, directive('HAPPY', 'warm', 'small_wave', 0.55)),
        classification,
        actions,
      );
    }

    case 'venting': {
      // Deliberately no scan offer here, and no exclamation marks: she
      // acknowledges before she does anything else. A recalled concern gets
      // named as itself — "the chin breakouts", not "that" — but only when the
      // current message didn't just name it, or "again?" answers a question
      // the user already answered.
      const replies = concern && !RECALLABLE_CONCERN.test(message)
        ? [
            `I hear you. Is it the ${concern} again, or something new?`,
            `Okay. Last time it was the ${concern} — same thing, or something else this time?`,
          ]
        : variants(family, {
            level: [
              `Okay, what happened — breakouts, dryness, irritation, or just one of those skin days?`,
              `I hear you. What's it actually doing — breaking out, feeling tight, going red?`,
              `That sounds like a rough one. Tell me what you're seeing and we'll take it from there.`,
            ],
            embarrassed: [
              `Nothing you tell me is going to faze me. What's it doing?`,
              `You don't have to dress it up for me. What are you seeing?`,
            ],
          });
      return turn(
        pick(replies, seed),
        directive('CONCERNED', 'concerned', 'head_tilt', 0.65),
        classification,
        actions,
      );
    }

    case 'describe_concern': {
      actions.push({ type: 'offer_scan', reason: 'user described a specific concern' });
      const replies = variants(family, {
        level: [
          `Got it. How long has it been like that — days, or building for a few weeks?`,
          `Okay, that's useful. One area or all over? And has anything in your routine changed lately?`,
        ],
        down: [
          `That's a hard one to sit with, I know. How long has it been like this — days, or weeks?`,
          `Okay, I hear you. When did it start, and has anything in your routine changed?`,
        ],
        embarrassed: [
          `Skin does this to everyone — no exceptions I've met. When did it start?`,
          `You don't need to apologise for your own face. How long has it been like this?`,
        ],
        up: [`Got it. Two quick questions: how long, and one area or all over?`],
      });
      return turn(
        pick(replies, seed) + (hasScans ? '' : ` If you want, I can take a proper look.`),
        familyDirective(family, directive('LISTENING', 'curious', 'lean_in', 0.5)),
        classification,
        actions,
      );
    }

    case 'request_scan': {
      actions.push({ type: 'enter_clinical' });
      return turn(
        `Okay. Let me look at you — find some even light and hold still for me.`,
        directive('THINKING', 'focused', 'open_palms', 0.6),
        classification,
        actions,
      );
    }

    case 'request_results':
    case 'request_progress': {
      if (!hasScans) {
        return turn(
          `I haven't actually seen your face yet, so I've got nothing to compare against. Give me a first scan and we'll have a baseline to talk about.`,
          directive('CONFUSED', 'curious', 'head_tilt', 0.5),
          classification,
          [{ type: 'offer_scan', reason: 'no baseline scan exists' }],
        );
      }
      actions.push({ type: 'show_progress' });
      return turn(explainTrends(ctx), directive('EXPLAINING', 'warm', 'point_to_hologram', 0.6), classification, actions);
    }

    case 'ask_product': {
      /*
       * Retinoids and pregnancy get an answer before anything else does. The
       * one thing that must not happen is a retinoid discussed neutrally with
       * someone who is pregnant — and "unknown" means unasked, never "no".
       */
      if (RETINOID.test(message)) {
        if (PREGNANCY_RESTRICTED.includes(ctx.user.profile.pregnancyStatus)) {
          return turn(
            `Straight answer: that one's off the table right now. Retinoids aren't for use in pregnancy or while breastfeeding — no exceptions worth gambling on. There are gentler routes to most of the same goals, so ask me and we'll find one.`,
            directive('CONCERNED', 'reassuring', 'slow_nod', 0.6),
            classification,
            actions,
          );
        }
        if (ctx.user.profile.pregnancyStatus === 'unknown') {
          return turn(
            `One thing before anything else: retinoids aren't for use in pregnancy or while breastfeeding — if that could apply to you, tell me and we'll go another way. Otherwise, tell me the name or read me the label and I'll check it against your profile.`,
            directive('THINKING', 'focused', 'hand_to_chin', 0.55),
            classification,
            actions,
          );
        }
      }
      const concerns = ctx.user.profile.concerns;
      return turn(
        `Tell me the name, or read me the label, and I'll check the ingredients against your profile` +
          (concerns.length ? ` — with ${concerns[0]} in the mix, that's worth doing properly.` : '.') +
          ` If the list doesn't tell me something, I'll say so rather than guess.`,
        directive('THINKING', 'focused', 'hand_to_chin', 0.5),
        classification,
        actions,
      );
    }

    case 'update_routine': {
      // Mirror and record. The mirror is the point: "noted — you're on X now"
      // proves she heard, and the memory write makes it true next week too.
      const stopped = /\b(stopp?ed|quit|dropped|came off|no longer)\b/i.test(message);
      const active = KNOWN_PRODUCT.exec(message)?.[0]?.toLowerCase() ?? null;
      const memoryWrites: MemoryWrite[] = [
        {
          kind: 'routine',
          key: 'latest_routine_change',
          value: message.trim().slice(0, 300),
          confidence: 0.75,
        },
      ];

      // Same pregnancy rule as ask_product: starting a retinoid gets flagged,
      // not neutrally filed.
      if (active && RETINOID.test(active) && !stopped) {
        if (PREGNANCY_RESTRICTED.includes(ctx.user.profile.pregnancyStatus)) {
          return {
            text: `Noted — and I have to flag it: retinoids aren't for use in pregnancy or while breastfeeding, and your profile says that applies to you. Worth stopping and talking to your doctor before anything else.`,
            directive: directive('CONCERNED', 'concerned', 'lean_in', 0.7),
            classification,
            memoryWrites,
            actions,
            demo: true,
          };
        }
        if (ctx.user.profile.pregnancyStatus === 'unknown') {
          return {
            text: `Noted — you're on ${active} now. Give it four to six weeks before we judge it. One check first: retinoids aren't for use in pregnancy or while breastfeeding — if that could apply to you, tell me.`,
            directive: directive('LISTENING', 'warm', 'slow_nod', 0.55),
            classification,
            memoryWrites,
            actions,
            demo: true,
          };
        }
      }

      const text = active
        ? stopped
          ? pick(
              [
                `Noted — off the ${active}. If anything shifts over the next couple of weeks, we'll know what to suspect.`,
                `Okay, ${active} is out. Written down — if your skin changes its mind about anything, that's our first suspect.`,
              ],
              seed,
            )
          : pick(
              [
                `Noted — you're on ${active} now. Give it four to six weeks before we judge it.`,
                `Okay, ${active} — written down. Skin answers in weeks, not days, so we'll judge it in four to six.`,
              ],
              seed,
            )
        : pick(
            [
              `Noted. I've written that down — routine changes explain more than people expect, so I like knowing. Give it a few weeks before we judge anything.`,
              `Okay, that's on the record. We'll give it a few weeks and let your skin vote.`,
            ],
            seed,
          );
      return {
        text,
        directive: directive('LISTENING', 'warm', 'slow_nod', 0.55),
        classification,
        memoryWrites,
        actions,
        demo: true,
      };
    }

    case 'small_talk': {
      const replies = variants(family, {
        level: [
          `I'm here. We can talk skin, or just talk.`,
          `Quiet suits this room. What's on your mind?`,
          `Noted. I'm mostly here for your skin, but I don't mind the company.`,
        ],
        up: [
          `Good energy today. Want me to put it to work, or are we just chatting?`,
          `I'll take it. What's going on?`,
        ],
        down: [`I'm here. No agenda — talk to me.`],
      });
      return turn(
        pick(replies, seed),
        familyDirective(family, directive('LISTENING', 'warm', 'head_tilt', 0.45)),
        classification,
        actions,
      );
    }

    case 'set_preference': {
      const wantsGenz = /gen ?-?z/i.test(message);
      const wantsSimple = /simple|shorter|less technical/i.test(message);
      const style = wantsGenz ? 'genz' : wantsSimple ? 'simple' : 'detailed';
      return {
        // "Bestie" appears exactly once in this file, here — inside the genz
        // costume the user just asked for. Nowhere else.
        text: wantsGenz
          ? `Done. Bestie mode it is.`
          : wantsSimple
            ? `Got it. The short version from here on.`
            : `Okay — the full read from here on. Regions, reasoning, numbers.`,
        directive: directive('HAPPY', wantsGenz ? 'grin' : 'warm', 'nod', 0.6),
        classification,
        memoryWrites: [
          { kind: 'preference', key: 'explanation_style', value: style, confidence: 0.9 },
        ],
        actions,
        demo: true,
      };
    }

    case 'goodbye':
      return turn(
        pick(
          [
            name
              ? `Take care of it, ${name}. Come back and show me.`
              : `Take care of it. Come back and show me.`,
            `Go gently on it. I'll be here when you want another look.`,
          ],
          seed,
        ),
        directive('GOODBYE', 'smile', 'small_wave', 0.55),
        classification,
        actions,
      );

    case 'ask_question':
      return turn(
        answerQuestion(message, ctx, hasScans),
        directive('EXPLAINING', 'curious', 'hand_to_chin', 0.55),
        classification,
        hasScans ? actions : [{ type: 'offer_scan', reason: 'a scan would let the answer use their data' }],
      );

    default:
      if (concern && hasScans && !RECALLABLE_CONCERN.test(message)) {
        return turn(
          `Still with you. Last time it was the ${concern} — want to pick that up, or is this something new?`,
          directive('LISTENING', 'warm', 'head_tilt', 0.5),
          classification,
          actions,
        );
      }
      // Even with no intent to route, the feeling still gets answered: a
      // worried message and a delighted one must not draw the same sentence.
      return turn(
        pick(
          variants(family, {
            level: [
              hasScans
                ? `I'm with you. ${shortState(ctx)} — what do you want to dig into?`
                : `I'm listening. Tell me what's going on with your skin, or I can take a look and we'll work from what I see.`,
            ],
            down: [
              `I hear you. Say a bit more — what's going on, and how long has it been like this?`,
              `Okay. That sounds like it's weighing on you — tell me what's happening and we'll take it apart together.`,
            ],
            up: [
              `Now that's the kind of update I like. Tell me more — what do you think did it?`,
              `Good. Whatever you're doing, it's earning its place. Want me to take a look and put a number on it?`,
            ],
            embarrassed: [
              `No judgement here — skin does this to everyone I've ever looked at. Tell me what's going on.`,
            ],
          }),
          seed,
        ),
        familyDirective(family, directive('LISTENING', 'warm', 'nod', 0.45)),
        classification,
        actions,
      );
  }
}

/**
 * The local engine cannot reason about an arbitrary question, but "ask me a
 * better question" is not an answer. This answers what it can — the stances
 * she holds and the numbers it has — and is honest about the boundary.
 */
function answerQuestion(message: string, ctx: ElohimContext, hasScans: boolean): string {
  if (/\bhow often\b[^.?!]{0,40}\b(scan|check|measure)|\b(scan|check)\b[^.?!]{0,20}\bhow often\b/i.test(message)) {
    return `Once a week is plenty. Skin moves in weeks, not days — scan more often than that and you're mostly measuring the lighting.`;
  }
  if (/\border\b|\bwhat (goes|comes) first\b|\bwhich\b[^.?!]{0,30}\bfirst\b/i.test(message)) {
    return `Thinnest to thickest: cleanse, treat, hydrate, protect. Sunscreen closes the morning, every morning — that one's not negotiable.`;
  }
  if (/\bhow long\b[^.?!]{0,40}\b(work|works|results?|see|take|takes)\b/i.test(message)) {
    return `Four to six weeks for most things — a full skin cycle or two. Anything promising overnight is selling the overnight, not the result.`;
  }
  if (hasScans) {
    return `Here's what I can answer from your data: ${shortState(ctx)}. Beyond that, my honest rule is that three things done consistently beat ten done sometimes. Name the bit you want unpacked and I'll go deeper.`;
  }
  return `Without a scan I can give you principle, not a reading — and the principle is that sunscreen's the non-negotiable and consistency beats variety. Let me take a look and I can answer for your skin instead of skin in general.`;
}

function turn(
  text: string,
  d: CharacterDirective,
  classification: TurnClassification,
  actions: ElohimAction[],
): ElohimTurn {
  return { text, directive: d, classification, memoryWrites: [], actions, demo: true };
}

/**
 * Turns produced by app events rather than by something the user typed. The
 * scan_complete case reads the freshly stored numbers — it is the local engine,
 * but the results it describes are the real ones.
 */
export function respondToEvent(
  event: 'opened' | 'scan_complete' | 'body_scan_complete',
  classification: TurnClassification,
  ctx: ElohimContext,
  opts: { introSkipped?: boolean } = {},
): ElohimTurn {
  if (event === 'body_scan_complete') return respondToBodyScan(classification, ctx);

  if (event === 'opened') return respondToOpen(classification, ctx, opts);

  if (!ctx.latest) {
    return turn(
      `Hmm — the scan finished but I can't read the results. Let's try that again.`,
      directive('CONFUSED', 'concerned', 'head_tilt', 0.6),
      classification,
      [],
    );
  }

  const parts: string[] = ["Okay… I've got it."];

  if (ctx.latest.confidence < 0.6) {
    parts.push(
      `Fair warning: the lighting wasn't ideal, so I'd hold these loosely${
        ctx.latest.quality?.issues?.length ? ` — ${ctx.latest.quality.issues[0]}` : ''
      }.`,
    );
  }

  const moved = ctx.summary.trends
    .filter((t) => t.significant && t.deltaFromPrevious !== null)
    .sort((a, b) => Math.abs(b.deltaFromPrevious!) - Math.abs(a.deltaFromPrevious!));

  const style = ctx.user.preferences.explanationStyle;

  if (ctx.summary.scanCount === 1) {
    const worst = [...ctx.summary.trends]
      .filter((t) => t.key !== 'hydration' && t.key !== 'evenness')
      .sort((a, b) => b.current - a.current)[0];
    parts.push(
      `That's your baseline now. Hydration's at ${Math.round(ctx.latest.metrics.hydration)}, and ${METRIC_LABELS[
        worst.key
      ].toLowerCase()} is the loudest thing I'm seeing.`,
    );
  } else if (moved.length === 0) {
    parts.push(`Everything's holding steady since last time — nothing moved beyond measurement noise. Steady is a result.`);
  } else {
    // Metric labels are a mix of singular and plural ("Texture", "Pores"), so
    // the sentence has to work for both — no "Pores is up".
    const top = moved[0];
    parts.push(
      top.direction === 'improving'
        ? `${METRIC_LABELS[top.key]} improved by about ${points(top.deltaFromPrevious!)} since your last scan.`
        : `${METRIC_LABELS[top.key]} moved the wrong way by about ${points(top.deltaFromPrevious!)} since your last scan.`,
    );
    const other = moved.find((t) => t.direction !== top.direction);
    if (other) {
      // Never say "up" or "down" about a score: higher is better for hydration
      // and worse for redness, so a raw direction word is wrong half the time.
      // Always speak in better/worse, which the trend direction already encodes.
      parts.push(
        other.direction === 'improving'
          ? `${METRIC_LABELS[other.key]}, on the other hand, improved by about ${points(other.deltaFromPrevious!)}.`
          : `${METRIC_LABELS[other.key]} slipped by about ${points(other.deltaFromPrevious!)} though.`,
      );
    }
    // A stored preference for detail gets detail without being asked.
    const third = moved.find((t) => t !== top && t !== other);
    if (style === 'detailed' && third) {
      parts.push(
        `Also on the sheet: ${METRIC_LABELS[third.key].toLowerCase()} ${
          third.direction === 'improving' ? 'improved' : 'slipped'
        } by about ${points(third.deltaFromPrevious!)}.`,
      );
    }
  }

  /*
   * The one thing to get, when the shelf has it.
   *
   * Ingredient first, product second, price as fetched - the same rules the
   * model is given. Only the top pick: a reading is a moment, not a shop.
   */
  const shelfPick = ctx.picks?.find((p) => p.product) ?? null;
  if (shelfPick && shelfPick.product) {
    const trigger = shelfPick.suggestion.because
      ? `For the ${shelfPick.suggestion.because.label.toLowerCase()}`
      : `To protect all of it`;
    parts.push(
      `${trigger}, I'd start with ${shelfPick.suggestion.title.toLowerCase()} - ` +
        `${shelfPick.product.brand ? shelfPick.product.brand + ' ' : ''}${shelfPick.product.name} does that. ${shelfPick.priceNote}`,
    );
  }

  /*
   * The style question is asked once, while no preference exists. A stored
   * preference is applied, and the reply closes with an offer to go deeper
   * instead of a question they have already answered.
   */
  const eventActions: ElohimAction[] = [];
  if (style === 'adaptive') {
    parts.push(`Do you want the short version, or the full read?`);
    eventActions.push({ type: 'ask_explanation_style' });
  } else if (style === 'genz') {
    parts.push(`That's the tea. Say the word if you want the deep dive.`);
  } else if (style === 'simple') {
    parts.push(`That's the short version. Ask me if you want more.`);
  } else {
    parts.push(`That's the headline — happy to go a layer deeper on any of it.`);
  }

  /*
   * Her mood follows the news. Net improvement reads happy, net decline reads
   * concerned, steady reads warm — the old always-focused delivery meant good
   * news and bad news arrived with the same face.
   */
  const improving = moved.filter((t) => t.direction === 'improving').length;
  const declining = moved.filter((t) => t.direction === 'declining').length;
  const mood =
    moved.length === 0 || improving === declining
      ? directive('EXPLAINING', 'warm', 'point_to_hologram', 0.55)
      : improving > declining
        ? directive('HAPPY', 'smile', 'point_to_hologram', 0.7)
        : directive('CONCERNED', 'concerned', 'point_to_hologram', 0.65);

  return {
    text: parts.join(' '),
    directive: mood,
    classification,
    memoryWrites: [],
    actions: eventActions,
    demo: true,
  };
}

/**
 * The opening line when the room appears. A pool rather than one sentence,
 * seeded by the day, and grounded in the data when there is any — the trend
 * that mattered last time, or the gap since the last scan.
 */
function respondToOpen(
  classification: TurnClassification,
  ctx: ElohimContext,
  opts: { introSkipped?: boolean },
): ElohimTurn {
  const name = knownName(ctx.user.displayName);
  const hasScans = ctx.summary.scanCount > 0;
  const seed = `opened|${dayStamp()}|${ctx.summary.scanCount}`;

  if (!hasScans) {
    /*
     * By the time the room opens, the intro sequence has already introduced
     * her — a second "I'm Elohim" reads as a loop. The one self-introducing
     * variant is reserved for a caller that knows the intro was skipped.
     */
    const lines = opts.introSkipped
      ? [
          `${greet(name)} I'm Elohim — I look at skin for a living, so to speak. Tell me what's been going on, or I can just take a look.`,
        ]
      : [
          `So — you found me. Tell me what's been going on, or I can just take a look.`,
          `${greet(name)} Tell me what's been going on with your skin, or I can just take a look.`,
        ];
    return turn(pick(lines, seed), directive('HAPPY', 'warm', 'small_wave', 0.55), classification, []);
  }

  const pool: string[] = [
    `${greet(name)} Let me look at you — how's the skin been?`,
    `Good to see you. What are we working with today?`,
    `You're back. Talk to me — how's it been behaving?`,
    `${greet(name)} How's it been since I last saw you?`,
  ];

  // Data-driven openers, guarded on the data actually existing.
  const story = ctx.summary.trends
    .filter((t) => t.significant && t.deltaFromPrevious !== null)
    .sort((a, b) => Math.abs(b.deltaFromPrevious!) - Math.abs(a.deltaFromPrevious!))[0];
  if (story) {
    pool.push(`Last time the ${METRIC_LABELS[story.key].toLowerCase()} was the story — how's it looking?`);
  }
  if (ctx.latest) {
    const gapDays = Math.floor((Date.now() - new Date(ctx.latest.capturedAt).getTime()) / 86_400_000);
    if (Number.isFinite(gapDays) && gapDays >= 14) {
      pool.push(`It's been a while since your last scan — fresh read, or just talk?`);
    }
  }

  return turn(pick(pool, seed), directive('HAPPY', 'smile', 'small_wave', 0.55), classification, []);
}

/** Phrases that identify a metric in ordinary speech, not just its label. */
const METRIC_ALIASES: Array<[SkinMetricKey, RegExp]> = [
  ['hydration', /\b(hydration|hydrated|dehydrat|moisture|dry(ness)?)\b/i],
  ['oiliness', /\b(oil(iness|y)?|shine|shiny|sebum|greasy|t-?zone)\b/i],
  ['redness', /\b(redness|red|flush|irritat|inflam)\b/i],
  ['texture', /\b(texture|rough|smooth(ness)?|bumpy?|uneven surface)\b/i],
  ['pores', /\b(pores?|blackheads?|congest)\b/i],
  ['darkSpots', /\b(dark spots?|pigment|hyperpigment|marks?|discolou?r)\b/i],
  ['evenness', /\b(even(ness)?|tone|patchy|blotch)\b/i],
  // The trailing \b needs the optional plural, or "under-eyes" fails to match:
  // the boundary after "eye" lands mid-word.
  ['underEye', /\b(under[- ]?eyes?|dark circles?|eye bags?|tired eyes)\b/i],
  ['acneIndicators', /\b(acne|breakout|break(ing)? out|pimples?|spots? on)\b/i],
];

function namedMetric(message: string): SkinMetricKey | null {
  for (const [key, pattern] of METRIC_ALIASES) {
    if (pattern.test(message)) return key;
  }
  return null;
}

/** Explains one metric from the stored numbers, honouring the noise floor. */
function explainMetric(key: SkinMetricKey, ctx: ElohimContext): string {
  const trend = ctx.summary.trends.find((t) => t.key === key);
  if (!trend) return `I don't have a reading for that yet.`;

  const label = METRIC_LABELS[key].toLowerCase();
  // "I've got your X at N" rather than "your X is at N": the labels are a mix of
  // singular and plural ("texture", "dark spots"), and this construction agrees
  // with both.
  const parts: string[] = [`I've got your ${label} at ${Math.round(trend.current)}.`];

  if (trend.deltaFromPrevious === null) {
    parts.push(`That was your first scan, so there's nothing to compare it to yet.`);
  } else if (!trend.significant) {
    parts.push(`Basically unchanged since last time — the difference is inside measurement noise.`);
  } else if (trend.direction === 'improving') {
    parts.push(`That's improved by about ${points(trend.deltaFromPrevious)} since your last scan.`);
  } else {
    parts.push(`That's moved the wrong way by about ${points(trend.deltaFromPrevious)} since your last scan.`);
  }

  if (trend.deltaFromFirst !== null && Math.abs(trend.deltaFromFirst) >= METRIC_NOISE_FLOOR[key]) {
    // Better/worse, never up/down — the score direction that counts as good
    // differs per metric, so a raw direction word is wrong half the time.
    const better = METRIC_HIGHER_IS_BETTER[key]
      ? trend.deltaFromFirst > 0
      : trend.deltaFromFirst < 0;
    parts.push(
      `Across everything I've seen, that's ${points(trend.deltaFromFirst)} ` +
        `${better ? 'better' : 'worse'} than where you started.`,
    );
  }

  if (ctx.latest && ctx.latest.confidence < 0.6) {
    parts.push(`Worth saying the last capture wasn't ideal, so hold that number loosely.`);
  }

  return parts.join(' ');
}

/** One clause describing where their skin currently sits, from real numbers. */
function shortState(ctx: ElohimContext): string {
  if (!ctx.latest) return 'we have no scans yet';
  const entries = Object.entries(ctx.latest.metrics) as Array<[SkinMetricKey, number]>;
  const hydration = ctx.latest.metrics.hydration;
  const worst = entries
    .filter(([k]) => k !== 'hydration' && k !== 'evenness')
    .sort((a, b) => b[1] - a[1])[0];
  return `hydration's sitting at ${Math.round(hydration)} and ${METRIC_LABELS[worst[0]].toLowerCase()} is the loudest thing on your last scan`;
}

/** Reads the real trend summary out loud, honouring the noise floor. */
function explainTrends(ctx: ElohimContext): string {
  const moved = ctx.summary.trends
    .filter((t) => t.significant && t.deltaFromPrevious !== null)
    .sort((a, b) => Math.abs(b.deltaFromPrevious!) - Math.abs(a.deltaFromPrevious!));

  if (ctx.summary.scanCount < 2) {
    return `That was your first scan, so there's nothing to compare it to yet. Do another in a few weeks and I'll show you what actually moved.`;
  }

  if (moved.length === 0) {
    return `Honestly? Nothing moved enough for me to call it a change — everything's inside measurement noise since your last scan. That's not nothing, that's stable.`;
  }

  const good = moved.filter((t) => t.direction === 'improving').slice(0, 2);
  const bad = moved.filter((t) => t.direction === 'declining').slice(0, 2);

  const parts: string[] = [];
  if (good.length) {
    // "improved by", not "is up" — see the note above on direction words.
    parts.push(
      `${good
        .map((t) => `${METRIC_LABELS[t.key].toLowerCase()} improved by ${points(t.deltaFromPrevious!)}`)
        .join(' and ')} — that's real movement, not noise.`,
    );
  }
  if (bad.length) {
    parts.push(
      `I'm seeing more ${bad.map((t) => METRIC_LABELS[t.key].toLowerCase()).join(' and ')} than last time though.`,
    );
  }

  const corr = ctx.summary.correlations[0];
  if (corr && Object.keys(corr.metricDeltasDuringUse).length) {
    parts.push(
      `You've been on ${corr.productName} for about ${corr.overlapDays} days, and your numbers shifted during that window — worth noting, though I can't tell you it's the cause.`,
    );
  }

  return parts.join(' ');
}

/** Exposed so the orchestrator can decide whether a metric moved enough to mention. */
export function isSignificant(key: SkinMetricKey, delta: number): boolean {
  return Math.abs(delta) >= METRIC_NOISE_FLOOR[key];
}

/**
 * The local engine's body-scan reply.
 *
 * Reads the block that arrived with the event rather than the stored skin
 * scans, which is the whole reason it is a separate function: the skin version
 * describes `ctx.latest`, and after a body scan that is somebody's pores.
 *
 * Says nothing a photograph cannot support. No weight, no body fat, no verdict
 * on build — and when there was no side view it says plainly that there is no
 * abdominal reading rather than reaching for the front frame to guess one.
 */
function respondToBodyScan(classification: TurnClassification, ctx: ElohimContext): ElohimTurn {
  const body = ctx.body;
  if (!body) {
    return turn(
      `The scan finished but the readings didn't reach me. Let's take that again.`,
      directive('CONFUSED', 'concerned', 'head_tilt', 0.6),
      classification,
      [],
    );
  }

  const parts: string[] = [];

  if (body.confidence < 0.7) {
    parts.push(
      `Some of your joints were hard to place in that frame, so hold these a bit loosely.`,
    );
  }

  if (body.findings.length === 0) {
    parts.push(`Shoulders, hips and head are all sitting level — nothing I'd change.`);
  } else {
    const moved = body.findings.filter((f) => f.kind === 'movement');
    const lead = moved[0] ?? body.findings[0];
    const nameOf = (f: { key: string }) => BODY_READING_LABELS[f.key] ?? f.key;
    const direction = lead.delta !== null && lead.delta > 0 ? 'up' : 'down';

    if (lead.kind === 'movement' && lead.delta !== null) {
      parts.push(
        `Your ${nameOf(lead).toLowerCase()} has moved ${direction} ${Math.abs(Math.round(lead.delta))} points since last time — that's past what I'd call noise.`,
      );
    } else if (lead.kind === 'tracked') {
      parts.push(
        `Your ${nameOf(lead).toLowerCase()} reads ${Math.round(lead.value)} out of 100. That's a starting point, not a score — the number worth anything is the next one, next month.`,
      );
    } else {
      parts.push(
        `The one I'd look at is your ${nameOf(lead).toLowerCase()}, at ${Math.round(lead.value)} out of 100.`,
      );
    }

    const second = body.findings.find((f) => f !== lead);
    if (second) {
      parts.push(`${nameOf(second)} came in at ${Math.round(second.value)}.`);
    }
  }

  if (!body.hasProfile) {
    parts.push(
      `I only have the front view, so I can't say anything about your stomach — that only shows from the side.`,
    );
  }

  return turn(
    parts.join(' '),
    directive('ANALYSIS_COMPLETE', 'neutral', 'none', 0.5),
    classification,
    [],
  );
}
