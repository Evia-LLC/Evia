/**
 * The character prototype on the real mannequin (public/character/proto/mannequin.glb).
 *
 * The figure is driven exactly as the Scan page drives it - the director's
 * state, the lit region, the hologram's anchors and the page's boxes - and
 * drawn with a stand-in renderer (Node has no WebGL). Then the pose is read
 * back from the bones: she reaches her fingertip onto each region's anchor,
 * her index along the ray through it, her face turned to it; no part of the
 * arm passes under the callout being read or the card tray (the other
 * callouts may be crossed and are named to fade); the elbow and wrist stay
 * in their ranges; the other hand rests on the rim with a soft elbow; the
 * same region always gets the same reach; a thinking hand is on the chin;
 * scan prep keeps the arm off the frame; reaches ease in without jumps; the
 * jaw moves only with an audible voice and the beats move the hand.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FACE_REGIONS, type FaceRegionKey } from '../shared/types.ts';
import { STAGE, createCharacter, type CharacterPass } from '../src/character3d/character.ts';
import { ARM_LIMITS, WRIST_LIMITS, angleOf, swingTwist } from '../src/character3d/ik.ts';
import { armSamples, touched, type ReachBox } from '../src/character3d/reach.ts';
import { PEDESTAL, REGION_REF, plateRectForStage, refToCanvas, rimPoint, worldToScreen, type PlateRect } from '../src/character3d/room.ts';
import { SpeechTrack } from '../src/character/speech.ts';
import { director } from '../src/stage/director.ts';
import type { HologramAnchors, HologramPassFrame } from '../src/hologram/engine.ts';

const deg = (d: number): number => (d * Math.PI) / 180;
/** The desk canvas with her in it covers ref x 90..1110, y 0..941 (Consultation's FIGURE_BOX). */
const BOX = { x: 90, y: 0, w: 1020, h: 941 };

interface Layout {
  plate: PlateRect;
  w: number;
  h: number;
  /** The page's boxes over the canvas (canvas px), by the slot the page names them. */
  boxes: ReachBox[];
}

/** The desk layout at stage scale `u` (1 = the mockup's 1672 x 941), boxes as the page measures them. */
function layout(u = 1): Layout {
  const stage = plateRectForStage({ x: 0, y: 0, w: 1672 * u, h: 941 * u });
  // The left callouts and the card tray at 1672 x 941 (measured on the page), in canvas px.
  const measured = [
    { id: 'forehead', x: 481, y: 127, w: 217, h: 100 },
    { id: 'tzone', x: 474, y: 250, w: 224, h: 100 },
    { id: 'cheeks', x: 511, y: 392, w: 211, h: 100 },
    { id: 'tray', x: 523, y: 599, w: 738, h: 180 },
  ];
  return {
    plate: { ...stage, x: stage.x - BOX.x * u, y: stage.y - BOX.y * u },
    w: BOX.w * u,
    h: BOX.h * u,
    boxes: measured.map((r) => ({ id: r.id, x: (r.x - BOX.x) * u, y: r.y * u, w: r.w * u, h: r.h * u })),
  };
}

/** Which callout each region is read from (the page lights that one; the others may fade). */
const SLOT: Partial<Record<FaceRegionKey, string>> = { forehead: 'forehead', periorbitalLeft: 'tzone', cheekLeft: 'cheeks', periorbitalRight: 'underEyes', chin: 'chin' };
const WALK: FaceRegionKey[] = ['forehead', 'periorbitalLeft', 'cheekLeft', 'periorbitalRight', 'chin'];

/** The boxes as the page hands them over with `region` being read: its callout and the tray hard. */
function boxesFor(l: Layout, region: FaceRegionKey | null): ReachBox[] {
  const active = region ? SLOT[region] : null;
  return l.boxes.map((b) => ({ ...b, soft: b.id !== 'tray' && b.id !== active }));
}

/** The anchors the hologram reports for the sample face (canvas px). */
function anchors(l: Layout): HologramAnchors {
  const out = {} as HologramAnchors;
  for (const k of FACE_REGIONS) {
    const [x, y] = refToCanvas(REGION_REF[k][0], REGION_REF[k][1], l.plate);
    out[k] = { x, y, visible: true, z: 0 };
  }
  return out;
}

