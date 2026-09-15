/**
 * The avatar contract (ARCHITECTURE §5.1).
 *
 * This interface is the seam that makes the V2 art upgrade a swap rather than a
 * rewrite. `ProceduralAvatar` implements it today with low-poly primitives; a
 * `SpriteAvatar` backed by painted layers implements the same surface today.
 * Nothing outside src/character/ may know which one is loaded, and nothing in
 * here may import from the scene, the holograms, the API or the stores.
 */
import type * as THREE from 'three';
import type { CharacterDirective, Viseme } from '@shared/types.ts';

export type Outfit = 'casual' | 'clinical';

export interface AvatarContext {
  /** Seconds since the avatar was mounted. */
  elapsed: number;
  /** Where the user's attention is, in world space. Null means "look ahead". */
  gazeTarget: THREE.Vector3 | null;
  /** 0..1 speech envelope driving the mouth. */
  speechLevel: number;
  /** Set by preferences — drops the idle layer amplitude to near zero. */
  reducedMotion: boolean;
}

export interface ElohimAvatar {
  readonly root: THREE.Object3D;
  mount(parent: THREE.Object3D): void;
  update(dt: number, ctx: AvatarContext): void;
  applyDirective(directive: CharacterDirective): void;
  setOutfit(outfit: Outfit, opts?: { transitionSeconds?: number }): void;
  setViseme(viseme: Viseme, weight: number): void;
  /**
   * Enables the edge fringe that softens her silhouette into the backdrop.
   *
   * Optional: the procedural rig has no photographic plate to sit into and no
   * skinned geometry to make a hull from, so it simply has nothing to turn on.
   */
  setFringe?(enabled: boolean): void;
  lookAt(target: THREE.Vector3 | null): void;
  /** Draw-call and triangle counts, for the performance budget check. */
  stats(): { meshes: number; triangles: number };
  dispose(): void;
}
