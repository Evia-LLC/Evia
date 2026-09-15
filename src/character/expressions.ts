/**
 * Expression and state pose targets.
 *
 * Every value here is a *target* the rig damps towards, never a value it snaps
 * to. That is most of what separates "believable" from "puppet".
 *
 * Two rules learned the hard way and encoded here:
 *
 * 1. **A smile lives in the eyes.** A mouth curve on its own reads as a mask.
 *    Every positive expression therefore also carries `lidSquint` and
 *    `cheekRaise` — the orbicularis oculi contraction that separates a real
 *    smile from a polite one. Nothing in the happy family has squint 0.
 * 2. **Faces are not symmetric.** Every pose that can afford it carries a small
 *    `browAsymmetry` / `mouthAsymmetry`, and the rig layers a further constant
 *    idiosyncratic asymmetry on top. Perfect bilateral symmetry is the single
 *    loudest "this is a 3D model" tell there is.
 *
 * Distances are metres on a head ~0.19 m wide, so 0.004 is a *visible* brow
 * move and 0.012 is near the top of human range.
 */
import type { CharacterState, Expression, Gesture, Viseme } from '@shared/types.ts';

export interface FacePose {
  /** Inner brow-end raise, metres. Up = worry/plea, down = anger/effort. */
  browInner: number;
  /** Outer brow-end raise, metres. Up = surprise/interest. */
  browOuter: number;
  /** Extra raise applied to her left brow only — reads as curiosity/doubt. */
  browAsymmetry: number;
  /** Upper lid, 0 = closed, 1 = neutral open, >1 = widened. */
  lidOpen: number;
  /** Lower lid raise, 0..1. The Duchenne channel — this is what sells a smile. */
  lidSquint: number;
  /** Cheek mass lift, 0..1. Pushes the lower lid and the mouth corners. */
  cheekRaise: number;
  /** Mouth corner lift in metres. Negative turns it down. */
  mouthCurve: number;
  /** Horizontal mouth scale multiplier. */
  mouthWidth: number;
  /** Jaw opening, 0..1, before visemes are layered on. */
  mouthOpen: number;
  /** Lip compression, 0..1. Thins the lips — restraint, doubt, effort. */
  mouthPress: number;
  /** Extra lift of her left mouth corner, metres. Smirk / wry. */
  mouthAsymmetry: number;
  /** Head roll in radians. */
  headTilt: number;
}

const BASE: FacePose = {
  browInner: 0,
  browOuter: 0,
  browAsymmetry: 0,
  lidOpen: 1,
  lidSquint: 0,
  cheekRaise: 0,
  mouthCurve: 0,
  mouthWidth: 1,
  mouthOpen: 0.015,
  mouthPress: 0,
  mouthAsymmetry: 0,
  headTilt: 0,
};

export const EXPRESSION_POSES: Record<Expression, FacePose> = {
  /** Not "blank": a resting face still has a little tone in it. */
  neutral: { ...BASE, lidOpen: 0.98, mouthPress: 0.08 },

  /** Her default. Closed, soft, and it reaches the eyes — that is the point. */
  warm: {
    ...BASE,
    browOuter: 0.0012,
    lidOpen: 0.94,
    lidSquint: 0.2,
    cheekRaise: 0.28,
    mouthCurve: 0.0042,
    mouthWidth: 1.05,
    mouthAsymmetry: 0.0008,
  },

  smile: {
    ...BASE,
    browInner: 0.001,
    browOuter: 0.0018,
    lidOpen: 0.86,
    lidSquint: 0.45,
    cheekRaise: 0.62,
    mouthCurve: 0.0088,
    mouthWidth: 1.13,
    mouthOpen: 0.03,
    mouthAsymmetry: 0.0016,
    headTilt: 0.022,
  },

  /** Open, teeth-adjacent, eyes nearly shut. Distinct from `smile` by degree. */
  grin: {
    ...BASE,
    browInner: 0.0018,
    browOuter: 0.0032,
    lidOpen: 0.7,
    lidSquint: 0.72,
    cheekRaise: 0.9,
    mouthCurve: 0.0132,
    mouthWidth: 1.22,
    mouthOpen: 0.26,
    mouthAsymmetry: 0.0022,
    headTilt: 0.03,
  },

  /** Inner brows *up*, outer down. The one shape you cannot fake with a frown. */
  concerned: {
    ...BASE,
    browInner: 0.0052,
    browOuter: -0.0028,
    browAsymmetry: -0.0009,
    lidOpen: 0.93,
    lidSquint: 0.14,
    mouthCurve: -0.0042,
    mouthWidth: 0.95,
    mouthPress: 0.4,
    mouthOpen: 0.005,
    headTilt: 0.055,
  },

  /** One brow noticeably higher, head cocked the other way. */
  curious: {
    ...BASE,
    browInner: 0.0022,
    browOuter: 0.0048,
    browAsymmetry: 0.0055,
    lidOpen: 1.06,
    lidSquint: 0.06,
    mouthCurve: 0.0022,
    mouthWidth: 0.97,
    mouthAsymmetry: 0.0026,
    headTilt: -0.105,
  },

  /** Warm, but with the inner-brow tilt that makes warmth read as *care*. */
  reassuring: {
    ...BASE,
    browInner: 0.0034,
    browOuter: 0.0008,
    lidOpen: 0.9,
    lidSquint: 0.34,
    cheekRaise: 0.5,
    mouthCurve: 0.0068,
    mouthWidth: 1.07,
    mouthAsymmetry: 0.0007,
    headTilt: 0.032,
  },

  /** Brows down and drawn in, lids narrowed, lips pressed. Work, not anger. */
  focused: {
    ...BASE,
    browInner: -0.0042,
    browOuter: -0.0016,
    lidOpen: 0.84,
    lidSquint: 0.3,
    mouthWidth: 0.93,
    mouthPress: 0.55,
    mouthOpen: 0,
    headTilt: -0.012,
  },

  /** The only pose with zero squint — surprise opens everything at once. */
  surprised: {
    ...BASE,
    browInner: 0.0085,
    browOuter: 0.0105,
    browAsymmetry: 0.0012,
    lidOpen: 1.22,
    lidSquint: 0,
    mouthOpen: 0.34,
    mouthWidth: 0.89,
    headTilt: -0.02,
  },
};

