/**
 * The mannequin's skeleton, posed from world-space targets every frame.
 *
 * Each frame starts from the rest pose (public/character/proto/README.md: an
 * A-pose, +Y along every bone, post-multiplied local rotations), then:
 *
 *   body   hips sway, spine lean and twist toward the hologram, breathing
 *   arms   clavicle lift, hinge IK to the wrist target (ik.ts), palm roll
 *          split forearm/hand, the hand turned to its direction and palm,
 *          the wrist limited, fingers curled, and for a point the hand
 *          turned until the index ray passes through the target, blended in
 *          by weight so a point grows out of whatever the hand was doing
 *   head   look split neck 40% / head 60% with limits, a residual pass on
 *          the head, tilt and nod on top, the jaw
 *
 * The targets come from the figure (character.ts), already eased by springs.
 */
import * as THREE from 'three';
import { ARM_LIMITS, WRIST_LIMITS, aimBone, angleOf, basisQuaternion, limitJoint, limitReach, pointAt, rollPalm, setWorldQuaternion, solveArm, type ArmBones, type ArmLimits } from './ik.ts';

const deg = (d: number): number => (d * Math.PI) / 180;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export type Side = 'Left' | 'Right';
export const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'] as const;

/** Curl angles, degrees: four fingers x three joints, then the thumb's three. */
export type Curls = number[];

export interface ArmTargets {
  /** World wrist target. */
  wrist: THREE.Vector3;
  /** World direction the elbow points toward. */
  pole: THREE.Vector3;
  /** World direction the hand runs (wrist to knuckles) and its palm normal. */
  handDir: THREE.Vector3;
  palm: THREE.Vector3;
  /** 16 curls (see `Curls`), degrees. */
  curls: Curls;
  /** Spread of the fingers, degrees. */
  spread: number;
  /** 0..1: how far the hand turns to put the index ray through `pointTarget`. */
  point: number;
  pointTarget: THREE.Vector3 | null;
  /** Clavicle lift, radians. */
  shrug: number;
  /**
   * The shoulder's range for this pose, where it differs from `ARM_LIMITS` (a hand brought to
   * the chin crosses toward the body's middle further than a reach may).
   */
  limits?: Partial<ArmLimits>;
  /**
   * The most the hand may turn (in the world) since the last pose, radians: a hand turning over
   * (a point from below becoming one from above) turns, it never flips in a frame. Unset: no limit.
   */
  maxTurn?: number;
}

export interface BodyTargets {
  /** Spine flexion, radians, spread over the three spine bones. */
  lean: number;
  /** Spine twist toward her left (the hologram), radians. */
  twist: number;
  /** Side bend toward her left, radians. */
  side: number;
  /** Breath, -1..1. */
  breath: number;
  /** Hip sway (weight shift), -1..1. */
  sway: number;
  /** Her weight moved onto the pedestal-side foot: the pelvis shifted toward her left, metres before scale. */
  shift?: number;
  /** Stepping (her feet moving her): how much, 0..1, and where in the stride, radians (a step per PI). */
  stride?: number;
  stridePhase?: number;
  /** World point she looks at, or null to keep the head straight. */
  look: THREE.Vector3 | null;
  /** Head tilt toward her left shoulder, radians. */
  tilt: number;
  /** Nod forward, radians. */
  nod: number;
  /** Jaw 0..1. */
  jaw: number;
  /** Idle life: a slow drift of the head (yaw toward her left, pitch forward), radians. */
  driftYaw?: number;
  driftPitch?: number;
}

/** The jaw's full opening, radians (the asset validates 12 degrees; the faceless head needs a little more to read). */
export const JAW_OPEN = deg(20);

export interface PoseReport {
  /** Pointing error, radians, for whichever arm points (NaN when none). */
  pointError: number;
  leftFlex: number;
  rightFlex: number;
  leftReached: boolean;
  rightReached: boolean;
}

const NAMES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'Jaw',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftIndexTip',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightIndexTip',
] as const;

export class Rig {
  readonly bones: Record<string, THREE.Bone> = {};
  readonly rest: Record<string, THREE.Quaternion> = {};
  readonly root: THREE.Object3D;
  private readonly all: THREE.Bone[];
  private readonly restHips: THREE.Vector3;
  /** Each hand's world rotation as last posed (for `maxTurn`). */
  private readonly lastHand: Partial<Record<Side, THREE.Quaternion>> = {};