async function mannequin(): Promise<THREE.Object3D> {
  const buf = readFileSync('public/character/proto/mannequin.glb');
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  return gltf.scene;
}

let rendered = 0;
const renderer = { render: () => void rendered++ } as unknown as THREE.WebGLRenderer;

function frame(l: Layout, dt: number, reducedMotion: boolean): HologramPassFrame {
  return { renderer, dt, cssW: l.w, cssH: l.h, anchors: anchors(l), reducedMotion };
}

function bones(model: THREE.Object3D): Record<string, THREE.Bone> {
  const out: Record<string, THREE.Bone> = {};
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) out[o.name] = o as THREE.Bone;
  });
  return out;
}

const rayAngle = (a: [number, number], b: [number, number]): number => Math.atan2(b[1] - a[1], b[0] - a[0]);

let pass: CharacterPass | null = null;
let model: THREE.Object3D;
let b: Record<string, THREE.Bone>;
let rest: Record<string, THREE.Quaternion>;
let yielded: string[] = [];
const L = layout();

beforeEach(async () => {
  director.reset();
  model = await mannequin();
  b = bones(model);
  rest = {};
  for (const [n, bone] of Object.entries(b)) rest[n] = bone.quaternion.clone();
  pass = createCharacter({ model, foreground: false });
  yielded = [];
});

afterEach(() => {
  pass?.dispose();
  pass = null;
  director.reset();
});

function point(region: FaceRegionKey, l: Layout = L, boxes: ReachBox[] | [] = boxesFor(l, region)): void {
  director.applyDirective({ state: 'EXPLAINING', expression: 'warm', gesture: 'point_to_hologram', intensity: 0.6 });
  pass!.setInputs({ plate: l.plate, region, phase: 'consult', avoid: boxes, onyield: (ids) => (yielded = ids) });
  // Reduced motion: every reach is instant; a second frame lets the point finish growing in.
  for (let i = 0; i < 3; i++) pass!.draw(frame(l, 0.05, true));
}

/** The left arm on screen as posed (shoulder, elbow, wrist, fingertip), at its thickness. */
function leftArm(l: Layout) {
  const p = (n: string) => b[n].getWorldPosition(new THREE.Vector3());
  const project = (q: THREE.Vector3) => worldToScreen([q.x, q.y, q.z], l.plate);
  return armSamples(
    { shoulder: p('LeftArm'), elbow: p('LeftForeArm'), wrist: p('LeftHand'), tip: p('LeftIndexTip') },
    [0.046 * STAGE.scale, 0.037 * STAGE.scale, 0.04 * STAGE.scale],
    project,
  );
}

