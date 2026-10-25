import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MetaHumanAvatar } from '../src/character/metahuman-avatar.ts';
import { DEFAULT_DIRECTIVE } from '../shared/types.ts';

function fixture() {
  const scene = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.2, 0, 0.1, 1.2, 0, 0, 1.4, 0], 3));
  const texture = new THREE.Texture();
  const material = new THREE.MeshPhysicalMaterial({ map: texture });
  const rigs = ['C6_body_rig', 'C6_head_rig'].map((name, index) => {
    const rig = new THREE.Group();
    rig.name = name;
    scene.add(rig);
    const add = (parent: THREE.Object3D, name: string, y: number) => {
      const bone = new THREE.Bone();
      bone.name = index ? `${name}_1` : name;
      bone.userData.name = name;
      bone.position.y = y;
      parent.add(bone);
      return bone;
    };
    const spine = add(rig, 'spine_05', 1.35);
    const neck = add(spine, 'neck_02', 0.15);
    const head = add(neck, 'head', 0.1);
    const eye = add(head, 'FACIAL_L_Eye', 0.075);
    const eyeRight = add(head, 'FACIAL_R_Eye', 0.075);
    const jaw = add(head, 'FACIAL_C_Jaw', -0.05);
    const lips = add(head, 'FACIAL_C_LowerLipRotation', -0.05);
    const brow = add(head, 'FACIAL_L_ForeheadIn', 0.09);
    const corner = add(head, 'FACIAL_L_LipCorner', -0.03);
    corner.position.x = 0.03;
    const cornerRight = add(head, 'FACIAL_R_LipCorner', -0.03);
    cornerRight.position.x = -0.03;
    const lipUpper = add(head, 'FACIAL_C_LipUpper', -0.03);
    const lipLower = add(lips, 'FACIAL_C_LipLower', 0.02);
    const lids = ['UpperA', 'UpperB', 'LowerA', 'LowerB'].map((lid) => add(head, `FACIAL_L_Eyelid${lid}`, 0.075));
    const lidsRight = ['UpperA', 'UpperB', 'LowerA', 'LowerB'].map((lid) => add(head, `FACIAL_R_Eyelid${lid}`, 0.075));
    // C6's inner corner has less clearance than its central lid. These
    // measured offsets exercise the pinch that whole-lid rotation can cause.
    const margins = [lids, lidsRight].map((side, index) => {
      const label = index ? 'R' : 'L';
      const upper = add(side[0], `FACIAL_${label}_EyelidUpperA1`, index ? 0.0016 : 0.0022);
      upper.position.z = index ? 0.015 : 0.0145;
      const lower = add(side[2], `FACIAL_${label}_EyelidLowerA1`, index ? -0.0068 : -0.0075);
      lower.position.z = index ? 0.013 : 0.012;
      return { upper, lower };
    });
    const arms = ['l', 'r'].map((side) => {
      const arm = add(spine, `upperarm_${side}`, 0);
      arm.position.x = side === 'l' ? 0.15 : -0.15;
      const lower = add(arm, `lowerarm_${side}`, -0.25);
      lower.position.x = side === 'l' ? 0.2 : -0.2;
      const hand = add(lower, `hand_${side}`, -0.2);
      hand.position.x = side === 'l' ? 0.15 : -0.15;
      return { arm, lower, hand };
    });
    rig.add(new THREE.Mesh(geometry, material));
    return { rig, spine, neck, head, eye, eyeRight, jaw, lips, lids, lidsRight, margins, arms, brow, corner, cornerRight, lipUpper, lipLower };
  });
  const hairGeometry = new THREE.BufferGeometry();
  hairGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.6, 0, 0.1, 1.7, 0, 0, 1.85, 0], 3));
  const hairMaterial = new THREE.MeshStandardMaterial({ transparent: true });
  const hair = new THREE.Mesh(hairGeometry, hairMaterial);
  hair.name = 'Hair_S_UpdoBuns_CardsMesh_Group0_LOD0';
  hair.scale.setScalar(0.01);
  scene.add(hair);
  return { scene, geometry, texture, material, rigs, hair, hairMaterial };
}

const context = { elapsed: 0, gazeTarget: null, speechLevel: 0, reducedMotion: true };
const loaded = (scene: THREE.Group): GLTF => ({ scene }) as unknown as GLTF;

