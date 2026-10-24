/**
 * C6, Evia's imported MetaHuman. The source contains independent body and face
 * skeletons, and no animation clips or facial blendshapes. Keep their bind
 * poses and drive only small, measured bone offsets; Mixamo pose helpers do
 * not share this skeleton's axes.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CharacterDirective, Viseme } from '@shared/types.ts';
import type { AvatarContext, ElohimAvatar, Outfit } from './types.ts';
import { CharacterStateMachine } from './state-machine.ts';
import { EXPRESSION_POSES, STATE_POSES } from './expressions.ts';

export const METAHUMAN_URL = '/character/evia/evia-metahuman.glb';
const EYE_HEIGHT = 1.6;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const JAW_OPEN: Record<Viseme, number> = {
  sil: 0, AA: 1, EE: 0.22, IH: 0.36, OH: 0.7, OU: 0.32,
  MBP: 0, FV: 0.12, L: 0.4, S: 0.12,
};

interface RestBone {
  bone: THREE.Bone;
  quaternion: THREE.Quaternion;
  position: THREE.Vector3;
}

type BoneMap = Map<string, RestBone>;

// GLTFLoader makes duplicate node names unique (head, head_1, …), but keeps
// the source name in userData. The two C6 skeletons must be searched separately.
function sourceName(object: THREE.Object3D): string {
  return typeof object.userData.name === 'string' ? object.userData.name : object.name;
}

function findSource(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!found && sourceName(object) === name) found = object;
  });
  return found;
}

function collectBones(root: THREE.Object3D): BoneMap {
  const bones: BoneMap = new Map();
  root.traverse((object) => {
    if ((object as THREE.Bone).isBone) {
      bones.set(sourceName(object), { bone: object as THREE.Bone, quaternion: object.quaternion.clone(), position: object.position.clone() });
    }
  });
  return bones;
}

/** GLBs own shared geometry, materials, textures and skeletons: release each once. */
function releaseModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture);
      }
    }
    const skin = object as THREE.SkinnedMesh;
    if (skin.isSkinnedMesh) skeletons.add(skin.skeleton);
  });
  root.removeFromParent();
  for (const item of geometries) item.dispose();
  for (const item of materials) item.dispose();
  for (const item of skeletons) item.dispose();
  const bitmaps = new Set<ImageBitmap>();
  for (const texture of textures) {
    const image = texture.source?.data as ImageBitmap | undefined;
    if (image && typeof image.close === 'function') bitmaps.add(image);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
  root.clear();
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finiteUnit = (value: number): number => Number.isFinite(value) ? clamp(value, 0, 1) : 0;

export class MetaHumanAvatar implements ElohimAvatar {
  /** The director owns this floor-level position and yaw. */
  readonly root = new THREE.Group();
  private readonly figure = new THREE.Group();
  private readonly fsm = new CharacterStateMachine();
  private model: THREE.Object3D | null = null;
  private body: BoneMap = new Map();
  private face: BoneMap = new Map();
  private animated: RestBone[] = [];
  private eyeOrigin = new THREE.Vector3(0, 1.675, 0.1);
  private counts = { meshes: 0, triangles: 0 };
  private disposed = false;
  private loadGeneration = 0;
  private gazeTarget: THREE.Vector3 | null = null;
  private viseme: Viseme = 'sil';
  private visemeWeight = 0;
  private hasViseme = false;
  private yaw = 0;
  private pitch = 0;
  private jaw = 0;
  private gestureTime = 10;
  private blinkWait = 2.8;
  private blinkAge = -1;
  private blinkCount = 0;
  private expression = { inner: 0, outer: 0, smile: 0, tilt: 0 };
  private gesture = { open: 0, point: 0, wave: 0, chin: 0, lean: 0 };

  private readonly axis = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly modelRotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly offsetRotation = new THREE.Quaternion();

  onDirectiveRejected: ((info: { reason: string; detail: string }) => void) | null = null;

  constructor() {
    this.root.name = 'EviaMetaHuman';
    this.figure.name = 'EviaFigure';
    this.root.add(this.figure);
    this.fsm.onRejected = (info) => this.onDirectiveRejected?.(info);
  }

  get ready(): boolean {
    return this.model !== null && !this.disposed;
  }

  mount(parent: THREE.Object3D): void {
    if (!this.disposed) parent.add(this.root);
  }

  /** A late download is disposed after navigation; a failed replacement keeps the old model. */
  async load(url = METAHUMAN_URL): Promise<void> {
    if (this.disposed) throw new Error('Evia avatar has been disposed');
    const generation = ++this.loadGeneration;
    const gltf = await new GLTFLoader().loadAsync(url);
    if (this.disposed || generation !== this.loadGeneration) {
      releaseModel(gltf.scene);
      return;
    }
    try {
      this.adopt(gltf.scene);
    } catch (error) {
      releaseModel(gltf.scene);
      throw error;
    }
  }

  private adopt(model: THREE.Object3D): void {
    const bodyRoot = findSource(model, 'C6_body_rig');
    const faceRoot = findSource(model, 'C6_head_rig');
    if (!bodyRoot || !faceRoot) throw new Error('Evia model is missing the C6 body or face skeleton');
    const body = collectBones(bodyRoot);
    const face = collectBones(faceRoot);
    for (const bones of [body, face]) {
      if (!bones.has('head') || !bones.has('neck_02')) throw new Error('Evia model is missing its head or neck joints');
    }
    const counts = { meshes: 0, triangles: 0 };
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      counts.meshes++;
      counts.triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3;
      // The imported bounds describe the bind pose, not the small animated pose.
      mesh.frustumCulled = false;
      if (sourceName(mesh) === 'C6_eyelashes_lod0_mesh') {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (material.alphaTest > 0) material.alphaToCoverage = false;
        }
      }
    });
    if (!counts.meshes) throw new Error('Evia model contains no visible meshes');

    model.updateMatrixWorld(true);
    const eye = face.get('FACIAL_L_Eye')?.bone;
    const eyeOrigin = eye
      ? model.worldToLocal(eye.getWorldPosition(new THREE.Vector3()))
      : new THREE.Vector3(0, 1.675, 0.1);
    eyeOrigin.x = 0;
    if (eyeOrigin.y < 1 || eyeOrigin.y > 2.2) throw new Error('Evia model has an unsupported scale');

    // C6's hair vertices were already exported in metres, but its unskinned
    // node retained the centimetre conversion. Correct only that known case.
    const hair = findSource(model, 'Hair_S_UpdoBuns_CardsMesh_Group0_LOD0');
    if (hair) {
      const mesh = hair as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.computeBoundingBox();
        if (Math.abs(hair.scale.x - 0.01) < 1e-5 && (mesh.geometry.boundingBox?.max.y ?? 0) > 1) {
          hair.scale.setScalar(1);
        }
        // Alpha-tested cards avoid the transparent-sort halos of the source.
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          material.transparent = false;
          material.alphaTest = 0.12;
          // Stage has no MSAA. Coverage here leaves partial output alpha and
          // bright fringes in captures; use the atlas's ordinary alpha test.
          material.alphaToCoverage = false;
          material.depthWrite = true;
          material.needsUpdate = true;
        }
      }
      model.updateMatrixWorld(true);
      if (!(hair as THREE.SkinnedMesh).isSkinnedMesh) face.get('head')!.bone.attach(hair);
    }

    const animated: RestBone[] = [];
    for (const bones of [body, face]) {
      for (const name of ['spine_05', 'neck_02', 'head', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r']) {
        const bone = bones.get(name);
        if (bone) animated.push(bone);
      }
    }
    for (const name of ['FACIAL_C_Jaw', 'FACIAL_C_LowerLipRotation']) {
      const bone = face.get(name);
      if (bone) animated.push(bone);
    }
    for (const side of ['L', 'R']) {
      for (const lid of ['UpperA', 'UpperB', 'LowerA', 'LowerB']) {
        const bone = face.get(`FACIAL_${side}_Eyelid${lid}`);
        if (bone) animated.push(bone);
      }
      for (const part of ['Eye', 'ForeheadIn', 'ForeheadInSkin', 'ForeheadMid', 'ForeheadMidSkin', 'ForeheadOut', 'ForeheadOutSkin', 'LipCorner']) {
        const bone = face.get(`FACIAL_${side}_${part}`);
        if (bone) animated.push(bone);
      }
    }
    for (const side of ['l', 'r']) {
      for (const finger of ['index', 'middle', 'ring', 'pinky']) {
        for (const joint of ['01', '02', '03']) {
          const bone = body.get(`${finger}_${joint}_${side}`);
          if (bone) animated.push(bone);
        }
      }
    }

    const previous = this.model;
    this.figure.add(model);
    this.figure.scale.setScalar(EYE_HEIGHT / eyeOrigin.y);
    this.model = model;
    this.body = body;
    this.face = face;
    this.animated = animated;
    this.eyeOrigin.copy(eyeOrigin);
    this.counts = { meshes: counts.meshes, triangles: Math.round(counts.triangles) };
    if (previous) releaseModel(previous);
  }

  applyDirective(directive: CharacterDirective): void {
    this.fsm.apply(directive);
    this.gestureTime = 0;
  }

  /** C6 currently supplies one nurse uniform; scene changes keep that outfit. */
  setOutfit(_outfit: Outfit, _opts?: { transitionSeconds?: number }): void {}

  setViseme(viseme: Viseme, weight: number): void {
    this.viseme = Object.hasOwn(JAW_OPEN, viseme) ? viseme : 'sil';
    this.visemeWeight = finiteUnit(weight);
    this.hasViseme = true;
  }

  lookAt(target: THREE.Vector3 | null): void {
    this.gazeTarget = target?.clone() ?? null;
  }

  stats(): { meshes: number; triangles: number } {
    return { ...this.counts };
  }

  /** Keeps the director's face/body tap reactions available for the 3D figure. */
  hitZone(raycaster: THREE.Raycaster): 'face' | 'body' | null {
    if (!this.model || this.disposed) return null;
    const hit = raycaster.intersectObject(this.figure, true)[0];
    if (!hit) return null;
    return this.model.worldToLocal(hit.point.clone()).y >= 1.48 ? 'face' : 'body';
  }

  /** Rotate around a model-space axis, regardless of MetaHuman's local bone rolls. */
  private rotate(bones: BoneMap, name: string, axis: THREE.Vector3, angle: number): void {
    const bone = bones.get(name)?.bone;
    if (!bone || !bone.parent || !angle) return;
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(this.parentRotation).invert();
    this.axis.copy(axis).applyQuaternion(this.modelRotation).applyQuaternion(this.parentRotation).normalize();
    this.offsetRotation.setFromAxisAngle(this.axis, angle);
    bone.quaternion.premultiply(this.offsetRotation);
    bone.updateWorldMatrix(false, false);
  }

  /** A small facial translation in model metres, independent of bone roll. */
  private shift(name: string, y: number, x = 0): void {
    const bone = this.face.get(name)?.bone;
    if (!bone?.parent || (!x && !y)) return;
    bone.parent.updateWorldMatrix(true, false);
    const position = bone.getWorldPosition(new THREE.Vector3());
    const origin = this.model!.localToWorld(new THREE.Vector3());
    const offset = this.model!.localToWorld(new THREE.Vector3(x, y, 0)).sub(origin);
    bone.position.copy(bone.parent.worldToLocal(position.add(offset)));
    bone.updateWorldMatrix(false, false);
  }

  private modelPoint(object: THREE.Object3D): THREE.Vector3 {
    return this.model!.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
  }

  private aim(bone: THREE.Bone, child: THREE.Bone, target: THREE.Vector3): void {
    if (!bone.parent) return;
    const at = bone.getWorldPosition(new THREE.Vector3());
    const from = child.getWorldPosition(new THREE.Vector3()).sub(at).normalize();
    const to = this.model!.localToWorld(target.clone()).sub(at).normalize();
    const world = new THREE.Quaternion().setFromUnitVectors(from, to).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    bone.updateWorldMatrix(false, false);
  }

  /** A bounded two-bone reach; no retargeting assumptions about C6's local axes. */
  private poseArm(side: 'l' | 'r', target: THREE.Vector3, weight: number, fingers: THREE.Vector3, palm: THREE.Vector3): void {
    const upper = this.body.get(`upperarm_${side}`)?.bone;
    const lower = this.body.get(`lowerarm_${side}`)?.bone;
    const hand = this.body.get(`hand_${side}`)?.bone;
    if (!upper || !lower || !hand || weight < 0.001) return;
    const sign = side === 'l' ? 1 : -1;
    const shoulder = this.modelPoint(upper), elbow = this.modelPoint(lower), wrist = this.modelPoint(hand);
    const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(wrist);
    if (a < 0.01 || b < 0.01) return;
    const goal = wrist.clone().lerp(target, clamp(weight, 0, 1));
    const line = goal.clone().sub(shoulder);
    const distance = clamp(line.length(), Math.abs(a - b) + 0.08, (a + b) * 0.94);
    line.normalize();
    goal.copy(shoulder).addScaledVector(line, distance);
    const pole = elbow.clone().lerp(new THREE.Vector3(sign * 0.48, 1.08, 0.03), weight).sub(shoulder);
    pole.addScaledVector(line, -pole.dot(line)).normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, a * a - along * along));
    const elbowGoal = shoulder.clone().addScaledVector(line, along).addScaledVector(pole, bend);
    this.aim(upper, lower, elbowGoal);
    this.aim(lower, hand, goal);

    // Share palm roll between forearm and wrist, keeping the wrist correction
    // below 32 degrees. C6's finger direction is +/-X and palm normal +/-Z.
    const foreAxis = this.modelPoint(hand).sub(this.modelPoint(lower)).normalize();
    const handWorld = hand.getWorldQuaternion(new THREE.Quaternion());
    const currentPalm = new THREE.Vector3(0, 0, sign).applyQuaternion(handWorld)
      .applyQuaternion(this.modelRotation.clone().invert());
    const fingerDirection = fingers.clone().normalize();
    const desiredPalm = palm.clone().addScaledVector(fingerDirection, -palm.dot(fingerDirection));
    if (desiredPalm.lengthSq() < 0.02) {
      desiredPalm.copy(currentPalm).addScaledVector(fingerDirection, -currentPalm.dot(fingerDirection));
    }
    desiredPalm.normalize();
    const projected = currentPalm.clone().addScaledVector(foreAxis, -currentPalm.dot(foreAxis)).normalize();
    const desired = desiredPalm.clone().addScaledVector(foreAxis, -desiredPalm.dot(foreAxis)).normalize();
    const roll = Math.atan2(foreAxis.dot(projected.clone().cross(desired)), projected.dot(desired));
    this.rotate(this.body, `lowerarm_${side}`, foreAxis, clamp(roll, -0.85, 0.85) * weight);
    const xx = fingers.clone().normalize().multiplyScalar(sign);
    const zz = desiredPalm.multiplyScalar(sign).addScaledVector(xx, -desiredPalm.dot(xx)).normalize();
    const yy = zz.clone().cross(xx).normalize();
    const wanted = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, yy, zz));
    wanted.premultiply(this.modelRotation);
    const current = hand.getWorldQuaternion(new THREE.Quaternion());
    const angle = current.angleTo(wanted);
    current.slerp(wanted, Math.min(weight, 0.55 / Math.max(angle, 1e-6)));
    hand.quaternion.copy(hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(current));
    hand.updateWorldMatrix(false, false);
  }

  private pointFingers(weight: number): void {
    if (weight < 0.001) return;
    for (const finger of ['index', 'middle', 'ring', 'pinky']) {
      for (const [index, joint] of ['01', '02', '03'].entries()) {
        const bone = this.body.get(`${finger}_${joint}_l`)?.bone;
        if (!bone) continue;
        // Unreal's finger axis is X; the source's existing curls are about Y.
        const angle = finger === 'index' ? [0.2, 0.12, 0.04][index] : [-0.4, -0.55, -0.35][index];
        bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(Y, angle * weight));
      }
    }
  }

  private blink(delta: number, reduced: boolean): number {
    if (reduced) {
      this.blinkAge = -1;
      return 0;
    }
    if (this.blinkAge < 0) {
      this.blinkWait -= delta;
      if (this.blinkWait > 0) return 0;
      this.blinkAge = 0;
    }
    this.blinkAge += delta;
    if (this.blinkAge >= 0.27) {
      this.blinkAge = -1;
      this.blinkWait = 3.6 + Math.sin(++this.blinkCount * 2.4) * 0.8;
      return 0;
    }
    const smooth = (t: number): number => {
      const v = clamp(t, 0, 1);
      return v * v * (3 - 2 * v);
    };
    return this.blinkAge < 0.09
      ? smooth(this.blinkAge / 0.09)
      : 1 - smooth((this.blinkAge - 0.13) / 0.14);
  }

  update(dt: number, ctx: AvatarContext): void {
    if (!this.model || this.disposed) return;
    const delta = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const elapsed = Number.isFinite(ctx.elapsed) ? ctx.elapsed : 0;
    const pose = this.fsm.update(delta);
    const statePose = STATE_POSES[pose.state];
    const expressionPose = EXPRESSION_POSES[pose.directive.expression];
    const intensity = finiteUnit(pose.directive.intensity);
    this.gestureTime += delta;
    for (const rest of this.animated) {
      rest.bone.quaternion.copy(rest.quaternion);
      rest.bone.position.copy(rest.position);
    }
    // Getters below update only the ancestor chains they need. One full
    // skeleton traversal at the end replaces repeated traversals per joint.
    this.root.updateWorldMatrix(true, false);
    this.model.getWorldQuaternion(this.modelRotation);

    const gaze = ctx.gazeTarget ?? this.gazeTarget;
    let fullYaw = statePose.headYaw * 0.45;
    let fullPitch = statePose.headPitch * 0.5;
    if (gaze) {
      this.target.copy(gaze);
      this.model.worldToLocal(this.target).sub(this.eyeOrigin);
      if (Number.isFinite(this.target.lengthSq()) && this.target.lengthSq() > 0.0025) {
        fullYaw = Math.atan2(this.target.x, this.target.z);
        fullPitch = -Math.atan2(this.target.y, Math.hypot(this.target.x, this.target.z));
      }
    }
    const targetYaw = clamp(fullYaw, -0.3, 0.3);
    const targetPitch = clamp(fullPitch, -0.16, 0.16);
    const easing = ctx.reducedMotion ? 1 : 1 - Math.exp(-7 * delta);
    this.yaw += (targetYaw - this.yaw) * easing;
    this.pitch += (targetPitch - this.pitch) * easing;
    const expressionTargets = {
      inner: clamp(expressionPose.browInner * intensity * 0.4, -0.002, 0.0034),
      outer: clamp(expressionPose.browOuter * intensity * 0.35, -0.002, 0.0034),
      smile: clamp(expressionPose.mouthCurve * intensity * 0.3, -0.0015, 0.0035),
      tilt: expressionPose.headTilt * intensity * 0.5,
    };
    for (const key of ['inner', 'outer', 'smile', 'tilt'] as const) {
      this.expression[key] += (expressionTargets[key] - this.expression[key]) * easing;
    }
    const envelope = (duration: number): number => {
      const t = this.gestureTime;
      return Math.min(clamp(t / 0.35, 0, 1), clamp((duration - t) / 0.65, 0, 1));
    };
    const requested = pose.directive.gesture;
    const presenting = pose.state === 'EXPLAINING' || pose.state === 'ANALYSIS_COMPLETE';
    const strength = 0.4 + intensity * 0.6;
    const gestureTargets = {
      open: requested === 'open_palms' ? envelope(2.5) * strength : 0,
      point: requested === 'point_to_hologram' ? (presenting ? 1 : envelope(3.2)) * strength : presenting ? 0.25 : 0,
      wave: requested === 'small_wave' ? envelope(2.1) * strength : 0,
      chin: requested === 'hand_to_chin' ? envelope(3.2) * strength : 0,
      lean: requested === 'lean_in' ? envelope(2.5) * 0.025 * strength : statePose.lean * 0.35,
    };
    for (const key of ['open', 'point', 'wave', 'chin', 'lean'] as const) {
      this.gesture[key] += (gestureTargets[key] - this.gesture[key]) * easing;
    }
    // Audio, not an inferred speaking state, opens her mouth. This is a jaw
    // envelope rather than a claim that the file contains phoneme blendshapes.
    // Once a speech track supplies phones, its closures win over audio energy:
    // m/b/p and silence must stay closed even while a loud syllable decays.
    const voiced = this.hasViseme
      ? this.visemeWeight * JAW_OPEN[this.viseme]
      : finiteUnit(ctx.speechLevel);
    const jawTarget = voiced * 0.1;
    this.jaw += (jawTarget - this.jaw) * (1 - Math.exp(-22 * delta));

    const breath = ctx.reducedMotion ? 0 : Math.sin(elapsed * Math.PI * 2 * statePose.breathRate) * 0.002 * statePose.breathDepth;
    const drift = ctx.reducedMotion ? 0 : Math.sin(elapsed * 0.47) * 0.006;
    const nodGesture = pose.directive.gesture === 'nod' || pose.directive.gesture === 'slow_nod';
    const nodDuration = pose.directive.gesture === 'slow_nod' ? 1.8 : 1.1;
    const nod = !ctx.reducedMotion && nodGesture && this.gestureTime < nodDuration
      ? Math.sin(Math.PI * this.gestureTime / nodDuration) * (0.02 + intensity * 0.04)
      : 0;
    const tilt = (requested === 'head_tilt' ? 0.035 * envelope(2.5) : statePose.headTilt * 0.5) + this.expression.tilt;
    for (const bones of [this.body, this.face]) {
      this.rotate(bones, 'spine_05', X, breath + this.gesture.lean);
      // The supplied bind pose holds the arms out. A small shoulder rotation
      // lowers both arms toward her sides without changing elbows or fingers.
      this.rotate(bones, 'upperarm_l', Z, -0.26);
      this.rotate(bones, 'upperarm_r', Z, 0.26);
      this.rotate(bones, 'neck_02', Y, this.yaw * 0.25);
      this.rotate(bones, 'head', Y, this.yaw * 0.75 + drift);
      this.rotate(bones, 'head', X, this.pitch + nod - breath);
      this.rotate(bones, 'head', Z, tilt);
    }
    const leftWeight = Math.max(this.gesture.open, this.gesture.point);
    const leftTarget = new THREE.Vector3(0.3, 1.22, 0.29).lerp(new THREE.Vector3(0.46, 1.34, 0.19), this.gesture.point);
    const leftDirection = new THREE.Vector3(0.15, 0.05, 1).lerp(new THREE.Vector3(1, 0.2, 0.3), this.gesture.point).normalize();
    this.poseArm('l', leftTarget, leftWeight, leftDirection, Y);
    const rightWeight = Math.max(this.gesture.open, this.gesture.wave, this.gesture.chin);
    const rightTarget = new THREE.Vector3(-0.3, 1.22, 0.29)
      .lerp(new THREE.Vector3(-0.36, 1.53, 0.14), this.gesture.wave)
      .lerp(new THREE.Vector3(-0.13, 1.46, 0.23), this.gesture.chin);
    const rightDirection = new THREE.Vector3(-0.15, 0.05, 1).lerp(Y, Math.max(this.gesture.wave, this.gesture.chin)).normalize();
    const rightPalm = Y.clone().lerp(Z, this.gesture.wave);
    // A little outward roll avoids a parallel palm/finger basis halfway up
    // from the palm-up resting gesture to the palm-forward wave.
    rightPalm.x -= Math.sin(Math.PI * this.gesture.wave) * 0.8;
    rightPalm.lerp(X, this.gesture.chin).normalize();
    this.poseArm('r', rightTarget, rightWeight, rightDirection, rightPalm);
    if (!ctx.reducedMotion) this.rotate(this.body, 'hand_r', Z, Math.sin(this.gestureTime * 9) * this.gesture.wave * 0.09);
    this.pointFingers(this.gesture.point);
    // The face export includes shoulder stubs weighted to the neck seam.
    // Apply the body shoulder's local delta to the corresponding face stub.
    for (const side of ['l', 'r']) {
      const body = this.body.get(`upperarm_${side}`), face = this.face.get(`upperarm_${side}`);
      if (body && face) face.bone.quaternion.copy(body.bone.quaternion).multiply(body.quaternion.clone().invert()).multiply(face.quaternion);
    }
    for (const side of ['L', 'R']) {
      this.rotate(this.face, `FACIAL_${side}_Eye`, Y, clamp(fullYaw - this.yaw, -0.12, 0.12));
      this.rotate(this.face, `FACIAL_${side}_Eye`, X, clamp(fullPitch - this.pitch, -0.1, 0.1));
      for (const suffix of ['', 'Skin']) {
        this.shift(`FACIAL_${side}_ForeheadIn${suffix}`, this.expression.inner);
        this.shift(`FACIAL_${side}_ForeheadMid${suffix}`, (this.expression.inner + this.expression.outer) / 2);
        this.shift(`FACIAL_${side}_ForeheadOut${suffix}`, this.expression.outer);
      }
      this.shift(`FACIAL_${side}_LipCorner`, this.expression.smile);
    }
    this.rotate(this.face, 'FACIAL_C_Jaw', X, this.jaw);
    this.rotate(this.face, 'FACIAL_C_LowerLipRotation', X, this.jaw);
    const blink = this.blink(delta, ctx.reducedMotion);
    for (const side of ['L', 'R']) {
      // The C6 A roots carry the lid margin and lashes; B carries the crease.
      // Measured against the exported eyelid vertices: a restrained closure
      // leaves a small gap instead of intersecting at the inner corners.
      this.rotate(this.face, `FACIAL_${side}_EyelidUpperA`, X, 0.6 * blink);
      this.rotate(this.face, `FACIAL_${side}_EyelidUpperB`, X, 0.48 * blink);
      this.rotate(this.face, `FACIAL_${side}_EyelidLowerA`, X, -0.15 * blink);
      this.rotate(this.face, `FACIAL_${side}_EyelidLowerB`, X, -0.12 * blink);
    }
    this.root.updateMatrixWorld(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.loadGeneration;
    if (this.model) releaseModel(this.model);
    this.model = null;
    this.body.clear();
    this.face.clear();
    this.animated = [];
    this.counts = { meshes: 0, triangles: 0 };
    this.root.removeFromParent();
    this.root.clear();
  }
}
