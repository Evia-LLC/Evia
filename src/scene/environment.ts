/**
 * The environment seam.
 *
 * The lounge and the clinical room implement the same interface, which is what
 * lets the transition director cross-fade between them without knowing anything
 * about either — and what lets a photoreal V2 environment drop in later.
 */
import type * as THREE from 'three';

export interface EnvironmentLights {
  key: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
}

export interface ElohimEnvironment {
  readonly group: THREE.Group;
  readonly lights: EnvironmentLights;
  /** Background colour this environment wants the renderer to clear to. */
  readonly background: THREE.Color;
  update(dt: number, elapsed: number): void;
  /**
   * 0 = fully dissolved, 1 = fully present. Drives the transition; every
   * environment must honour it on both geometry and lights.
   */
  setPresence(presence: number): void;
  dispose(): void;
}