  constructor(root: THREE.Object3D, skeletonBones: THREE.Bone[]) {
    this.root = root;
    this.all = skeletonBones;
    for (const b of skeletonBones) {
      this.bones[b.name] = b;
      this.rest[b.name] = b.quaternion.clone();
    }
    for (const n of NAMES) if (!this.bones[n]) throw new Error(`mannequin: bone ${n} is missing`);
    this.restHips = this.bones.Hips.position.clone();
  }

  b(name: string): THREE.Bone {
    return this.bones[name];
  }

  reset(): void {
    for (const bone of this.all) bone.quaternion.copy(this.rest[bone.name]);
    this.bones.Hips.position.copy(this.restHips);
    this.root.updateMatrixWorld(true);
  }

  /** Post-multiplies a local rotation about one of the bone's own axes. */
  rot(name: string, axis: THREE.Vector3, angle: number): void {
    if (!angle) return;
    this.bones[name].quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  }

  /** The body's axes in the world (forward, her left, up), from the root. */
  axes(): { forward: THREE.Vector3; left: THREE.Vector3; up: THREE.Vector3 } {
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    return { forward: Z.clone().applyQuaternion(q), left: X.clone().applyQuaternion(q), up: Y.clone() };
  }

  /** The full pose: `poseBody`, then `poseLimbs`. */
  pose(body: BodyTargets, left: ArmTargets, right: ArmTargets): PoseReport {
    this.poseBody(body, left.shrug, right.shrug);
    return this.poseLimbs(body, left, right);
  }

  /**
   * From rest: the hips, spine and clavicles. After it the shoulders are where this frame's
   * arms start, so the arms' goals can be worked out from them (character.ts does).
   */
  poseBody(body: BodyTargets, leftShrug: number, rightShrug: number): void {
    this.reset();
    // The feet stay where they stand, whatever the pelvis does.
    const sides = ['Left', 'Right'] as const;
    const feet = sides.map((side) => this.bones[`${side}Foot`].getWorldPosition(new THREE.Vector3()));
    const footQ = sides.map((side) => this.bones[`${side}Foot`].getWorldQuaternion(new THREE.Quaternion()));
    // Weight shift: the pelvis moves over the weighted foot (toward her left when she reaches
    // for the hologram, and slowly side to side at rest) and drops toward the unweighted side,
    // the spine comes back over it and that side's knee softens.
    const hips = this.bones.Hips;
    const shift = (body.shift ?? 0) + 0.018 * body.sway;
    if (shift && hips.parent) {
      const s = this.root.getWorldScale(new THREE.Vector3()).y;
      const leg = 0.8 * s;
      const off = shift * s;
      const at = hips.getWorldPosition(new THREE.Vector3());
      at.addScaledVector(this.axes().left, off).addScaledVector(Y, -(leg - Math.sqrt(Math.max(0, leg * leg - off * off))));
      hips.position.copy(hips.parent.worldToLocal(at));
      hips.updateMatrixWorld(true);
    }
    this.rot('Hips', Z, deg(1.8) * body.sway);
    hips.updateMatrixWorld(true);
    sides.forEach((side, i) => {
      const up = this.bones[`${side}UpLeg`];
      aimBone(up, feet[i].clone().sub(up.getWorldPosition(new THREE.Vector3())));
      setWorldQuaternion(this.bones[`${side}Foot`], footQ[i]);
    });
    this.rot('Spine', Z, -deg(1.5) * body.sway);
    this.rot(body.sway > 0 ? 'RightLeg' : 'LeftLeg', X, -deg(5) * Math.abs(body.sway));
    // A step: each leg in turn lifts (hip forward, knee bent) while she moves.
    if (body.stride && body.stride > 0.01) {
      sides.forEach((side, i) => {
        const lift = Math.max(0, Math.sin((body.stridePhase ?? 0) + i * Math.PI)) * body.stride!;
        this.rot(`${side}UpLeg`, X, deg(16) * lift);
        this.rot(`${side}Leg`, X, -deg(30) * lift);
        this.rot(`${side}Foot`, X, deg(10) * lift);
      });
    }
    const flex = [0.3, 0.38, 0.32];
    const twist = [0.28, 0.36, 0.36];
    (['Spine', 'Spine1', 'Spine2'] as const).forEach((n, i) => {
      this.rot(n, X, body.lean * flex[i] + (i === 2 ? deg(1.4) * body.breath : i === 1 ? -deg(0.5) * body.breath : 0));
      this.rot(n, Y, body.twist * twist[i]);
      this.rot(n, Z, -body.side * flex[i]);
    });
    this.rot('LeftShoulder', Z, deg(1.2) * body.breath + leftShrug);
    this.rot('RightShoulder', Z, -deg(1.2) * body.breath - rightShrug);
    this.root.updateMatrixWorld(true);
  }

