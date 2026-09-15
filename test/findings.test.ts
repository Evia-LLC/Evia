/**
 * What the display is allowed to claim it found.
 *
 * The readouts used to be a template: three metrics pinned in place for
 * everyone, the rest filled from a default list, and seven fixed zone labels.
 * A person with clear skin was shown "Chin · Breakout signs · 22" as a finding,
 * which is a display describing itself rather than a face.
 *
 * These tests pin the property that replaced it — that a finding has to be true
 * of *this* scan — including the case that used to be impossible to express:
 * that there is nothing to report.
 */
import { describe, expect, it } from 'vitest';

import {
  METRIC_HIGHER_IS_BETTER,
  METRIC_NOISE_FLOOR,
  SKIN_METRIC_KEYS,
  type SkinAnalysis,
  type SkinAppearanceMetrics,
} from '../shared/types.ts';
import {
  hasIssues,
  headlineOf,
  selectFindings,
  selectPresented,
  SLOT_COUNT,
} from '../src/holograms/presented.ts';

/** Builds a scan where every metric reads at `goodness` on its own scale. */
function at(goodness: number, overrides: Partial<Record<string, number>> = {}): SkinAnalysis {
  const metrics = {} as SkinAppearanceMetrics;
  for (const key of SKIN_METRIC_KEYS) {
    metrics[key] = METRIC_HIGHER_IS_BETTER[key] ? goodness : 100 - goodness;
  }
  for (const [key, value] of Object.entries(overrides)) {
    metrics[key as keyof SkinAppearanceMetrics] = value;
  }
  return {
    id: 'scan',
    capturedAt: new Date().toISOString(),
    metrics,
    regions: {},
    quality: { score: 0.85, lighting: 0.8, sharpness: 0.85, framing: 0.9 } as SkinAnalysis['quality'],
    confidence: 0.8,
    modelVersion: 'v1',
  };
}

describe('a clear face', () => {
  it('produces no findings at all', () => {
    // Everything comfortably good, nothing to say.
    expect(selectFindings(at(72), null)).toEqual([]);
  });

  it('produces no headline, rather than picking one anyway', () => {
    const clear = at(72);
    expect(headlineOf(selectPresented(clear, null), clear, null)).toBeNull();
  });

  it('does not invent a finding from a merely average reading', () => {
    // 64 is unremarkable, not a concern. Flagging it is how an app teaches
    // people to find fault with a face that is fine.
    expect(selectFindings(at(64), null)).toEqual([]);
  });
});

describe('only what is true of this face', () => {
  it('reports a genuinely poor reading', () => {
    // Oiliness is lower-is-better, so 85 is bad.
    const found = selectFindings(at(72, { oiliness: 85 }), null);
    expect(found.map((f) => f.key)).toContain('oiliness');
  });

  it('does not report a metric that is fine', () => {
    const found = selectFindings(at(72, { oiliness: 85 }), null);
    // Breakouts at 28/100 is clear skin. It used to be shown regardless.
    expect(found.map((f) => f.key)).not.toContain('acneIndicators');
  });

  it('reports movement past the noise floor even when the reading is fine', () => {
    const before = at(72);
    const after = at(72, {
      hydration: before.metrics.hydration + METRIC_NOISE_FLOOR.hydration + 3,
    });
    const found = selectFindings(after, before);
    expect(found.map((f) => f.key)).toContain('hydration');
    expect(found.find((f) => f.key === 'hydration')?.kind).toBe('movement');
  });

  it('ignores movement inside the noise floor', () => {
    const before = at(72);
    const after = at(72, {
      hydration: before.metrics.hydration + METRIC_NOISE_FLOOR.hydration - 1,
    });
    expect(selectFindings(after, before)).toEqual([]);
  });

  it('never returns more than the display has room for', () => {
    // Every metric terrible: still capped, still ordered worst-first.
    const found = selectFindings(at(10), null);
    expect(found.length).toBeLessThanOrEqual(SLOT_COUNT);
    for (let i = 1; i < found.length; i++) {
      expect(found[i - 1].weight).toBeGreaterThanOrEqual(found[i].weight);
    }
  });

  it('gives each metric one row, however many ways it qualifies', () => {
    // Bad *and* moved: one finding, not two.
    const before = at(72);
    const after = at(72, { oiliness: 90 });
    const found = selectFindings(after, before);
    const keys = found.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ranks a change above a static reading', () => {
    // Oiliness is poor in *both* scans, so it is a standing condition rather
    // than news. Setting it high only in the second would make it the largest
    // movement in the scan, which would rightly outrank everything.
    const before = at(72, { oiliness: 66 });
    const after = at(72, {
      oiliness: 66,
      redness: before.metrics.redness - METRIC_NOISE_FLOOR.redness - 6,
    });
    const found = selectFindings(after, before);
    expect(found[0].key).toBe('redness');
    expect(found[0].kind).toBe('movement');
    // The standing concern is still reported, just not led with.
    expect(found.map((f) => f.key)).toContain('oiliness');
  });
});

describe('a face with only good news', () => {
  // Several readings excellent, none poor, nothing moved.
  const excellent = at(72, { darkSpots: 12, acneIndicators: 14, evenness: 86 });

  it('reports no issues', () => {
    expect(hasIssues(selectFindings(excellent, null))).toBe(false);
  });

  it('mentions at most two strengths rather than filling the display', () => {
    const found = selectFindings(excellent, null);
    expect(found.length).toBeLessThanOrEqual(2);
    expect(found.every((f) => f.kind === 'strength')).toBe(true);
  });

  it('still leads with a concern when there is one', () => {
    const mixed = selectFindings(at(72, { darkSpots: 12, oiliness: 88 }), null);
    expect(hasIssues(mixed)).toBe(true);
    expect(mixed[0].key).toBe('oiliness');
  });
});

describe('before the first scan', () => {
  it('presents nothing', () => {
    expect(selectPresented(null, null)).toEqual([]);
  });
});
