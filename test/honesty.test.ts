/**
 * Tests for the claims this app is willing to make.
 *
 * Deliberately not "tests for the analysis". The pixel maths has no ground
 * truth in this repo and pinning it with assertions would only freeze whatever
 * it happens to output today. What *can* be pinned, and what actually matters,
 * is the layer above it: the rules that decide when a number is allowed to
 * become a statement.
 *
 * Every test here corresponds to a way the product could quietly start
 * flattering its user — reporting noise as progress, comparing across
 * incompatible model versions, announcing wins while staying silent about
 * failures. Those are the regressions worth catching, because none of them look
 * like bugs. They look like good news.
 */
import { describe, expect, it } from 'vitest';

import {
  METRIC_HIGHER_IS_BETTER,
  METRIC_NOISE_FLOOR,
  SKIN_METRIC_KEYS,
  VISEMES,
  type ProductUsage,
  type SkinAnalysis,
  type SkinAppearanceMetrics,
} from '../shared/types.ts';
import { assessCapture } from '../src/skin-analysis/quality.ts';
import { evaluateRoutine } from '../server/skin/outcomes.ts';
import { summarise } from '../server/skin/longitudinal.ts';
import { FAMILY_TARGETS } from '../server/skin/recommend.ts';

const DAY = 86_400_000;

const FLAT: SkinAppearanceMetrics = {
  hydration: 50,
  oiliness: 50,
  redness: 50,
  texture: 50,
  pores: 50,
  darkSpots: 50,
  evenness: 50,
  underEye: 50,
  acneIndicators: 50,
};

function scan(daysAgo: number, overrides: Partial<SkinAppearanceMetrics> = {}, version = 'v1'): SkinAnalysis {
  return {
    id: `s${daysAgo}-${version}`,
    capturedAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
    metrics: { ...FLAT, ...overrides },
    regions: {},
    quality: { score: 0.85, lighting: 0.8, sharpness: 0.85, framing: 0.9 } as SkinAnalysis['quality'],
    confidence: 0.8,
    modelVersion: version,
  };
}

function usage(name: string, ingredients: string[], startedDaysAgo: number): ProductUsage {
  return {
    product: { id: name, name, brand: null, category: null, ingredients, source: 'user' },
    startedAt: new Date(Date.now() - startedDaysAgo * DAY).toISOString(),
    endedAt: null,
  } as ProductUsage;
}

describe('noise floor', () => {
  it('refuses to call a sub-floor move a change', () => {
    // Texture's floor is 4. A 3-point move is not a result.
    const drift = METRIC_NOISE_FLOOR.texture - 1;
    const outcomes = evaluateRoutine(
      [scan(40, { texture: 50 }), scan(0, { texture: 50 - drift })],
      [usage('Retinal', ['Retinaldehyde'], 40)],
    );
    expect(outcomes[0].verdict).toBe('no_evidence');
    expect(outcomes[0].statement).toMatch(/no evidence/i);
  });

  it('does call a move past the floor a change', () => {
    const real = METRIC_NOISE_FLOOR.texture + 2;
    const outcomes = evaluateRoutine(
      [scan(40, { texture: 50 }), scan(0, { texture: 50 - real })],
      [usage('Retinal', ['Retinaldehyde'], 40)],
    );
    expect(outcomes[0].verdict).toBe('working');
  });

  it('every metric has a floor above zero', () => {
    // A floor of 0 would let a rounding difference become a headline.
    for (const key of SKIN_METRIC_KEYS) expect(METRIC_NOISE_FLOOR[key]).toBeGreaterThan(0);
  });
});