describe('the character prototype on the mannequin', () => {
  it('loads the rig and draws through the renderer it is handed', () => {
    expect(pass!.ready).toBe(true);
    const before = rendered;
    pass!.setInputs({ plate: L.plate, region: null, phase: 'consult' });
    pass!.draw(frame(L, 0.05, true));
    expect(rendered).toBe(before + 1);
    // Nothing to draw without knowing where the plate is.
    pass!.setInputs({ plate: null, region: null, phase: 'consult' });
    expect(pass!.draw(frame(L, 0.05, true))).toBe(false);
    expect(rendered).toBe(before + 1);
  });

  it.each(WALK)('reaches for the %s anchor: fingertip on it, index along the ray through it, face turned to it', (region) => {
    point(region, L, []);
    const r = pass!.report!;
    const [ax, ay] = refToCanvas(REGION_REF[region][0], REGION_REF[region][1], L.plate);
    expect(Math.hypot(r.target[0] - ax, r.target[1] - ay)).toBeLessThan(1.5);
    const gap = Math.hypot(r.tip[0] - ax, r.tip[1] - ay);
    // The far side of the face (the other eye) is further than her arm: the fingertip gets close.
    expect(gap).toBeLessThan(region === 'periorbitalRight' ? 110 : 40);
    // On screen the finger's line runs through the anchor (when the tip is not already on it).
    if (gap > 12) expect(Math.abs(rayAngle(r.tip, r.ray) - rayAngle(r.tip, r.target))).toBeLessThan(deg(3));
    expect(r.look).toBe('region');
    expect(r.gazeError).toBeLessThan(deg(4));
  });

  it.each([1, 0.82, 1.15])('at stage scale %s: reaches every region with no part of the arm under the callout being read or the tray', (u) => {
    const l = layout(u);
    for (const region of WALK) {
      const boxes = boxesFor(l, region);
      point(region, l, boxes);
      const r = pass!.report!;
      expect(r.mode).not.toBe('blocked');
      const hard = boxes.filter((x) => !x.soft);
      const under = [...touched(leftArm(l), hard, 0)].map((x) => x.id);
      expect(under, `${region} at ${u}`).toEqual([]);
      // Only callouts not being read are named to fade.
      expect(r.yields.every((id) => boxes.find((x) => x.id === id)?.soft)).toBe(true);
      expect(yielded).toEqual(r.yields);
      const [ax, ay] = refToCanvas(REGION_REF[region][0], REGION_REF[region][1], l.plate);
      expect(Math.hypot(r.tip[0] - ax, r.tip[1] - ay), `${region} at ${u}`).toBeLessThan((region === 'periorbitalRight' ? 130 : 60) * u);
    }
  });

  it('gives a region the same reach whatever she was pointing at before', async () => {
    point('chin');
    point('cheekLeft');
    const after = b.LeftHand.getWorldPosition(new THREE.Vector3());
    // A second figure (its own mannequin) coming to the same region from another one.
    pass!.dispose();
    model = await mannequin();
    b = bones(model);
    pass = createCharacter({ model, foreground: false });
    point('forehead');
    point('cheekLeft');
    const again = b.LeftHand.getWorldPosition(new THREE.Vector3());
    expect(again.distanceTo(after)).toBeLessThan(0.005);
  });

  it('keeps the elbow, wrist and neck inside their ranges while pointing', () => {
    for (const region of FACE_REGIONS) {
      point(region);
      for (const side of ['Left', 'Right']) {
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(b[`${side}Arm`].getWorldQuaternion(new THREE.Quaternion()));
        const fo = new THREE.Vector3(0, 1, 0).applyQuaternion(b[`${side}ForeArm`].getWorldQuaternion(new THREE.Quaternion()));
        const flex = up.angleTo(fo);
        expect(flex).toBeGreaterThanOrEqual(ARM_LIMITS.minFlex - deg(0.5));
        expect(flex).toBeLessThanOrEqual(ARM_LIMITS.maxFlex + deg(0.5));
        const { swing, twist } = swingTwist(rest[`${side}Hand`].clone().invert().multiply(b[`${side}Hand`].quaternion));
        expect(angleOf(swing)).toBeLessThanOrEqual(WRIST_LIMITS.swing + 1e-4);
        expect(angleOf(twist)).toBeLessThanOrEqual(WRIST_LIMITS.twist + 1e-4);
      }
      const head = swingTwist(rest.Head.clone().invert().multiply(b.Head.quaternion));
      expect(angleOf(head.swing)).toBeLessThanOrEqual(deg(45) + 1e-4);
      expect(angleOf(head.twist)).toBeLessThanOrEqual(deg(60) + 1e-4);
    }
  });

  it('presents palm up toward the head with nothing lit, the other hand on the rim with a soft elbow (ref4)', () => {
    director.applyDirective({ state: 'IDLE', expression: 'warm', gesture: 'none', intensity: 0.5 });
    pass!.setInputs({ plate: L.plate, region: null, phase: 'consult', avoid: boxesFor(L, null) });
    for (let i = 0; i < 3; i++) pass!.draw(frame(L, 0.05, true));
    const palm = new THREE.Vector3(0, 0, 1).applyQuaternion(b.LeftHand.getWorldQuaternion(new THREE.Quaternion()));
    expect(palm.y).toBeGreaterThan(0.7);
    const r = pass!.report!;
    expect(r.mode).toBe('present');
    // Nothing fades for a hand at rest.
    expect(r.yields).toEqual([]);
    // The resting hand reaches the rim with the elbow a little bent, never locked.
    expect(r.rightReached).toBe(true);
    expect(r.rightFlex).toBeGreaterThan(deg(8));
    expect(r.rightFlex).toBeLessThan(deg(40));
    const hand = b.RightHand.getWorldPosition(new THREE.Vector3());
    const shoulder = b.RightArm.getWorldPosition(new THREE.Vector3());
    const rim = new THREE.Vector3(...rimPoint([shoulder.x, shoulder.y, shoulder.z], 0.04));
    expect(hand.y - PEDESTAL.top).toBeGreaterThan(0);
    expect(hand.y - PEDESTAL.top).toBeLessThan(0.1);
    expect(Math.hypot(hand.x - rim.x, hand.z - rim.z)).toBeLessThan(0.1);
  });

  it('holds her chin while thinking: the finger on it, the elbow short of where its skin creases', async () => {
    director.userSubmitted();
    pass!.setInputs({ plate: L.plate, region: null, phase: 'consult', avoid: boxesFor(L, null) });
    for (let i = 0; i < 60; i++) pass!.draw(frame(L, 1 / 30, false));
    const r = pass!.report!;
    expect(r.look).toBe('thought');
    expect(r.chinGap).toBeLessThan(0.015);
    expect(r.rightFlex).toBeLessThanOrEqual(deg(128));
    // Reduced motion gets there too (frames are drawn until it has).
    director.reset();
    pass!.dispose();
    model = await mannequin();
    b = bones(model);
    pass = createCharacter({ model, foreground: false });
    director.userSubmitted();
    const p2 = pass;
    p2.setInputs({ plate: L.plate, region: null, phase: 'consult' });
    let busy = true;
    for (let i = 0; i < 20 && busy; i++) busy = p2.draw(frame(L, 0.05, true));
    expect(busy).toBe(false);
    expect(p2.report!.chinGap).toBeLessThan(0.015);
  });

  it('in scan prep presents the frame with an open hand, stepping aside from a panel right beside her', () => {
    // A consent column standing where the pedestal is, its left edge at her side (as at 1672 x 941).
    const panel = { id: 'frame', x: 491 - BOX.x, y: 156, w: 690, h: 785 };
    director.applyDirective({ state: 'CLINICAL_ANALYSIS', expression: 'focused', gesture: 'none', intensity: 0.7 });
    // Where she stands before the scan.
    pass!.setInputs({ plate: L.plate, region: null, phase: 'consult' });
    pass!.draw(frame(L, 1 / 30, false));
    const before = b.Hips.getWorldPosition(new THREE.Vector3());
    pass!.setInputs({ plate: L.plate, region: null, phase: 'prep', frame: { x: panel.x + 12, y: 509 }, avoid: [panel] });
    for (let i = 0; i < 90; i++) pass!.draw(frame(L, 1 / 30, false));
    const r = pass!.report!;
    expect(r.mode).toBe('frame');
    expect([...touched(leftArm(L), [panel], 0)]).toEqual([]);
    // She moved away from the pedestal (to her right), and the palm is up.
    expect(b.Hips.getWorldPosition(new THREE.Vector3()).x).toBeLessThan(before.x - 0.05);
    const palm = new THREE.Vector3(0, 0, 1).applyQuaternion(b.LeftHand.getWorldQuaternion(new THREE.Quaternion()));
    expect(palm.y).toBeGreaterThan(0.3);
    // With room, she steps in toward the pedestal instead.
    pass!.setInputs({ plate: L.plate, region: null, phase: 'prep', frame: { x: 900, y: 300 }, avoid: [{ id: 'frame', x: 820, y: 150, w: 180, h: 300 }] });
    for (let i = 0; i < 90; i++) pass!.draw(frame(L, 1 / 30, false));
    expect(b.Hips.getWorldPosition(new THREE.Vector3()).x).toBeGreaterThan(before.x + 0.05);
  });

  it('eases from one region to the next without a jump', () => {
    point('forehead');
    director.revealRegion('acneIndicators');
    pass!.setInputs({ plate: L.plate, region: 'chin', phase: 'consult', avoid: boxesFor(L, 'chin') });
    const start = pass!.report!.tip;
    let prev = start;
    let most = 0;
    for (let i = 0; i < 90; i++) {
      pass!.draw(frame(L, 1 / 30, false));
      const tip = pass!.report!.tip;
      expect(Number.isFinite(tip[0]) && Number.isFinite(tip[1])).toBe(true);
      most = Math.max(most, Math.hypot(tip[0] - prev[0], tip[1] - prev[1]));
      prev = tip;
    }
    const travel = Math.hypot(prev[0] - start[0], prev[1] - start[1]);
    // A real move (the finger crosses the face), spread over many frames: no frame takes more
    // than a fifth of it, where a pop would take all of it at once.
    expect(travel).toBeGreaterThan(60);
    expect(most).toBeLessThan(travel * 0.2);
  });

  it('turns the hand over smoothly from a reach from below to one from above (no flip)', () => {
    // Pores / T-zone is reached from below the PORES card, cheeks from above the CHEEKS card.
    point('periorbitalLeft');
    director.revealRegion('redness');
    pass!.setInputs({ plate: L.plate, region: 'cheekLeft', phase: 'consult', avoid: boxesFor(L, 'cheekLeft') });
    let prev = pass!.report!.tip;
    let most = 0;
    for (let i = 0; i < 60; i++) {
      pass!.draw(frame(L, 1 / 30, false));
      const tip = pass!.report!.tip;
      most = Math.max(most, Math.hypot(tip[0] - prev[0], tip[1] - prev[1]));
      prev = tip;
    }
    expect(most).toBeLessThan(40);
  });

  it('moves the jaw with an audible line only, and her hand and head with its beats', () => {
    director.applyDirective({ state: 'EXPLAINING', expression: 'warm', gesture: 'none', intensity: 0.6 });
    pass!.setInputs({ plate: L.plate, region: null, phase: 'consult', avoid: boxesFor(L, null) });
    // A line with its lips shut (no voice): no jaw, no beats.
    director.elohimSpoke({ state: 'EXPLAINING', expression: 'warm', gesture: 'none', intensity: 0.6 }, 'Starting with the forehead.');
    let open = 0;
    let beat = 0;
    for (let i = 0; i < 20; i++) {
      director.step(0.05);
      pass!.draw(frame(L, 0.05, false));
      open = Math.max(open, pass!.report!.jaw);
      beat = Math.max(beat, pass!.report!.beat);
    }
    expect(open).toBe(0);
    expect(beat).toBe(0);
    // The same kind of line, heard: the jaw follows the mouth, the beats move hand and head.
    director.useSpeechTrack(new SpeechTrack('Across the T-zone the pores are more visible, and there is some oil activity.'));
    open = 0;
    const tips: [number, number][] = [];
    const chins: [number, number][] = [];
    for (let i = 0; i < 80; i++) {
      director.step(0.05);
      pass!.draw(frame(L, 0.05, false));
      open = Math.max(open, pass!.report!.jaw);
      tips.push(pass!.report!.tip);
      chins.push(pass!.report!.chin);
    }
    expect(open).toBeGreaterThan(0.2);
    const span = (xs: [number, number][]) => Math.hypot(Math.max(...xs.map((p) => p[0])) - Math.min(...xs.map((p) => p[0])), Math.max(...xs.map((p) => p[1])) - Math.min(...xs.map((p) => p[1])));
    expect(span(tips)).toBeGreaterThan(15);
    expect(span(chins)).toBeGreaterThan(6);
  });

  it('draws nothing more once disposed, frees the skeleton too, and lets go of any card it had faded', () => {
    point('forehead');
    expect(yielded.length).toBeGreaterThan(0);
    let skinned: THREE.SkinnedMesh | null = null;
    model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
    });
    let freed = 0;
    const skeleton = (skinned as unknown as THREE.SkinnedMesh).skeleton;
    const dispose = skeleton.dispose.bind(skeleton);
    skeleton.dispose = () => {
      freed++;
      dispose();
    };
    pass!.dispose();
    expect(freed).toBe(1);
    expect(yielded).toEqual([]);
    const before = rendered;
    expect(pass!.draw(frame(L, 0.05, true))).toBe(false);
    expect(rendered).toBe(before);
  });
});
