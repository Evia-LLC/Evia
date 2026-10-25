import { describe, expect, it } from 'vitest';
import { metaHumanSpeechPose, SPEECH_POSE_BONES } from '../src/character/metahuman-speech-pose.ts';

describe('C6 speech pose', () => {
  it('keeps silence and MBP closed and rejects nonfinite strengths', () => {
    for (const viseme of ['sil', 'MBP'] as const) {
      for (const weight of [0, 0.5, 1, 5, Number.NaN, Infinity]) {
        expect(metaHumanSpeechPose(viseme, weight)).toEqual({ jaw: 0, offsets: [] });
      }
    }
    for (const weight of [-1, Number.NaN, Infinity, -Infinity]) {
      expect(metaHumanSpeechPose('AA', weight)).toEqual({ jaw: 0, offsets: [] });
    }
  });

  it('distinguishes rounded, spread and lower-lip consonant forms', () => {
    const find = (viseme: 'EE' | 'OU' | 'FV', bone: string) => metaHumanSpeechPose(viseme, 1).offsets.find((offset) => offset.bone === bone)!;
    expect(find('EE', 'FACIAL_L_LipCorner').x).toBeGreaterThan(0);
    expect(find('OU', 'FACIAL_L_LipCorner').x).toBeLessThan(0);
    expect(find('OU', 'FACIAL_C_LipUpper').z).toBeGreaterThan(0);
    expect(find('FV', 'FACIAL_C_LipLower').y).toBeGreaterThan(0);
    expect(find('FV', 'FACIAL_C_LipLower').z).toBeLessThan(0);
    expect(find('FV', 'FACIAL_C_LipUpper').y).toBe(0);
  });

  it('bounds every deformation and gives the integrator every reset bone', () => {
    for (const viseme of ['AA', 'EE', 'IH', 'OH', 'OU', 'FV', 'L', 'S'] as const) {
      const full = metaHumanSpeechPose(viseme, 1);
      const half = metaHumanSpeechPose(viseme, 0.5);
      expect(full.jaw).toBeGreaterThanOrEqual(0);
      expect(full.jaw).toBeLessThanOrEqual(0.12);
      expect(half.jaw).toBeCloseTo(full.jaw / 2);
      expect(new Set(full.offsets.map((offset) => offset.bone)).size).toBe(full.offsets.length);
      for (let i = 0; i < full.offsets.length; i++) {
        const offset = full.offsets[i];
        expect(SPEECH_POSE_BONES).toContain(offset.bone);
        expect(Math.hypot(offset.x, offset.y, offset.z)).toBeLessThan(0.0024);
        for (const axis of ['x', 'y', 'z'] as const) expect(half.offsets[i][axis]).toBeCloseTo(offset[axis] / 2);
      }
    }
  });
});
