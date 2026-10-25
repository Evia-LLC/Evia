import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configureMetaHumanMaterials } from '../src/character/metahuman-materials.ts';

function rig() {
  const root = new THREE.Group();
  const materials = ['C6_eyeLeft_shader', 'C6_eyeRight_shader', 'WorldGridMaterial', 'C6_eyelashes_shader', 'C6_head_shader'].map((name) => {
    const material = new THREE.MeshPhysicalMaterial();
    material.name = name;
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(), material));
    return material;
  });
  return { root, materials };
}

describe('MetaHuman material repairs', () => {
  it('keeps eye artwork and shares one owned curved-surface reflection per model', () => {
    const { root, materials: [left, right, , , head] } = rig();
    const original = new THREE.Texture();
    left!.map = original;
    const headRoughness = head!.roughness;
    configureMetaHumanMaterials(root);
    expect(left!.map).toBe(original);
    expect(left!.envMap).toBeTruthy();
    expect(right!.envMap).toBe(left!.envMap);
    expect(left!.envMap!.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(left!.specularIntensity).toBe(1);
    expect(left!.clearcoat).toBe(1);
    expect(head!.envMap).toBeNull();
    expect(head!.roughness).toBe(headRoughness);
    const reflection = left!.envMap;
    configureMetaHumanMaterials(root, { antialias: true });
    expect(left!.envMap).toBe(reflection);
    const next = rig();
    configureMetaHumanMaterials(next.root);
    expect(next.materials[0]!.envMap).not.toBe(reflection);
  });

  it('uses coverage only when the actual context supports MSAA', () => {
    const { root, materials: [, , hair, lashes] } = rig();
    configureMetaHumanMaterials(root);
    expect(hair!.alphaToCoverage).toBe(false);
    expect(lashes!.alphaToCoverage).toBe(false);
    expect(hair!.transparent).toBe(false);
    expect(hair!.depthWrite).toBe(true);
    configureMetaHumanMaterials(root, { antialias: true });
    expect(hair!.alphaToCoverage).toBe(true);
    expect(lashes!.alphaToCoverage).toBe(true);
    configureMetaHumanMaterials(root, { antialias: false });
    expect(hair!.alphaToCoverage).toBe(false);
    expect(lashes!.alphaToCoverage).toBe(false);
  });

  it('keeps blonde tint stable across reconfiguration without adding geometry', () => {
    const { root, materials: [, , hair] } = rig();
    const source = root.children[2] as THREE.Mesh;
    const original = hair!.color.clone();
    configureMetaHumanMaterials(root, { antialias: true });
    expect(source.children).toHaveLength(0);
    expect(source.material).toBe(hair);
    expect(hair!.color.r).toBeCloseTo(original.r * 0.68);
    const tint = hair!.color.clone();
    configureMetaHumanMaterials(root, { antialias: false });
    expect(source.children).toHaveLength(0);
    expect(hair!.color.equals(tint)).toBe(true);
  });
});
