import * as THREE from 'three';

export interface MetaHumanMaterialOptions {
  /** Actual context capability, not just the requested renderer option. */
  antialias?: boolean;
}

/** A small lighting environment. It is reflected by the curved eye surface;
 * it is neither an eye decal nor a plane placed in front of the character. */
function eyeReflection(): THREE.DataTexture {
  const width = 256;
  const height = 128;
  const pixels = new Uint8Array(width * height * 4);
  const key = new THREE.Vector3(-0.45, 0.6, 1).normalize();
  const fill = new THREE.Vector3(0.65, 0.25, 1).normalize();
  const direction = new THREE.Vector3();
  for (let y = 0; y < height; y++) {
    const latitude = ((y + 0.5) / height - 0.5) * Math.PI;
    for (let x = 0; x < width; x++) {
      const longitude = ((x + 0.5) / width - 0.5) * Math.PI * 2;
      direction.set(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude));
      const keyLight = Math.exp(-Math.pow(Math.acos(THREE.MathUtils.clamp(direction.dot(key), -1, 1)) / 0.14, 4));
      const fillLight = Math.exp(-Math.pow(Math.acos(THREE.MathUtils.clamp(direction.dot(fill), -1, 1)) / 0.1, 4)) * 0.32;
      const light = Math.min(1, 0.012 + keyLight + fillLight);
      const index = (y * width + x) * 4;
      pixels[index] = Math.round(light * 255);
      pixels[index + 1] = Math.round(light * 252);
      pixels[index + 2] = Math.round(light * 247);
      pixels[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.name = 'Evia eye softbox reflection';
  texture.userData.eviaEyeReflection = true;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Repair known export material settings while keeping C6's geometry and maps.
 * Call once after import. All created textures are material properties, so the
 * avatar's existing deduplicated releaseModel traversal owns their disposal. */
export function configureMetaHumanMaterials(model: THREE.Object3D, options: MetaHumanMaterialOptions = {}): void {
  let reflection: THREE.DataTexture | undefined;
  const visited = new Set<THREE.Material>();
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const source of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (visited.has(source)) continue;
      visited.add(source);
      const material = source as THREE.MeshPhysicalMaterial;
      if (!material.isMeshPhysicalMaterial) continue;
      if (/^C6_eye(Left|Right)_shader$/.test(material.name)) {
        reflection ??= material.envMap?.userData.eviaEyeReflection
          ? material.envMap as THREE.DataTexture
          : eyeReflection();
        material.envMap = reflection;
        material.envMapIntensity = 2.5;
        material.specularIntensity = 1;
        material.ior = 1.376;
        material.roughness = 0.12;
        material.clearcoat = 1;
        material.clearcoatRoughness = 0.055;
        // The exported iris normal should not roughen the wet corneal layer.
        material.normalScale.setScalar(0.2);
        material.needsUpdate = true;
      } else if (material.name === 'WorldGridMaterial') {
        material.userData.eviaHairBaseColor ??= material.color.toArray();
        material.color.fromArray(material.userData.eviaHairBaseColor as number[]).multiplyScalar(0.68);
        material.roughness = 0.57;
        material.specularIntensity = 0.4;
        material.anisotropy = 0.4;
        material.anisotropyRotation = Math.PI / 2;
        material.alphaTest = 0.12;
        material.alphaToCoverage = options.antialias === true;
        material.transparent = false;
        material.depthWrite = true;
        material.needsUpdate = true;
      } else if (material.name === 'C6_eyelashes_shader') {
        material.alphaToCoverage = options.antialias === true;
        material.needsUpdate = true;
      }
    }
  });
}
