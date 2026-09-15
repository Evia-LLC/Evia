/**
 * The rule-based turn classifier.
 *
 * Lives in `shared/` because two things need it: the server, as the first
 * pass before (or instead of) the model, and the browser, where a guest with
 * no server still talks to the local engine. It has no dependencies beyond
 * the shared types, which is what makes that possible.
 */
import type { Emotion, Intent, TurnClassification } from './types.ts';

const ESCALATION_PATTERNS: RegExp[] = [
  /\b(bleed|bleeding|bled)\b/i,
  /\b(pus|oozing|weeping)\b/i,
  /\b(mole|freckle)\b[^.?!]{0,40}\b(chang|grow|new|shape|colou?r|bigger|irregular)/i,
  /\b(chang|grow|spread)[a-z]*\b[^.?!]{0,30}\b(mole|lesion|spot|patch)\b/i,
  /\bwon'?t heal|not healing|never heals|hasn'?t healed\b/i,
  /\b(painful|hurts?|burning|stinging)\b[^.?!]{0,30}\b(sore|lesion|rash|patch|lump)\b/i,
  /\b(rash|swelling)\b[^.?!]{0,30}\b(fever|spreading|fast|rapidly)\b/i,
  /\b(lump|nodule|ulcer)\b/i,
  /\b(allergic reaction|anaphylaxis|anaphylactic)\b/i,
  /\b(swelling|swollen|swell)\b[^.?!]{0,40}\b(face|lip|lips|eye|eyes|tongue|throat|mouth)\b/i,
  /\b(face|lip|lips|eye|eyes|tongue|throat|mouth)\b[^.?!]{0,40}\b(swelling|swollen|swell(?:ing)? up)\b/i,
  /\b(throat clos|can'?t breathe|cannot breathe|can not breathe|trouble breathing|struggling to breathe)\b/i,
  /\b(throat|chest)\b[^.?!]{0,20}\b(tight|tightness|closing|close up)\b/i,
  /\btight(?:ness)?\b[^.?!]{0,20}\b(throat|chest)\b/i,
  /\b(chemical burn|burn(?:ed|ing|t)?|blister(?:ed|ing|s)?|raw|stinging|peeling)\b[^.?!]{0,45}\b(acid|peel|retinoid|retinol|tretinoin|adapalene|benzoyl|product|treatment|cream|serum|after (?:the|that|using))\b/i,
  /\b(acid|peel|retinoid|retinol|tretinoin|adapalene|benzoyl)\b[^.?!]{0,45}\b(chemical burn|burn(?:ed|ing|t)|blister(?:ed|ing|s)?|raw)\b/i,
];

/*
 * The subset of escalations where "see a dermatologist" is the wrong advice.
 *
 * A changing mole warrants an appointment. An airway closing warrants care
 * today, and a derm referral is weeks out — so routing both to the same
 * sentence is a real failure of the disclaimer, not a wording preference.
 */
const URGENT_PATTERNS: RegExp[] = [
  /\b(allergic reaction|anaphylaxis|anaphylactic)\b/i,
  /\b(throat clos|can'?t breathe|cannot breathe|can not breathe|trouble breathing|struggling to breathe)\b/i,
  /\b(throat|chest)\b[^.?!]{0,20}\b(tight|tightness|closing|close up)\b/i,
  /\btight(?:ness)?\b[^.?!]{0,20}\b(throat|chest)\b/i,
  /*
   * Facial and periorbital swelling sits here rather than in the appointment
   * tier because angioedema presents that way and can progress to the airway.
   * Note this matches "swollen", not "puffy" — puffy under-eyes in the morning
   * is the single most common benign complaint this app receives, and sending
   * that to urgent care would be its own kind of harm.
   */
  /\b(swelling|swollen|swell)\b[^.?!]{0,40}\b(face|lip|lips|eye|eyes|tongue|throat|mouth)\b/i,
  /\b(face|lip|lips|eye|eyes|tongue|throat|mouth)\b[^.?!]{0,40}\b(swelling|swollen|swell(?:ing)? up)\b/i,
  /\b(rash|swelling)\b[^.?!]{0,30}\b(fever|spreading|fast|rapidly)\b/i,
];

const EMOTION_CUES: Array<[Emotion, RegExp]> = [
  ['sad', /😭|😢|😞|\b(sad|depress|crying|cry|awful|hate my|miserable)\b/i],
  ['frustrated', /😤|😩|\b(frustrat|annoy|fed up|sick of|nothing works|ugh|again\?)\b/i],
  ['worried', /\b(worried|worry|scared|anxious|nervous|concerned|is (this|it) bad|should i be)\b/i],
  ['embarrassed', /\b(embarrass|ashamed|ugly|gross|disgusting|hide|so bad)\b/i],
  ['excited', /🤩|🥳|\b(excited|can'?t wait|so happy|amazing|yesss+|omg)\b/i],
  ['happy', /😊|😄|🙂|\b(happy|great|lovely|so good|thank you so much|glowing)\b/i],
  ['playful', /😏|😜|😂|🤣|\b(lol|lmao|haha|girl|bestie|periodt|slay)\b/i],
  ['confused', /🤔|\b(confused|don'?t (get|understand)|what does that mean|huh\?|unclear)\b/i],
  ['curious', /\b(curious|wondering|how does|what is|why does|tell me about)\b/i],
];

const INTENT_CUES: Array<[Intent, RegExp]> = [
  ['goodbye', /\b(bye|goodbye|see you|talk later|good ?night|gtg|that'?s all)\b/i],
  ['greeting', /^\s*(hey+|hi+|hello+|yo+|good (morning|afternoon|evening)|heyyy+)\b/i],
  ['request_scan', /\b(scan|analy[sz]e|check my (skin|face)|look at my (skin|face)|take a look)\b/i],
  ['request_results', /\b(results?|what did you (see|find)|how'?s my skin|my (scores?|numbers))\b/i],
  ['request_progress', /\b(progress|improv|compare|since (last|the) (time|scan)|better than|trend|history)\b/i],
  ['ask_product', /\b(should i use|is .{2,40} (good|ok|safe)|this (serum|cleanser|cream|moisturi[sz]er|product)|ingredients?|retinol|niacinamide|salicylic|vitamin c|spf|sunscreen)\b/i],
  ['update_routine', /\b(i('| a)?m using|i started|i stopped|added .{2,30} to my routine|my routine is|switched to)\b/i],
  ['set_preference', /\b(gen ?-?z|keep it simple|simpler|more detail|explain it (like|simply)|shorter|less technical)\b/i],
  // Every noun takes an optional plural: the singular-only version of this
  // list sent "my breakouts got worse" — the single most common opening
  // complaint — to the generic default, because \bbreakout\b does not match
  // "breakouts". Getting-worse language counts as describing a concern too.
  ['describe_concern', /\b(break(ing|s)? out|broke out|breakouts?|acne|pimples?|spots?|dry|oily|red(ness)?|irritat|itch|texture|dark spots?|pigment|dull|flak|peel|blackheads?|pores?|congest|bumpy?|whiteheads?|blemish(es)?|(got|getting|gotten|so much|much)\s+worse|worsening|flar(e|es|ed|ing)(\s+up)?)\b/i],
  ['ask_question', /\?\s*$|^\s*(what|why|how|when|can|does|do|is|are|should)\b/i],
];

/** Venting reads as a concern but must not trigger a scan — brief §6. */
const VENTING =
  /\b(terrible|awful|the worst|hate|crazy|acting (up|weird|crazy)|so bad|freaking out|disaster|losing it|over it|why is it like this)\b/i;

/** Anything that makes a message about the user's own skin rather than in general. */
const ABOUT_MY_SKIN = /\b(my|me|i'?m|i am|i'?ve)\b[^.?!]{0,40}\b(skin|face|complexion|cheeks?|forehead|chin|t-?zone)\b|\b(skin|face)\b[^.?!]{0,20}\b(is|has been|keeps|won'?t)\b/i;

/** Explicit asks that outrank a venting read even when the tone is upset. */
const EXPLICIT_REQUEST: Intent[] = [
  'request_scan',
  'request_results',
  'request_progress',
  'ask_product',
  'set_preference',
  'update_routine',
  'goodbye',
];

export function classifyLocally(message: string): TurnClassification {
  const text = message.trim();

  const escalate = ESCALATION_PATTERNS.some((re) => re.test(text));
  const urgent = URGENT_PATTERNS.some((re) => re.test(text));

  let emotion: Emotion = 'neutral';
  for (const [candidate, re] of EMOTION_CUES) {
    if (re.test(text)) {
      emotion = candidate;
      break;
    }
  }

  let intent: Intent = 'other';
  for (const [candidate, re] of INTENT_CUES) {
    if (re.test(text)) {
      intent = candidate;
      break;
    }
  }

  // Someone venting about their skin wants to be heard, not measured. This has
  // to win over the keyword read, because "my skin is terrible today 😭" is full
  // of concern keywords and is emphatically not a request for a scan.
  const venting = VENTING.test(text) && ABOUT_MY_SKIN.test(text);
  if (venting && !EXPLICIT_REQUEST.includes(intent)) {
    intent = 'venting';
  } else if (venting && intent === 'request_scan' && !/\b(scan|analy[sz]e)\b/i.test(text)) {
    intent = 'venting';
  }

  if (intent === 'other' && text.length < 30 && /^[\p{Emoji}\s\p{P}]+$/u.test(text)) {
    intent = 'small_talk';
  }

  // Confidence is intentionally modest: this is pattern matching, and the main
  // model gets to disagree with it in its own reading of the turn.
  const confidence = intent === 'other' ? 0.3 : 0.65;

  return { emotion, intent, confidence, escalate, urgent };
}