describe('reporting failure', () => {
  it('says so when the metric moved the wrong way', () => {
    const outcomes = evaluateRoutine(
      // Texture is lower-is-better, so rising is worse.
      [scan(40, { texture: 50 }), scan(0, { texture: 62 })],
      [usage('Retinal', ['Retinaldehyde'], 40)],
    );
    expect(outcomes[0].verdict).toBe('wrong_way');
    expect(outcomes[0].statement).toMatch(/wrong way/i);
  });

  it('sorts failures above successes', () => {
    const outcomes = evaluateRoutine(
      [scan(40, { texture: 50, evenness: 50 }), scan(0, { texture: 62, evenness: 66 })],
      [usage('Retinal', ['Retinaldehyde'], 40), usage('Vit C', ['Ascorbic Acid'], 40)],
    );
    // Bad news first, or it is easy to miss under a list of wins.
    expect(outcomes[0].verdict).toBe('wrong_way');
    expect(outcomes[1].verdict).toBe('working');
  });

  it('states the association caveat on every graded verdict', () => {
    const outcomes = evaluateRoutine(
      [scan(40, { texture: 50, evenness: 50 }), scan(0, { texture: 62, evenness: 66 })],
      [usage('Retinal', ['Retinaldehyde'], 40), usage('Vit C', ['Ascorbic Acid'], 40)],
    );
    for (const outcome of outcomes) {
      expect(outcome.statement).toMatch(/association, not proof/i);
    }
  });
});

describe('refusing to answer early', () => {
  it('will not grade a product used for a few days', () => {
    const outcomes = evaluateRoutine(
      [scan(2, { texture: 50 }), scan(0, { texture: 30 })],
      [usage('Retinal', ['Retinaldehyde'], 3)],
    );
    expect(outcomes[0].verdict).toBe('too_early');
  });

  it('will not grade on a single scan however long the window', () => {
    const outcomes = evaluateRoutine(
      [scan(0, { texture: 30 })],
      [usage('Retinal', ['Retinaldehyde'], 90)],
    );
    expect(outcomes[0].verdict).toBe('too_early');
  });
});

describe('what a product is for', () => {
  it('never treats an inert ingredient as the target', () => {
    // Water is first in almost every real ingredient list, and its family is
    // `texture`. Reading position as concentration once made every product in
    // the routine a texture treatment.
    const outcomes = evaluateRoutine(
      [scan(40, { hydration: 40 }), scan(0, { hydration: 60 })],
      [usage('Serum', ['Aqua', 'Niacinamide'], 40)],
    );
    expect(outcomes[0].metric).toBe('hydration');
  });

  it('separates "not scored" from "not recognised"', () => {
    const history = [scan(40), scan(0)];
    const spf = evaluateRoutine(history, [usage('SPF', ['Zinc Oxide'], 40)])[0];
    const junk = evaluateRoutine(history, [usage('Mystery', ['Unobtanium'], 40)])[0];
    expect(spf.verdict).toBe('not_scored');
    expect(junk.verdict).toBe('unrecognised');
  });

  it('maps no inert or unscored family to a metric', () => {
    for (const family of ['solvent', 'preservative', 'texture', 'fragrance', 'spf', 'occlusive']) {
      expect(FAMILY_TARGETS[family as keyof typeof FAMILY_TARGETS]).toBeUndefined();
    }
  });
});

describe('model versions never mix', () => {
  it('excludes scans from another version of the analysis', () => {
    // A huge apparent improvement that exists only because the formula changed.
    const outcomes = evaluateRoutine(
      [scan(40, { texture: 90 }, 'v0'), scan(20, { texture: 50 }), scan(0, { texture: 48 })],
      [usage('Retinal', ['Retinaldehyde'], 40)],
    );
    // 90 -> 48 would read as a triumph; 50 -> 48 is inside the floor.
    expect(outcomes[0].verdict).toBe('no_evidence');
  });

  it('flags a mixed history in the summary', () => {
    const summary = summarise([scan(40, {}, 'v0'), scan(20), scan(0)]);
    expect(summary.mixedModelVersions).toBe(true);
  });
});

