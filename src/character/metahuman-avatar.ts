/**
 * C6, Evia's imported MetaHuman. The source contains independent body and face
 * skeletons, and no animation clips or facial blendshapes. Keep their bind
 * poses and drive only small, measured bone offsets; Mixamo pose helpers do
 * not share this skeleton's axes.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VISEMES, type CharacterDirective, type Viseme } from '@shared/types.ts';
import type { AvatarContext, ElohimAvatar, Outfit } from './types.ts';
import { CharacterStateMachine } from './state-machine.ts';
import { EXPRESSION_POSES, STATE_POSES } from './expressions.ts';
import { configureMetaHumanMaterials, type MetaHumanMaterialOptions } from './metahuman-materials.ts';
import { metaHumanSpeechPose, SPEECH_POSE_BONES } from './metahuman-speech-pose.ts';

export const METAHUMAN_URL = '/character/evia/evia-metahuman.glb';
const EYE_HEIGHT = 1.6;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

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
const smooth = (value: number): number => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

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
  private winkAge = -1;
  private winkSide: 'L' | 'R' = 'L';
  private eyeMotion = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, wait: 0.7 };
  private eyeSeed = 0x6c657669;
  private expression = { inner: 0, outer: 0, smile: 0, tilt: 0, lid: 0, squint: 0 };
  private gesture = { open: 0, point: 0, wave: 0, chin: 0, lean: 0 };
  private readonly armRoll = { l: 0, r: 0 };
  private readonly armTwist = { l: 0, r: 0 };
  private readonly wristArc: Record<'l' | 'r', THREE.Quaternion | null> = { l: null, r: null };
  private readonly speechOffsets = new Map<string, THREE.Vector3>(SPEECH_POSE_BONES.map((name) => [name, new THREE.Vector3()]));
  private readonly speechTargets = new Map<string, THREE.Vector3>(SPEECH_POSE_BONES.map((name) => [name, new THREE.Vector3()]));

  private readonly axis = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly modelRotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly offsetRotation = new THREE.Quaternion();
  private readonly translationPosition = new THREE.Vector3();
  private readonly translationOrigin = new THREE.Vector3();
  private readonly translationOffset = new THREE.Vector3();
  private readonly materialOptions: MetaHumanMaterialOptions;

  onDirectiveRejected: ((info: { reason: string; detail: string }) => void) | null = null;

  constructor(materialOptions: MetaHumanMaterialOptions = {}) {
    this.materialOptions = materialOptions;
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
          // Safe default until material adaptation reads the actual renderer
          // context; coverage requires supported multisample antialiasing.
          material.alphaToCoverage = false;
          material.depthWrite = true;
          material.needsUpdate = true;
        }
      }
      model.updateMatrixWorld(true);
      if (!(hair as THREE.SkinnedMesh).isSkinnedMesh) face.get('head')!.bone.attach(hair);
    }

    configureMetaHumanMaterials(model, this.materialOptions);

    const animated: RestBone[] = [];
    for (const bones of [body, face]) {
      for (const name of ['spine_05', 'neck_02', 'head', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r']) {
        const bone = bones.get(name);
        if (bone) animated.push(bone);
      }
    }
    for (const name of ['FACIAL_C_Jaw', 'FACIAL_C_LowerLipRotation', ...SPEECH_POSE_BONES]) {
      const bone = face.get(name);
      if (bone) animated.push(bone);
    }
    for (const side of ['L', 'R']) {
      for (const lid of ['UpperA', 'UpperB', 'LowerA', 'LowerB']) {
        const bone = face.get(`FACIAL_${side}_Eyelid${lid}`);
        if (bone) animated.push(bone);
        for (const index of [1, 2, 3]) {
          const margin = face.get(`FACIAL_${side}_Eyelid${lid}${index}`);
          if (margin) animated.push(margin);
        }
      }
      for (const part of ['Eye', 'ForeheadIn', 'ForeheadInSkin', 'ForeheadMid', 'ForeheadMidSkin', 'ForeheadOut', 'ForeheadOutSkin']) {
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
    const previousGesture = this.fsm.directive.gesture;
    this.fsm.apply(directive);
    const gesture = this.fsm.directive.gesture;
    // A closing smile or another state update is not a second wave. Repeated
    // requests may replay a completed gesture, but never restart it mid-lift.
    const duration = gesture === 'small_wave' ? 2.6
      : gesture === 'open_palms' || gesture === 'lean_in' || gesture === 'head_tilt' ? 2.5
        : gesture === 'point_to_hologram' || gesture === 'hand_to_chin' ? 3.2
          : gesture === 'slow_nod' ? 1.8 : 1.1;
    if (gesture !== previousGesture || this.gestureTime >= duration) this.gestureTime = 0;
  }

  /** C6 currently supplies one nurse uniform; scene changes keep that outfit. */
  setOutfit(_outfit: Outfit, _opts?: { transitionSeconds?: number }): void {}

  setViseme(viseme: Viseme, weight: number): void {
    this.viseme = VISEMES.includes(viseme) ? viseme : 'sil';
    this.visemeWeight = finiteUnit(weight);
    this.hasViseme = true;
  }

  lookAt(target: THREE.Vector3 | null): void {
    this.gazeTarget = target?.clone() ?? null;
  }

  /** An intentional, one-shot action; reduced motion only disables idle motion. */
  wink(side: 'left' | 'right' = 'left'): void {
    if (this.disposed) return;
    this.winkSide = side === 'right' ? 'R' : 'L';
    this.winkAge = 0;
    // Do not let a scheduled blink turn a requested wink into two shut eyes.
    this.blinkAge = -1;
    this.blinkWait = 2.8;
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
  private shift(name: string, y: number, x = 0, z = 0): void {
    const bone = this.face.get(name)?.bone;
    if (!bone?.parent || (!x && !y && !z)) return;
    bone.parent.updateWorldMatrix(true, false);
    const position = bone.getWorldPosition(this.translationPosition);
    const origin = this.model!.localToWorld(this.translationOrigin.set(0, 0, 0));
    const offset = this.model!.localToWorld(this.translationOffset.set(x, y, z)).sub(origin);
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

  /** A fixed hand frame in model space; blend these frames as quaternions. */
  private handOrientation(side: 'l' | 'r', fingers: THREE.Vector3, palm: THREE.Vector3): THREE.Quaternion {
    const sign = side === 'l' ? 1 : -1;
    const xx = fingers.clone().normalize().multiplyScalar(sign);
    const zz = palm.clone().multiplyScalar(sign);
    zz.addScaledVector(xx, -zz.dot(xx)).normalize();
    const yy = zz.clone().cross(xx).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, yy, zz));
  }

  /** Solve one complete pose, then blend its joints once from their rest. */
  private poseArm(side: 'l' | 'r', target: THREE.Vector3, weight: number, orientation: THREE.Quaternion, animationDelta: number): void {
    const upper = this.body.get(`upperarm_${side}`)?.bone;
    const lower = this.body.get(`lowerarm_${side}`)?.bone;
    const hand = this.body.get(`hand_${side}`)?.bone;
    if (!upper || !lower || !hand) return;
    if (weight < 0.001) {
      this.armRoll[side] = 0;
      this.armTwist[side] = 0;
      this.wristArc[side] = null;
      return;
    }
    const restUpper = upper.quaternion.clone();
    const restLower = lower.quaternion.clone();
    const restHand = hand.quaternion.clone();
    const sign = side === 'l' ? 1 : -1;
    const shoulder = this.modelPoint(upper), elbow = this.modelPoint(lower), wrist = this.modelPoint(hand);
    const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(wrist);
    if (a < 0.01 || b < 0.01) return;
    const goal = target.clone();
    const line = goal.clone().sub(shoulder);
    const distance = clamp(line.length(), Math.abs(a - b) + 0.08, (a + b) * 0.94);
    line.normalize();
    goal.copy(shoulder).addScaledVector(line, distance);
    const pole = new THREE.Vector3(sign * 0.48, 1.08, 0.03).sub(shoulder);
    pole.addScaledVector(line, -pole.dot(line)).normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, a * a - along * along));
    const elbowGoal = shoulder.clone().addScaledVector(line, along).addScaledVector(pole, bend);
    this.aim(upper, lower, elbowGoal);
    this.aim(lower, hand, goal);

    // Share palm roll between forearm and wrist, keeping the wrist correction
    // below 26 degrees. C6's finger direction is +/-X and palm normal +/-Z.
    const foreAxis = this.modelPoint(hand).sub(this.modelPoint(lower)).normalize();
    const handWorld = hand.getWorldQuaternion(new THREE.Quaternion());
    const currentPalm = new THREE.Vector3(0, 0, sign).applyQuaternion(handWorld)
      .applyQuaternion(this.modelRotation.clone().invert());
    const desiredPalm = new THREE.Vector3(0, 0, sign).applyQuaternion(orientation);
    const projected = currentPalm.clone().addScaledVector(foreAxis, -currentPalm.dot(foreAxis));
    const desired = desiredPalm.clone().addScaledVector(foreAxis, -desiredPalm.dot(foreAxis));
    let roll = this.armRoll[side];
    if (projected.lengthSq() > 1e-6 && desired.lengthSq() > 1e-6) {
      projected.normalize();
      desired.normalize();
      roll = Math.atan2(foreAxis.dot(projected.clone().cross(desired)), projected.dot(desired));
      // Preserve the same side of the +/-PI branch during a cross-fade.
      // Clamping two equivalent angles of +PI/-PI produced opposite twists.
      while (roll - this.armRoll[side] > Math.PI) roll -= Math.PI * 2;
      while (roll - this.armRoll[side] < -Math.PI) roll += Math.PI * 2;
      this.armRoll[side] = roll;
    }
    // Palm projection becomes sensitive when it nearly aligns with the
    // forearm. Bound pronation speed as well as range through that region.
    const twistTarget = clamp(roll, -0.7, 0.7);
    const twistStep = 2 * animationDelta;
    this.armTwist[side] += clamp(twistTarget - this.armTwist[side], -twistStep, twistStep);
    this.rotate(this.body, `lowerarm_${side}`, foreAxis, this.armTwist[side]);
    const wanted = orientation.clone().premultiply(this.modelRotation);
    const current = hand.getWorldQuaternion(new THREE.Quaternion());
    const correction = wanted.multiply(current.clone().invert());
    const previousArc = this.wristArc[side];
    // Near 180 degrees, choosing the shortest slerp afresh changes the
    // correction's direction and snaps a capped wrist to the opposite side.
    // Keep the same quaternion hemisphere throughout an active gesture.
    if ((previousArc ? correction.dot(previousArc) : correction.w) < 0) {
      correction.set(-correction.x, -correction.y, -correction.z, -correction.w);
    }
    this.wristArc[side] = correction.clone();
    const correctionAxis = new THREE.Vector3(correction.x, correction.y, correction.z);
    const sine = correctionAxis.length();
    if (sine > 1e-6) {
      const angle = 2 * Math.atan2(sine, correction.w);
      correction.setFromAxisAngle(correctionAxis.divideScalar(sine), Math.min(0.45, angle));
      current.premultiply(correction);
    }
    hand.quaternion.copy(hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(current));
    // Blending the target position and then the wrist orientation separately
    // made the elbow and palm trace different paths, with sudden twists near
    // a straight arm. Interpolate the three solved local joints together.
    const blend = clamp(weight, 0, 1);
    upper.quaternion.slerp(restUpper, 1 - blend);
    lower.quaternion.slerp(restLower, 1 - blend);
    hand.quaternion.slerp(restHand, 1 - blend);
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
    if (reduced || this.winkAge >= 0) {
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
    return this.blinkAge < 0.09
      ? smooth(this.blinkAge / 0.09)
      : 1 - smooth((this.blinkAge - 0.13) / 0.14);
  }

  private winkClosure(delta: number): number {
    if (this.winkAge < 0) return 0;
    this.winkAge += delta;
    if (this.winkAge >= 0.46) {
      this.winkAge = -1;
      return 0;
    }
    return this.winkAge < 0.1
      ? smooth(this.winkAge / 0.1)
      : 1 - smooth((this.winkAge - 0.22) / 0.24);
  }

  /** Short fixations, not a looping sine-wave stare; both eyes stay conjugate. */
  private updateEyeMotion(delta: number, reduced: boolean, idleScale: number): void {
    const motion = this.eyeMotion;
    if (reduced) {
      motion.yaw = motion.pitch = motion.targetYaw = motion.targetPitch = 0;
      motion.wait = 0.7;
      return;
    }
    motion.wait -= delta;
    if (motion.wait <= 0) {
      // A private seeded generator avoids global randomness and makes the
      // bounded motion reproducible in recorded previews and regression tests.
      const sample = (): number => {
        this.eyeSeed = (Math.imul(this.eyeSeed, 1664525) + 1013904223) >>> 0;
        return this.eyeSeed / 0x100000000;
      };
      const scale = clamp(idleScale, 0.25, 1);
      motion.targetYaw = (sample() * 2 - 1) * 0.018 * scale;
      motion.targetPitch = (sample() * 2 - 1) * 0.012 * scale;
      motion.wait = 0.65 + sample() * 1.85;
    }
    const easing = 1 - Math.exp(-35 * delta);
    motion.yaw += (motion.targetYaw - motion.yaw) * easing;
    motion.pitch += (motion.targetPitch - motion.pitch) * easing;
  }

  update(dt: number, ctx: AvatarContext): void {
    if (!this.model || this.disposed) return;
    const delta = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const animationDelta = typeof ctx.animationDt === 'number' && Number.isFinite(ctx.animationDt)
      ? Math.max(0, ctx.animationDt)
      : delta;
    const elapsed = Number.isFinite(ctx.elapsed) ? ctx.elapsed : 0;
    const pose = this.fsm.update(delta);
    const statePose = STATE_POSES[pose.state];
    const expressionPose = EXPRESSION_POSES[pose.directive.expression];
    const intensity = finiteUnit(pose.directive.intensity);
    this.gestureTime += animationDelta;
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
      lid: clamp((1 - expressionPose.lidOpen) * intensity * 0.24, -0.035, 0.08),
      squint: clamp(expressionPose.lidSquint * intensity, 0, 0.72),
    };
    for (const key of ['inner', 'outer', 'smile', 'tilt', 'lid', 'squint'] as const) {
      this.expression[key] += (expressionTargets[key] - this.expression[key]) * easing;
    }
    const envelope = (duration: number): number => {
      const t = this.gestureTime;
      return Math.min(smooth(t / 0.7), smooth((duration - t) / 0.85));
    };
    const requested = pose.directive.gesture;
    const presenting = pose.state === 'EXPLAINING' || pose.state === 'ANALYSIS_COMPLETE';
    const strength = 0.4 + intensity * 0.6;
    const gestureTargets = {
      open: requested === 'open_palms' ? envelope(2.5) * strength : 0,
      point: requested === 'point_to_hologram' ? (presenting ? 1 : envelope(3.2)) * strength : presenting ? 0.25 : 0,
      wave: requested === 'small_wave' ? envelope(2.6) * strength : 0,
      chin: requested === 'hand_to_chin' ? envelope(3.2) * strength : 0,
      lean: requested === 'lean_in' ? envelope(2.5) * 0.025 * strength : statePose.lean * 0.35,
    };
    for (const key of ['open', 'point', 'wave', 'chin', 'lean'] as const) {
      // A replacement gesture must release the lifted arm gently. Using the
      // fast attack rate for its decay made the first cross-fade frame drop.
      const rate = gestureTargets[key] < this.gesture[key] ? 2.5 : 7;
      const gestureEasing = ctx.reducedMotion ? 1 : 1 - Math.exp(-rate * animationDelta);
      this.gesture[key] += (gestureTargets[key] - this.gesture[key]) * gestureEasing;
    }
    // Audio, not an inferred speaking state, opens her mouth. Small authored
    // bone poses distinguish spread/rounded vowels; C6 has no blendshapes.
    // Once a speech track supplies phones, its closures win over audio energy:
    // m/b/p and silence must stay closed even while a loud syllable decays.
    const speechPose = metaHumanSpeechPose(this.viseme, this.hasViseme ? this.visemeWeight : 0);
    const jawTarget = this.hasViseme ? speechPose.jaw : finiteUnit(ctx.speechLevel) * 0.1;
    this.jaw += (jawTarget - this.jaw) * (1 - Math.exp(-22 * animationDelta));
    for (const target of this.speechTargets.values()) target.set(0, 0, 0);
    for (const offset of speechPose.offsets) this.speechTargets.get(offset.bone)?.set(offset.x, offset.y, offset.z);
    const speechEasing = 1 - Math.exp(-32 * animationDelta);
    for (const [name, offset] of this.speechOffsets) offset.lerp(this.speechTargets.get(name)!, speechEasing);

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
    // Pose choice and its fade are separate. A single fading wave keeps its
    // target beside the face instead of sweeping through the open-palm pose.
    const leftWeight = this.gesture.open + this.gesture.point;
    const pointing = this.gesture.point / Math.max(leftWeight, 1e-6);
    const leftTarget = new THREE.Vector3(0.2, 1.32, 0.18).lerp(new THREE.Vector3(0.4, 1.34, 0.19), pointing);
    const leftOrientation = this.handOrientation('l', new THREE.Vector3(0.15, 0.05, 1), Y)
      .slerp(this.handOrientation('l', new THREE.Vector3(1, 0.2, 0.3), Y), pointing);
    this.poseArm('l', leftTarget, leftWeight, leftOrientation, animationDelta);
    const rightWeight = this.gesture.open + this.gesture.wave + this.gesture.chin;
    const rightTotal = Math.max(rightWeight, 1e-6);
    const rightTarget = new THREE.Vector3(-0.2, 1.32, 0.18).multiplyScalar(this.gesture.open / rightTotal)
      .addScaledVector(new THREE.Vector3(-0.22, 1.55, 0.12), this.gesture.wave / rightTotal)
      .addScaledVector(new THREE.Vector3(-0.13, 1.46, 0.23), this.gesture.chin / rightTotal);
    const rightOrientation = this.handOrientation('r', new THREE.Vector3(-0.15, 0.05, 1), Y)
      .slerp(this.handOrientation('r', Y, Z), this.gesture.wave / Math.max(this.gesture.open + this.gesture.wave, 1e-6))
      .slerp(this.handOrientation('r', Y, X), this.gesture.chin / rightTotal);
    this.poseArm('r', rightTarget, rightWeight, rightOrientation, animationDelta);
    // Lift, give a small greeting, lower. No wrist oscillation during the lift.
    const waveAge = this.gestureTime - 0.85;
    const waveBeat = smooth(waveAge / 0.2) * smooth((1.7 - this.gestureTime) / 0.2);
    if (!ctx.reducedMotion) this.rotate(this.body, 'hand_r', Z, Math.sin(waveAge * Math.PI * 4) * waveBeat * this.gesture.wave * 0.065);
    this.pointFingers(this.gesture.point);
    // The face export includes shoulder stubs weighted to the neck seam.
    // Apply the body shoulder's local delta to the corresponding face stub.
    for (const side of ['l', 'r']) {
      const body = this.body.get(`upperarm_${side}`), face = this.face.get(`upperarm_${side}`);
      if (body && face) face.bone.quaternion.copy(body.bone.quaternion).multiply(body.quaternion.clone().invert()).multiply(face.quaternion);
    }
    this.updateEyeMotion(delta, ctx.reducedMotion, statePose.idleScale);
    // Counter the small idle head turn and nod so eye contact survives them.
    const eyeYaw = clamp(fullYaw - this.yaw - drift + this.eyeMotion.yaw, -0.12, 0.12);
    const eyePitch = clamp(fullPitch - this.pitch - nod + this.eyeMotion.pitch, -0.1, 0.1);
    for (const side of ['L', 'R']) {
      this.rotate(this.face, `FACIAL_${side}_Eye`, Y, eyeYaw);
      this.rotate(this.face, `FACIAL_${side}_Eye`, X, eyePitch);
      for (const suffix of ['', 'Skin']) {
        this.shift(`FACIAL_${side}_ForeheadIn${suffix}`, this.expression.inner);
        this.shift(`FACIAL_${side}_ForeheadMid${suffix}`, (this.expression.inner + this.expression.outer) / 2);
        this.shift(`FACIAL_${side}_ForeheadOut${suffix}`, this.expression.outer);
      }
      this.shift(`FACIAL_${side}_LipCorner`, this.expression.smile);
    }
    this.rotate(this.face, 'FACIAL_C_Jaw', X, this.jaw);
    this.rotate(this.face, 'FACIAL_C_LowerLipRotation', X, this.jaw);
    for (const [name, offset] of this.speechOffsets) this.shift(name, offset.y, offset.x, offset.z);
    const blink = this.blink(animationDelta, ctx.reducedMotion);
    const wink = this.winkClosure(animationDelta);
    for (const side of ['L', 'R']) {
      // The C6 A roots carry the lid margin and lashes; B carries the crease.
      // Lower the resting upper lid slightly, and let warm expressions reach
      // the lower lid. Pitch follow keeps the lid close to the moving iris.
      const upperRest = clamp(0.045 + this.expression.lid + this.expression.squint * 0.025 + eyePitch * 0.6, 0, 0.16);
      const lowerRest = clamp(-this.expression.squint * 0.055 + eyePitch * 0.2, -0.065, 0.02);
      const closure = Math.max(blink, side === this.winkSide ? wink : 0);
      // Blend TO the measured blink endpoints, never add a closure on top of
      // the smile/follow pose: addition can drive C6's inner corners together.
      const upper = THREE.MathUtils.lerp(upperRest, 0.6, closure);
      const lower = THREE.MathUtils.lerp(lowerRest, -0.15, closure);
      this.rotate(this.face, `FACIAL_${side}_EyelidUpperA`, X, upper);
      this.rotate(this.face, `FACIAL_${side}_EyelidUpperB`, X, upper * 0.8);
      this.rotate(this.face, `FACIAL_${side}_EyelidLowerA`, X, lower);
      this.rotate(this.face, `FACIAL_${side}_EyelidLowerB`, X, lower * 0.8);
      if (closure > 0.25) {
        // The inner margins are asymmetric: rotating the entire lid equally
        // can cross C6's right inner corner by 2.4 mm. Split a small correction
        // across the two margin controls, retaining a 0.35 mm seam. Their lash
        // children follow, and the crease follows at a reduced amount.
        for (const index of [1, 2, 3]) {
          const upperName = `FACIAL_${side}_EyelidUpperA${index}`;
          const lowerName = `FACIAL_${side}_EyelidLowerA${index}`;
          const upperBone = this.face.get(upperName)?.bone;
          const lowerBone = this.face.get(lowerName)?.bone;
          if (!upperBone || !lowerBone) continue;
          const separation = this.modelPoint(upperBone).y - this.modelPoint(lowerBone).y;
          const correction = clamp((0.00035 - separation) * 0.5, 0, 0.0016);
          this.shift(upperName, correction);
          this.shift(lowerName, -correction);
          this.shift(`FACIAL_${side}_EyelidUpperB${index}`, correction * 0.6);
          this.shift(`FACIAL_${side}_EyelidLowerB${index}`, -correction * 0.6);
        }
      }
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
