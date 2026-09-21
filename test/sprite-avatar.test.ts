import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SpriteAvatar } from '../src/character/sprite-avatar.ts';
import { DEFAULT_DIRECTIVE, type CharacterDirective } from '../shared/types.ts';
import type { AvatarContext } from '../src/character/types.ts';
import manifest from '../public/character/elohim/manifest.json';

const avatars: SpriteAvatar[] = [];
const heldFiles = new Set<string>();
const pendingLoads = new Map<string, () => void>();
const context: AvatarContext = { elapsed: 0, gazeTarget: null, speechLevel: 0, reducedMotion: false };

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => manifest }));
  vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async (url) => {
    const texture = new THREE.Texture();
    texture.name = url.split('/').at(-1)!;
    if (heldFiles.has(texture.name)) {
      await new Promise<void>((resolve) => pendingLoads.set(texture.name, resolve));
    }
    return texture;
  });
});

afterEach(() => {
  avatars.splice(0).forEach((avatar) => avatar.dispose());
  pendingLoads.forEach((resolve) => resolve());
  pendingLoads.clear();
  heldFiles.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function create() {
  const avatar = new SpriteAvatar();
  avatars.push(avatar);
  await avatar.load('/character/elohim/manifest.json');
  step(avatar, 30);
  return avatar;
}

function step(avatar: SpriteAvatar, frames = 1, ctx: Partial<AvatarContext> = {}, dt = 1 / 60) {
  for (let frame = 0; frame < frames; frame++) avatar.update(dt, { ...context, ...ctx });
}

function direct(avatar: SpriteAvatar, values: Partial<CharacterDirective>) {
  avatar.applyDirective({ ...DEFAULT_DIRECTIVE, ...values });
}

function mesh(avatar: SpriteAvatar, name: string) {
  return avatar.root.getObjectByName(`elohim-${name}`) as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

function drawing(avatar: SpriteAvatar, name: string) {
  const layer = mesh(avatar, name);
  return layer.visible && layer.material.opacity > 0.5 ? layer.material.map?.name : null;
}

function visibleBodies(avatar: SpriteAvatar) {
  const result: string[] = [];
  avatar.root.traverse((object) => {
    if (object.name.startsWith('elohim-body-') && object.visible) result.push(object.name);
  });
  return result;
}

describe('painted avatar speech', () => {
  it('does not mime an estimated viseme without audible audio', async () => {
    const avatar = await create();
    direct(avatar, { state: 'SPEAKING', expression: 'warm' });
    for (let i = 0; i < 90; i++) {
      avatar.setViseme(i % 2 ? 'AA' : 'OH', 1);
      step(avatar);
      expect(drawing(avatar, 'mouthA')).not.toMatch(/mouth-(AA|OH)/);
    }
  });

  it('opens for audio and closes immediately on cancellation, including during a held shape', async () => {
    const avatar = await create();
    avatar.setViseme('AA', 1);
    step(avatar, 1, { speechLevel: 0.7 });
    expect(drawing(avatar, 'mouthA')).toBe(manifest.mouths.AA);
    avatar.setViseme('sil', 0);
    expect(drawing(avatar, 'mouthA')).toBeNull();
  });

  it('holds a vowel long enough to read, using the animation clock', async () => {
    const avatar = await create();
    avatar.setViseme('AA', 1);
    step(avatar, 1, { speechLevel: 0.7 });
    avatar.setViseme('OH', 1);
    step(avatar, 2, { speechLevel: 0.7 });
    expect(drawing(avatar, 'mouthA')).toBe(manifest.mouths.AA);
    step(avatar, 7, { speechLevel: 0.7 });
    expect(drawing(avatar, 'mouthA')).toBe(manifest.mouths.OH);
  });

  it('closes on loss of audio or a stale viseme instead of freezing open', async () => {
    const avatar = await create();
    avatar.setViseme('AA', 1);
    step(avatar, 1, { speechLevel: 0.7 });
    step(avatar);
    expect(drawing(avatar, 'mouthA')).toBeNull();
    avatar.setViseme('OH', 1);
    step(avatar, 20, { speechLevel: 0.7 });
    expect(drawing(avatar, 'mouthA')).not.toBe(manifest.mouths.OH);
  });

  it('keeps breathing continuous when syllables change and elapsed time jumps', async () => {
    const quiet = await create();
    const speaking = await create();
    for (let i = 0; i < 40; i++) {
      speaking.setViseme(i % 2 ? 'AA' : 'sil', i % 2);
      step(quiet, 1, { elapsed: 90 + i / 60 });
      step(speaking, 1, { elapsed: 90 + i / 60, speechLevel: i % 2 });
      expect(mesh(speaking, 'body-casual-rest').scale.y)
        .toBeCloseTo(mesh(quiet, 'body-casual-rest').scale.y, 9);
    }
  });
});

describe('painted avatar attention and transitions', () => {
  it('honors context gaze without requiring the optional lookAt call', async () => {
    const avatar = await create();
    const head = avatar.root.getObjectByName('elohim-head-motion')!;
    const before = head.position.x;
    step(avatar, 90, { gazeTarget: new THREE.Vector3(0.7, 1.6, 1) });
    expect(head.position.x - before).toBeGreaterThan(0.003);
  });

  it('keeps attentive eye contact throughout listening', async () => {
    const avatar = await create();
    direct(avatar, { state: 'LISTENING', expression: 'warm' });
    for (let i = 0; i < 900; i++) {
      step(avatar);
      expect(drawing(avatar, 'eyes')).toBe(manifest.eyes.warm);
    }
  });

  it('lets thinking look away, then returns to the next conversational expression', async () => {
    const avatar = await create();
    direct(avatar, { state: 'THINKING', expression: 'focused' });
    const seen = new Set<string | null | undefined>();
    for (let i = 0; i < 200; i++) {
      step(avatar);
      seen.add(drawing(avatar, 'eyes'));
    }
    expect(seen).toContain(manifest.eyes.focused);
    expect(seen).toContain(manifest.eyes['look-up']);
    direct(avatar, { state: 'SPEAKING', expression: 'reassuring' });
    step(avatar, 30);
    expect(drawing(avatar, 'eyes')).toBe(manifest.eyes.warm);
  });

  it('keeps the current eyes while a requested emotion texture is still loading', async () => {
    heldFiles.add(manifest.eyes.concerned);
    const avatar = await create();
    step(avatar, 1, { reducedMotion: true });
    direct(avatar, { state: 'CONCERNED', expression: 'concerned' });
    step(avatar, 30, { reducedMotion: true });
    expect(drawing(avatar, 'eyes')).toBe(manifest.eyes.warm);
    pendingLoads.get(manifest.eyes.concerned)!();
    await Promise.resolve();
    await Promise.resolve();
    step(avatar, 30, { reducedMotion: true });
    expect(drawing(avatar, 'eyes')).toBe(manifest.eyes.concerned);
  });

  it('does not land a cancelled body gesture on a later blink', async () => {
    const avatar = await create();
    direct(avatar, { gesture: 'open_palms' });
    step(avatar);
    direct(avatar, { gesture: 'none' });
    for (let i = 0; i < 60; i++) {
      step(avatar);
      expect(visibleBodies(avatar)).toEqual(['elohim-body-casual-rest']);
    }
  });

  it('switches an outfit with one visible body, including reduced motion', async () => {
    const avatar = await create();
    step(avatar, 1, { reducedMotion: true });
    avatar.setOutfit('clinical');
    step(avatar, 1, { reducedMotion: true });
    expect(visibleBodies(avatar)).toEqual(['elohim-body-clinical-rest']);
  });

  it('keeps the head on the same breathing path across differently cropped body poses', async () => {
    const rest = await create();
    const presenting = await create();
    direct(presenting, { gesture: 'open_palms' });
    for (let i = 0; i < 60; i++) {
      step(rest);
      step(presenting);
      expect(presenting.root.getObjectByName('elohim-head-motion')!.position.y)
        .toBeCloseTo(rest.root.getObjectByName('elohim-head-motion')!.position.y, 9);
    }
    expect(visibleBodies(presenting)).toEqual(['elohim-body-casual-explain']);
  });

  it('finishes a nod even if its directive is delivered repeatedly', async () => {
    const once = await create();
    const repeated = await create();
    direct(once, { gesture: 'nod' });
    direct(repeated, { gesture: 'nod' });
    for (let i = 0; i < 50; i++) {
      if (i % 5 === 0) direct(repeated, { gesture: 'nod' });
      step(once);
      step(repeated);
      expect(repeated.root.getObjectByName('elohim-head-motion')!.position.y)
        .toBeCloseTo(once.root.getObjectByName('elohim-head-motion')!.position.y, 9);
    }
  });

  it('scales gaze travel down for reduced motion and survives a resumed tab', async () => {
    const normal = await create();
    const reduced = await create();
    const target = new THREE.Vector3(2, 1.6, 1);
    step(normal, 180, { gazeTarget: target });
    step(reduced, 180, { gazeTarget: target, reducedMotion: true });
    const x = (avatar: SpriteAvatar) => avatar.root.getObjectByName('elohim-head-motion')!.position.x;
    const gap = x(normal) - x(reduced);
    expect(gap).toBeGreaterThan(0.003);
    direct(reduced, { expression: 'concerned' });
    step(reduced, 10, { reducedMotion: true }, 2);
    expect(drawing(reduced, 'eyes')).toBe(manifest.eyes.concerned);
    expect(Number.isFinite(x(reduced))).toBe(true);
  });

  it('releases the blink resources and counts every constructed quad', async () => {
    const avatar = await create();
    const blink = mesh(avatar, 'blink');
    const geometry = vi.spyOn(blink.geometry, 'dispose');
    const material = vi.spyOn(blink.material, 'dispose');
    let meshCount = 0;
    avatar.root.traverse((object) => { if (object instanceof THREE.Mesh) meshCount++; });
    expect(avatar.stats()).toEqual({ meshes: meshCount, triangles: meshCount * 2 });
    avatar.dispose();
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    avatars.splice(avatars.indexOf(avatar), 1);
  });
});
