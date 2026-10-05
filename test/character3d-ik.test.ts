/**
 * The character prototype's reach and point math (src/character3d/ik.ts, reach.ts).
 *
 * Plain vector checks on the analytic two-bone solve (reach, the elbow's
 * flexion range, the pole), the shoulder's natural range, the wrist's swing
 * and twist limits and the pointing turn, on a hand-built arm whose bones
 * follow the mannequin's conventions (+Y along each bone, the elbow flexing
 * about its own X toward +Z). The same code on the real mannequin is covered
 * in character3d-rig.test.ts.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  ARM_LIMITS,
  WRIST_LIMITS,
  angleOf,
  limitJoint,
  limitReach,
  pointAt,
  pointingWrist,
  solveArm,
  solveTwoBone,
  swingTwist,
} from '../src/character3d/ik.ts';
import { armSamples, clearOf, clearWrist, planReach, rectDistance, touched } from '../src/character3d/reach.ts';

const deg = (d: number): number => (d * Math.PI) / 180;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('two-bone solve', () => {
  const S = V(0, 1.4, 0);
  const L1 = 0.3;
  const L2 = 0.25;
  const pole = V(0, -1, -0.3);

  it('puts the wrist on a reachable target and keeps both segments their length', () => {
    const T = V(0.25, 1.2, 0.3);
    const sol = solveTwoBone(S, T, L1, L2, pole);
    expect(sol.reached).toBe(true);
    expect(sol.wrist.distanceTo(T)).toBeLessThan(1e-9);
    expect(sol.elbow.distanceTo(S)).toBeCloseTo(L1, 9);
    expect(sol.elbow.distanceTo(sol.wrist)).toBeCloseTo(L2, 9);
    expect(sol.flex).toBeGreaterThanOrEqual(ARM_LIMITS.minFlex);
    expect(sol.flex).toBeLessThanOrEqual(ARM_LIMITS.maxFlex);
  });

  it('bends the elbow toward the pole', () => {
    const T = V(0.3, 1.4, 0.2);
    const sol = solveTwoBone(S, T, L1, L2, pole);
    const mid = S.clone().add(sol.wrist).multiplyScalar(0.5);
    const out = sol.elbow.clone().sub(mid);
    expect(out.dot(pole)).toBeGreaterThan(0);
  });

  it('never locks or hyper-extends the elbow on a target out of reach', () => {
    const T = V(2, 1.4, 0);
    const sol = solveTwoBone(S, T, L1, L2, pole);
    expect(sol.reached).toBe(false);
    expect(sol.flex).toBeCloseTo(ARM_LIMITS.minFlex, 6);
    // The wrist stays on the line toward the target.
    const dir = T.clone().sub(S).normalize();
    expect(sol.wrist.clone().sub(S).normalize().dot(dir)).toBeCloseTo(1, 9);
  });

  it('never folds the elbow past its range on a target at the shoulder', () => {
    const sol = solveTwoBone(S, V(0.01, 1.4, 0.02), L1, L2, pole);
    expect(sol.reached).toBe(false);
    expect(sol.flex).toBeCloseTo(ARM_LIMITS.maxFlex, 6);
  });

  it('points the wrist along the arm for a point, short of locking', () => {
    const T = V(0.9, 1.6, 0.4);
    const w = pointingWrist(S, T, L1 + L2, 0.17, 0.96);
    expect(w.distanceTo(S)).toBeCloseTo((L1 + L2) * 0.96, 9);
    expect(w.clone().sub(S).normalize().dot(T.clone().sub(S).normalize())).toBeCloseTo(1, 9);
  });
});

describe('shoulder range', () => {
  const S = V(0.17, 1.4, 0);
  const forward = V(0, 0, 1);
  const outward = V(1, 0, 0);
  const up = V(0, 1, 0);

  it('keeps a reach in front of the body and at its distance', () => {
    const behind = limitReach(S, V(0.2, 1.3, -0.5), forward, outward, up);
    const n = behind.clone().sub(S);
    expect(n.length()).toBeCloseTo(V(0.2, 1.3, -0.5).sub(S).length(), 9);
    expect(n.normalize().dot(forward)).toBeGreaterThanOrEqual(-ARM_LIMITS.maxBehind - 1e-9);
  });

  it('limits a reach across the chest and straight overhead', () => {
    const across = limitReach(S, V(-0.6, 1.4, 0.05), forward, outward, up).sub(S).normalize();
    expect(across.dot(outward)).toBeGreaterThanOrEqual(-ARM_LIMITS.maxAcross - 1e-9);
    const over = limitReach(S, V(0.18, 2.3, 0.01), forward, outward, up).sub(S).normalize();
    expect(over.dot(up)).toBeLessThanOrEqual(ARM_LIMITS.maxUp + 1e-9);
  });

  it('leaves a natural reach alone', () => {
    const T = V(0.45, 1.2, 0.35);
    expect(limitReach(S, T, forward, outward, up).distanceTo(T)).toBeLessThan(1e-9);
  });
});

/** A left arm like the mannequin's: +Y along each bone, +Z forward, the hand's +Z the palm. */
function buildArm() {
  const root = new THREE.Bone();
  root.name = 'Spine2';
  const upper = new THREE.Bone();
  upper.name = 'LeftArm';
  upper.position.set(0.17, 1.36, 0);
  // Rest: the arm hangs 40 degrees under horizontal toward +X (an A-pose), +Z forward.
  const ay = V(Math.cos(deg(40)), -Math.sin(deg(40)), 0);
  const az = V(0, 0, 1);
  const ax = new THREE.Vector3().crossVectors(ay, az);
  upper.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, az));
  const lower = new THREE.Bone();
  lower.name = 'LeftForeArm';
  lower.position.set(0, 0.282, 0);
  const hand = new THREE.Bone();
  hand.name = 'LeftHand';
  hand.position.set(0, 0.234, 0);
  // The hand's palm faces down and in at rest: roll the hand a quarter turn about its own Y.
  hand.quaternion.setFromAxisAngle(V(0, 1, 0), deg(-90));
  const tip = new THREE.Bone();
  tip.name = 'LeftIndexTip';
  tip.position.set(0.01, 0.16, 0.012);
  root.add(upper);
  upper.add(lower);
  lower.add(hand);
  hand.add(tip);
  root.updateMatrixWorld(true);
  const rest = { lower: lower.quaternion.clone(), hand: hand.quaternion.clone() };
  return { root, upper, lower, hand, tip, rest };
}