afterEach(() => vi.restoreAllMocks());

describe('MetaHumanAvatar', () => {
  it('keeps the director root on the floor and imported materials while correcting C6 hair and eye height', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    const stage = new THREE.Scene();
    avatar.mount(stage);
    await avatar.load();
    avatar.root.updateMatrixWorld(true);

    expect(avatar.ready).toBe(true);
    expect(avatar.root.position.y).toBe(0);
    expect(model.material.map).toBe(model.texture);
    expect(model.rigs[1].eye.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(1.6, 6);
    expect(model.hair.parent).toBe(model.rigs[1].head);
    expect(new THREE.Box3().setFromObject(model.hair).max.y).toBeGreaterThan(1.7);
    expect(model.hairMaterial.transparent).toBe(false);
    expect(avatar.stats()).toEqual({ meshes: 3, triangles: 3 });
    avatar.dispose();
  });

  it('animates both independently named skeletons without accumulating pose or moving the director root', async () => {
    const model = fixture();
    for (const rig of model.rigs) rig.head.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.03);
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    avatar.root.position.set(0.2, 0, -0.1);
    const ctx = { ...context, gazeTarget: new THREE.Vector3(0.6, 1.6, 2) };
    avatar.update(0.1, ctx);
    const posed = model.rigs[0].head.quaternion.clone();
    expect(posed.angleTo(model.rigs[1].head.quaternion)).toBeLessThan(1e-6);
    for (let i = 0; i < 60; i++) avatar.update(0.1, ctx);
    expect(posed.angleTo(model.rigs[0].head.quaternion)).toBeLessThan(1e-6);
    expect(avatar.root.position.toArray()).toEqual([0.2, 0, -0.1]);
    avatar.dispose();
  });

  it('moves lower lips with the jaw for audible speech, then returns to the bind pose in silence', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    const rest = model.rigs[1].jaw.quaternion.clone();
    avatar.setViseme('AA', 1);
    avatar.update(0.1, { ...context, speechLevel: 1 });
    expect(model.rigs[1].jaw.quaternion.angleTo(rest)).toBeGreaterThan(0.05);
    expect(model.rigs[1].lips.quaternion.angleTo(rest)).toBeGreaterThan(0.05);
    avatar.setViseme('sil', 0);
    for (let i = 0; i < 12; i++) avatar.update(0.1, context);
    expect(model.rigs[1].jaw.quaternion.angleTo(rest)).toBeLessThan(1e-5);
    expect(model.rigs[1].lips.quaternion.angleTo(rest)).toBeLessThan(1e-5);
    avatar.dispose();
  });

  it('keeps closed-lip phones and silence closed despite a nonzero audio envelope', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    const rest = model.rigs[1].jaw.quaternion.clone();
    for (const phone of ['MBP', 'sil'] as const) {
      avatar.setViseme('AA', 1);
      avatar.update(0.1, { ...context, speechLevel: 1 });
      avatar.setViseme(phone, 1);
      for (let i = 0; i < 12; i++) avatar.update(0.1, { ...context, speechLevel: 1 });
      expect(model.rigs[1].jaw.quaternion.angleTo(rest)).toBeLessThan(1e-5);
      expect(model.rigs[1].lips.quaternion.angleTo(rest)).toBeLessThan(1e-5);
    }
    avatar.dispose();
  });

  it('spreads and rounds the lips for vowels, then releases speech offsets on closed phones', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    avatar.applyDirective({ ...DEFAULT_DIRECTIVE, expression: 'neutral' });
    const face = model.rigs[1];
    const rest = [face.corner, face.cornerRight, face.lipUpper, face.lipLower].map((bone) => bone.position.clone());
    avatar.setViseme('EE', 1);
    for (let i = 0; i < 4; i++) avatar.update(0.1, context);
    const spread = face.corner.position.x - face.cornerRight.position.x;
    expect(spread).toBeGreaterThan(0.063);
    avatar.setViseme('OU', 1);
    for (let i = 0; i < 4; i++) avatar.update(0.1, context);
    expect(face.corner.position.x - face.cornerRight.position.x).toBeLessThan(0.057);
    expect(face.lipUpper.position.z).toBeGreaterThan(rest[2].z + 0.001);
    expect(face.lipLower.position.z).toBeGreaterThan(rest[3].z + 0.001);
    avatar.setViseme('MBP', 1);
    for (let i = 0; i < 12; i++) avatar.update(0.1, { ...context, speechLevel: 1 });
    [face.corner, face.cornerRight, face.lipUpper, face.lipLower].forEach((bone, index) => {
      expect(bone.position.distanceTo(rest[index])).toBeLessThan(1e-6);
    });
    expect(face.jaw.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    avatar.dispose();
  });

  it('lowers both arms toward her sides and returns eyelids to rest after an idle blink', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    avatar.root.updateMatrixWorld(true);
    const before = model.rigs[0].arms.map(({ hand }) => hand.getWorldPosition(new THREE.Vector3()));
    avatar.update(1 / 60, context);
    const after = model.rigs[0].arms.map(({ hand }) => hand.getWorldPosition(new THREE.Vector3()));
    after.forEach((hand, index) => {
      expect(Math.abs(hand.x)).toBeLessThan(Math.abs(before[index].x));
      expect(hand.y).toBeLessThan(before[index].y);
    });
    let maxBlink = 0;
    for (let frame = 0; frame < 200; frame++) {
      avatar.update(1 / 60, { ...context, reducedMotion: false, elapsed: frame / 60 });
      maxBlink = Math.max(maxBlink, model.rigs[1].lids[0].quaternion.angleTo(new THREE.Quaternion()));
    }
    expect(maxBlink).toBeGreaterThan(0.5);
    // The idle pose is now softly relaxed, rather than the wide-open bind pose.
    const restingLid = model.rigs[1].lids[0].quaternion.angleTo(new THREE.Quaternion());
    expect(restingLid).toBeGreaterThan(0.02);
    expect(restingLid).toBeLessThan(0.12);
    avatar.dispose();
  });

  it('winks only the requested eye, keeps speech independent, and restores relaxed lids', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    avatar.update(0.1, context);
    const face = model.rigs[1];
    const rest = [face.lids, face.lidsRight].map((lids) => lids.map((lid) => lid.quaternion.clone()));
    const marginRest = face.margins.map(({ upper, lower }) => [upper.position.clone(), lower.position.clone()]);
    avatar.setViseme('AA', 1);
    for (const [side, active] of [['left', 0], ['right', 1]] as const) {
      avatar.wink(side);
      avatar.update(0.1, context);
      const sides = [face.lids, face.lidsRight];
      expect(sides[active][0].quaternion.angleTo(rest[active][0])).toBeGreaterThan(0.5);
      expect(sides[1 - active][0].quaternion.angleTo(rest[1 - active][0])).toBeLessThan(1e-7);
      expect(face.jaw.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.08);
      const margin = face.margins[active];
      const gap = model.scene.worldToLocal(margin.upper.getWorldPosition(new THREE.Vector3())).y
        - model.scene.worldToLocal(margin.lower.getWorldPosition(new THREE.Vector3())).y;
      expect(gap).toBeGreaterThanOrEqual(0.000349);
      for (let i = 0; i < 6; i++) avatar.update(0.1, context);
      sides.forEach((lids, index) => lids.forEach((lid, joint) => {
        expect(lid.quaternion.angleTo(rest[index][joint])).toBeLessThan(1e-7);
      }));
      face.margins.forEach(({ upper, lower }, index) => {
        expect(upper.position.distanceTo(marginRest[index][0])).toBeLessThan(1e-7);
        expect(lower.position.distanceTo(marginRest[index][1])).toBeLessThan(1e-7);
      });
    }
    avatar.dispose();
  });

  it('uses bounded conjugate eye fixations, and stops idle eye motion for reduced motion', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    const face = model.rigs[1];
    const poses: THREE.Quaternion[] = [];
    for (let frame = 0; frame < 600; frame++) {
      avatar.update(1 / 60, { ...context, elapsed: frame / 60, reducedMotion: false });
      expect(face.eye.quaternion.angleTo(face.eyeRight.quaternion)).toBeLessThan(1e-7);
      expect(face.eye.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.04);
      if (frame % 30 === 0) poses.push(face.eye.quaternion.clone());
    }
    expect(poses.some((pose) => pose.angleTo(poses[0]) > 0.005)).toBe(true);
    avatar.update(0.1, context);
    const reducedPose = face.eye.quaternion.clone();
    const reducedLid = face.lids[0].quaternion.clone();
    for (let frame = 0; frame < 300; frame++) {
      avatar.update(0.1, { ...context, elapsed: frame / 10 });
      expect(face.eye.quaternion.angleTo(reducedPose)).toBeLessThan(1e-7);
      expect(face.lids[0].quaternion.angleTo(reducedLid)).toBeLessThan(1e-7);
    }
    avatar.dispose();
  });

  it('lets warmth reach the eyelids without adding expression offsets to a full wink', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    const face = model.rigs[1];
    avatar.applyDirective({ ...DEFAULT_DIRECTIVE, expression: 'neutral', intensity: 1 });
    avatar.update(0.1, context);
    const neutral = face.lids.map((lid) => lid.quaternion.clone());
    avatar.applyDirective({ ...DEFAULT_DIRECTIVE, expression: 'smile', intensity: 1 });
    avatar.update(0.1, context);
    expect(face.lids[0].quaternion.angleTo(neutral[0])).toBeGreaterThan(0.03);
    expect(face.lids[2].quaternion.angleTo(neutral[2])).toBeGreaterThan(0.02);
    avatar.wink();
    avatar.update(0.1, context);
    expect(face.lids[0].quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0.6, 6);
    expect(face.lids[2].quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0.15, 6);
    avatar.dispose();
  });

  it('responds to expression intensity and restores facial translations after the expression changes', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    const rest = model.rigs[1].corner.position.clone();
    avatar.applyDirective({ ...DEFAULT_DIRECTIVE, expression: 'smile', intensity: 0 });
    avatar.update(0.1, context);
    expect(model.rigs[1].corner.position.distanceTo(rest)).toBeLessThan(1e-8);
    avatar.applyDirective({ ...DEFAULT_DIRECTIVE, expression: 'smile', intensity: 1 });
    avatar.update(0.1, context);
    expect(model.rigs[1].corner.position.y - rest.y).toBeGreaterThan(0.002);
    avatar.applyDirective({ ...DEFAULT_DIRECTIVE, expression: 'neutral', intensity: 1 });
    avatar.update(0.1, context);
    expect(model.rigs[1].corner.position.distanceTo(rest)).toBeLessThan(1e-8);
    avatar.dispose();
  });

  it('presents with both hands, reaches with the left hand, and raises the right for a small wave', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    avatar.update(0.1, context);
    const rest = model.rigs[0].arms.map(({ hand }) => hand.getWorldPosition(new THREE.Vector3()));
    const gesture = (name: 'open_palms' | 'point_to_hologram' | 'small_wave') => {
      avatar.applyDirective({ ...DEFAULT_DIRECTIVE, gesture: name, intensity: 1 });
      for (let i = 0; i < 8; i++) avatar.update(0.1, context);
      return model.rigs[0].arms.map(({ hand }) => hand.getWorldPosition(new THREE.Vector3()));
    };
    const open = gesture('open_palms');
    expect(open[0].y).toBeGreaterThan(rest[0].y + 0.15);
    expect(open[1].y).toBeGreaterThan(rest[1].y + 0.15);
    expect(open.every((hand) => hand.z > 0.1)).toBe(true);
    const point = gesture('point_to_hologram');
    expect(point[0].x).toBeGreaterThan(open[0].x + 0.08);
    expect(point[0].y).toBeGreaterThan(rest[0].y + 0.2);
    const wave = gesture('small_wave');
    expect(wave[1].y).toBeGreaterThan(rest[1].y + 0.4);
    expect(wave.every((hand) => Number.isFinite(hand.lengthSq()))).toBe(true);
    avatar.dispose();
  });

  it('keeps a wave continuous when the speaking expression changes mid-gesture', async () => {
    const first = fixture();
    const reference = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValueOnce(loaded(first.scene))
      .mockResolvedValueOnce(loaded(reference.scene));
    const avatar = new MetaHumanAvatar();
    const other = new MetaHumanAvatar();
    await avatar.load();
    await other.load();
    const directive = { ...DEFAULT_DIRECTIVE, gesture: 'small_wave' as const, intensity: 0.85 };
    avatar.applyDirective(directive);
    other.applyDirective(directive);
    for (let i = 0; i < 36; i++) {
      const ctx = { ...context, reducedMotion: false, elapsed: i / 60 };
      avatar.update(1 / 60, ctx);
      other.update(1 / 60, ctx);
    }
    avatar.applyDirective({ ...directive, expression: 'smile' });
    for (let i = 36; i < 90; i++) {
      const ctx = { ...context, reducedMotion: false, elapsed: i / 60 };
      avatar.update(1 / 60, ctx);
      other.update(1 / 60, ctx);
      for (const part of ['arm', 'lower', 'hand'] as const) {
        expect(first.rigs[0].arms[1][part].quaternion.angleTo(reference.rigs[0].arms[1][part].quaternion)).toBeLessThan(1e-6);
      }
    }
    avatar.dispose();
    other.dispose();
  });

  it('raises and lowers an arm without a sudden elbow or wrist flip', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    avatar.update(1 / 60, context);
    const arm = model.rigs[0].arms[1];
    const bones = [arm.arm, arm.lower, arm.hand];
    const previous = bones.map((bone) => bone.quaternion.clone());
    let maxStep = 0;
    const ctx = { ...context, reducedMotion: false };
    for (const [gesture, frames] of [['small_wave', 36], ['open_palms', 36], ['small_wave', 180], ['none', 180]] as const) {
      avatar.applyDirective({ ...DEFAULT_DIRECTIVE, gesture, intensity: 0.85 });
      for (let frame = 0; frame < frames; frame++) {
        ctx.elapsed += 1 / 60;
        avatar.update(1 / 60, ctx);
        bones.forEach((bone, index) => {
          maxStep = Math.max(maxStep, bone.quaternion.angleTo(previous[index]));
          previous[index].copy(bone.quaternion);
        });
      }
    }
    // At 60 fps a larger single-frame turn reads as a visible pose cut.
    expect(maxStep).toBeLessThan(0.1);
    avatar.dispose();
  });

  it('finishes requested gestures on real time when rendering drops frames', async () => {
    const model = fixture();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(loaded(model.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    const ctx = { ...context, reducedMotion: false };
    avatar.update(0.1, ctx);
    const rest = model.rigs[0].arms[1].hand.getWorldPosition(new THREE.Vector3());
    avatar.applyDirective({ ...DEFAULT_DIRECTIVE, gesture: 'small_wave', intensity: 0.85 });
    avatar.update(0.1, { ...ctx, animationDt: 0.7 });
    expect(model.rigs[0].arms[1].hand.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(rest.y + 0.3);
    avatar.wink();
    avatar.update(0.1, { ...ctx, animationDt: 0.1 });
    expect(model.rigs[1].lids[0].quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.5);
    avatar.update(0.1, { ...ctx, animationDt: 3 });
    expect(model.rigs[0].arms[1].hand.getWorldPosition(new THREE.Vector3()).distanceTo(rest)).toBeLessThan(0.0001);
    expect(model.rigs[1].lids[0].quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.1);
    avatar.dispose();
  });

  it('releases a load that finishes after disposal and disposes shared resources exactly once', async () => {
    const model = fixture();
    const geometryDispose = vi.spyOn(model.geometry, 'dispose');
    const materialDispose = vi.spyOn(model.material, 'dispose');
    const textureDispose = vi.spyOn(model.texture, 'dispose');
    let resolve!: (gltf: GLTF) => void;
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockReturnValue(new Promise((done) => { resolve = done; }));
    const avatar = new MetaHumanAvatar();
    const pending = avatar.load();
    avatar.dispose();
    resolve(loaded(model.scene));
    await pending;
    avatar.dispose();
    expect(avatar.ready).toBe(false);
    expect(avatar.root.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it('keeps a working avatar when a replacement model is invalid', async () => {
    const model = fixture();
    const invalid = fixture();
    invalid.rigs[1].rig.name = 'unknown';
    const invalidDispose = vi.spyOn(invalid.geometry, 'dispose');
    vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValueOnce(loaded(model.scene))
      .mockResolvedValueOnce(loaded(invalid.scene));
    const avatar = new MetaHumanAvatar();
    await avatar.load();
    await expect(avatar.load('/invalid.glb')).rejects.toThrow('skeleton');
    expect(avatar.ready).toBe(true);
    expect(model.scene.parent).not.toBeNull();
    expect(invalidDispose).toHaveBeenCalledTimes(1);
    avatar.dispose();
  });
});
