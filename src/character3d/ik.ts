/**
 * Reaching and pointing: analytic two-bone IK with natural joint limits.
 *
 * The arm is solved the way an arm works. The elbow is a hinge: the upper arm
 * is turned so the elbow's own flexion axis (the bone's local X, see
 * public/character/proto/README.md) is square to the plane of the arm, and the
 * forearm then only flexes about that axis - never a twisted elbow - within
 * 4-130 degrees (the mannequin's skin creases past that). The pole says
 * where the elbow points (out, down and back for a relaxed arm). Pronation
 * and supination roll the forearm about its own
 * length, most of it in the forearm and the rest in the hand, as the rig has
 * no twist bones. The wrist bends at most 70 degrees and twists at most 50.
 * The shoulder keeps the arm in front of the body: a target behind her back,
 * across her chest or straight overhead is moved to the nearest place she can
 * naturally reach toward.
 *
 * `pointAt` then turns the hand about the wrist until the index fingertip's
 * ray (the `...IndexTip` marker bone's +Y) passes through the target (a few
 * passes, as the fingertip itself moves when the hand turns).
 *
 * Everything works on three.js `Bone`s in world space and is plain math on
 * them, so the tests run it in Node on a hand-built chain.
 */
import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0);
const deg = (d: number): number => (d * Math.PI) / 180;

export interface ArmLimits {
  /** Elbow flexion range, radians (0 is a straight arm). */
  minFlex: number;
  maxFlex: number;
  /** Largest backward share of the reach direction, behind the body's frontal plane (0..1). */
  maxBehind: number;
  /** Largest share across the body, toward the other side (0..1). */
  maxAcross: number;
  /** Largest upward share (sine of the elevation above the shoulder). */
  maxUp: number;
}

export const ARM_LIMITS: ArmLimits = {
  minFlex: deg(4),
  // The mannequin's skin is validated to 125 degrees; past about 130 the elbow creases.
  maxFlex: deg(130),
  maxBehind: 0.25,
  maxAcross: 0.35,
  maxUp: 0.85,
};

/** Wrist: most swing (flexion/deviation) and twist it takes, radians. */
export const WRIST_LIMITS = { swing: deg(70), twist: deg(50) };

export interface TwoBoneSolution {
  elbow: THREE.Vector3;
  wrist: THREE.Vector3;
  /** Elbow flexion, radians (0 straight). */
  flex: number;
  /** True when the wrist is on the target (it was within reach and the limits). */
  reached: boolean;
}

/**
 * Where the elbow and wrist go for a shoulder at `s`, a wrist target `t`, segment lengths
 * `l1`, `l2` and a pole (the direction the elbow should point). The reach is clamped to what the
 * elbow's flexion range allows, along the same line.
 */
export function solveTwoBone(
  s: THREE.Vector3,
  t: THREE.Vector3,
  l1: number,
  l2: number,
  pole: THREE.Vector3,
  limits: Pick<ArmLimits, 'minFlex' | 'maxFlex'> = ARM_LIMITS,
): TwoBoneSolution {
  const D = t.clone().sub(s);
  const d = D.length();
  const dMax = Math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(limits.minFlex));
  const dMin = Math.sqrt(Math.max(0, l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(limits.maxFlex)));
  const dc = Math.min(dMax, Math.max(dMin, d));
  const dn = d > 1e-9 ? D.multiplyScalar(1 / d) : new THREE.Vector3(0, -1, 0);
  const a = (l1 * l1 + dc * dc - l2 * l2) / (2 * dc);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = perpendicular(pole, dn);
  const elbow = s.clone().addScaledVector(dn, a).addScaledVector(p, h);
  const wrist = s.clone().addScaledVector(dn, dc);
  const cosInterior = (l1 * l1 + l2 * l2 - dc * dc) / (2 * l1 * l2);
  const flex = Math.PI - Math.acos(Math.min(1, Math.max(-1, cosInterior)));
  return { elbow, wrist, flex, reached: Math.abs(d - dc) < 1e-4 };
}

/** The unit part of `v` square to unit `axis`; any square direction when `v` runs along it. */
export function perpendicular(v: THREE.Vector3, axis: THREE.Vector3): THREE.Vector3 {
  const p = v.clone().addScaledVector(axis, -v.dot(axis));
  if (p.lengthSq() > 1e-10) return p.normalize();
  const helper = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  return helper.addScaledVector(axis, -helper.dot(axis)).normalize();
}

/**
 * Keeps a reach inside the shoulder's natural range. `forward`, `outward` and `up` are the
 * body's unit axes in the world (outward = toward this arm's own side). Returns a new target
 * at the same distance from the shoulder.
 */
export function limitReach(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  forward: THREE.Vector3,
  outward: THREE.Vector3,
  up: THREE.Vector3,
  limits: Pick<ArmLimits, 'maxBehind' | 'maxAcross' | 'maxUp'> = ARM_LIMITS,
): THREE.Vector3 {
  const D = target.clone().sub(shoulder);
  const len = D.length();
  if (len < 1e-9) return target.clone();
  const n = D.multiplyScalar(1 / len);
  // The nearest direction inside all three limits: each limit turns the direction just onto
  // its boundary (keeping the rest of it), a few rounds so each holds after the others.
  for (let round = 0; round < 4; round++) {
    clampComponent(n, forward, -limits.maxBehind, 1);
    clampComponent(n, outward, -limits.maxAcross, 1);
    clampComponent(n, up, -1, limits.maxUp);
  }
  return shoulder.clone().addScaledVector(n, len);
}

