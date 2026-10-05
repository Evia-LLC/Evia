/**
 * The character prototype: the stand-in mannequin, standing in the consult
 * room beside the pedestal, drawn through the room plate's own camera.
 *
 * It is a `HologramPass`: the Scan page hands it to the hologram engine, which
 * draws it under the hologram in the same canvas and WebGL context, with the
 * engine's DPR cap, quality steps, pauses and reduced-motion rule. During the
 * scan's capture (no hologram on screen) `mountStandalone` gives it a small
 * renderer of its own instead.
 *
 * Placement. The camera is the Blender plate's (room.ts), laid over wherever
 * the page draws the plate (`plateRect`, canvas px), so she shares the plate's
 * perspective: she stands on its floor, 4.35 m out, where ref4 has Evia. Two
 * depth-only occluders put the room back in front of her: the pedestal drum
 * (the plate's own cylinder) and the foreground render's alpha (books, ledge,
 * the pedestal's band), except over the pedestal's glass top, where her hand
 * rests on the rim. What they hide shows the plate underneath, so there is no
 * seam: nothing of the room is redrawn.
 *
 * Motion. `Behaviour` (behaviour.ts) decides from `director.character` and
 * the region the page lights; this file turns the decision into world
 * targets, eases every one of them with a critically damped spring and poses
 * the rig (rig.ts, ik.ts). Beat strokes, the idle hand's drift and the talk
 * of the head are added after the springs, so their rhythm is not smoothed
 * away. Reduced motion snaps the springs (instant reaches) and drops
 * breathing, sway, drift and beats.
 *
 * Reaching. The pointing arm is planned against the page's boxes (reach.ts):
 * the callout being read and the card tray are never covered by any part of
 * the arm; a callout not being read may be, and the page fades it back while
 * her arm is in front of it (`onyield`).
 *
 * Nothing about her persists, and she reads nothing of the user: the only
 * input from the reading is which region is lit and where the hologram draws
 * it (the anchors the leader lines use).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { HologramPass, HologramPassFrame } from '@/hologram/index.ts';
import { director } from '@/stage/director.ts';
import type { FaceRegionKey } from '@shared/types.ts';
import { Behaviour, type Intent, type Phase, type Snapshot } from './behaviour.ts';
import { solveTwoBone } from './ik.ts';
import { armSamples, clearOf, clearWrist, planReach, touched, type ElbowKind, type ReachBox, type ReachMode, type ScreenRect } from './reach.ts';
import { Rig, type ArmTargets, type BodyTargets, type PoseReport } from './rig.ts';
import {
  CAMERA_HEIGHT,
  FOCAL,
  PEDESTAL,
  PLATE_ASPECT,
  PRINCIPAL,
  VIEWER,
  cameraView,
  hologramCentre,
  reachTarget,
  regionTarget,
  rimPoint,
  screenToWorld,
  worldToScreen,
  type PlateRect,
  type Vec3,
} from './room.ts';
import { spring, spring3, snapSpring, stepSpring, stepSpring3, springRestless, type Spring, type Spring3 } from './spring.ts';

export const MANNEQUIN_URL = '/character/proto/mannequin.glb';
export const FOREGROUND_URL = '/env/consult/fg-1280.webp';

const deg = (d: number): number => (d * Math.PI) / 180;
/** The mannequin's upper arm, forearm (shoulder to wrist) and hand (wrist to index tip), metres before scale. */
const UPPER = 0.282;
const FORE = 0.234;
const ARM = UPPER + FORE;
const HAND = 0.087 + 0.08;
/** Half-thickness of upper arm, forearm and hand (with the fingers), metres before scale. */
const ARM_RADIUS: [number, number, number] = [0.046, 0.037, 0.04];

/**
 * Where she stands and how she holds herself. Tuned against ref4 (Evia left of the pedestal,
 * leaning in, left palm up toward the head, right hand on the rim). `scale` makes the 1.68 m
 * mannequin the mockup's figure (about 1.82 m): ref4 draws Evia that tall at 4.35 m.
 */
export const STAGE = {
  x: -0.9,
  depth: 4.36,
  /** Body turned toward the hologram (her left), degrees. */
  yaw: 26,
  scale: 1.085,
  /** Scan prep: how far she steps in toward the pedestal, metres (less when the page leaves less room). */
  stepIn: 0.16,
  /** Arrival: how long she takes to fade in while her arms come up from her sides, seconds. */
  arrive: 0.8,
  /** Reaching for a region: her weight onto the pedestal-side foot, the pelvis this far over, metres. */
  shift: 0.07,
  /** Full lean, degrees of spine flexion; twist and side bend toward the hologram. */
  lean: 21,
  twist: 16,
  side: 9,
  /** Model-space wrist targets (x her left, y up, z forward, metres before scale). */
  present: [0.24, 1.08, 0.34] as Vec3,
  open: [0.3, 1.14, 0.36] as Vec3,
  rest: [0.2, 0.83, 0.07] as Vec3,
  /** The right hand's open-palm beat (while the left points). */
  openRight: [-0.12, 1.03, 0.33] as Vec3,
  /** How far along the arm the wrist goes for the straight point (1 = straight). */
  reach: 0.985,
  /** Thinking, the fist under the chin: how far the hand leans back toward the neck, and toward her left (+) or right (-). */
  chin: { back: 0.8, inward: -0.7 },
  /** Thinking: where she looks (model space), away to her right. */
  thought: [-0.55, 1.5, 1.3] as Vec3,
};

const CURLS = {
  relax: [6, 8, 4, 9, 10, 5, 12, 12, 6, 15, 14, 8, -8, 6, 6],
  open: [2, 3, 2, 3, 4, 2, 4, 4, 2, 6, 5, 3, -14, 2, 2],
  point: [0, 0, 0, 82, 95, 55, 88, 95, 55, 95, 90, 50, 20, 0, 0],
  rest: [10, 12, 6, 14, 14, 8, 16, 15, 8, 18, 16, 10, 0, 5, 5],
  rim: [8, 6, 3, 8, 6, 3, 9, 7, 3, 10, 8, 4, 0, 4, 4],
  /** The pensive hand: the index up along the chin, the other fingers curled, the thumb under the jaw. */
  chin: [12, 22, 12, 72, 90, 48, 80, 92, 50, 86, 88, 46, -6, 6, 4],
};