describe('summary honesty', () => {
  it('says nothing moved rather than inventing a headline', () => {
    const summary = summarise([scan(40), scan(20), scan(0)]);
    expect(summary.headline).toMatch(/nothing moved/i);
  });

  it('reports a decline as readily as an improvement', () => {
    const summary = summarise([scan(20, { redness: 40 }), scan(0, { redness: 60 })]);
    expect(summary.headline).toMatch(/wrong way/i);
  });

  it('never claims a trend from one scan', () => {
    const summary = summarise([scan(0, { redness: 90 })]);
    expect(summary.headline).toBeNull();
  });
});

describe('metric direction table', () => {
  it('covers every metric', () => {
    // A missing entry defaults to falsy, which silently inverts a verdict:
    // an improvement would be reported as a decline.
    for (const key of SKIN_METRIC_KEYS) {
      expect(typeof METRIC_HIGHER_IS_BETTER[key]).toBe('boolean');
    }
  });
});

describe('the painted mouth chart', () => {
  it('has a mouth for every viseme the speech engine can emit', async () => {
    // The sprite avatar quantises continuous visemes onto painted mouths. A
    // viseme with no entry would throw at runtime mid-sentence.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/character/sprite-avatar.ts', 'utf8');
    const block = source.slice(
      source.indexOf('const VISEME_MOUTH'),
      source.indexOf('};', source.indexOf('const VISEME_MOUTH')),
    );
    for (const viseme of VISEMES) {
      expect(block).toMatch(new RegExp(`\\b${viseme}\\s*:`));
    }
  });
});

describe('a capture the app cannot read is refused, not measured', () => {
  /*
   * The failure this guards against, in the exact shape it took: a dark frame
   * produced texture 100, dark spots 100 and oiliness 0 — every signal pinned
   * to an extreme — and the readout printed them as findings with a progress
   * bar under each one. Sensor noise in a dark room is not bad skin, and the
   * difference between "uncertain" and "wrong" is the whole product.
   */
  /*
   * Pixels, not fractions — `assessCapture` divides by the image dimensions
   * itself. Written as fractions the first time, which made every fixture score
   * zero for being "far away" and "cut off", so the dark-frame tests passed for
   * a reason that had nothing to do with darkness.
   */
  const SIZE = 128;
  const face = { x: 32, y: 20, width: 64, height: 78, confidence: 0.95 };

  function frame(level: number, noisy: boolean): ImageData {
    const size = SIZE;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      // Noise is what a dark, high-ISO photograph actually looks like, and it
      // is what drives the texture and dark-spot signals to their ceilings.
      const jitter = noisy ? (Math.random() - 0.5) * 90 : 0;
      const v = Math.max(0, Math.min(255, level * 255 + jitter));
      data[i * 4] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    return { data, width: size, height: size, colorSpace: 'srgb' } as ImageData;
  }

  it('refuses a dark frame outright', () => {
    const quality = assessCapture(frame(0.08, true), face);
    expect(quality.verdict).toBe('fail');
    expect(quality.issues.join(' ')).toContain('dark');
  });

  it('says the same thing it acts on', () => {
    // The sentence the user reads and the decision to stop must come from one
    // threshold. If they drift, the app tells someone it is too dark and then
    // measures it anyway.
    const quality = assessCapture(frame(0.1, true), face);
    expect(quality.verdict).toBe('fail');
    expect(quality.issues.some((i) => i.includes('dark'))).toBe(true);
  });

  it('still accepts a normally lit frame with detail in it', () => {
    /*
     * The gate has to refuse the unusable without refusing the ordinary.
     *
     * Structured detail rather than flat grey, because a flat field has no
     * edges and is therefore genuinely blurry by any sharpness measure — the
     * first version of this test asserted that an image with no information in
     * it should pass, which is the opposite of the point.
     */
    const size = SIZE;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const v = 110 + ((x >> 2) % 2 === (y >> 2) % 2 ? 26 : -26);
        data[i] = v + 18;
        data[i + 1] = v;
        data[i + 2] = v - 6;
        data[i + 3] = 255;
      }
    }
    const lit = { data, width: size, height: size, colorSpace: 'srgb' } as ImageData;
    expect(assessCapture(lit, face).verdict).not.toBe('fail');
  });
});
