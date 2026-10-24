import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CharacterDirective } from '../shared/types.ts';

type Gate = ReturnType<typeof deferred>;
type TestAvatar = ReturnType<typeof avatarDouble>;
const controls = vi.hoisted(() => ({
  avatarLoad: null as Gate | null,
  procedural: [] as TestAvatar[],
  metahuman: [] as TestAvatar[],
  sprite: [] as TestAvatar[],
  stages: [] as Array<{ scene: THREE.Scene; setShot: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
  clinicError: null as Error | null,
  hologramLayoutError: null as Error | null,
  clinics: [] as Array<{ group: THREE.Group; dispose: ReturnType<typeof vi.fn> }>,
  holograms: [] as Array<{ group: THREE.Group; setLayout: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function avatarDouble(kind: 'procedural' | 'metahuman' | 'sprite') {
  const root = new THREE.Group();
  const avatar = {
    root,
    state: 'IDLE',
    load: vi.fn(() => kind === 'metahuman' ? controls.avatarLoad!.promise : Promise.resolve()),
    mount: vi.fn((scene: THREE.Scene) => scene.add(root)),
    dispose: vi.fn(() => root.removeFromParent()),
    setOutfit: vi.fn(),
    lookAt: vi.fn(),
    setViseme: vi.fn(),
    update: vi.fn(),
    stats: vi.fn(() => ({ meshes: 1, triangles: 1 })),
    applyDirective: vi.fn((directive: CharacterDirective) => {
      // Preserve the real FSM constraint which made late completed readings fail.
      if (directive.state === 'ANALYSIS_COMPLETE' && avatar.state !== 'CLINICAL_ANALYSIS') return;
      avatar.state = directive.state;
    }),
  };
  controls[kind].push(avatar);
  return avatar;
}

vi.mock('../src/character/procedural-avatar.ts', () => ({ ProceduralAvatar: class { constructor() { return avatarDouble('procedural'); } } }));
vi.mock('../src/character/metahuman-avatar.ts', () => ({ MetaHumanAvatar: class { constructor() { return avatarDouble('metahuman'); } } }));
vi.mock('../src/character/sprite-avatar.ts', () => ({ SpriteAvatar: class { constructor() { return avatarDouble('sprite'); } } }));
vi.mock('../src/character/speech.ts', () => ({ MutedSpeechTrack: class {}, SpeechTrack: class {} }));
vi.mock('../src/state/session.svelte.ts', () => ({ session: { sceneMode: 'lounge', chatError: null } }));
vi.mock('../src/lib/sound.ts', () => ({ startRoom: vi.fn(), stopRoom: vi.fn() }));
vi.mock('../src/holograms/primitives.ts', () => ({ METRIC_FACE_REGIONS: {} }));
vi.mock('../src/scene/textures.ts', () => ({ radialTexture: () => new THREE.Texture() }));
vi.mock('../src/scene/grade.ts', () => ({ Grade: class { dispose = vi.fn(); } }));
vi.mock('../src/scene/cinematography.ts', () => ({ Cinematographer: class { reset = vi.fn(); request = vi.fn(); } }));
vi.mock('../src/scene/lounge.ts', () => ({ LoungeEnvironment: class {
  group = new THREE.Group();
  background = new THREE.Color();
  setPresence = vi.fn();
  dispose = vi.fn();
} }));
vi.mock('../src/scene/stage.ts', () => ({
  SHOT_CONVERSATION: { fov: 40, target: { y: 1.5 }, position: { z: 3 } },
  SHOT_CLINICAL: { fov: 45, target: { y: 1.5 }, position: { z: 4 } },
  SHOT_CLINICAL_PORTRAIT: { fov: 50, target: { y: 1.5 }, position: { z: 5 } },
  Stage: class {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();
    settings = { particles: false, richEffects: false };
    renderer = { setClearColor: vi.fn() };
    aspect = 1.44;
    setShot = vi.fn();
    start = vi.fn();
    dispose = vi.fn();
    constructor() { controls.stages.push(this); }
  },
}));
vi.mock('../src/scene/clinical.ts', () => ({ ClinicalEnvironment: class {
  group = new THREE.Group();
  background = new THREE.Color();
  setPresence = vi.fn();
  dispose = vi.fn(() => this.group.removeFromParent());
  constructor() {
    if (controls.clinicError) throw controls.clinicError;
    controls.clinics.push(this);
  }
} }));
vi.mock('../src/holograms/rig.ts', () => ({ HologramRig: class {
  group = new THREE.Group();
  mount = vi.fn((parent: THREE.Object3D) => parent.add(this.group));
  setLayout = vi.fn(() => { if (controls.hologramLayoutError) throw controls.hologramLayoutError; });
  shutdown = vi.fn();
  dispose = vi.fn(() => this.group.removeFromParent());
  constructor() { controls.holograms.push(this); }
} }));

import { SessionDirector } from '../src/scene/director.ts';
import { session } from '../src/state/session.svelte.ts';
import * as sound from '../src/lib/sound.ts';

let director: SessionDirector | null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', {});
  controls.avatarLoad = deferred();
  controls.procedural.length = controls.metahuman.length = controls.sprite.length = controls.stages.length = 0;
  controls.clinicError = null;
  controls.hologramLayoutError = null;
  controls.clinics.length = controls.holograms.length = 0;
  session.sceneMode = 'lounge';
  session.chatError = null;
  director = new SessionDirector({} as HTMLCanvasElement);
});

afterEach(() => {
  director?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SessionDirector asynchronous lifecycle', () => {
  it('disposes a character that completes after teardown without mounting or announcing it', async () => {
    const loaded = controls.metahuman[0];
    const onStatus = vi.fn();
    director!.onCharacterStatus = onStatus;
    director!.dispose();
    controls.avatarLoad!.resolve();
    await controls.avatarLoad!.promise;
    await Promise.resolve();

    expect(loaded.dispose).toHaveBeenCalled();
    expect(loaded.mount).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
    expect(controls.stages[0].dispose).toHaveBeenCalledTimes(1);
    expect(controls.sprite).toHaveLength(0);
  });

  it('copies the latest scene transform and conversation directive into a late character', async () => {
    const placeholder = controls.procedural[0];
    placeholder.root.position.set(-0.35, 0.2, 0.28);
    placeholder.root.rotation.set(0.02, 0.42, -0.01);
    placeholder.root.scale.setScalar(0.93);
    const directive: CharacterDirective = { state: 'THINKING', expression: 'focused', gesture: 'hand_to_chin', intensity: 0.6 };
    director!.applyDirective(directive);
    controls.avatarLoad!.resolve();
    await controls.avatarLoad!.promise;
    await Promise.resolve();

    const loaded = controls.metahuman[0];
    expect(loaded.root.position.equals(placeholder.root.position)).toBe(true);
    expect(loaded.root.quaternion.equals(placeholder.root.quaternion)).toBe(true);
    expect(loaded.root.scale.equals(placeholder.root.scale)).toBe(true);
    expect(loaded.state).toBe('THINKING');
    expect(loaded.applyDirective).toHaveBeenLastCalledWith(directive);
    expect(loaded.setOutfit).toHaveBeenCalledWith('casual');
    expect(loaded.root.parent).toBe(controls.stages[0].scene);
    expect(placeholder.dispose).toHaveBeenCalledTimes(1);
    expect(director!.characterStatus).toBe('ready');
  });

  it('restores a completed reading through the valid clinical state before swapping the avatar', async () => {
    await director!.enterClinical();
    const directive: CharacterDirective = { state: 'ANALYSIS_COMPLETE', expression: 'warm', gesture: 'point_to_hologram', intensity: 0.7 };
    director!.applyDirective(directive);
    controls.avatarLoad!.resolve();
    await controls.avatarLoad!.promise;
    await Promise.resolve();

    const loaded = controls.metahuman[0];
    expect(loaded.applyDirective.mock.calls.map(([value]) => value.state)).toEqual(['CLINICAL_ANALYSIS', 'ANALYSIS_COMPLETE']);
    expect(loaded.state).toBe('ANALYSIS_COMPLETE');
    expect(loaded.applyDirective).toHaveBeenLastCalledWith(directive);
    expect(loaded.setOutfit).toHaveBeenCalledWith('clinical');
  });

  it('ignores clinic loading that finishes after the user has returned home', async () => {
    const room = deferred();
    const internal = director as unknown as { ensureClinicalLoaded(): Promise<void>; advanceTransition(dt: number): void };
    vi.spyOn(internal, 'ensureClinicalLoaded').mockReturnValue(room.promise);
    const entering = director!.enterClinical();
    expect(session.sceneMode).toBe('transitioning');
    director!.exitClinical();
    internal.advanceTransition(1);
    expect(session.sceneMode).toBe('lounge');
    room.resolve();
    await entering;

    expect(session.sceneMode).toBe('lounge');
    expect(sound.startRoom).not.toHaveBeenCalled();
    expect(controls.stages[0].setShot).toHaveBeenCalledTimes(1);
    expect(controls.procedural[0].setOutfit).toHaveBeenLastCalledWith('casual', { transitionSeconds: 0.7 });
  });

  it('returns to the lounge with an actionable error when the clinic cannot load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    controls.clinicError = new Error('Clinical module unavailable');
    await director!.enterClinical();

    expect(session.sceneMode).toBe('lounge');
    expect(session.chatError).toMatch(/clinic could not load.*try Scan again/i);
    expect(sound.startRoom).not.toHaveBeenCalled();
    expect(controls.stages[0].setShot).not.toHaveBeenCalled();

    // A failed import must release the shared pending load so Scan can retry.
    controls.clinicError = null;
    await director!.enterClinical();
    expect(sound.startRoom).toHaveBeenCalledTimes(1);
    expect(session.sceneMode).toBe('transitioning');
    expect(session.chatError).toBeNull();
  });

  it('disposes partial clinic setup and rebuilds both groups on retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = controls.stages[0].scene;
    const initialChildren = [...scene.children];
    controls.hologramLayoutError = new Error('Hologram layout unavailable');
    await director!.enterClinical();

    expect(session.sceneMode).toBe('lounge');
    expect(controls.clinics).toHaveLength(1);
    expect(controls.holograms).toHaveLength(1);
    expect(controls.clinics[0].dispose).toHaveBeenCalledTimes(1);
    expect(controls.holograms[0].dispose).toHaveBeenCalledTimes(1);
    expect(scene.children).toEqual(initialChildren);
    expect(sound.startRoom).not.toHaveBeenCalled();

    controls.hologramLayoutError = null;
    await director!.enterClinical();
    expect(controls.clinics).toHaveLength(2);
    expect(controls.holograms).toHaveLength(2);
    expect(controls.clinics[1].group.parent).toBe(scene);
    expect(controls.holograms[1].group.parent).toBe(scene);
    expect(controls.holograms[1].setLayout).toHaveBeenCalled();
    expect(scene.children).toHaveLength(initialChildren.length + 2);
    expect(sound.startRoom).toHaveBeenCalledTimes(1);
    expect(session.chatError).toBeNull();

    director!.dispose();
    for (const room of [...controls.clinics, ...controls.holograms]) {
      expect(room.dispose).toHaveBeenCalledTimes(1);
      expect(room.group.parent).toBeNull();
    }
  });
});