export interface BodyPose {
  /** Forward lean in radians at the spine. */
  lean: number;
  /** Axial twist of the chest in radians. Positive turns her left shoulder back. */
  chestTwist: number;
  /** Head yaw bias in radians — where she is naturally oriented. */
  headYaw: number;
  headPitch: number;
  /** State-level head roll, on top of whatever the expression asks for. */
  headTilt: number;
  /** Shoulder raise in metres. Up = tension, guarding, excitement. */
  shoulder: number;
  /** Resting eye offset, -1..1, before any gaze target. Thinking looks away. */
  gazeBiasX: number;
  gazeBiasY: number;
  /** Breaths per second and depth multiplier. 0.22 Hz is calm adult resting. */
  breathRate: number;
  breathDepth: number;
  /** Upper-arm rotation targets, radians [pitch, yaw, roll]. */
  armLeft: [number, number, number];
  armRight: [number, number, number];
  elbowLeft: number;
  elbowRight: number;
  /** Multiplier on the idle-motion amplitude for this state. */
  idleScale: number;
}

const REST: BodyPose = {
  lean: 0,
  chestTwist: 0,
  headYaw: 0,
  headPitch: 0,
  headTilt: 0,
  shoulder: 0,
  gazeBiasX: 0,
  gazeBiasY: 0,
  breathRate: 0.22,
  breathDepth: 1,
  // Arms hang slightly away from the ribcage and slightly behind the coronal
  // plane — pinned flat to the sides is the tell of a mannequin.
  armLeft: [0.06, -0.04, 0.15],
  armRight: [0.06, 0.04, -0.15],
  elbowLeft: 0.22,
  elbowRight: 0.2,
  idleScale: 1,
};

