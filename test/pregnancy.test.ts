/**
 * Pregnancy status, and the two ways it can go wrong.
 *
 * Before this existed, `vetoFor: ['pregnancy']` on the retinoid rule was only
 * reachable if the user typed the word "pregnancy" into a free-text
 * *sensitivities* box whose placeholder reads "fragrance, essential oils". The
 * veto was real and nobody could trigger it.
 *
 * The second failure is subtler and is what most of this file guards: treating
 * "prefer not to say" as "no". Unanswered and declined are both `unknown`, and
 * `unknown` must never be silently converted into the convenient answer.
 */
import { describe, expect, it } from 'vitest';
import { buildRoutinePlan } from '../server/skin/recommend.ts';
import { PREGNANCY_STATUSES, type PregnancyStatus, type SkinProfile } from '../shared/types.ts';
import type { SkinAppearanceMetrics } from '../shared/types.ts';

const profile = (pregnancyStatus: PregnancyStatus): SkinProfile => ({
  skinType: 'normal',
  fitzpatrick: null,
  concerns: [],
  sensitivities: [],
  pregnancyStatus,
  updatedAt: new Date().toISOString(),
});

/** Texture high enough to clear the threshold and the noise floor comfortably. */
const metrics = (): SkinAppearanceMetrics => ({
  oiliness: 30,
  texture: 80,
  pores: 30,
  hydration: 70,
  redness: 20,
  darkSpots: 20,
  evenness: 70,
  underEye: 30,
  acneIndicators: 20,
});

const planFor = (status: PregnancyStatus) =>
  buildRoutinePlan(metrics(), profile(status), [], 0.9);

const retinoidIn = (status: PregnancyStatus) =>
  planFor(status).suggestions.filter((s) => s.family === 'retinoid');

describe('a restricted status withholds the retinoid', () => {
  it.each(['pregnant', 'trying', 'breastfeeding'] as PregnancyStatus[])(
    'suggests no retinoid when %s',
    (status) => {
      expect(retinoidIn(status)).toHaveLength(0);
    },
  );

  it.each(['pregnant', 'trying', 'breastfeeding'] as PregnancyStatus[])(
    'still offers the gentler alternative when %s',
    (status) => {
      // Withholding must not mean withholding help — the rule has a fallback
      // for exactly this, and the texture reading has not gone away.
      const titles = planFor(status).suggestions.map((s) => s.title);
      expect(titles).toContain('Mandelic acid');
    },
  );

  it('says why it was swapped rather than silently substituting', () => {
    const swapped = planFor('pregnant').suggestions.find((s) => s.title === 'Mandelic acid');
    expect(swapped?.cautions.join(' ')).toMatch(/pregnancy/i);
  });
});

describe('an explicit no allows it', () => {
  it('suggests the retinoid', () => {
    expect(retinoidIn('no').length).toBeGreaterThan(0);
  });

  it('does not attach the pregnancy caution', () => {
    const retinoid = retinoidIn('no')[0];
    expect(retinoid.cautions.join(' ')).not.toMatch(/pregnant/i);
  });
});

describe('unknown is not a no', () => {
  it('does not silently recommend as if the answer were no', () => {
    // The suggestion stands — a hard veto would withhold the best-evidenced
    // treatment from every user over a question they were never asked — but it
    // cannot stand *unqualified*.
    const retinoid = retinoidIn('unknown')[0];
    expect(retinoid).toBeDefined();
    expect(retinoid.cautions.join(' ')).toMatch(
      /not for use if you are pregnant, trying to conceive, or breastfeeding/i,
    );
  });

  it('leads with that caution rather than burying it', () => {
    expect(retinoidIn('unknown')[0].cautions[0]).toMatch(/pregnant/i);
  });

  it('produces a different plan from an explicit no', () => {
    // The regression this catches: someone "simplifying" by defaulting unknown
    // to 'no'. If that happens these two become identical.
    const unknown = JSON.stringify(planFor('unknown').suggestions);
    const no = JSON.stringify(planFor('no').suggestions);
    expect(unknown).not.toBe(no);
  });

  it('is the default for a profile that has never been asked', () => {
    expect(profile('unknown').pregnancyStatus).toBe('unknown');
  });
});

describe('the status union', () => {
  it('has a plan for every value, with no crash and no empty result', () => {
    for (const status of PREGNANCY_STATUSES) {
      const plan = planFor(status);
      expect(plan.suggestions.length, status).toBeGreaterThan(0);
    }
  });

  it('never lets a retinoid through for any restricted status', () => {
    const leaked = PREGNANCY_STATUSES.filter(
      (s) => s !== 'no' && s !== 'unknown' && retinoidIn(s).length > 0,
    );
    expect(leaked).toEqual([]);
  });
});
