import type { Viseme } from '@shared/types.ts';

export interface SpeechBoneOffset {
  readonly bone: string;
  /** C6 model-space metres: +X character left, +Y up, +Z forward. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MetaHumanSpeechPose {
  /** Model-X rotation, in radians, shared by jaw and lower-lip rotation. */
  readonly jaw: number;
  readonly offsets: readonly SpeechBoneOffset[];
}

/** Track these rest positions before applying any speech deformation. The
 * upper groups and corners are siblings under FACIAL_C_MouthUpper. The lower
 * groups are siblings under FACIAL_C_MouthLower, itself a descendant of the
 * already-rotated FACIAL_C_LowerLipRotation. Do not also translate their parent. */
export const SPEECH_POSE_BONES = [
  'FACIAL_C_LipUpper', 'FACIAL_C_LipLower',
  'FACIAL_L_LipCorner', 'FACIAL_R_LipCorner',
  'FACIAL_L_LipUpper', 'FACIAL_R_LipUpper',
  'FACIAL_L_LipLower', 'FACIAL_R_LipLower',
  'FACIAL_L_LipUpperOuter', 'FACIAL_R_LipUpperOuter',
  'FACIAL_L_LipLowerOuter', 'FACIAL_R_LipLowerOuter',
] as const;

interface Shape {
  jaw: number;
  /** Signed corner displacement: positive spreads, negative rounds. */
  width: number;
  forward: number;
  upper: number;
  lower: number;
  lowerBack?: number;
}

// Measured C6 corner span: 51.74 mm. The centre contact anchors are 1.47 mm
// apart at rest. Width offsets stay below 4.3% of that span per side; vertical
// offsets stay below 0.7 mm. These are modest authored approximations, not
// phonetic blendshapes recovered from the source, which contains none.
const SHAPES: Record<Exclude<Viseme, 'sil' | 'MBP'>, Shape> = {
  AA: { jaw: 0.12, width: -0.0003, forward: 0, upper: 0.00065, lower: 0 },
  EE: { jaw: 0.05, width: 0.002, forward: -0.00015, upper: 0.00055, lower: -0.0003 },
  IH: { jaw: 0.08, width: 0.00065, forward: 0, upper: 0.0003, lower: 0 },
  OH: { jaw: 0.11, width: -0.0018, forward: 0.0011, upper: 0.00025, lower: -0.0002 },
  OU: { jaw: 0.055, width: -0.0022, forward: 0.0015, upper: 0.00015, lower: -0.0001 },
  FV: { jaw: 0.015, width: -0.0002, forward: 0, upper: 0, lower: 0.00065, lowerBack: -0.00075 },
  L: { jaw: 0.045, width: 0.00025, forward: 0, upper: 0.0002, lower: 0 },
  S: { jaw: 0.02, width: 0.0009, forward: -0.0001, upper: 0.0002, lower: 0 },
};

const REST: MetaHumanSpeechPose = Object.freeze({ jaw: 0, offsets: Object.freeze([]) });

/** Pure pose sampling. The caller owns the clock, interpolation and rest reset.
 * Silence and lip-closure consonants win even if the audio envelope is loud. */
export function metaHumanSpeechPose(viseme: Viseme, weight: number): MetaHumanSpeechPose {
  const strength = Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0;
  if (!strength || viseme === 'sil' || viseme === 'MBP' || !Object.hasOwn(SHAPES, viseme)) return REST;
  const shape = SHAPES[viseme as keyof typeof SHAPES];
  const offsets: SpeechBoneOffset[] = [];
  const add = (bone: string, x: number, y: number, z: number) => offsets.push({ bone, x: x * strength, y: y * strength, z: z * strength });
  add('FACIAL_C_LipUpper', 0, shape.upper, shape.forward);
  add('FACIAL_C_LipLower', 0, shape.lower, shape.forward + (shape.lowerBack ?? 0));
  for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
    add(`FACIAL_${side}_LipCorner`, sign * shape.width, 0, shape.forward * 0.35);
    // Spread a graded deformation across adjacent lip groups so the corners
    // do not stretch away from a stationary centre. No overlapping ancestors.
    for (const [part, fraction] of [['', 0.45], ['Outer', 0.75]] as const) {
      add(`FACIAL_${side}_LipUpper${part}`, sign * shape.width * fraction, shape.upper * 0.65, shape.forward * 0.75);
      add(`FACIAL_${side}_LipLower${part}`, sign * shape.width * fraction, shape.lower * 0.65, (shape.forward + (shape.lowerBack ?? 0)) * 0.75);
    }
  }
  return { jaw: shape.jaw * strength, offsets };
}