export const STATE_POSES: Record<CharacterState, BodyPose> = {
  IDLE: { ...REST },

  /** Weight forward, breathing shallower, gaze steady. Listening is *stiller*. */
  LISTENING: {
    ...REST,
    lean: 0.05,
    headPitch: 0.022,
    headTilt: 0.02,
    breathRate: 0.2,
    breathDepth: 0.85,
    idleScale: 0.62,
  },

  /**
   * Eyes up and off to her left — the single most legible "thinking" cue there
   * is, and worth more than the hand-to-chin it used to rely on.
   */
  THINKING: {
    ...REST,
    headPitch: -0.05,
    headYaw: 0.1,
    headTilt: -0.035,
    chestTwist: -0.03,
    gazeBiasX: 0.55,
    gazeBiasY: 0.45,
    breathRate: 0.18,
    breathDepth: 0.8,
    armRight: [-0.5, 0.22, -0.34],
    elbowRight: 1.15,
    idleScale: 0.55,
  },

  SPEAKING: { ...REST, lean: 0.018, breathRate: 0.3, breathDepth: 0.75, idleScale: 0.92 },

  HAPPY: {
    ...REST,
    lean: 0.026,
    headPitch: -0.028,
    shoulder: 0.008,
    breathRate: 0.27,
    breathDepth: 1.15,
    idleScale: 1.1,
  },

  /** Shoulders slightly up and in, breath slow and deep. Concern is held. */
  CONCERNED: {
    ...REST,
    lean: 0.042,
    headPitch: 0.045,
    headTilt: 0.03,
    shoulder: 0.006,
    breathRate: 0.17,
    breathDepth: 1.25,
    armLeft: [0.02, -0.02, 0.11],
    armRight: [0.02, 0.02, -0.11],
    idleScale: 0.6,
  },

  EXCITED: {
    ...REST,
    lean: 0.048,
    shoulder: 0.014,
    breathRate: 0.36,
    breathDepth: 1.2,
    armLeft: [-0.12, -0.06, 0.24],
    armRight: [-0.12, 0.06, -0.24],
    elbowLeft: 0.4,
    elbowRight: 0.38,
    idleScale: 1.3,
  },

  CONFUSED: {
    ...REST,
    headYaw: -0.12,
    headTilt: -0.06,
    chestTwist: 0.025,
    gazeBiasX: -0.3,
    gazeBiasY: 0.12,
    idleScale: 0.78,
  },

  /** Composed and near-still: the holograms carry this beat, not her body. */
  CLINICAL_ANALYSIS: {
    ...REST,
    lean: -0.008,
    breathRate: 0.19,
    breathDepth: 0.7,
    armLeft: [0.03, -0.03, 0.09],
    armRight: [0.03, 0.03, -0.09],
    elbowLeft: 0.1,
    elbowRight: 0.09,
    idleScale: 0.38,
  },

  /**
   * Presenting the result — a *held* pose, not a passing gesture.
   *
   * This was the rest pose with a slight nod, so the moment the analysis landed
   * she stood with her arms at her sides next to the thing she had just
   * produced. A gesture clip fires over the top of this and then ends; if what
   * it returns to is "arms down", she spends almost all of the explanation
   * looking like she has nothing to do with the hologram beside her.
   *
   * Her left arm is the one that reaches, because the contour model sits to
   * world +x — the viewer's right, and therefore her left.
   */
  ANALYSIS_COMPLETE: {
    ...REST,
    headPitch: -0.018,
    lean: 0.012,
    chestTwist: 0.05,
    // Far enough to actually read as a gesture. At -0.58 the arm lifted about
    // seventeen degrees off the A-pose, which is a shrug rather than a
    // presentation. Still well short of the rotation that breaks the skinning
    // on this rig — that only shows up approaching a radian and a half.
    armLeft: [-0.98, -0.44, 0.3],
    elbowLeft: 0.54,
    armRight: [0.04, 0.02, -0.08],
    elbowRight: 0.22,
    breathDepth: 1.05,
    idleScale: 0.8,
  },

  /** One hand out, chest turned a few degrees into the gesture. */
  EXPLAINING: {
    ...REST,
    lean: 0.016,
    chestTwist: 0.03,
    armLeft: [-0.44, -0.3, 0.42],
    elbowLeft: 0.82,
    armRight: [0.02, 0.04, -0.13],
    elbowRight: 0.3,
    idleScale: 0.95,
  },

  GOODBYE: { ...REST, headPitch: -0.032, headTilt: 0.03, breathDepth: 1.1, idleScale: 0.9 },
};

/**
 * Mouth shape per viseme: [widthMultiplier, openness, roundness, protrusion].
 *
 * Protrusion is the fourth channel the flat-ribbon mouth could not express:
 * OU and OH push the lips physically forward off the face, which is most of
 * what makes a rounded vowel readable in profile.
 */
export const VISEME_SHAPES: Record<Viseme, [number, number, number, number]> = {
  sil: [1.0, 0.015, 0, 0],
  AA: [1.04, 0.85, 0, 0],
  EE: [1.26, 0.32, 0, -0.25],
  IH: [1.12, 0.26, 0, -0.1],
  OH: [0.8, 0.62, 0.72, 0.55],
  OU: [0.66, 0.36, 1.0, 1.0],
  MBP: [0.97, 0.0, 0, 0.15],
  FV: [1.03, 0.13, 0, -0.15],
  L: [1.0, 0.4, 0, 0],
  S: [1.09, 0.11, 0, -0.2],
};

/** Additive offsets over the state pose, so a gesture never fights the posture. */
export interface GestureOffsets {
  headYaw?: number;
  headPitch?: number;
  headTilt?: number;
  lean?: number;
  chestTwist?: number;
  shoulder?: number;
  armRight?: [number, number, number];
  armLeft?: [number, number, number];
  elbowRight?: number;
  elbowLeft?: number;
  /** Gestures may touch the face — a nod without a brow is a bobblehead. */
  browInner?: number;
  browOuter?: number;
  lidOpen?: number;
  mouthCurve?: number;
}

export interface GestureClip {
  duration: number;
  /** Offsets at normalised time t (0..1). */
  sample(t: number): GestureOffsets;
}