/** What the page tells the figure (all positions in the drawing canvas's CSS px). */
export interface CharacterInputs {
  /** Where the whole room plate is drawn; null until known (she is not drawn without it). */
  plate: PlateRect | null;
  /** The region lit on the hologram (the callout she is on), or null. */
  region: FaceRegionKey | null;
  phase: Phase;
  /** Scan prep: the point of the camera frame to gesture toward (its near edge, in view). */
  frame?: { x: number; y: number } | null;
  /**
   * The page's boxes over the canvas: the callouts and the card tray (and in scan prep, the
   * frame). A `soft` box (a callout not being read) may have her arm in front of it; every
   * other box is kept clear of the whole arm.
   */
  avoid?: ReachBox[];
  /** Told which soft boxes her arm is in front of now (their ids), whenever that changes. */
  onyield?: (ids: string[]) => void;
}

interface ArmState {
  wrist: Spring3;
  pole: Spring3;
  dir: Spring3;
  palm: Spring3;
  target: Spring3;
  curls: Spring[];
  spread: Spring;
  point: Spring;
  shrug: Spring;
}

function armState(curls: number[]): ArmState {
  return {
    wrist: spring3(),
    pole: spring3(),
    dir: spring3(),
    palm: spring3(),
    target: spring3(),
    curls: curls.map((c) => spring(c)),
    spread: spring(4),
    point: spring(0),
    shrug: spring(0),
  };
}