  /** The upper chest's axes in the world (forward, her left, up): the shoulders' ranges are the torso's. */
  chestAxes(): { forward: THREE.Vector3; left: THREE.Vector3; up: THREE.Vector3 } {
    const q = this.bones.Spine2.getWorldQuaternion(new THREE.Quaternion());
    return { forward: Z.clone().applyQuaternion(q), left: X.clone().applyQuaternion(q), up: Y.clone().applyQuaternion(q) };
  }

  /** On top of `poseBody`: both arms to their targets, then the head and jaw. */
  poseLimbs(body: BodyTargets, left: ArmTargets, right: ArmTargets): PoseReport {
    const a = this.chestAxes();
    const l = this.arm('Left', left, a);
    const r = this.arm('Right', right, a);

    // ---- head -----------------------------------------------------------
    this.head(body);
    this.rot('Jaw', X, JAW_OPEN * Math.max(0, Math.min(1, body.jaw)));
    this.bones.Jaw.updateMatrixWorld(true);

    return {
      pointError: left.point > 0.5 ? l.pointError : right.point > 0.5 ? r.pointError : NaN,
      leftFlex: l.flex,
      rightFlex: r.flex,
      leftReached: l.reached,
      rightReached: r.reached,
    };
  }

  private arm(side: Side, t: ArmTargets, a: { forward: THREE.Vector3; left: THREE.Vector3; up: THREE.Vector3 }): { flex: number; reached: boolean; pointError: number } {
    const bones: ArmBones = { upper: this.bones[`${side}Arm`], lower: this.bones[`${side}ForeArm`], hand: this.bones[`${side}Hand`] };
    const shoulder = bones.upper.getWorldPosition(new THREE.Vector3());
    const outward = side === 'Left' ? a.left : a.left.clone().negate();
    const limits = t.limits ? { ...ARM_LIMITS, ...t.limits } : ARM_LIMITS;
    const target = limitReach(shoulder, t.wrist, a.forward, outward, a.up, limits);
    const sol = solveArm(bones, { lower: this.rest[`${side}ForeArm`] }, target, t.pole, limits);
    rollPalm(bones.lower, bones.hand, t.palm, 0.7);
    setWorldQuaternion(bones.hand, basisQuaternion(t.handDir, t.palm));
    limitJoint(bones.hand, this.rest[`${side}Hand`], WRIST_LIMITS.swing, WRIST_LIMITS.twist);

    // Fingers: +X curls into the palm; spread about Z (mirrored).
    const sgn = side === 'Left' ? 1 : -1;
    FINGERS.forEach((f, i) => {
      for (let j = 0; j < 3; j++) this.rot(`${side}${f}${j + 1}`, X, deg(t.curls[i * 3 + j] ?? 0));
      this.rot(`${side}${f}1`, Z, sgn * deg(t.spread) * (i - 1.2) * 0.5);
    });
    for (let j = 0; j < 3; j++) this.rot(`${side}Thumb${j + 1}`, X, deg(t.curls[12 + j] ?? 0));
    bones.hand.updateMatrixWorld(true);

    let pointError = NaN;
    if (t.point > 0.001 && t.pointTarget) {
      const before = bones.hand.quaternion.clone();
      pointError = pointAt(bones.hand, this.bones[`${side}IndexTip`], t.pointTarget);
      limitJoint(bones.hand, this.rest[`${side}Hand`], WRIST_LIMITS.swing, WRIST_LIMITS.twist);
      const after = bones.hand.quaternion.clone();
      bones.hand.quaternion.slerpQuaternions(before, after, Math.min(1, t.point));
      bones.hand.updateMatrixWorld(true);
      // Tuck the thumb over the curled middle finger, as far as the point has grown.
      const m2 = this.bones[`${side}Middle2`].getWorldPosition(new THREE.Vector3());
      const m3 = this.bones[`${side}Middle3`].getWorldPosition(new THREE.Vector3());
      const thumbs = [this.bones[`${side}Thumb2`], this.bones[`${side}Thumb3`]];
      const aims = [m2, m3.clone().lerp(m2, 0.3)];
      thumbs.forEach((bone, k) => {
        const from = bone.quaternion.clone();
        const p = bone.getWorldPosition(new THREE.Vector3());
        const q = bone.getWorldQuaternion(new THREE.Quaternion());
        const y = Y.clone().applyQuaternion(q);
        const w = new THREE.Quaternion().setFromUnitVectors(y, aims[k].clone().sub(p).normalize()).multiply(q);
        setWorldQuaternion(bone, w);
        bone.quaternion.slerpQuaternions(from, bone.quaternion.clone(), Math.min(1, t.point) * 0.9);
        bone.updateMatrixWorld(true);
      });
      if (t.point > 0.5) pointError = this.pointErrorOf(side, t.pointTarget);
    }
    // The hand's turn since the last pose, limited: it swings round, it never snaps round.
    const handQ = bones.hand.getWorldQuaternion(new THREE.Quaternion());
    const last = this.lastHand[side];
    if (last && t.maxTurn !== undefined && Number.isFinite(t.maxTurn)) {
      const turn = angleOf(last.clone().invert().multiply(handQ));
      if (turn > t.maxTurn) {
        setWorldQuaternion(bones.hand, last.clone().slerp(handQ, t.maxTurn / turn));
        handQ.copy(bones.hand.getWorldQuaternion(new THREE.Quaternion()));
        if (t.point > 0.5 && t.pointTarget) pointError = this.pointErrorOf(side, t.pointTarget);
      }
    }
    this.lastHand[side] = handQ;
    return { flex: sol.flex, reached: sol.reached, pointError };
  }