/** Half-sine: rises and falls, zero at both ends so a clip never pops. */
const arc = (t: number) => Math.sin(t * Math.PI);

/**
 * Rise fast, fall slow, with a small settle overshoot on the way back. Real
 * limbs do not travel symmetrically and they do not stop dead.
 */
const swing = (t: number) => {
  if (t < 0.32) return Math.sin((t / 0.32) * Math.PI * 0.5);
  const u = (t - 0.32) / 0.68;
  return (1 - u) * Math.cos(u * Math.PI * 1.35) * (1 - 0.18 * u);
};

/** Flat-topped envelope: ramp in, hold, ramp out. For poses that are *held*. */
const hold = (t: number, edge = 0.22) =>
  Math.min(1, t / edge) * Math.min(1, (1 - t) / edge);

export const GESTURE_CLIPS: Record<Gesture, GestureClip | null> = {
  none: null,

  /**
   * Two beats, unequal: the second dip is smaller than the first, and the brows
   * lift on the way up. A nod of identical repeated cycles is a metronome.
   */
  nod: {
    duration: 0.82,
    sample: (t) => {
      const primary = Math.sin(t * Math.PI * 2) * (1 - 0.45 * t);
      return {
        headPitch: primary * 0.062,
        headTilt: arc(t) * 0.012,
        browOuter: Math.max(0, -primary) * 0.0018,
      };
    },
  },

  /** One slow deliberate beat, with the head settling lower than it started. */
  slow_nod: {
    duration: 1.6,
    sample: (t) => ({
      headPitch: Math.sin(t * Math.PI * 2) * 0.052 + arc(t) * 0.014,
      lidOpen: -arc(t) * 0.08,
      browInner: arc(t) * 0.0012,
    }),
  },

  head_tilt: {
    duration: 1.2,
    sample: (t) => ({
      headTilt: swing(t) * 0.115,
      // The head does not roll in isolation; it yaws slightly into the roll.
      headYaw: swing(t) * 0.035,
      browOuter: arc(t) * 0.0022,
    }),
  },

  /**
   * A wave is the arm *out to the side*, not thrust at the camera. The old clip
   * rotated the shoulder forward, which with the longer arms would have put her
   * hand through the lens. Roll raises it laterally; the forearm does the wave.
   */
  small_wave: {
    duration: 1.5,
    sample: (t) => {
      const raise = hold(t, 0.3);
      const flap = Math.sin(t * Math.PI * 4.6) * hold(t, 0.24);
      return {
        armRight: [-0.34 * raise, 0.12 * raise, -0.92 * raise],
        elbowRight: 0.85 * raise + 0.16 * flap,
        headTilt: -arc(t) * 0.05,
        browOuter: arc(t) * 0.0026,
        mouthCurve: arc(t) * 0.0022,
      };
    },
  },

  /** Both palms turn out and up. Shoulders drop as they open — that is the beat. */
  open_palms: {
    duration: 1.55,
    sample: (t) => {
      const a = hold(t, 0.3);
      return {
        armLeft: [-0.38 * a, -0.26 * a, 0.3 * a],
        armRight: [-0.38 * a, 0.26 * a, -0.3 * a],
        elbowLeft: 0.62 * a,
        elbowRight: 0.6 * a,
        shoulder: -0.006 * a,
        browOuter: a * 0.0016,
      };
    },
  },

  /**
   * She looks where she points, and her eyes lead her hand rather than trailing
   * it — hence the head yaw peaking earlier than the arm.
   */
  point_to_hologram: {
    duration: 1.8,
    sample: (t) => {
      const a = hold(t, 0.26);
      const lead = hold(Math.min(1, t * 1.25), 0.2);
      return {
        armRight: [-0.72 * a, -0.5 * a, -0.5 * a],
        elbowRight: -0.1 * a,
        headYaw: -0.19 * lead,
        chestTwist: -0.05 * a,
        headTilt: -0.02 * a,
      };
    },
  },

  /** Held pose: hand up under the chin, gaze off, lids narrowed. */
  hand_to_chin: {
    duration: 2.4,
    sample: (t) => {
      const a = hold(t, 0.18);
      return {
        armRight: [-0.86 * a, 0.24 * a, -0.36 * a],
        elbowRight: 1.62 * a,
        headPitch: -0.03 * a,
        headTilt: -0.028 * a,
        lidOpen: -0.1 * a,
        browInner: -0.0016 * a,
      };
    },
  },

  /** Torso forward from the hips, head levelling to keep the eyeline. */
  lean_in: {
    duration: 2.0,
    sample: (t) => {
      const a = hold(t, 0.3);
      return {
        lean: a * 0.055,
        headPitch: a * 0.022,
        shoulder: a * 0.004,
        lidOpen: a * 0.05,
        browOuter: a * 0.0014,
      };
    },
  },
};