const v3 = (a: readonly number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
type ReachOptionsTrace = NonNullable<Parameters<typeof planReach>[0]['trace']>;

export interface CharacterReport extends PoseReport {
  /** The left arm's pose ('straight' / 'under' / 'blocked' for a point). */
  mode: string;
  /** What she looks at, and the angle (radians) between her face's forward and the way to it. */
  look: string;
  gazeError: number;
  /** Jaw opening 0..1, speech energy 0..1 and the beat stroke 0..1 this frame. */
  jaw: number;
  energy: number;
  beat: number;
  /** Canvas px: the left index tip, a point 0.4 m along its ray, and the point target. */
  tip: [number, number];
  ray: [number, number];
  target: [number, number];
  /** Canvas px: the left elbow and wrist (the reach's shape on screen), the chin and the top of the head. */
  elbow: [number, number];
  wrist: [number, number];
  chin: [number, number];
  head: [number, number];
  /** The soft boxes her arm is in front of (the page fades them). */
  yields: string[];
  /** Thinking: the fist's knuckles to the chin, metres (NaN otherwise). */
  chinGap: number;
  /** 0..1: how far she has faded in. */
  presence: number;
}

export interface CharacterPass extends HologramPass {
  /** False until the mannequin has loaded; `onReady` fires then. */
  readonly ready: boolean;
  setInputs(inputs: CharacterInputs): void;
  /** For development: the last pose's report (pointing error, flexion, where the index ray lands). */
  readonly report: CharacterReport | null;
  /** For development: the lights, to tune against the plate from the console. */
  readonly lights: Record<'hemi' | 'key' | 'rim' | 'fill', THREE.Light>;
}

export interface CharacterOptions {
  /** Called once the mannequin is loaded (the host asks for a frame). */
  onReady?: () => void;
  /** Tests: skip loading and use this skeleton root instead. */
  model?: THREE.Object3D;
  /** Tests: no texture loading. */
  foreground?: false;
}

export function createCharacter(options: CharacterOptions = {}): CharacterPass {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.set(0, CAMERA_HEIGHT, 0);

  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ---- light: the room's (anchors.json light): a cool key from the hologram, a warm rose rim
  // from the left wall's coves, the room's dusky ambient and a little warm fill from the front.
  const hemi = new THREE.HemisphereLight(0xb89090, 0x1c1214, 0.6);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0x9cbaf4, 3.0);
  key.position.set(PEDESTAL.x + 0.2, 1.75, -PEDESTAL.depth + 0.25);
  const rim = new THREE.DirectionalLight(0xf8ad99, 3.4);
  rim.position.set(-4.5, 2.6, -8.5);
  const fill = new THREE.DirectionalLight(0xf2c2ae, 1.0);
  fill.position.set(-1.6, 1.9, 0.4);
  const lightTarget = new THREE.Object3D();
  lightTarget.position.set(STAGE.x, 1.2, -STAGE.depth);
  scene.add(lightTarget);
  for (const l of [key, rim, fill]) {
    l.target = lightTarget;
    scene.add(l);
  }

  // ---- occluders: depth only, drawn first -------------------------------------------------
  const hidden = own(new THREE.MeshBasicMaterial({ colorWrite: false }));
  const drum = new THREE.Mesh(own(new THREE.CylinderGeometry(PEDESTAL.radius + 0.004, PEDESTAL.radius + 0.004, PEDESTAL.top, 96)), hidden);
  drum.position.set(PEDESTAL.x, PEDESTAL.top / 2, -PEDESTAL.depth);
  drum.renderOrder = -10;
  scene.add(drum);

  // The foreground render's alpha, on a plane in front of her covering the plate's whole view.
  const fgDepth = 2.2;
  const fgW = fgDepth / FOCAL;
  const fgH = (fgDepth * PLATE_ASPECT) / FOCAL;
  const fgGeo = own(new THREE.PlaneGeometry(fgW, fgH));
  const e = PEDESTAL.topEllipse;
  const fgU = {
    uFg: { value: null as THREE.Texture | null },
    // The glass top's ellipse, a little larger to take the rim's lip and glow.
    uEll: { value: new THREE.Vector4(e.cx, e.cy, e.rx * 1.012, e.ry * 1.14) },
  };
  const fgMat = own(
    new THREE.ShaderMaterial({
      uniforms: fgU,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFg;
        uniform vec4 uEll;
        varying vec2 vUv;
        void main() {
          vec2 p = vec2(vUv.x, 1.0 - vUv.y);
          vec2 q = (p - uEll.xy) / uEll.zw;
          if (dot(q, q) < 1.0) discard;
          if (texture2D(uFg, vUv).a < 0.5) discard;
          gl_FragColor = vec4(0.0);
        }`,
    }),
  );
  fgMat.colorWrite = false;
  const fgPlane = new THREE.Mesh(fgGeo, fgMat);
  // Plate u 0..1 spans x -fgW/2..fgW/2; v 0..1 spans the rows from the principal point.
  fgPlane.position.set((0.5 - PRINCIPAL.u) * fgW, CAMERA_HEIGHT - (0.5 - PRINCIPAL.v) * fgH, -fgDepth);
  fgPlane.renderOrder = -9;
  fgPlane.visible = false;
  scene.add(fgPlane);
  if (options.foreground !== false) {
    new THREE.TextureLoader().load(
      FOREGROUND_URL,
      (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        own(tex);
        tex.colorSpace = THREE.NoColorSpace;
        fgU.uFg.value = tex;
        fgPlane.visible = true;
        options.onReady?.();
      },
      undefined,
      () => {
        // No foreground render: the drum alone still hides her behind the pedestal.
      },
    );
  }

  // ---- the figure -----------------------------------------------------------------------
  const holder = new THREE.Group();
  holder.scale.setScalar(STAGE.scale);
  holder.rotation.y = deg(STAGE.yaw);
  scene.add(holder);
  let rig: Rig | null = null;
  let skin: THREE.MeshPhysicalMaterial | null = null;
  let disposed = false;
  let ready = false;

  function adopt(model: THREE.Object3D): void {
    let skinned: THREE.SkinnedMesh | null = null;
    model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh;
    });
    const mesh = skinned as THREE.SkinnedMesh | null;
    if (!mesh) throw new Error('mannequin: no skinned mesh');
    // A matte rose-cream with a touch of sheen, as the asset's README suggests.
    const old = mesh.material as THREE.Material;
    skin = own(
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0xebd2c8),
        roughness: 0.6,
        metalness: 0,
        sheen: 0.35,
        sheenRoughness: 0.6,
        sheenColor: new THREE.Color(0xf3c9bd),
      }),
    );
    mesh.material = skin;
    old?.dispose?.();
    mesh.frustumCulled = false;
    own(mesh.geometry);
    // The skeleton's bone texture is a GPU resource of its own.
    own(mesh.skeleton);
    holder.add(model);
    rig = new Rig(holder, mesh.skeleton.bones);
    ready = true;
    options.onReady?.();
  }

  if (options.model) {
    adopt(options.model);
  } else {
    new GLTFLoader().loadAsync(MANNEQUIN_URL).then(
      (gltf) => {
        if (disposed) return;
        adopt(gltf.scene);
      },
      (err) => console.warn('[character] the mannequin could not load', err),
    );
  }

  // ---- state ------------------------------------------------------------------------
  const behaviour = new Behaviour();
  let inputs: CharacterInputs = { plate: null, region: null, phase: 'consult', frame: null };
  let clock = 0;
  let report: CharacterReport | null = null;
  let entered = false;

  const rootS = spring3();
  const lookS = spring3();
  const leanS = spring(0);
  const twistS = spring(0);
  const tiltS = spring(0);
  const jawS = spring(0);
  const stepS = spring(0);
  const shiftS = spring(0);
  let strideDist = 0;
  let strideAmount = 0;
  const appear = spring(0);
  const left = armState(CURLS.relax);
  const right = armState(CURLS.rim);
  const shoulderL = new THREE.Vector3();
  const shoulderR = new THREE.Vector3();
  let shouldersKnown = false;
  /** Thinking: the right wrist to the fist's knuckles as last posed (world), and how far they are from the chin. */
  const fistOffset = new THREE.Vector3();
  const chinAt = new THREE.Vector3();
  let fistKnown = false;
  let chinGap = NaN;
  /** The body pose of this frame, and the canonical pointing pose (for planning without history). */
  let bodyNow: BodyTargets | null = null;

  function snapshot(): Snapshot {
    const c = director.character;
    return {
      state: c.state,
      gesture: c.gesture,
      gestureSeq: c.gestureSeq,
      speaking: c.speaking,
      mouthOpen: c.mouthOpen,
      attention: c.attention,
      region: inputs.region,
      phase: inputs.phase,
    };
  }

  /** A model-space point (her frame, unscaled metres) in the world, for the current root. */
  function model(p: readonly number[]): THREE.Vector3 {
    return holder.localToWorld(v3(p));
  }
  /** A model-space direction in the world. */
  function modelDir(p: readonly number[]): THREE.Vector3 {
    return v3(p).applyQuaternion(holder.quaternion).normalize();
  }

  function world(p: Vec3): THREE.Vector3 {
    return v3(p);
  }

  interface ArmGoal {
    wrist: THREE.Vector3;
    pole: THREE.Vector3;
    dir: THREE.Vector3;
    palm: THREE.Vector3;
    curls: number[];
    spread: number;
    point: number;
    target: THREE.Vector3;
    shrug: number;
    limits?: ArmTargets['limits'];
  }

  const projector = (rect: PlateRect) => (p: THREE.Vector3) => worldToScreen([p.x, p.y, p.z], rect);

  /**
   * The pointing arm's elbow direction: straight, out and down; from below, down and back; or
   * held out to her side, nearly level (to keep a straight reach's elbow off a card below it).
   */
  function pointPole(lowered: boolean, elbow: ElbowKind = 'down'): THREE.Vector3 {
    if (elbow === 'out') return new THREE.Vector3(0, -0.35, 0).addScaledVector(modelDir([1, 0, -0.45]), 1).normalize();
    if (elbow === 'up') return new THREE.Vector3(0, 1, 0).addScaledVector(modelDir([0.3, 0, -0.6]), 1).normalize();
    return lowered
      ? new THREE.Vector3(0, -1, 0).addScaledVector(modelDir([0.5, 0, -1]), 0.6)
      : new THREE.Vector3(0, -1, 0).addScaledVector(modelDir([1, 0, 0]), 0.55).addScaledVector(modelDir([0, 0, -1]), 0.3);
  }

  /** Where her left shoulder is in the canonical pointing pose (no breath, sway or shrug). */
  function canonicalShoulder(lean: number): THREE.Vector3 {
    if (!rig || !bodyNow) return shoulderL.clone();
    const canon: BodyTargets = { ...bodyNow, lean: lean * deg(STAGE.lean), twist: deg(STAGE.twist), side: lean * deg(STAGE.side), breath: 0, sway: 0, shift: STAGE.shift };
    rig.poseBody(canon, 0, 0);
    const s = rig.b('LeftArm').getWorldPosition(new THREE.Vector3());
    // Back to this frame's body.
    rig.poseBody(bodyNow, left.shrug.x, right.shrug.x);
    return s;
  }

  const hardOnly = (boxes: readonly ReachBox[]): ScreenRect[] => boxes.filter((b) => !b.soft);

  /*
   * The pointing reach is planned once per region (and again only if the plan stops being
   * clear), not every frame: the hologram's float must not make the arm hop between two
   * reaches. It is planned from the canonical pointing pose, so the same region always gets
   * the same reach whatever she was doing before, and kept as an offset from the shoulder.
   */
  let reachKey = '';
  let reachAt = -Infinity;
  let reachOffset = new THREE.Vector3();
  let reachMode: ReachMode = 'straight';
  let reachElbow: ElbowKind = 'down';
  let plannedYields: string[] = [];
  function pointReach(region: FaceRegionKey | null, s: THREE.Vector3, t: THREE.Vector3, rect: PlateRect, lean: number): { wrist: THREE.Vector3; mode: ReachMode; elbow: ElbowKind } {
    const boxes = inputs.avoid ?? [];
    const key = `${region}|${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)}|${boxes
      .map((r) => `${r.id ?? ''}${r.soft ? '~' : ''}${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`)
      .join(';')}`;
    const project = projector(rect);
    const cached = s.clone().add(reachOffset);
    const stale = key !== reachKey || (clock - reachAt > 0.6 && reachMode !== 'blocked' && !clearOf([project(cached)], hardOnly(boxes), 0));
    if (stale) {
      const s0 = canonicalShoulder(lean);
      const plan = planReach({
        shoulder: s0,
        target: t,
        upper: UPPER * STAGE.scale,
        fore: FORE * STAGE.scale,
        hand: HAND * STAGE.scale,
        project,
        boxes,
        pole: (lowered, elbow) => pointPole(lowered, elbow),
        radius: ARM_RADIUS.map((r) => r * STAGE.scale) as [number, number, number],
        trace: (globalThis as { __reachTrace?: ReachOptionsTrace }).__reachTrace,
      });
      reachKey = key;
      reachAt = clock;
      reachMode = plan.mode;
      reachElbow = plan.elbow;
      reachOffset = plan.wrist.clone().sub(s0);
      plannedYields = plan.yields;
    }
    return { wrist: s.clone().add(reachOffset), mode: reachMode, elbow: reachElbow };
  }

  /** Scan prep: the open hand's place, planned once per frame target and boxes (as the point is). */
  let frameKey = '';
  let frameOffset = new THREE.Vector3();
  function frameReach(s: THREE.Vector3, t: THREE.Vector3, rect: PlateRect): THREE.Vector3 {
    const boxes = inputs.avoid ?? [];
    const f = inputs.frame;
    const key = `${f ? `${Math.round(f.x)},${Math.round(f.y)}` : '-'}|${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)}|${boxes
      .map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`)
      .join(';')}`;
    if (key !== frameKey) {
      const plan = planReach({
        shoulder: s,
        target: t,
        upper: UPPER * STAGE.scale,
        fore: FORE * STAGE.scale,
        hand: HAND * STAGE.scale,
        project: projector(rect),
        boxes: boxes.map((b) => ({ ...b, soft: false })),
        pole: () => new THREE.Vector3(0, -1, 0).addScaledVector(modelDir([1, 0, -0.3]), 0.7),
        radius: ARM_RADIUS.map((r) => r * STAGE.scale) as [number, number, number],
        // The frame's panel may stand right beside her: the open hand then presents it from in
        // front of her (the reach turned toward the viewer).
        turns: [0, -20, -40, -60, -80],
      });
      frameKey = key;
      frameOffset = plan.wrist.clone().sub(s);
    }
    return s.clone().add(frameOffset);
  }

  /** A resting left hand kept clear of every box (nothing fades for a hand at rest). */
  function clearRest(wrist: THREE.Vector3, along: THREE.Vector3, rect: PlateRect, pole: THREE.Vector3): THREE.Vector3 {
    const boxes = inputs.avoid ?? [];
    if (!boxes.length) return wrist;
    const s = shouldersKnown ? shoulderL : model([0.17, 1.36, 0.05]);
    const elbow = solveTwoBone(s, wrist, UPPER * STAGE.scale, FORE * STAGE.scale, pole).elbow;
    return clearWrist(wrist, along, HAND * STAGE.scale, STAGE.scale, projector(rect), boxes, 8, elbow);
  }

  function leftGoal(intent: Intent, rect: PlateRect, anchors: HologramPassFrame['anchors'] | null): ArmGoal {
    const up = new THREE.Vector3(0, 1, 0);
    const toward = world(hologramCentre(rect));
    switch (intent.left) {
      case 'point': {
        // The region's spot on screen, and the point on its camera ray she can reach: her
        // fingertip goes onto the spot, her index along the ray through it.
        const region = inputs.region;
        const spot = worldToScreen(region ? regionTarget(region, anchors?.[region] ?? null, rect) : hologramCentre(rect), rect);
        const s = shouldersKnown ? shoulderL.clone() : model([0.17, 1.36, 0.05]);
        const t = world(reachTarget(spot.x, spot.y, [s.x, s.y, s.z], rect));
        const { wrist, mode, elbow } = pointReach(region, s, t, rect, intent.lean);
        const elev = mode === 'straight' ? Math.max(0, t.y - s.y) / Math.max(0.1, t.distanceTo(s)) : 0;
        // The hand travels relaxed and points as it arrives, as a person does: while the wrist is
        // still far from its place the point eases off (the hand follows its springs, so a reach
        // from below to one from above turns the hand over smoothly instead of flipping it).
        const travel = left.wrist.primed ? v3(left.wrist.x).distanceTo(wrist) / STAGE.scale : 0;
        return {
          wrist,
          pole: pointPole(mode === 'under', elbow),
          dir: t.clone().sub(wrist).normalize(),
          palm: new THREE.Vector3(0, -1, 0).addScaledVector(modelDir([-1, 0, 0]), 0.45).normalize(),
          curls: CURLS.point,
          spread: 0,
          point: travel > 0.14 ? 0.25 : 1,
          target: t,
          shrug: deg(10) * elev,
        };
      }
      case 'open': {
        const pole = new THREE.Vector3(0, -1, 0).addScaledVector(modelDir([1, 0, -0.4]), 0.8);
        const dir = modelDir([0.55, 0.05, 1]);
        return {
          wrist: clearRest(model(STAGE.open), dir, rect, pole),
          pole,
          dir,
          palm: new THREE.Vector3(0, 1, 0).addScaledVector(modelDir([0, 0, 1]), 0.7).normalize(),
          curls: CURLS.open,
          spread: 10,
          point: 0,
          target: toward,
          shrug: deg(2),
        };
      }
      case 'rest':
        return {
          wrist: model(STAGE.rest),
          pole: modelDir([0.35, -0.1, -1]),
          dir: new THREE.Vector3(0, -1, 0).addScaledVector(modelDir([0, 0, 1]), 0.15).normalize(),
          palm: modelDir([-1, 0, 0.1]),
          curls: CURLS.rest,
          spread: 3,
          point: 0,
          target: toward,
          shrug: 0,
        };
      case 'frame': {
        // An open palm toward the camera frame, the whole arm kept off it (it is a hard box).
        const f = inputs.frame;
        const t = f ? world(screenToWorld(f.x, f.y, PEDESTAL.depth - 0.3, rect)) : toward;
        const s = shouldersKnown ? shoulderL.clone() : model([0.17, 1.36, 0.05]);
        const wrist = frameReach(s, t, rect);
        const d = t.clone().sub(wrist).normalize();
        return {
          wrist,
          pole: new THREE.Vector3(0, -1, 0).addScaledVector(modelDir([1, 0, -0.3]), 0.7),
          // The hand runs toward the frame, palm up and turned to it: "here".
          dir: d.clone().addScaledVector(up, 0.15).normalize(),
          palm: up.clone().addScaledVector(d, 0.45).normalize(),
          curls: CURLS.open,
          spread: 9,
          point: 0,
          target: t,
          shrug: deg(3),
        };
      }
      case 'present':
      default: {
        const flat = toward.clone().sub(model(STAGE.present)).setY(0).normalize();
        const pole = new THREE.Vector3(0, -1, 0).addScaledVector(modelDir([1, 0, -0.35]), 0.75);
        return {
          wrist: clearRest(model(STAGE.present), flat, rect, pole),
          pole,
          dir: flat.clone().addScaledVector(up, 0.05).normalize(),
          palm: up.clone().addScaledVector(modelDir([-1, 0, 0]), 0.15).normalize(),
          curls: CURLS.relax,
          spread: 5,
          point: 0,
          target: toward,
          shrug: deg(2),
        };
      }
    }
  }

  /** The chin: the point under it where a fist would hold it (the jaw bone's far end, a little down). */
  function chinPoint(): THREE.Vector3 {
    const jaw = rig?.b('Jaw');
    if (!jaw) return model([0, 1.45, 0.08]);
    return jaw.localToWorld(new THREE.Vector3(0, 0.1, 0)).add(new THREE.Vector3(0, -0.012 * STAGE.scale, 0));
  }

  /** Where the hand touches the chin: the index finger's last knuckle (the finger's pad lies on the chin). */
  function fistTop(): THREE.Vector3 {
    if (!rig) return new THREE.Vector3();
    return rig.b('RightIndex3').getWorldPosition(new THREE.Vector3());
  }

  function rightGoal(intent: Intent, rect: PlateRect): ArmGoal {
    const up = new THREE.Vector3(0, 1, 0);
    switch (intent.right) {
      case 'chin': {
        // A loose fist under the chin: the forearm up in front of the chest, the hand leaning
        // back toward the neck and across toward her right, the palm toward her, the elbow down
        // and in front. The wrist goes where the fist's knuckles (as the hand is shaped now)
        // land on the chin: `fistOffset` is last frame's wrist-to-knuckles, so the contact holds
        // whatever the hand's exact shape, with no correction to wind up.
        // The chin where the head was last drawn (the head turns after the arms are posed).
        const chin = fistKnown ? chinAt.clone() : chinPoint();
        const chestQ = rig ? rig.b('Spine2').getWorldQuaternion(new THREE.Quaternion()) : holder.quaternion.clone();
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chestQ).setY(0).normalize();
        const herLeft = new THREE.Vector3(1, 0, 0).applyQuaternion(chestQ).setY(0).normalize();
        const handDir = up.clone().addScaledVector(fwd, -STAGE.chin.back).addScaledVector(herLeft, STAGE.chin.inward).normalize();
        if (!fistKnown) fistOffset.copy(handDir).multiplyScalar(0.15 * STAGE.scale);
        return {
          wrist: chin.clone().sub(fistOffset),
          pole: new THREE.Vector3(0, -1, 0).addScaledVector(fwd, 0.35).addScaledVector(herLeft, -0.35),
          dir: handDir,
          palm: fwd.clone().negate().addScaledVector(up, -0.35).normalize(),
          curls: CURLS.chin,
          spread: 0,
          point: 0,
          target: chin,
          shrug: deg(3),
          // The forearm crosses toward her middle: past a reach's limit, natural for a hand at the face.
          limits: { maxAcross: 0.85 },
        };
      }
      case 'open':
        // An open-palm beat while the left hand points: off the rim, palm up, toward you.
        return {
          wrist: model(STAGE.openRight),
          pole: new THREE.Vector3(0, -1, 0).addScaledVector(modelDir([-1, 0, -0.3]), 0.7),
          dir: modelDir([0.35, 0.1, 1]),
          palm: up.clone().addScaledVector(modelDir([0.2, 0, 1]), 0.5).normalize(),
          curls: CURLS.open,
          spread: 10,
          point: 0,
          target: model([0, 1.1, 1.2]),
          shrug: deg(2),
        };
      case 'rest':
        return {
          wrist: model([-STAGE.rest[0], STAGE.rest[1], STAGE.rest[2]]),
          pole: modelDir([-0.35, -0.1, -1]),
          dir: new THREE.Vector3(0, -1, 0).addScaledVector(modelDir([0, 0, 1]), 0.15).normalize(),
          palm: modelDir([1, 0, 0.1]),
          curls: CURLS.rest,
          spread: 3,
          point: 0,
          target: model([0, 1, 1]),
          shrug: 0,
        };
      case 'rim':
      default: {
        const s = shouldersKnown ? shoulderR.clone() : model([-0.17, 1.36, 0.05]);
        const rimAt = world(rimPoint([s.x, s.y, s.z], 0.04));
        const inward = new THREE.Vector3(PEDESTAL.x - rimAt.x, 0, -PEDESTAL.depth - rimAt.z).normalize();
        // The palm lies on the rim, fingers toward the middle: the wrist sits a hand's length
        // back from the fingers and a little above the glass - and no further from the
        // shoulder than a relaxed arm reaches (a soft elbow, never a locked one).
        let wrist = rimAt.clone().addScaledVector(inward, -0.05 * STAGE.scale).add(new THREE.Vector3(0, 0.045 * STAGE.scale, 0));
        const most = ARM * STAGE.scale * 0.985;
        if (wrist.distanceTo(s) > most) wrist = s.clone().add(wrist.clone().sub(s).setLength(most));
        void rect;
        return {
          wrist,
          pole: modelDir([-1, -0.2, -0.5]),
          dir: inward.clone().addScaledVector(up, -0.35).normalize(),
          palm: new THREE.Vector3(0, -1, 0),
          curls: CURLS.rim,
          spread: 4,
          point: 0,
          target: rimAt,
          shrug: 0,
        };
      }
    }
  }

  function ease(arm: ArmState, goal: ArmGoal, dt: number, snap: boolean, fast: boolean): ArmTargets {
    // A reach takes about 0.6 s (4 / omega for 90% of the way), a relaxed move a little longer.
    const w = fast ? 7 : 6;
    const wrist = stepSpring3(arm.wrist, goal.wrist.toArray(), w, dt, snap);
    const pole = stepSpring3(arm.pole, goal.pole.toArray(), 6, dt, snap);
    const dir = stepSpring3(arm.dir, goal.dir.toArray(), 10, dt, snap);
    const palm = stepSpring3(arm.palm, goal.palm.toArray(), 10, dt, snap);
    const target = stepSpring3(arm.target, goal.target.toArray(), 8, dt, snap);
    const curls = arm.curls.map((c, i) => (snap ? snapSpring(c, goal.curls[i]) : stepSpring(c, goal.curls[i], 12, dt)));
    const spread = snap ? snapSpring(arm.spread, goal.spread) : stepSpring(arm.spread, goal.spread, 10, dt);
    const point = snap ? snapSpring(arm.point, goal.point) : stepSpring(arm.point, goal.point, 8, dt);
    const shrug = snap ? snapSpring(arm.shrug, goal.shrug) : stepSpring(arm.shrug, goal.shrug, 6, dt);
    return {
      wrist: v3(wrist),
      pole: v3(pole).normalize(),
      handDir: v3(dir).normalize(),
      palm: v3(palm).normalize(),
      curls,
      spread,
      point: Math.max(0, Math.min(1, point)),
      pointTarget: v3(target),
      shrug,
      limits: goal.limits,
      // A hand turns at most about 6 rad/s (reduced motion: at once).
      maxTurn: snap ? undefined : Math.max(0.02, 6 * dt),
    };
  }

  function restless(arm: ArmState, goal: ArmGoal): number {
    return springRestless(arm.wrist, goal.wrist.toArray()) + springRestless(arm.dir, goal.dir.toArray()) + Math.abs(arm.point.x - goal.point);
  }

  function lookPoint(intent: Intent, rect: PlateRect, anchors: HologramPassFrame['anchors'] | null): THREE.Vector3 {
    switch (intent.look) {
      case 'region':
        return inputs.region ? world(regionTarget(inputs.region, anchors?.[inputs.region] ?? null, rect)) : world(hologramCentre(rect));
      case 'hologram':
        return world(hologramCentre(rect));
      case 'frame':
        return inputs.frame ? world(screenToWorld(inputs.frame.x, inputs.frame.y, PEDESTAL.depth - 0.3, rect)) : world(hologramCentre(rect));
      case 'thought':
        // Away to her right and a little down, into the thought (the chin comes forward onto the fist).
        return model(STAGE.thought);
      case 'viewer':
      default:
        return world(VIEWER);
    }
  }

  /**
   * Scan prep: how far she steps toward the pedestal, in `STAGE.stepIn`s: in (up to 1) when the
   * frame leaves room, out and away (down to -2) when its panel stands right beside her, so her
   * open hand has room beside her to present it (at least 0.2 m of the frame's side free).
   */
  function stepRoom(station: (k: number) => THREE.Vector3, rect: PlateRect): number {
    const boxes = hardOnly(inputs.avoid ?? []);
    if (!boxes.length || !shouldersKnown) return 1;
    const offset = shoulderL.clone().sub(holder.position);
    const project = projector(rect);
    for (let k = 1; k >= -2; k -= 0.125) {
      const at = station(k).add(offset);
      const p = project(at);
      const room = project(at.clone().add(new THREE.Vector3(0.2 * STAGE.scale, 0, 0))).x - p.x;
      const blocked = boxes.some((b) => b.y < p.y + 4 * room && b.y + b.h > p.y - room && p.x + room > b.x);
      if (!blocked) return k;
    }
    return -2;
  }

  // ---- which soft boxes her arm is in front of (the page fades them) --------------------
  const seen = new Map<string, number>();
  let yielded: string[] = [];
  function updateYields(intent: Intent, rect: PlateRect): void {
    const soft = (inputs.avoid ?? []).filter((b) => b.soft && b.id);
    const now: string[] = [];
    if (rig && soft.length && (intent.left === 'point' || left.point.x > 0.05)) {
      if (intent.left === 'point') now.push(...plannedYields);
      const p = (n: string) => rig!.b(n).getWorldPosition(new THREE.Vector3());
      const samples = armSamples(
        { shoulder: p('LeftArm'), elbow: p('LeftForeArm'), wrist: p('LeftHand'), tip: p('LeftIndexTip') },
        ARM_RADIUS.map((r) => r * STAGE.scale) as [number, number, number],
        projector(rect),
      );
      for (const b of touched(samples, soft, 2)) now.push(b.id!);
    }
    for (const id of now) seen.set(id, clock);
    // A card comes back a moment after the arm has left it, never in and out on one frame - and
    // at once when it becomes the one being read.
    const softIds = new Set(soft.map((b) => b.id));
    const next = [...seen.entries()].filter(([id, at]) => clock - at < 0.3 && softIds.has(id)).map(([id]) => id).sort();
    for (const [id, at] of seen) if (clock - at >= 0.3) seen.delete(id);
    if (next.join('|') !== yielded.join('|')) {
      yielded = next;
      inputs.onyield?.(next);
    }
  }

  function draw(frame: HologramPassFrame): boolean {
    const rect = inputs.plate;
    if (!rig || !rect || disposed) return false;
    const reduced = frame.reducedMotion;
    const dt = frame.dt;
    clock += dt;

    // Camera: the plate's, laid over this canvas.
    const view = cameraView(rect, frame.cssW, frame.cssH);
    camera.fov = view.fovDeg;
    camera.aspect = view.aspect;
    camera.setViewOffset(view.fullW, view.fullH, view.offsetX, view.offsetY, frame.cssW, frame.cssH);
    camera.updateProjectionMatrix();

    const intent = behaviour.decide(snapshot(), dt, reduced);
    const snap = reduced;

    // Where she stands: her station, stepped in for the scan (as far as the page leaves room).
    const toPed = new THREE.Vector3(PEDESTAL.x - STAGE.x, 0, -PEDESTAL.depth + STAGE.depth).normalize();
    const station = (k: number) => new THREE.Vector3(STAGE.x, 0, -STAGE.depth).addScaledVector(toPed, STAGE.stepIn * k);
    const stepK = intent.step > 0 ? intent.step * stepRoom(station, rect) : 0;
    // A move of her feet is stepped, not glided: a stride per 0.3 m, as fast as she goes.
    const before = rootS.primed ? v3(rootS.x) : null;
    const step = snap ? snapSpring(stepS, stepK) : stepSpring(stepS, stepK, 3.2, dt);
    holder.rotation.y = deg(STAGE.yaw);
    holder.scale.setScalar(STAGE.scale);

    // Idle life: breathing, a slow weight shift, the head's drift (none under reduced motion).
    const breath = reduced ? 0 : Math.sin((clock * Math.PI * 2) / 4.2);
    const sway = reduced ? 0 : Math.sin((clock * Math.PI * 2) / 8.5) * 0.85 + Math.sin(clock * 0.41 + 0.7) * 0.3;
    const herLeft = modelDir([1, 0, 0]);
    const root = stepSpring3(rootS, station(step).toArray(), 3.2, dt, true);
    holder.position.set(root[0], 0, root[2]);
    if (before && dt > 0) {
      const moved = Math.hypot(root[0] - before.x, root[2] - before.z);
      strideDist += moved;
      strideAmount += (Math.min(1, moved / dt / 0.22) - strideAmount) * Math.min(1, dt * 8);
    }
    holder.updateMatrixWorld(true);

    // Arrival: she fades in where she stands while her arms come up from her sides.
    if (!entered) {
      entered = true;
      if (!reduced) {
        const restL = leftGoal({ ...intent, left: 'rest' }, rect, null);
        const restR = rightGoal({ ...intent, right: 'rest' }, rect);
        ease(left, restL, 0, true, false);
        ease(right, restR, 0, true, false);
      }
    }
    const presence = reduced ? snapSpring(appear, 1) : Math.min(1, appear.x + dt / STAGE.arrive);
    appear.x = presence;
    if (skin) {
      const fading = presence < 0.999;
      if (skin.transparent !== fading) {
        skin.transparent = fading;
        skin.needsUpdate = true;
      }
      skin.opacity = fading ? presence * presence * (3 - 2 * presence) : 1;
    }

    const anchors = frame.anchors ?? null;
    const look = stepSpring3(lookS, lookPoint(intent, rect, anchors).toArray(), 6.5, dt, snap);
    const jaw = snap ? snapSpring(jawS, intent.jaw) : stepSpring(jawS, intent.jaw, 30, dt);
    // Talking moves the head with the mouth: up a little as it opens, a slow turn over the line.
    const talk = reduced ? 0 : intent.energy;
    // Her weight goes onto the pedestal-side foot as she reaches (a little while presenting).
    const shiftGoal = intent.left === 'point' ? STAGE.shift : intent.left === 'frame' ? 0.04 : 0.02;
    const body: BodyTargets = {
      lean: (snap ? snapSpring(leanS, intent.lean) : stepSpring(leanS, intent.lean, 3, dt)) * deg(STAGE.lean),
      twist: (snap ? snapSpring(twistS, 1) : stepSpring(twistS, 1, 3, dt)) * deg(STAGE.twist),
      side: leanS.x * deg(STAGE.side),
      breath,
      sway,
      shift: snap ? snapSpring(shiftS, shiftGoal) : stepSpring(shiftS, shiftGoal, 3, dt),
      stride: reduced ? 0 : strideAmount,
      stridePhase: (strideDist / (0.3 * STAGE.scale)) * Math.PI,
      look: v3(look),
      tilt: snap ? snapSpring(tiltS, intent.tilt) : stepSpring(tiltS, intent.tilt, 7, dt),
      nod: reduced ? 0 : intent.nod - deg(3) * (jaw - 0.35) * talk,
      jaw,
      driftYaw: reduced ? 0 : deg(1.6) * Math.sin(clock * 0.47 + 1.1) + deg(2.5) * Math.sin(clock * 1.7) * talk,
      driftPitch: reduced ? 0 : deg(1.2) * Math.sin(clock * 0.61 + 0.3),
    };

    // The body first: the arms' goals start from where this frame's shoulders are.
    bodyNow = body;
    rig.poseBody(body, left.shrug.x, right.shrug.x);
    rig.b('LeftArm').getWorldPosition(shoulderL);
    rig.b('RightArm').getWorldPosition(shoulderR);
    shouldersKnown = true;
    const lGoal = leftGoal(intent, rect, anchors);
    // Stepped away from the pedestal (scan prep beside a panel), the rim is out of reach: that hand rests.
    const rGoal = rightGoal(step < -0.3 && intent.right === 'rim' ? { ...intent, right: 'rest' } : intent, rect);
    const lT = ease(left, lGoal, dt, snap, intent.left === 'point');
    const rT = ease(right, rGoal, dt, snap, false);

    // After the springs (so the rhythm is not smoothed away): the beat stroke and the idle drift.
    const beat = intent.beat;
    const upV = new THREE.Vector3(0, 1, 0);
    if (!reduced) {
      if (intent.left === 'point') {
        // A jab along the pointing line on the stressed syllable.
        lT.wrist.addScaledVector(lT.pointTarget!.clone().sub(lT.wrist).normalize(), 0.04 * STAGE.scale * beat);
        lT.wrist.addScaledVector(upV, 0.012 * STAGE.scale * beat);
      } else if (intent.left === 'present' || intent.left === 'open') {
        // The palm-up hand strokes down and out, and drifts a little while she waits.
        lT.wrist.addScaledVector(upV, -0.05 * STAGE.scale * beat).addScaledVector(herLeft, 0.02 * STAGE.scale * beat);
        lT.wrist
          .addScaledVector(herLeft, 0.014 * STAGE.scale * Math.sin(clock * 0.9 + 0.4))
          .addScaledVector(upV, 0.012 * STAGE.scale * Math.sin(clock * 1.23 + 2));
      }
      if (intent.right === 'open') rT.wrist.addScaledVector(upV, -0.045 * STAGE.scale * beat);
      lT.shrug += deg(2.5) * beat;
    }
    const posed = rig.poseLimbs(body, lT, rT);

    // Thinking: where the fist's knuckles are on the hand as posed, and how far from the chin.
    if (intent.right === 'chin') {
      const top = fistTop();
      chinAt.copy(chinPoint());
      chinGap = chinAt.distanceTo(top);
      fistOffset.copy(top.sub(rig.b('RightHand').getWorldPosition(new THREE.Vector3())));
      fistKnown = true;
    } else {
      chinGap = NaN;
      fistKnown = false;
    }
    updateYields(intent, rect);

    // Where the index ray lands on screen (development and tests): tip, a point along the ray, the target.
    const tipBone = rig.b('LeftIndexTip');
    const tip = tipBone.getWorldPosition(new THREE.Vector3());
    const along = tip.clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(tipBone.getWorldQuaternion(new THREE.Quaternion())), 0.4);
    const sc = (p: THREE.Vector3) => {
      const q = worldToScreen([p.x, p.y, p.z], rect);
      return [Math.round(q.x), Math.round(q.y)] as [number, number];
    };
    // And where her face is turned: the angle between the head's forward and the way to what she looks at.
    const headQ = rig.b('Head').getWorldQuaternion(new THREE.Quaternion());
    const headAt = rig.headCentre();
    const gazeErr = new THREE.Vector3(0, 0, 1).applyQuaternion(headQ).angleTo(v3(look).sub(headAt));
    report = {
      ...posed,
      mode: intent.left === 'point' ? reachMode : intent.left,
      look: intent.look,
      gazeError: gazeErr,
      jaw: body.jaw,
      energy: intent.energy,
      beat,
      tip: sc(tip),
      ray: sc(along),
      target: sc(lT.pointTarget ?? tip),
      elbow: sc(rig.b('LeftForeArm').getWorldPosition(new THREE.Vector3())),
      wrist: sc(rig.b('LeftHand').getWorldPosition(new THREE.Vector3())),
      chin: sc(chinPoint()),
      head: sc(headAt.clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(headQ), 0.1 * STAGE.scale)),
      yields: yielded,
      chinGap,
      presence,
    };
    frame.renderer.render(scene, camera);

    if (!reduced) return true;
    const chinBusy = intent.right === 'chin' && chinGap > 0.004;
    return chinBusy || restless(left, lGoal) + restless(right, rGoal) + springRestless(lookS, lookPoint(intent, rect, anchors).toArray()) > 1e-3;
  }

  return {
    get ready() {
      return ready;
    },
    get report() {
      return report;
    },
    lights: { hemi, key, rim, fill },
    setInputs(next) {
      inputs = { ...next };
    },
    draw,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (yielded.length) inputs.onyield?.([]);
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      scene.clear();
      rig = null;
      skin = null;
    },
  };
}

