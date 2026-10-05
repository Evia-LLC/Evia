/**
 * A synthetic reading for the consult tour's tests: its region statistics put texture on the forehead,
 * redness on the cheeks, under-eye darkness under the eyes and dark spots on the chin (pores, breakout
 * signs and tone evenness have no place). Not anyone's reading.
 */
import type { FaceRegionKey, RegionStats, SkinAnalysis, SkinAppearanceMetrics } from '../../shared/types.ts';

const REGIONS: FaceRegionKey[] = ['forehead', 'glabella', 'nose', 'cheekLeft', 'cheekRight', 'periorbitalLeft', 'periorbitalRight', 'perioral', 'chin'];

export function placedAnalysis(metrics: Partial<SkinAppearanceMetrics> = {}): SkinAnalysis {
  const base: RegionStats = { samples: 500, L: 62, a: 11, b: 16, sigmaL: 5, specular: 0.08, highFreq: 0.2, darkFraction: 0.04 };
  const regions = Object.fromEntries(REGIONS.map((r) => [r, { ...base }])) as Record<FaceRegionKey, RegionStats>;
  regions.forehead.sigmaL = 12;
  regions.cheekLeft.a = 26;
  regions.cheekRight.a = 25;
  regions.periorbitalLeft.L = 34;
  regions.periorbitalRight.L = 35;
  regions.chin.darkFraction = 0.2;
  return {
    id: 'scan-1',
    capturedAt: '2026-09-26T10:00:00.000Z',
    metrics: { hydration: 60, oiliness: 30, redness: 62, texture: 70, pores: 55, darkSpots: 58, evenness: 70, underEye: 56, acneIndicators: 20, ...metrics },
    regions,
    confidence: 0.8,
    quality: { brightness: 0.5, sharpness: 0.8, faceHeightFraction: 0.6, centeringError: 0.1, issues: [] },
    modelVersion: 'elohim-skin-1.0.0',
    imageStored: false,
  } as unknown as SkinAnalysis;
}