/** Turns unit `n` (in place) as little as possible so its component along unit `axis` is in [min, max]. */
function clampComponent(n: THREE.Vector3, axis: THREE.Vector3, min: number, max: number): void {
  const c = n.dot(axis);
  if (c >= min && c <= max) return;
  const t = Math.min(max, Math.max(min, c));
  const perp = perpendicular(n, axis);
  n.copy(axis).multiplyScalar(t).addScaledVector(perp, Math.sqrt(Math.max(0, 1 - t * t)));
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** Sets a bone's local rotation so its world rotation is `world`. */
export function setWorldQuaternion(bone: THREE.Object3D, world: THREE.Quaternion): void {
  const parent = bone.parent;
  if (parent) {
    parent.getWorldQuaternion(_q2);
    bone.quaternion.copy(_q2.invert().multiply(world));
  } else {
    bone.quaternion.copy(world);
  }
  bone.updateMatrixWorld(true);
}

/** Turns a bone (minimal rotation) so its +Y, the direction it runs, points along `dir` in the world. */
export function aimBone(bone: THREE.Object3D, dir: THREE.Vector3): void {
  if (dir.lengthSq() < 1e-12) return;
  const q = bone.getWorldQuaternion(new THREE.Quaternion());
  const y = Y.clone().applyQuaternion(q);
  const w = new THREE.Quaternion().setFromUnitVectors(y, dir.clone().normalize()).multiply(q);
  setWorldQuaternion(bone, w);
}

/** The world rotation with +Y along `yDir` and +Z as near `zDir` as it can be (square to Y). */
export function basisQuaternion(yDir: THREE.Vector3, zDir: THREE.Vector3): THREE.Quaternion {
  const y = yDir.clone().normalize();
  const z = perpendicular(zDir, y);
  const x = new THREE.Vector3().crossVectors(y, z);
  _m.makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(_m);
}

export interface ArmBones {
  upper: THREE.Bone;
  lower: THREE.Bone;
  hand: THREE.Bone;
}

export interface ArmRest {
  /** The forearm's rest local rotation (its hinge acts on top of it). */
  lower: THREE.Quaternion;
}

/**
 * Solves an arm onto a wrist target with a hinge elbow. Returns the solution (flexion and
 * whether the target was reached). Bone lengths are read from the current skeleton, so a
 * scaled figure solves in its own world units.
 */
export function solveArm(bones: ArmBones, rest: ArmRest, target: THREE.Vector3, pole: THREE.Vector3, limits: ArmLimits = ARM_LIMITS): TwoBoneSolution {
  const s = bones.upper.getWorldPosition(new THREE.Vector3());
  const e0 = bones.lower.getWorldPosition(new THREE.Vector3());
  const w0 = bones.hand.getWorldPosition(new THREE.Vector3());
  const l1 = s.distanceTo(e0);
  const l2 = e0.distanceTo(w0);
  const sol = solveTwoBone(s, target, l1, l2, pole, limits);

  // Upper arm: along shoulder -> elbow, rolled so its +Z (the side the forearm folds toward)
  // faces the wrist. On a straight arm that side is the one away from the pole.
  const yUp = sol.elbow.clone().sub(s).normalize();
  const fore = sol.wrist.clone().sub(sol.elbow);
  let z = fore.clone().addScaledVector(yUp, -fore.dot(yUp));
  if (z.lengthSq() < 1e-8 * fore.lengthSq() || sol.flex < deg(1)) z = perpendicular(pole, yUp).negate();
  setWorldQuaternion(bones.upper, basisQuaternion(yUp, z));

  // Forearm: its rest rotation, flexed about its own X (the hinge), then trued up so the
  // wrist lands exactly (a hair of correction where the rest frames differ).
  bones.lower.quaternion.copy(rest.lower).multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), sol.flex));
  bones.lower.updateMatrixWorld(true);
  aimBone(bones.lower, sol.wrist.clone().sub(sol.elbow));
  return sol;
}

/**
 * Rolls the forearm and hand about their own length so the hand's +Z (the palm normal) faces
 * `want` as nearly as it can: `share` of the roll in the forearm, the rest in the hand.
 */
export function rollPalm(foreArm: THREE.Bone, hand: THREE.Bone, want: THREE.Vector3, share = 0.7): number {
  const ax = Y.clone().applyQuaternion(foreArm.getWorldQuaternion(new THREE.Quaternion()));
  const cur = new THREE.Vector3(0, 0, 1).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
  const c = cur.addScaledVector(ax, -cur.dot(ax));
  const t = want.clone().addScaledVector(ax, -want.dot(ax));
  if (c.lengthSq() < 1e-10 || t.lengthSq() < 1e-10) return 0;
  c.normalize();
  t.normalize();
  const ang = Math.atan2(ax.dot(new THREE.Vector3().crossVectors(c, t)), c.dot(t));
  foreArm.quaternion.multiply(_q.setFromAxisAngle(Y, ang * share));
  foreArm.updateMatrixWorld(true);
  hand.quaternion.multiply(_q.setFromAxisAngle(Y, ang * (1 - share)));
  hand.updateMatrixWorld(true);
  return ang;
}