/**
 * A figure with a renderer of its own, for the scan's capture (no hologram on screen). One
 * context, the hologram engine's DPR caps and frame cap (30 fps, as on touch devices: she only
 * gestures here), paused when hidden or off-screen, disposed with it.
 */
const NO_ANCHORS = {} as HologramPassFrame['anchors'];
export const STANDALONE_FPS = 30;

export function mountStandalone(canvas: HTMLCanvasElement, pass: CharacterPass, reducedMotion: () => boolean): { redraw(): void; dispose(): void } {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch {
    pass.dispose();
    return { redraw() {}, dispose() {} };
  }
  renderer.setClearColor(0x000000, 0);
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const dprCap = cores <= 2 ? 1 : typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
  let raf = 0;
  let last = 0;
  let drawnAt = 0;
  let w = 0;
  let h = 0;
  let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  let inView = true;
  let gone = false;

  function size(): boolean {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return false;
    if (cw !== w || ch !== h) {
      w = cw;
      h = ch;
      renderer.setPixelRatio(Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, dprCap, 4096 / Math.max(cw, ch)));
      renderer.setSize(cw, ch, false);
    }
    return true;
  }

  function frame(now: number): void {
    raf = 0;
    if (gone || hidden || !inView || !size()) return;
    // The frame cap: skip a frame that comes too soon after the last one drawn.
    if (drawnAt && now - drawnAt < 1000 / STANDALONE_FPS - 2) {
      raf = requestAnimationFrame(frame);
      return;
    }
    drawnAt = now;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    renderer.clear();
    const busy = pass.draw({ renderer, dt, cssW: w, cssH: h, anchors: NO_ANCHORS, reducedMotion: reducedMotion() });
    if (busy || !pass.ready) raf = requestAnimationFrame(frame);
  }
  function redraw(): void {
    if (gone || raf) return;
    last = performance.now();
    drawnAt = 0;
    raf = requestAnimationFrame(frame);
  }
  const onVisibility = (): void => {
    hidden = document.visibilityState === 'hidden';
    if (!hidden) redraw();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => {
    inView = es.some((x) => x.isIntersecting);
    if (inView) redraw();
  }) : null;
  io?.observe(canvas);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => redraw()) : null;
  ro?.observe(canvas);
  redraw();
  return {
    redraw,
    dispose() {
      if (gone) return;
      gone = true;
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      io?.disconnect();
      ro?.disconnect();
      pass.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
