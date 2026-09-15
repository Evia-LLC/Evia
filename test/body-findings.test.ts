/**
 * What the body readout is allowed to call a problem.
 *
 * The rule that matters: a proportion is not a defect. Shoulder-to-hip and
 * waist-to-shoulder describe build, and build has no correct value — so they
 * are reportable only when they change. Get this wrong and the app tells people
 * their skeleton is the wrong shape.
 */
import { describe, expect, it } from 'vitest';

import { BODY_NOISE_FLOOR, type BodyMetrics } from '../src/body-analysis/metrics.ts';
import {
  bodyAverage,
  hasBodyIssues,
  selectBodyFindings,
  type BodyReadingInput,
} from '../src/body-analysis/findings.ts';

const GOOD: BodyMetrics = {
  shoulderHipRatio: 70,
  waistRatio: 68,
  shoulderTilt: 88,
  hipTilt: 86,
  headForward: 84,
  postureAlignment: 87,
};

/**
 * A whole body reading, posture-only by default.
 *
 * `profile: null` is the front-only scan — no side view was taken, so there is
 * no abdominal depth and the readout must not invent one.
 */
const at = (
  o: Partial<BodyMetrics> = {},
  extra: Partial<Omit<BodyReadingInput, 'metrics'>> = {},
): BodyReadingInput => ({
  metrics: { ...GOOD, ...o },
  waistSource: 'silhouette',
  profile: null,
  ...extra,
});

describe('proportions are never a fault', () => {
  it('does not flag a narrow build', () => {
    const found = selectBodyFindings(at({ shoulderHipRatio: 12 }), null);
    expect(found.map((f) => f.key)).not.toContain('shoulderHipRatio');
  });

  it('does not flag a wide waist ratio on its own', () => {
    const found = selectBodyFindings(at({ waistRatio: 8 }), null);
    expect(found.map((f) => f.key)).not.toContain('waistRatio');
  });

  it('does report a proportion that changed', () => {
    const before = at({ waistRatio: 40 });
    const after = at({ waistRatio: 40 + BODY_NOISE_FLOOR.waistRatio + 4 });
    const found = selectBodyFindings(after, before);
    expect(found.map((f) => f.key)).toContain('waistRatio');
    expect(found.find((f) => f.key === 'waistRatio')?.kind).toBe('movement');
  });
});

describe('posture can be flagged on its own', () => {
  it('reports an uneven shoulder line', () => {
    const found = selectBodyFindings(at({ shoulderTilt: 30 }), null);
    expect(found.map((f) => f.key)).toContain('shoulderTilt');
  });

  it('reports a forward head', () => {
    const found = selectBodyFindings(at({ headForward: 26 }), null);
    expect(found.find((f) => f.key === 'headForward')?.kind).toBe('concern');
  });

  it('says nothing about a good posture', () => {
    expect(selectBodyFindings(at(), null)).toEqual([]);
    expect(hasBodyIssues(selectBodyFindings(at(), null))).toBe(false);
  });
});

describe('honesty about precision', () => {
  it('ignores movement inside the noise floor', () => {
    const before = at({ shoulderTilt: 60 });
    const after = at({ shoulderTilt: 60 + BODY_NOISE_FLOOR.shoulderTilt - 1 });
    const moved = selectBodyFindings(after, before).filter((f) => f.kind === 'movement');
    expect(moved).toEqual([]);
  });

  it('scores the all-clear from posture only, not from build', () => {
    // A very narrow build with excellent posture is still excellent posture.
    const narrow = bodyAverage(at({ shoulderHipRatio: 5, waistRatio: 5 }).metrics);
    const broad = bodyAverage(at({ shoulderHipRatio: 95, waistRatio: 95 }).metrics);
    expect(narrow).toBe(broad);
  });
});
