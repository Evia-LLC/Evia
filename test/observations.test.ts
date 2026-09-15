/**
 * What the readout is allowed to say it saw.
 *
 * The number is not the finding. "Pores 49" cannot be interpreted by the person
 * reading it — 49 against what? — and printing it in large type claims a
 * precision the measurement does not have. These tests pin the three rules that
 * make the replacement honest rather than merely gentler: bands wide enough to
 * survive noise, a pinned scale reported as out of range instead of as an
 * extreme, and a location claimed only where one was actually measured.
 */
import { describe, expect, it } from 'vitest';

import {
  EXPLANATION,
  observationsFor,
  severityFor,
  locusFor,
} from '../src/skin-analysis/observations.ts';
import type { FaceRegionKey, RegionStats, SkinAppearanceMetrics } from '../shared/types.ts';

function stats(over: Partial<RegionStats> = {}): RegionStats {
  return {
    samples: 4000,
    L: 62,
    a: 8,
    b: 14,
    sigmaL: 3,
    specular: 0.02,
    highFreq: 2,
    darkFraction: 0.01,
    ...over,
  } as RegionStats;
}

const METRICS: SkinAppearanceMetrics = {
  hydration: 70,
  oiliness: 40,
  redness: 30,
  texture: 35,
  pores: 45,
  darkSpots: 20,
  evenness: 65,
  underEye: 30,
  acneIndicators: 15,
};

describe('a pinned scale is reported as out of range, not as an extreme', () => {
  it('does not call a clamped reading "marked"', () => {
    /*
     * The failure this exists for. Every metric is clamped to 0-100, so a
     * reading at the concerning extreme means the raw signal ran past the end
     * of the calibrated range — which is "outside what this can describe", not
     * "the worst skin possible". A painted illustration produced Oiliness 100,
     * and the readout printed it as a finding in 96px type.
     */
    expect(severityFor('oiliness', 100).severity).toBe('beyond-range');
    expect(severityFor('texture', 100).severity).toBe('beyond-range');
  });

  it('catches it at the good end too, for metrics that run the other way', () => {
    // Evenness is better when high, so 0 is the pinned, concerning end.
    expect(severityFor('evenness', 0).severity).toBe('beyond-range');
    expect(severityFor('hydration', 0).severity).toBe('beyond-range');
  });

  it('does not mistake a genuinely good reading for a broken one', () => {
    // Redness 0 is the *unconcerning* extreme: nothing was detected.
    expect(severityFor('redness', 0).severity).toBe('clear');
    expect(severityFor('evenness', 100).severity).toBe('clear');
  });

  it('says so in a word short enough to print where the number was', () => {
    // And "Off scale" is deliberately paired with EXPLANATION, because alone it
    // reads as "off the scale bad" — the opposite of "I decline to say".
    expect(severityFor('oiliness', 100).severityLabel).toBe('Off scale');
    expect(EXPLANATION['beyond-range']).toContain('no number');
  });
});

describe('bands are wider than the measurement error', () => {
  it('does not change word for a change inside the noise floor', () => {
    // The widest skin noise floor is 8 points. A band that could flip inside
    // that would make the wording jitter between two scans of the same face.
    for (const start of [30, 55, 80]) {
      expect(severityFor('oiliness', start).severity).toBe(
        severityFor('oiliness', start + 8).severity,
      );
    }
  });

  it('still separates the ends', () => {
    expect(severityFor('oiliness', 10).severity).toBe('clear');
    expect(severityFor('oiliness', 40).severity).toBe('slight');
    expect(severityFor('oiliness', 60).severity).toBe('moderate');
    expect(severityFor('oiliness', 85).severity).toBe('marked');
  });
});

describe('a location is claimed only where one was measured', () => {
  const T_ZONE_OILY: Partial<Record<FaceRegionKey, RegionStats>> = {
    forehead: stats({ specular: 0.09 }),
    glabella: stats({ specular: 0.085 }),
    nose: stats({ specular: 0.095 }),
    cheekLeft: stats({ specular: 0.012 }),
    cheekRight: stats({ specular: 0.011 }),
  };

  it('names the T-zone when the T-zone is where it is', () => {
    expect(locusFor('oiliness', T_ZONE_OILY)).toBe('Most visible across the T-zone.');
  });

  it('names the cheeks when the cheeks lead', () => {
    const cheeky: Partial<Record<FaceRegionKey, RegionStats>> = {
      cheekLeft: stats({ a: 17 }),
      cheekRight: stats({ a: 16.5 }),
      nose: stats({ a: 7 }),
      chin: stats({ a: 6.5 }),
    };
    expect(locusFor('redness', cheeky)).toBe('Most visible on the cheeks.');
  });

  it('says "fairly even" rather than inventing a hotspot', () => {
    /*
     * A face is never uniform, so the highest region is always higher than the
     * mean. Naming it regardless would attach a confident location to a reading
     * that is actually even — which reads as insight and is noise.
     */
    const even: Partial<Record<FaceRegionKey, RegionStats>> = {
      forehead: stats({ specular: 0.041 }),
      glabella: stats({ specular: 0.039 }),
      nose: stats({ specular: 0.04 }),
      cheekLeft: stats({ specular: 0.038 }),
      cheekRight: stats({ specular: 0.042 }),
    };
    expect(locusFor('oiliness', even)).toBe('Fairly even across the face.');
  });

  it('claims nothing for metrics with no per-region signal', () => {
    // pores and acneIndicators come from whole-image passes; evenness is the
    // spread *between* regions. None of the three has a "where".
    expect(locusFor('pores', T_ZONE_OILY)).toBeNull();
    expect(locusFor('acneIndicators', T_ZONE_OILY)).toBeNull();
    expect(locusFor('evenness', T_ZONE_OILY)).toBeNull();
  });

  it('claims nothing when the regions were not measured', () => {
    expect(locusFor('oiliness', {})).toBeNull();
    expect(locusFor('oiliness', { nose: stats() })).toBeNull();
  });
});

describe('the whole readout', () => {
  it('describes every metric without leading with a number', () => {
    const out = observationsFor(METRICS, { forehead: stats(), cheekLeft: stats() });
    expect(out).toHaveLength(Object.keys(METRICS).length);
    for (const o of out) {
      expect(o.severityLabel.length).toBeGreaterThan(0);
      // The number survives for the trend, but it is not the finding.
      expect(typeof o.value).toBe('number');
    }
  });

  it('gives a clear reading nowhere to be', () => {
    // "Not detected, most visible on the cheeks" is a contradiction.
    const out = observationsFor({ ...METRICS, redness: 2 }, {
      cheekLeft: stats({ a: 20 }),
      cheekRight: stats({ a: 19 }),
      nose: stats({ a: 6 }),
      chin: stats({ a: 6 }),
    });
    const redness = out.find((o) => o.key === 'redness')!;
    expect(redness.severity).toBe('clear');
    expect(redness.locus).toBeNull();
  });
});
