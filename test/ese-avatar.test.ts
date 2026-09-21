import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EseAvatar, type AvatarAsset } from '../src/character/ese-avatar.ts';
import { CharacterPortal } from '../src/character/portal.ts';
import { DEFAULT_DIRECTIVE, type CharacterDirective } from '../shared/types.ts';
import type { AvatarContext } from '../src/character/types.ts';

const base: AvatarContext = { elapsed: 0, gazeTarget: null, speechLevel: 0, reducedMotion: false };
const avatars: EseAvatar[] = [], portals: CharacterPortal[] = [];
afterEach(() => { avatars.splice(0).forEach((a) => a.dispose()); portals.splice(0).forEach((p) => p.dispose()); vi.restoreAllMocks(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function asset(name = 'fixture', animateJaw = false) {
  const scene = new THREE.Group(); scene.name = name; scene.userData.portalY = 1.1;
  const geometry = new THREE.BoxGeometry(.3, .5, .2);
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
  const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = 'Face';
  const head = new THREE.Bone(); head.name = 'Head'; head.position.y = 1.7; scene.add(head);
  const skeleton = new THREE.Skeleton([head]); mesh.bind(skeleton); skeleton.computeBoneTexture();
  const names = ['viseme_aa', 'viseme_O', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight', 'browInnerUp', 'eyeBlinkLeft', 'eyeBlinkRight'];
  geometry.morphAttributes.position = names.map(() => geometry.attributes.position.clone());
  mesh.morphTargetDictionary = Object.fromEntries(names.map((value, i) => [value, i]));
  mesh.morphTargetInfluences = names.map(() => 0); scene.add(mesh);
  // Shared resources must still be released exactly once.
  const hidden = new THREE.Mesh(geometry, material); hidden.name = 'NORMAL_Body'; scene.add(hidden);
  const marker = new THREE.Object3D(); marker.name = 'BodyMarker'; scene.add(marker);
  const clips = ['Idle', 'Welcome', 'Listening', 'Empathy', 'Pointing', 'Examining', 'Speaking'];
  const animations = clips.map((clip, index) => new THREE.AnimationClip(clip, 1, [
    new THREE.VectorKeyframeTrack('BodyMarker.position', [0, 1], [index, 0, 0, index, 0, 0]),
    ...(animateJaw ? [new THREE.NumberKeyframeTrack('Face.morphTargetInfluences[jawOpen]', [0, 1], [.8, .8])] : []),
  ]));
  const resources = [geometry, material, texture, skeleton.boneTexture!];
  const disposed = resources.map(() => vi.fn());
  resources.forEach((resource, i) => resource.addEventListener('dispose', disposed[i]));
  const value = (morph: string) => mesh.morphTargetInfluences![mesh.morphTargetDictionary![morph]];
  return { scene, animations, mesh, head, marker, resources, disposed, value };
}
async function create(fixture = asset()) {
  const avatar = new EseAvatar(async () => fixture); avatars.push(avatar); avatar.mount(new THREE.Scene()); await avatar.load();
  return { avatar, fixture };
}
function step(avatar: EseAvatar, frames = 1, context: Partial<AvatarContext> = {}, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) avatar.update(dt, { ...base, ...context });
}
function direct(avatar: EseAvatar, directive: Partial<CharacterDirective>) {
  avatar.applyDirective({ ...DEFAULT_DIRECTIVE, ...directive });
}
function liveWake(portal: CharacterPortal): Array<{ index: number; point: THREE.Vector3; age: number }> {
  const positions = portal.trail.geometry.getAttribute('position');
  const ages = portal.trail.geometry.getAttribute('age');
  return Array.from({ length: ages.count }, (_, index) => ({ index, point: new THREE.Vector3().fromBufferAttribute(positions, index), age: ages.getX(index) }))
    .filter(({ age }) => age < 1.8);
}

describe('Ese GLB ownership and disposal', () => {
  it('releases an asset that resolves after disposal without mounting it', async () => {
    const pending = deferred<AvatarAsset>(); const fixture = asset('late');
    const avatar = new EseAvatar(() => pending.promise); avatars.push(avatar);
    const parent = new THREE.Scene(); avatar.mount(parent); const loading = avatar.load();
    avatar.dispose(); pending.resolve(fixture); await loading;
    expect(parent.children).toHaveLength(0); expect(fixture.scene.parent).toBeNull();
    fixture.disposed.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
  });
  it('keeps the newest load and disposes an older out-of-order result', async () => {
    const first = deferred<AvatarAsset>(), second = deferred<AvatarAsset>();
    const a = asset('old'), b = asset('latest');
    const loader = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const avatar = new EseAvatar(loader); avatars.push(avatar);
    const loadA = avatar.load('old.glb'), loadB = avatar.load('new.glb');
    second.resolve(b); await loadB; first.resolve(a); await loadA;
    expect(avatar.root.getObjectByName('latest')).toBe(b.scene); expect(avatar.root.getObjectByName('old')).toBeUndefined();
    a.disposed.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
    b.disposed.forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
  });
  it('replaces a previously loaded model instead of retaining two bodies and mixers', async () => {
    const a = asset('first'), b = asset('second'); const loader = vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    const avatar = new EseAvatar(loader); avatars.push(avatar); await avatar.load(); await avatar.load();
    expect(avatar.root.getObjectByName('first')).toBeUndefined(); expect(avatar.root.getObjectByName('second')).toBe(b.scene);
    a.disposed.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
  });
  it('disposes shared geometry, material, texture, skin bone texture and portal resources only once', async () => {
    const { avatar, fixture } = await create();
    const portalGeometry = (avatar.portal.group.children[0] as THREE.Mesh).geometry;
    const portalDisposed = vi.fn(); portalGeometry.addEventListener('dispose', portalDisposed);
    avatar.dispose(); avatar.dispose();
    fixture.disposed.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
    expect(portalDisposed).toHaveBeenCalledTimes(1);
  });
  it('hides authored normal/reference meshes without requiring a renderer', async () => {
    const { avatar, fixture } = await create();
    expect(fixture.scene.getObjectByName('NORMAL_Body')?.visible).toBe(false);
    expect(fixture.mesh.frustumCulled).toBe(false); expect(avatar.stats().triangles).toBeGreaterThan(0);
  });
});

describe('Ese body clips, expressions and actual-audio mouth', () => {
  it.each([
    [{ gesture: 'small_wave', state: 'HAPPY' }, 1], [{ state: 'LISTENING' }, 2],
    [{ expression: 'reassuring' }, 3], [{ gesture: 'point_to_hologram', state: 'EXPLAINING' }, 4],
    [{ state: 'THINKING' }, 5], [{ state: 'SPEAKING', gesture: 'open_palms' }, 6],
  ] as Array<[Partial<CharacterDirective>, number]>)('plays the authored clip for %j', async (directive, target) => {
    const { avatar, fixture } = await create(); direct(avatar, directive); step(avatar, 60);
    expect(fixture.marker.position.x).toBeCloseTo(target, 3);
  });
  it('does not reset an unchanged body clip every time the same directive arrives', async () => {
    const fixture = asset();
    const speaking = fixture.animations.find((clip) => clip.name === 'Speaking')!;
    speaking.tracks[0] = new THREE.VectorKeyframeTrack('BodyMarker.position', [0, 1], [0, 0, 0, 1, 0, 0]);
    const { avatar } = await create(fixture);
    for (let i = 0; i < 40; i++) { direct(avatar, { state: 'SPEAKING' }); step(avatar); }
    expect(fixture.marker.position.x).toBeGreaterThan(.4);
  });
  it('opens for audio, closes immediately on silence, and retains a reassuring expression', async () => {
    const { avatar, fixture } = await create(); direct(avatar, { state: 'SPEAKING', expression: 'reassuring' });
    avatar.setViseme('AA', 1); step(avatar, 1, { speechLevel: .8 });
    expect(fixture.value('viseme_aa')).toBeGreaterThan(0);
    step(avatar, 1, { speechLevel: 0 }); expect(fixture.value('viseme_aa')).toBe(0);
    expect(fixture.value('mouthSmileLeft')).toBeGreaterThan(0);
  });
  it('cancellation clears all speech morphs before another frame and stays closed under a jaw animation', async () => {
    const { avatar, fixture } = await create(asset('animated-jaw', true));
    direct(avatar, { state: 'SPEAKING' }); avatar.setViseme('AA', 1); step(avatar, 1, { speechLevel: .8 });
    avatar.setViseme('sil', 0);
    expect(fixture.value('viseme_aa')).toBe(0); expect(fixture.value('jawOpen')).toBe(0);
    step(avatar, 1, { speechLevel: 0 });
    expect(fixture.value('viseme_aa')).toBe(0); expect(fixture.value('jawOpen')).toBe(0);
  });
  it('expires a stale viseme even if the envelope stays high', async () => {
    const { avatar, fixture } = await create(); avatar.setViseme('OH', 1); step(avatar, 1, { speechLevel: .8 });
    expect(fixture.value('viseme_O')).toBeGreaterThan(0);
    step(avatar, 24, { speechLevel: .8 }); expect(fixture.value('viseme_O')).toBe(0);
  });
  it('keeps the rig finite if a bad numeric speech weight arrives', async () => {
    const { avatar, fixture } = await create(); avatar.setViseme('AA', Number.NaN); step(avatar, 1, { speechLevel: .8 });
    expect(fixture.mesh.morphTargetInfluences!.every(Number.isFinite)).toBe(true);
  });
  it('freezes idle drift and body animation for reduced motion while honoring audio silence', async () => {
    const { avatar, fixture } = await create();
    step(avatar, 1, { reducedMotion: true }); const marker = fixture.marker.position.clone();
    step(avatar, 120, { reducedMotion: true });
    expect(fixture.marker.position.equals(marker)).toBe(true);
    expect(avatar.root.getObjectByName('EseBody')?.position.y).toBe(0);
    expect(avatar.root.getObjectByName('EseBody')?.rotation.z).toBe(0);
    expect(avatar.portal.trail.visible).toBe(false);
    expect(fixture.value('viseme_aa')).toBe(0);
  });
});

describe('attached portal and world-space wake', () => {
  function createPortal(parent = new THREE.Scene()) {
    const portal = new CharacterPortal(); portals.push(portal); parent.add(portal.group, portal.trail); return portal;
  }
  it('emits only after movement and leaves earlier samples behind as the avatar moves', () => {
    const portal = createPortal(); portal.update(.05, .05, false); expect(liveWake(portal)).toHaveLength(0);
    portal.group.position.x = 1; portal.update(.05, .1, false); const first = liveWake(portal)[0];
    expect(first.point.x).toBeCloseTo(1);
    portal.group.position.x = 2; portal.update(.05, .15, false);
    const wake = liveWake(portal); expect(wake).toHaveLength(2); expect(wake[0].point.x).toBeCloseTo(1);
    expect(wake[1].point.x).toBeGreaterThan(1.8);
  });
  it('does not transform world-space samples twice under a translated parent', () => {
    const parent = new THREE.Scene(); parent.position.set(10, 2, 4);
    const portal = createPortal(parent); portal.update(.05, .05, false);
    portal.group.position.x = 1; portal.update(.05, .1, false);
    const point = portal.trail.localToWorld(liveWake(portal)[0].point.clone());
    const attached = portal.group.getWorldPosition(new THREE.Vector3());
    expect(point.x).toBeCloseTo(attached.x); expect(point.z).toBeCloseTo(attached.z + .13);
    expect(point.y).toBeCloseTo(attached.y - .04 - .05 * .045);
  });
  it('suppresses wake and animated shader/ring motion with reduced motion', () => {
    const portal = createPortal(); portal.update(.05, 1, true); portal.group.position.x = 1; portal.update(.05, 2, true);
    expect(liveWake(portal)).toHaveLength(0); expect(portal.trail.visible).toBe(false);
    const shaders = portal.group.children.filter((o) => o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
    shaders.forEach((mesh) => expect(mesh.material.uniforms.time.value).toBe(0));
    const rings = portal.group.children.filter((o) => o instanceof THREE.Mesh && o.geometry instanceof THREE.TorusGeometry);
    rings.forEach((ring) => expect(ring.rotation.z).toBe(0));
  });
  it('hides its sibling wake when the attached character ancestor is hidden', () => {
    const scene = new THREE.Scene(), body = new THREE.Group(); scene.add(body);
    const portal = createPortal(); body.add(portal.group); scene.add(portal.trail);
    portal.update(.05, .05, false); body.position.x = 1; portal.update(.05, .1, false);
    body.visible = false; portal.update(.05, .15, false); expect(portal.trail.visible).toBe(false);
  });
  it('releases portal resources exactly once and detaches both objects', () => {
    const parent = new THREE.Scene(), portal = createPortal(parent);
    const disposed: ReturnType<typeof vi.fn>[] = [];
    portal.group.traverse((object) => { if (object instanceof THREE.Mesh) {
      for (const resource of [object.geometry, object.material as THREE.Material]) { const spy = vi.fn(); resource.addEventListener('dispose', spy); disposed.push(spy); }
    } });
    for (const resource of [portal.trail.geometry, portal.trail.material as THREE.Material]) { const spy = vi.fn(); resource.addEventListener('dispose', spy); disposed.push(spy); }
    portal.dispose(); portal.dispose(); expect(parent.children).toHaveLength(0);
    disposed.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
  });
});