describe('the hinge arm', () => {
  it('lands the wrist on the target with a pure elbow hinge inside its range', () => {
    const arm = buildArm();
    const target = V(0.42, 1.18, 0.32);
    const sol = solveArm({ upper: arm.upper, lower: arm.lower, hand: arm.hand }, { lower: arm.rest.lower }, target, V(0.4, -1, -0.3));
    arm.root.updateMatrixWorld(true);
    expect(arm.hand.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-4);
    // The forearm's rotation away from rest is a turn about its own X only: a hinge.
    const rel = arm.rest.lower.clone().invert().multiply(arm.lower.quaternion);
    const { swing } = swingTwist(rel, V(1, 0, 0));
    expect(angleOf(swing)).toBeLessThan(deg(0.5));
    // And it flexes forward (+Z side), within the elbow's range.
    const upY = V(0, 1, 0).applyQuaternion(arm.upper.getWorldQuaternion(new THREE.Quaternion()));
    const foY = V(0, 1, 0).applyQuaternion(arm.lower.getWorldQuaternion(new THREE.Quaternion()));
    const flex = upY.angleTo(foY);
    expect(flex).toBeCloseTo(sol.flex, 3);
    expect(flex).toBeGreaterThanOrEqual(ARM_LIMITS.minFlex - 1e-6);
    expect(flex).toBeLessThanOrEqual(ARM_LIMITS.maxFlex + 1e-6);
  });

  it('keeps the wrist within its swing and twist', () => {
    const arm = buildArm();
    arm.hand.quaternion.copy(arm.rest.hand).multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), deg(120)));
    arm.hand.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), deg(100)));
    expect(limitJoint(arm.hand, arm.rest.hand, WRIST_LIMITS.swing, WRIST_LIMITS.twist)).toBe(true);
    const { swing, twist } = swingTwist(arm.rest.hand.clone().invert().multiply(arm.hand.quaternion));
    expect(angleOf(swing)).toBeLessThanOrEqual(WRIST_LIMITS.swing + 1e-6);
    expect(angleOf(twist)).toBeLessThanOrEqual(WRIST_LIMITS.twist + 1e-6);
  });

  it('turns the hand until the index ray passes through the target', () => {
    const arm = buildArm();
    solveArm({ upper: arm.upper, lower: arm.lower, hand: arm.hand }, { lower: arm.rest.lower }, V(0.45, 1.25, 0.3), V(0.4, -1, -0.3));
    const target = V(0.9, 1.5, 0.9);
    const err = pointAt(arm.hand, arm.tip, target);
    expect(err).toBeLessThan(deg(0.1));
  });
});

