/**
 * Escalation is the one classifier output where a miss has a body attached to
 * it, so it gets its own table-driven test rather than living inside the
 * general classifier tests.
 *
 * Every phrase here was drawn from a real failure: the original patterns
 * matched the literal string "face is swelling" and nothing else, so
 * "my lips are swelling and I can not breathe well" reached the catch-all and
 * was answered with a hydration score.
 *
 * The negatives matter as much as the positives. An app that sends morning
 * under-eye puffiness to urgent care has failed differently, not less.
 */
import { describe, expect, it } from 'vitest';
import { classifyLocally } from '../server/ai/classify.ts';

type Tier = 'urgent' | 'derm' | 'none';

const tierOf = (message: string): Tier => {
  const r = classifyLocally(message);
  return r.urgent ? 'urgent' : r.escalate ? 'derm' : 'none';
};

/** Airway or allergic presentation — needs care today, not an appointment. */
const URGENT = [
  'my lips are swelling and I can not breathe well',
  'my throat feels tight and my face is puffy',
  'my lips and face are swelling up',
  'my whole face is swollen',
  'I think I am having an allergic reaction',
  'my face is swelling',
  'my eyes are swollen shut',
  'there is tightness in my throat',
  'my tongue feels swollen',
  'I am having an anaphylactic reaction',
];

/** Warrants a clinician, but an appointment is the right advice. */
const DERM = [
  'my face is peeling and burning after that acid',
  'my skin is burning after the retinol',
  'I got a chemical burn from a peel',
  'my skin is raw and blistered from the tretinoin',
  'I have a mole that changed shape',
  'there is a lump under my skin',
  'this spot wont heal',
  'the patch is bleeding',
];

/** Ordinary skincare talk. Escalating any of these is its own failure. */
const NONE = [
  'my skin is a bit dry today',
  'should I use retinol for texture?',
  'is salicylic acid ok for oily skin',
  'my cheeks look red in this light',
  'I burned dinner lol',
  'my under eyes are puffy in the morning',
  'my face looks puffy when I wake up',
  'can you check my pores',
  'my skin feels tight after cleansing',
  'what does niacinamide do',
];

describe('escalation tiers', () => {
  it.each(URGENT)('routes to urgent care: %s', (message) => {
    expect(tierOf(message)).toBe('urgent');
  });

  it.each(DERM)('routes to a dermatologist: %s', (message) => {
    expect(tierOf(message)).toBe('derm');
  });

  it.each(NONE)('does not escalate: %s', (message) => {
    expect(tierOf(message)).toBe('none');
  });

  it('treats every urgent phrase as an escalation too', () => {
    // urgent is a subset of escalate, not a sibling of it — the fallback
    // branches on escalate first and only then picks the wording.
    for (const message of URGENT) {
      expect(classifyLocally(message).escalate, message).toBe(true);
    }
  });
});
