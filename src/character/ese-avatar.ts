/** Real skinned GLB character. Body clips, additive expression, and measured audio have separate channels. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CharacterStateMachine } from './state-machine.ts';
import { CharacterPortal } from './portal.ts';
import type { AvatarContext, ElohimAvatar, Outfit } from './types.ts';
import type { CharacterDirective, Expression, Viseme } from '@shared/types.ts';

export const ESE_MODEL_URL = '/character/ese/ese.glb';
export interface AvatarAsset { scene: THREE.Group; animations: THREE.AnimationClip[]; }
type AssetLoader = (url: string) => Promise<AvatarAsset>;
const VISEME: Record<Viseme, string | null> = {
  sil: null, AA: 'viseme_aa', EE: 'viseme_E', IH: 'viseme_I', OH: 'viseme_O', OU: 'viseme_U',
  MBP: 'viseme_PP', FV: 'viseme_FF', L: 'viseme_nn', S: 'viseme_SS',
};
export const EXPRESSION_MORPHS: Record<Expression, Record<string, number>> = {
  neutral: {},
  warm: { mouthSmileLeft: .19, mouthSmileRight: .21, cheekSquintLeft: .07, cheekSquintRight: .07 },
  smile: { mouthSmileLeft: .45, mouthSmileRight: .45, cheekSquintLeft: .16, cheekSquintRight: .16 },
  grin: { mouthSmileLeft: .62, mouthSmileRight: .62, cheekSquintLeft: .24, cheekSquintRight: .24 },
  concerned: { browInnerUp: .36, mouthFrownLeft: .08, mouthFrownRight: .08, eyeSquintLeft: .07, eyeSquintRight: .07 },
  reassuring: { browInnerUp: .2, mouthSmileLeft: .25, mouthSmileRight: .23, cheekSquintLeft: .09, cheekSquintRight: .09 },
  curious: { browInnerUp: .19, browOuterUpLeft: .28, eyeWideLeft: .08, eyeWideRight: .08, mouthSmileRight: .13 },
  focused: { browDownLeft: .16, browDownRight: .13, eyeSquintLeft: .14, eyeSquintRight: .14 },
  surprised: { browInnerUp: .4, browOuterUpLeft: .32, browOuterUpRight: .32, eyeWideLeft: .35, eyeWideRight: .35 },
};

function disposeAsset(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  textures.forEach(t => t.dispose()); geometries.forEach(g => g.dispose());
  skeletons.forEach(s => s.dispose());
  root.removeFromParent();
}

export class EseAvatar implements ElohimAvatar {
  readonly root = new THREE.Group();
  readonly portal = new CharacterPortal();
  private model = new THREE.Group();
  private fsm = new CharacterStateMachine();
  private loader: AssetLoader;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private action: THREE.AnimationAction | null = null;
  private morphs: THREE.Mesh[] = [];
  private head: THREE.Bone | null = null;
  private headRest = new THREE.Quaternion();
  private headDelta = new THREE.Quaternion();
  private headEuler = new THREE.Euler();
  private targetLocal = new THREE.Vector3();
  private headPosition = new THREE.Vector3();
  private gaze: THREE.Vector3 | null = null;
  private viseme: Viseme = 'sil';
  private weight = 0;
  private visemeAge = 9;
  private blinkAt = 2.7;
  private blinkTime = -1;
  private time = 0;
  private yaw = 0;
  private pitch = 0;
  private gestureTime = 0;
  private loaded = false;
  private disposed = false;
  private version = 0;
  private portalY = 1.02;
  private lastGesture = 'none';
  onDirectiveRejected: ((info: { reason: string; detail: string }) => void) | null = null;

  constructor(loader: AssetLoader = url => new GLTFLoader().loadAsync(url)) {
    this.loader = loader;
    this.root.name = 'Ese3D'; this.model.name = 'EseBody';
    this.root.add(this.model, this.portal.group);
    this.fsm.onRejected = info => this.onDirectiveRejected?.(info);
  }
  mount(parent: THREE.Object3D): void { parent.add(this.root, this.portal.trail); }
  async load(url = ESE_MODEL_URL): Promise<void> {
    const version = ++this.version;
    const asset = await this.loader(url);
    if (this.disposed || version !== this.version) { disposeAsset(asset.scene); return; }
    this.releaseModel();
    this.model.add(asset.scene);
    asset.scene.traverse(o => {
      if (o instanceof THREE.Bone && o.name === 'Head') { this.head = o; this.headRest.copy(o.quaternion); }
      if (!(o instanceof THREE.Mesh)) return;
      o.frustumCulled = false;
      if (o.name.startsWith('NORMAL_')) o.visible = false;
      if (o.morphTargetDictionary && o.morphTargetInfluences) this.morphs.push(o);
    });
    const portalY = Number(asset.scene.userData.portalY);
    if (Number.isFinite(portalY) && portalY > .4 && portalY < 1.5) this.portalY = portalY;
    this.mixer = new THREE.AnimationMixer(asset.scene);
    for (const clip of asset.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.loaded = true;
    this.selectAction();
    this.mixer.update(0);
  }
  applyDirective(directive: CharacterDirective): void {
    this.fsm.apply(directive);
    if (this.lastGesture !== this.fsm.directive.gesture) { this.gestureTime = 0; this.lastGesture = this.fsm.directive.gesture; }
    this.selectAction();
  }
  private selectAction(): void {
    if (!this.loaded) return;
    const d = this.fsm.directive;
    let name = 'Idle';
    if (d.gesture === 'small_wave') name = this.actions.has('Welcome') ? 'Welcome' : 'Speaking';
    else if (d.gesture === 'point_to_hologram') name = 'Pointing';
    else if (d.expression === 'concerned' || d.expression === 'reassuring') name = this.actions.has('Empathy') ? 'Empathy' : 'Listening';
    else if (d.state === 'LISTENING' || d.gesture === 'lean_in') name = 'Listening';
    else if (d.state === 'THINKING' || d.state === 'CLINICAL_ANALYSIS' || d.gesture === 'hand_to_chin') name = 'Examining';
    else if (d.state === 'EXPLAINING' || d.state === 'SPEAKING' || d.gesture === 'open_palms') name = 'Speaking';
    const next = this.actions.get(name) ?? this.actions.get('Idle');
    if (!next || next === this.action) return;
    const previous = this.action;
    next.reset().setEffectiveWeight(1).play();
    if (previous) { next.crossFadeFrom(previous, .65, false); }
    this.action = next;
  }
  setOutfit(_outfit: Outfit): void { /* Ese wears her signature coat in both rooms. */ }
  setFringe(_enabled: boolean): void { /* Physical mesh shading supplies the silhouette. */ }
  lookAt(target: THREE.Vector3 | null): void { this.gaze = target?.clone() ?? null; }
  setViseme(viseme: Viseme, weight: number): void {
    this.viseme = viseme; this.weight = Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0; this.visemeAge = 0;
    if (viseme === 'sil' || this.weight <= 0) {
      this.weight = 0;
      for (const mesh of this.morphs) for (const [name, i] of Object.entries(mesh.morphTargetDictionary!)) {
        if (name.startsWith('viseme_') || name === 'jawOpen') mesh.morphTargetInfluences![i] = 0;
      }
    }
  }
  update(dt: number, ctx: AvatarContext): void {
    if (this.disposed) return;
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(.1, dt)) : 0;
    this.time += step; this.gestureTime += step; this.visemeAge += step;
    this.fsm.update(step);
    // Reset additive head motion before the mixer writes its body pose.
    if (this.head) this.head.quaternion.copy(this.headRest);
    this.mixer?.update(ctx.reducedMotion ? 0 : step);
    const d = this.fsm.directive;
    const breath = ctx.reducedMotion ? 0 : Math.sin(this.time * 1.45) * .006;
    this.model.position.y = breath;
    this.portal.group.position.y = this.portalY + breath;
    this.model.rotation.z = ctx.reducedMotion ? 0 : Math.sin(this.time * .44) * .006;

    if (this.time >= this.blinkAt && this.blinkTime < 0) { this.blinkTime = 0; this.blinkAt = this.time + 3.1 + Math.random() * 2.5; }
    if (this.blinkTime >= 0) this.blinkTime += step;
    const blink = this.blinkTime >= 0 && this.blinkTime < .18 ? Math.sin(this.blinkTime / .18 * Math.PI) : 0;
    if (this.blinkTime >= .18) this.blinkTime = -1;
    const speaking = ctx.speechLevel > .002 && this.visemeAge < .3;
    const speechWeight = speaking ? this.weight * Math.min(1, ctx.speechLevel * 2.4) : 0;
    const expression = EXPRESSION_MORPHS[d.expression];
    const selectedViseme = VISEME[this.viseme];
    const response = 1 - Math.exp(-step * 12);
    for (const mesh of this.morphs) for (const [name, i] of Object.entries(mesh.morphTargetDictionary!)) {
      let target = (expression[name] ?? 0) * (.5 + d.intensity * .5);
      if (name === 'eyeBlinkLeft' || name === 'eyeBlinkRight') target = blink;
      if (name.startsWith('viseme_')) target = name === selectedViseme ? speechWeight * .72 : 0;
      if (name === 'eyeLookOutLeft' || name === 'eyeLookInRight') target = Math.max(0, this.yaw) * .7;
      if (name === 'eyeLookInLeft' || name === 'eyeLookOutRight') target = Math.max(0, -this.yaw) * .7;
      const influences = mesh.morphTargetInfluences!;
      influences[i] = (name.startsWith('viseme_') || name === 'jawOpen') && !speaking ? 0 : THREE.MathUtils.lerp(influences[i], target, response);
    }
    if (this.head) {
      this.root.updateMatrixWorld(true);
      this.head.getWorldPosition(this.headPosition);
      const gaze = this.gaze ?? ctx.gazeTarget;
      let yaw = 0, pitch = 0;
      if (gaze) {
        this.targetLocal.copy(gaze).sub(this.headPosition);
        const rootYaw = this.root.rotation.y;
        this.targetLocal.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -rootYaw);
        yaw = THREE.MathUtils.clamp(Math.atan2(this.targetLocal.x, Math.max(.2, this.targetLocal.z)), -.3, .3);
        pitch = THREE.MathUtils.clamp(-Math.atan2(this.targetLocal.y, Math.max(.3, this.targetLocal.z)), -.15, .15);
      }
      this.yaw = THREE.MathUtils.lerp(this.yaw, yaw, response * .5);
      this.pitch = THREE.MathUtils.lerp(this.pitch, pitch, response * .5);
      const nod = !ctx.reducedMotion && (d.gesture === 'nod' || d.gesture === 'slow_nod') && this.gestureTime < 2
        ? Math.sin(this.gestureTime * (d.gesture === 'nod' ? 5 : 3)) * .06 * Math.sin(Math.min(1, this.gestureTime / 2) * Math.PI) : 0;
      const tilt = d.gesture === 'head_tilt' || d.expression === 'concerned' ? .055 : d.state === 'LISTENING' ? -.025 : 0;
      this.headEuler.set(this.pitch + nod, this.yaw, tilt, 'YXZ');
      this.headDelta.setFromEuler(this.headEuler);
      this.head.quaternion.multiply(this.headDelta);
    }
    this.portal.update(step, this.time, ctx.reducedMotion, ctx.speechLevel);
  }
  hitZone(ray: THREE.Raycaster): 'face' | 'body' | null {
    const hit = ray.intersectObject(this.model, true)[0];
    if (!hit) return null;
    const local = this.root.worldToLocal(hit.point.clone());
    return local.y > 1.5 ? 'face' : 'body';
  }
  stats(): { meshes: number; triangles: number } {
    let meshes = 0, triangles = 0;
    this.root.traverseVisible(o => { if (o instanceof THREE.Mesh) {
      meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position?.count ?? 0) / 3;
    } });
    return { meshes, triangles: Math.round(triangles) };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.version++;
    this.releaseModel(); this.portal.dispose(); this.root.removeFromParent();
  }
  private releaseModel(): void {
    this.mixer?.stopAllAction();
    if (this.mixer) this.mixer.uncacheRoot(this.mixer.getRoot());
    for (const child of [...this.model.children]) disposeAsset(child);
    this.mixer = null; this.action = null; this.loaded = false;
    this.actions.clear(); this.morphs = []; this.head = null;
  }
}