describe('a visible reach', () => {
  // A plain pinhole looking down -z from the origin, 1000 px focal, centre (500, 400).
  const project = (p: THREE.Vector3) => ({ x: 500 + (p.x / -p.z) * 1000, y: 400 - (p.y / -p.z) * 1000 });
  const shoulder = V(-0.8, 1.45, -4.3);
  const target = V(0.0, 1.75, -3.7);
  const pole = () => V(0, -1, 0);
  const base = { shoulder, target, upper: 0.3, fore: 0.26, hand: 0.18, project, pole };
  const radius = [0.05, 0.04, 0.042] as const;

  /** The planned arm on screen: shoulder, elbow (as the planner solves it), wrist, fingertip. */
  function arm(wrist: THREE.Vector3) {
    const elbow = solveTwoBone(shoulder, wrist, 0.3, 0.26, pole()).elbow;
    const tip = wrist.clone().addScaledVector(target.clone().sub(wrist).normalize(), 0.18);
    return { elbow, tip, samples: armSamples({ shoulder, elbow, wrist, tip }, radius, project) };
  }

  it('reaches straight for the target when nothing is in the way, fingertip as near as the arm allows', () => {
    const c = planReach({ ...base, boxes: [] });
    expect(c.mode).toBe('straight');
    expect(c.yields).toEqual([]);
    // Out along the line to the target, the arm nearly straight.
    const dir = target.clone().sub(shoulder).normalize();
    expect(c.wrist.clone().sub(shoulder).normalize().angleTo(dir)).toBeLessThan(deg(1));
    expect(c.wrist.distanceTo(shoulder)).toBeGreaterThan(0.56 * 0.9);
  });

  it('keeps the whole arm - upper arm, forearm, hand and fingertip, at their thickness - off a hard box', () => {
    const straight = arm(planReach({ ...base, boxes: [] }).wrist);
    // A box right over the forearm of the straight reach.
    const mid = project(straight.elbow.clone().lerp(planReach({ ...base, boxes: [] }).wrist, 0.5));
    const box = { x: mid.x - 40, y: mid.y - 60, w: 80, h: 90, id: 'card' };
    const c = planReach({ ...base, boxes: [box] });
    expect(c.mode).not.toBe('blocked');
    const { samples } = arm(c.wrist);
    expect(touched(samples, [box], 0).size).toBe(0);
    expect(c.yields).toEqual([]);
  });

  it('passes in front of a soft box (a callout not being read) and says so, rather than give up the reach', () => {
    const straight = planReach({ ...base, boxes: [] });
    const mid = project(arm(straight.wrist).elbow.clone().lerp(straight.wrist, 0.5));
    // A soft box over the whole middle of the reach: going round it would cost far more than fading it.
    const soft = { x: mid.x - 150, y: mid.y - 150, w: 300, h: 300, id: 'pores', soft: true };
    const c = planReach({ ...base, boxes: [soft] });
    expect(c.yields).toEqual(['pores']);
    expect(c.gap).toBeLessThan(straight.gap + 5);
    // A smaller one, hard: the arm goes round it, whatever it costs in reach.
    const box = { x: mid.x - 40, y: mid.y - 40, w: 80, h: 80, id: 'pores' };
    const hard = planReach({ ...base, boxes: [box] });
    expect(hard.mode).not.toBe('blocked');
    expect(hard.yields).toEqual([]);
    expect(touched(arm(hard.wrist).samples, [box], 0).size).toBe(0);
    expect(hard.gap).toBeGreaterThan(straight.gap);
  });

  it('never bends the wrist further than it goes to aim the hand', () => {
    for (const box of [[], [{ x: 520, y: 200, w: 200, h: 120, id: 'a' }], [{ x: 380, y: 300, w: 250, h: 150, id: 'b' }]]) {
      const c = planReach({ ...base, boxes: box });
      const elbow = solveTwoBone(shoulder, c.wrist, 0.3, 0.26, pole()).elbow;
      expect(c.wrist.clone().sub(elbow).angleTo(target.clone().sub(c.wrist))).toBeLessThanOrEqual(deg(58) + 1e-6);
    }
  });

  it('says so when no reach keeps a hard box clear (the box covers her)', () => {
    const s = project(shoulder);
    const c = planReach({ ...base, boxes: [{ x: s.x - 400, y: s.y - 400, w: 800, h: 800, id: 'all' }] });
    expect(c.mode).toBe('blocked');
  });

  it('lowers a resting hand out from under a box, forearm included', () => {
    const w = V(-0.5, 1.2, -4.1);
    const along = V(1, 0, 0.3).normalize();
    const p = project(w);
    const box = { x: p.x - 20, y: p.y - 60, w: 300, h: 90 };
    const elbow = V(-0.62, 1.12, -4.2);
    const moved = clearWrist(w, along, 0.18, 1.085, project, [box], 8, elbow);
    expect(moved.y).toBeLessThan(w.y);
    expect(clearOf([0, 0.5, 1].map((k) => project(moved.clone().addScaledVector(along, 0.18 * k))), [box])).toBe(true);
    expect(clearOf([0.35, 0.7].map((k) => project(elbow.clone().lerp(moved, k))), [box])).toBe(true);
  });

  it('measures boxes the arm touches at its thickness', () => {
    const samples = [{ x: 100, y: 100, r: 10, slack: 0 }];
    expect(touched(samples, [{ x: 108, y: 90, w: 20, h: 20 }], 0).size).toBe(1);
    expect(touched(samples, [{ x: 115, y: 90, w: 20, h: 20 }], 0).size).toBe(0);
    expect(rectDistance({ x: 0, y: 0 }, { x: 3, y: 4, w: 1, h: 1 })).toBeCloseTo(5, 9);
  });
});
