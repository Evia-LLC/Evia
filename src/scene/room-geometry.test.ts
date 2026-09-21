import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { LoungeEnvironment } from './lounge.ts';
import { ClinicalEnvironment } from './clinical.ts';

describe.each([
  ['lounge', () => new LoungeEnvironment({ particles: false, ground: false })],
  ['clinic', () => new ClinicalEnvironment({ particles: false })],
] as const)('%s modeled environment', (name, create) => {
  it('is a furnished 3D room within its mobile geometry budget', () => {
    const room = create();
    let calls = 0, triangles = 0;
    const bounds = new THREE.Box3();
    const surfaces = new Set<THREE.Material>();
    room.group.updateMatrixWorld(true);
    room.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      calls++;
      triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
      bounds.expandByObject(object);
      const material = object.material as THREE.MeshStandardMaterial;
      surfaces.add(material);
      expect(material.map === null || material.map instanceof THREE.DataTexture).toBe(true);
      expect(object.geometry.getAttribute('normal')).toBeDefined();
      for (const attribute of Object.values(object.geometry.attributes) as THREE.BufferAttribute[]) {
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      }
    });
    console.info(`${name}: ${calls} room draws, ${triangles} triangles, ${surfaces.size} materials`);
    expect(calls).toBeLessThanOrEqual(30);
    expect(triangles).toBeLessThanOrEqual(40000);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(8);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(5);
    expect(bounds.max.y - bounds.min.y).toBeGreaterThan(3);
    expect(surfaces.size).toBeGreaterThan(10);
    room.dispose();
  });

  it('fades geometry and all lighting without losing base material opacity', () => {
    const room = create(); room.setPresence(1);
    const original = new Map<THREE.Material, number>();
    room.group.traverse((object) => { if (object instanceof THREE.Mesh) original.set(object.material as THREE.Material, (object.material as THREE.Material).opacity); });
    const intensity = room.lights.key.intensity;
    room.setPresence(.37);
    for (const [material, opacity] of original) expect(material.opacity).toBeCloseTo(opacity * .37);
    expect(room.lights.key.intensity).toBeCloseTo(intensity * .37);
    room.setPresence(0); expect(room.group.visible).toBe(false);
    expect(room.lights.key.intensity + room.lights.rim.intensity + room.lights.ambient.intensity).toBe(0);
    room.update(.016, 2);
    room.setPresence(1); expect(room.group.visible).toBe(true);
    for (const [material, opacity] of original) expect(material.opacity).toBeCloseTo(opacity);
    room.dispose();
  });

  it('disposes every mesh, material and procedural texture exactly once', () => {
    const room = create(), scene = new THREE.Scene(); scene.add(room.group);
    const lightDisposers = Object.values(room.lights).map((light) => vi.spyOn(light, 'dispose'));
    const tracked = new Map<THREE.BufferGeometry | THREE.Material | THREE.Texture, number>();
    const watch = (resource: THREE.BufferGeometry | THREE.Material | THREE.Texture) => {
      if (tracked.has(resource)) return;
      tracked.set(resource, 0);
      resource.addEventListener('dispose', () => tracked.set(resource, (tracked.get(resource) ?? 0) + 1));
    };
    room.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      watch(object.geometry);
      const material = object.material as THREE.MeshStandardMaterial; watch(material);
      if (material.bumpMap) watch(material.bumpMap);
      if (material.map) watch(material.map);
    });
    room.dispose(); room.dispose();
    expect(room.group.parent).toBeNull();
    expect(room.group.children).toHaveLength(0);
    for (const count of tracked.values()) expect(count).toBe(1);
    for (const dispose of lightDisposers) expect(dispose).toHaveBeenCalledTimes(1);
  });
});

it('optional particles add only one draw per room and release their resources', () => {
  for (const room of [new LoungeEnvironment({ particles: true, ground: false }), new ClinicalEnvironment({ particles: true })]) {
    const particles: THREE.Points[] = [];
    room.group.traverse((object) => { if (object instanceof THREE.Points) particles.push(object); });
    expect(particles).toHaveLength(1);
    let geometryDisposed = false, materialDisposed = false;
    particles[0].geometry.addEventListener('dispose', () => { geometryDisposed = true; });
    (particles[0].material as THREE.Material).addEventListener('dispose', () => { materialDisposed = true; });
    room.setPresence(.6); room.update(.033, 7); room.dispose();
    expect(geometryDisposed && materialDisposed).toBe(true);
  }
});