  pointErrorOf(side: Side, target: THREE.Vector3): number {
    const tip = this.bones[`${side}IndexTip`];
    const p = tip.getWorldPosition(new THREE.Vector3());
    const dir = Y.clone().applyQuaternion(tip.getWorldQuaternion(new THREE.Quaternion()));
    return dir.angleTo(target.clone().sub(p));
  }

  /** The middle of the head in the world (a little above the head joint). */
  headCentre(): THREE.Vector3 {
    const head = this.bones.Head;
    const p = head.getWorldPosition(new THREE.Vector3());
    const up = Y.clone().applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
    const s = this.root.getWorldScale(new THREE.Vector3()).y;
    return p.addScaledVector(up, 0.085 * s);
  }

  private head(body: BodyTargets): void {
    const neck = this.bones.Neck;
    const head = this.bones.Head;
    if (body.look) {
      const spine2 = this.bones.Spine2.getWorldQuaternion(new THREE.Quaternion());
      const d = body.look.clone().sub(this.headCentre()).applyQuaternion(spine2.invert());
      const yaw = Math.max(-deg(75), Math.min(deg(75), Math.atan2(d.x, d.z)));
      const pitch = Math.max(-deg(30), Math.min(deg(38), Math.atan2(-d.y, Math.hypot(d.x, d.z))));
      this.rot('Neck', Y, yaw * 0.4);
      this.rot('Neck', X, pitch * 0.35);
      this.rot('Head', Y, yaw * 0.6);
      this.rot('Head', X, pitch * 0.65);
      neck.updateMatrixWorld(true);
      // Residual: the split is measured in the upper chest's frame; true the head up on the target.
      const hq = head.getWorldQuaternion(new THREE.Quaternion());
      const fwd = Z.clone().applyQuaternion(hq);
      const want = body.look.clone().sub(this.headCentre()).normalize();
      const fix = new THREE.Quaternion().setFromUnitVectors(fwd, want);
      setWorldQuaternion(head, fix.multiply(hq));
      limitJoint(head, this.rest.Head, deg(45), deg(60));
    }
    this.rot('Head', X, body.nod + (body.driftPitch ?? 0));
    this.rot('Head', Y, body.driftYaw ?? 0);
    this.rot('Head', Z, -body.tilt);
    head.updateMatrixWorld(true);
  }
}