/** Splits a rotation into a twist about `axis` and the swing left over (q = swing * twist). */
export function swingTwist(q: THREE.Quaternion, axis: THREE.Vector3 = Y): { swing: THREE.Quaternion; twist: THREE.Quaternion } {
  const r = new THREE.Vector3(q.x, q.y, q.z);
  const p = axis.clone().multiplyScalar(r.dot(axis));
  const twist = new THREE.Quaternion(p.x, p.y, p.z, q.w);
  if (twist.lengthSq() < 1e-12) twist.set(0, 0, 0, 1);
  else twist.normalize();
  const swing = q.clone().multiply(twist.clone().invert());
  return { swing, twist };
}

/** The rotation angle of a unit quaternion, 0..PI. */
export function angleOf(q: THREE.Quaternion): number {
  return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
}

function limitAngle(q: THREE.Quaternion, max: number): THREE.Quaternion {
  const a = angleOf(q);
  if (a <= max || a < 1e-9) return q;
  return new THREE.Quaternion().slerp(q, max / a);
}

/**
 * Keeps a joint's rotation away from its rest within a swing and a twist (about its own Y).
 * Returns true when it had to clamp.
 */
export function limitJoint(bone: THREE.Bone, rest: THREE.Quaternion, maxSwing: number, maxTwist: number): boolean {
  const rel = rest.clone().invert().multiply(bone.quaternion);
  const { swing, twist } = swingTwist(rel);
  const s = limitAngle(swing, maxSwing);
  const t = limitAngle(twist, maxTwist);
  if (s === swing && t === twist) return false;
  bone.quaternion.copy(rest).multiply(s.clone().multiply(t));
  bone.updateMatrixWorld(true);
  return true;
}

/**
 * Turns the hand about the wrist so the fingertip marker's ray (+Y of `tip`) passes through
 * `target`: one exact turn, then up to three corrective passes.
 */
export function pointAt(hand: THREE.Bone, tip: THREE.Object3D, target: THREE.Vector3, passes = 3): number {
  const tq = new THREE.Quaternion();
  // Exact in one turn: the point of the finger's line as far from the wrist as the target is
  // turns onto the target (the line then runs through it). A target nearer the wrist than the
  // line comes is left to the passes below.
  {
    const w = hand.getWorldPosition(new THREE.Vector3());
    const t0 = tip.getWorldPosition(new THREE.Vector3()).sub(w);
    const d0 = Y.clone().applyQuaternion(tip.getWorldQuaternion(tq));
    const v = target.clone().sub(w);
    const b = t0.dot(d0);
    const disc = b * b - t0.lengthSq() + v.lengthSq();
    if (disc >= 0 && v.lengthSq() > 1e-12) {
      const s = -b + Math.sqrt(disc);
      if (s > 0) {
        const q = t0.addScaledVector(d0, s).normalize();
        const turn = new THREE.Quaternion().setFromUnitVectors(q, v.normalize());
        setWorldQuaternion(hand, turn.multiply(hand.getWorldQuaternion(new THREE.Quaternion())));
      }
    }
  }
  for (let i = 0; i < passes; i++) {
    if (pointError(tip, target) < 2e-4) break;
    const p = tip.getWorldPosition(new THREE.Vector3());
    const dir = Y.clone().applyQuaternion(tip.getWorldQuaternion(tq));
    const want = target.clone().sub(p);
    if (want.lengthSq() < 1e-10) break;
    const w = new THREE.Quaternion().setFromUnitVectors(dir, want.normalize()).multiply(hand.getWorldQuaternion(new THREE.Quaternion()));
    setWorldQuaternion(hand, w);
  }
  return pointError(tip, target);
}

/** Angle (radians) between the fingertip's ray and the direction to `target`. */
export function pointError(tip: THREE.Object3D, target: THREE.Vector3): number {
  const p = tip.getWorldPosition(new THREE.Vector3());
  const dir = Y.clone().applyQuaternion(tip.getWorldQuaternion(new THREE.Quaternion()));
  return dir.angleTo(target.clone().sub(p));
}

/** Where the wrist should be for pointing: along shoulder -> target, `reach` of the arm's full length out. */
export function pointingWrist(shoulder: THREE.Vector3, target: THREE.Vector3, armLength: number, fingerLength: number, reach = 0.96): THREE.Vector3 {
  const D = target.clone().sub(shoulder);
  const len = D.length();
  if (len < 1e-9) return target.clone();
  const out = Math.min(armLength * reach, Math.max(armLength * 0.55, len - fingerLength * 1.2));
  return shoulder.clone().addScaledVector(D.multiplyScalar(1 / len), out);
}
