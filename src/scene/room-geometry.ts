/** Shared construction tools for the two furnished, texture-independent rooms.
 * Geometry is baked into room coordinates and merged once per material. No
 * image backdrop, shadow map, render target, or post-processing is required. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type XYZ = readonly [number, number, number];
type Surface = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
const ZERO: XYZ = [0, 0, 0];

export class RoomGeometry {
  readonly group = new THREE.Group();
  private batches = new Map<Surface, THREE.BufferGeometry[]>();
  private surfaces = new Map<Surface, { opacity: number; transparent: boolean; depthWrite: boolean }>();
  private geometry: THREE.BufferGeometry[] = [];
  private textures = new Set<THREE.Texture>();
  private disposed = false;

  surface(name: string, color: number, roughness = .65, metalness = 0, emission = 0): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness, vertexColors: true,
      emissive: color, emissiveIntensity: emission, alphaHash: true });
    material.name = name;
    this.register(material);
    return material;
  }

  light(name: string, color: number, opacity = 1, additive = false): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({ color, vertexColors: true, toneMapped: false,
      transparent: additive || opacity < 1, opacity, depthWrite: !additive && opacity === 1,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      alphaHash: !additive && opacity === 1 });
    material.name = name;
    this.register(material);
    return material;
  }

  private register(material: Surface): void {
    this.surfaces.set(material, { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
    this.batches.set(material, []);
  }

  translucent(material: Surface, opacity: number): void {
    material.opacity = opacity; material.transparent = true;
    material.alphaHash = false; material.depthWrite = false;
    material.forceSinglePass = true;
    this.surfaces.set(material, { opacity, transparent: true, depthWrite: false });
  }

  /** Fine material grain generated in memory; never a photograph of a room. */
  grain(material: THREE.MeshStandardMaterial, repeats = 5, amount = .006): void {
    const size = 64, data = new Uint8Array(size * size * 4);
    let seed = 7129;
    for (let i = 0; i < size * size; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = 100 + (seed >>> 25);
      data.set([value, value, value, 255], i * 4);
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeats, repeats);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    material.bumpMap = texture; material.bumpScale = amount;
    this.textures.add(texture);
  }

  /** Small generated stone texture. It describes a material, never a room view. */
  marble(material: THREE.MeshStandardMaterial, base: number, vein: number): void {
    const size = 256, data = new Uint8Array(size * size * 4);
    const a = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
    const b = [(vein >> 16) & 255, (vein >> 8) & 255, vein & 255];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const flow = Math.sin(u * 16 + v * 10 + Math.sin(v * 19) * .43 + Math.sin(u * 33 + v * 27) * .12);
      const line = Math.pow(Math.max(0, 1 - Math.abs(flow) * 22), 2.5);
      const cloud = Math.sin(u * 27 + v * 19) * 2 + Math.sin(u * 51 - v * 33) * 1.5;
      const index = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) data[index + c] = Math.round(a[c] + (b[c] - a[c]) * line * .65 + cloud);
      data[index + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(2.4, 3.8);
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = 2; texture.needsUpdate = true;
    material.map = texture; material.color.setHex(0xffffff); this.textures.add(texture);
  }

  add(material: Surface, source: THREE.BufferGeometry, position: XYZ = ZERO, rotation: XYZ = ZERO, scale: XYZ = [1, 1, 1], shade = 1): void {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
    geometry.applyMatrix4(transform);
    if (!geometry.getAttribute('color')) {
      const colors = new Float32Array(geometry.getAttribute('position').count * 3).fill(shade);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    this.batches.get(material)!.push(geometry);
  }

  box(material: Surface, dimensions: XYZ, position: XYZ, radius = 0, rotation: XYZ = ZERO, shade = 1, segments = 1): void {
    const geo = radius > 0
      ? new RoundedBoxGeometry(...dimensions, segments, Math.min(radius, ...dimensions.map((n) => n / 2)))
      : new THREE.BoxGeometry(...dimensions);
    this.add(material, geo, position, rotation, [1, 1, 1], shade);
  }

  cylinder(material: Surface, radius: number, height: number, position: XYZ, bottom = radius, rotation: XYZ = ZERO, sides = 16): void {
    this.add(material, new THREE.CylinderGeometry(radius, bottom, height, sides), position, rotation);
  }

  sphere(material: Surface, position: XYZ, scale: XYZ, rotation: XYZ = ZERO, shade = 1): void {
    this.add(material, new THREE.SphereGeometry(1, 8, 5), position, rotation, scale, shade);
  }

  rod(material: Surface, start: XYZ, end: XYZ, radius: number, sides = 6): void {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), delta = b.clone().sub(a);
    const geo = new THREE.CylinderGeometry(radius, radius, delta.length(), sides);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    this.add(material, geo, a.add(b).multiplyScalar(.5).toArray());
  }

  curve(material: Surface, points: XYZ[], radius = .007, steps = 36, sides = 5): void {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    this.add(material, new THREE.TubeGeometry(curve, steps, radius, sides, false));
  }

  /** Rounded rectangular tubular molding, authored in local XY. */
  frame(material: Surface, width: number, height: number, corner: number, tube: number, position: XYZ, rotation: XYZ = ZERO): void {
    const x = width / 2, y = height / 2, r = Math.min(corner, x, y), shape = new THREE.Shape();
    shape.moveTo(-x + r, -y); shape.lineTo(x - r, -y);
    shape.quadraticCurveTo(x, -y, x, -y + r); shape.lineTo(x, y - r);
    shape.quadraticCurveTo(x, y, x - r, y); shape.lineTo(-x + r, y);
    shape.quadraticCurveTo(-x, y, -x, y - r); shape.lineTo(-x, -y + r);
    shape.quadraticCurveTo(-x, -y, -x + r, -y);
    const points = shape.getSpacedPoints(56).slice(0, -1).map((p) => new THREE.Vector3(p.x, p.y, 0));
    const path = new THREE.CatmullRomCurve3(points, true, 'centripetal');
    this.add(material, new THREE.TubeGeometry(path, 72, tube, 5, true), position, rotation);
  }

  /** A pleated sheet with real folds, floor-length with a scalloped hem. */
  curtain(material: Surface, x: number, fromZ: number, toZ: number, height: number): void {
    const geo = new THREE.PlaneGeometry(toZ - fromZ, height, 80, 8);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) + (toZ - fromZ) / 2) / (toZ - fromZ), v = (pos.getY(i) + height / 2) / height;
      const fold = Math.cos(u * Math.PI * 24);
      pos.setXYZ(i, x + .095 * fold, .06 + v * height + .018 * Math.sin(u * Math.PI * 24) * (1 - v), fromZ + u * (toZ - fromZ));
    }
    geo.computeVertexNormals();
    material.side = THREE.DoubleSide; material.forceSinglePass = true;
    this.add(material, geo);
  }

  bottle(body: Surface, cap: Surface, label: Surface, position: XYZ, height: number, radius: number, kind = 0): void {
    const [x, y, z] = position;
    if (kind % 3 === 0) this.box(body, [radius * 1.7, height * .73, radius * 1.35], [x, y + height * .37, z], .015);
    else this.cylinder(body, radius, height * .72, [x, y + height * .36, z], radius * 1.02, ZERO, 10);
    this.cylinder(cap, radius * .64, height * .21, [x, y + height * .845, z], radius * .64, ZERO, 8);
    if (kind % 4 === 0) this.rod(cap, [x, y + height, z], [x + radius, y + height, z], .009);
    // Small actual label plaques, kept text-free at this distance.
    this.box(label, [radius * .98, height * .24, .006], [x, y + height * .40, z + radius * .96]);
  }

  plant(pot: Surface, stems: Surface, leaves: Surface, position: XYZ, size = 1): void {
    const [x, y, z] = position;
    this.cylinder(pot, size * .17, size * .36, [x, y + size * .18, z], size * .13, ZERO, 18);
    for (let branch = 0; branch < 9; branch++) {
      const angle = branch * 2.39996, length = size * (.56 + .19 * Math.sin(branch * 3.2));
      const tx = x + Math.cos(angle) * size * .25, tz = z + Math.sin(angle) * size * .25;
      this.rod(stems, [x, y + size * .30, z], [tx, y + size * .40 + length, tz], size * .007);
      for (let leaf = 0; leaf < 3; leaf++) {
        const t = .44 + leaf * .26, side = leaf % 2 ? -1 : 1;
        this.sphere(leaves, [x + (tx - x) * t + Math.cos(angle + side) * size * .08,
          y + size * .4 + length * t, z + (tz - z) * t + Math.sin(angle + side) * size * .08],
        [size * .035, size * .15, size * .058], [side * .6, -angle, side * .55], .6 + .1 * leaf);
      }
    }
  }

  /** Soft geometry-only light/contact patch. Vertex alpha, not a room image. */
  floorPatch(material: Surface, position: XYZ, size: readonly [number, number], color: number, alpha: number): void {
    const vertices: number[] = [], colors: number[] = [], c = new THREE.Color(color), segments = 32;
    for (let i = 0; i < segments; i++) {
      for (const [a, r] of [[0, 0], [i * Math.PI * 2 / segments, 1], [(i + 1) * Math.PI * 2 / segments, 1]]) {
        vertices.push(position[0] + Math.cos(a) * size[0] * r, position[1], position[2] + Math.sin(a) * size[1] * r);
        colors.push(c.r, c.g, c.b, r === 0 ? alpha : 0);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    material.side = THREE.DoubleSide; material.forceSinglePass = true;
    this.add(material, geo);
  }

  /** Broad, subtly broken specular swaths aligned with the ceiling/window rails. */
  reflectionStrip(material: Surface, x: number, z: number, width: number, length: number, color: number, alpha: number): void {
    const geometry = new THREE.PlaneGeometry(width, length, 6, 32);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute('position'), colors = new Float32Array(positions.count * 4), c = new THREE.Color(color);
    for (let i = 0; i < positions.count; i++) {
      const u = THREE.MathUtils.clamp(Math.abs(positions.getX(i) / (width / 2)), 0, 1);
      const t = THREE.MathUtils.clamp(positions.getZ(i) / length + .5, 0, 1);
      const falloff = Math.pow(1 - u, 1.8) * Math.pow(Math.max(0, Math.sin(t * Math.PI)), .8);
      const broken = .62 + .21 * Math.sin(t * 94) + .11 * Math.sin(t * 231 + u * 8);
      positions.setXYZ(i, x + positions.getX(i) + .016 * Math.sin(t * 77), -.001, z + positions.getZ(i));
      colors.set([c.r, c.g, c.b, Math.max(0, falloff * broken * alpha)], i * 4);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    material.side = THREE.DoubleSide; material.forceSinglePass = true;
    this.add(material, geometry);
  }

  /** Geometry-only contact shading inside a recessed cubby or wall alcove. */
  recessShade(material: Surface, width: number, height: number, position: XYZ, rotation: XYZ = ZERO, opacity = .8): void {
    const geometry = new THREE.PlaneGeometry(width, height, 8, 8);
    const positions = geometry.getAttribute('position'), colors = new Float32Array(positions.count * 4);
    for (let i = 0; i < positions.count; i++) {
      const u = Math.abs(positions.getX(i) / (width * .5)), v = positions.getY(i) / (height * .5);
      const edge = Math.max(Math.pow(u, 5) * .72, Math.pow(Math.max(0, v), 4), Math.pow(Math.max(0, -v), 7) * .42);
      colors[i * 4 + 3] = edge * opacity;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    material.side = THREE.DoubleSide; material.forceSinglePass = true;
    this.add(material, geometry, position, rotation);
  }

  finish(name: string): void {
    this.group.name = name;
    let triangles = 0, draws = 0;
    for (const [material, parts] of this.batches) {
      if (!parts.length) continue;
      const merged = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!merged) throw new Error(`Could not merge ${name}: ${material.name}`);
      // A modest, deterministic ambient-occlusion ramp at architectural
      // contacts. It adds shape without SSAO, shadow maps, or extra draw calls.
      if (material instanceof THREE.MeshStandardMaterial) {
        const positions = merged.getAttribute('position'), normals = merged.getAttribute('normal'), colors = merged.getAttribute('color');
        for (let i = 0; i < positions.count; i++) {
          const y = positions.getY(i), ny = normals.getY(i);
          let occlusion = .78 + .22 * Math.max(0, ny);
          if (ny < .7) {
            occlusion *= .68 + .32 * THREE.MathUtils.clamp(y / .53, 0, 1);
            occlusion *= .78 + .22 * THREE.MathUtils.clamp((3.35 - y) / .44, 0, 1);
          }
          if (y < .02 && ny > .7) {
            const distance = Math.min(2.93 - Math.abs(positions.getX(i)), positions.getZ(i) + 6.36);
            occlusion *= .86 + .14 * THREE.MathUtils.clamp(distance / .64, 0, 1);
          }
          colors.setXYZ(i, colors.getX(i) * occlusion, colors.getY(i) * occlusion, colors.getZ(i) * occlusion);
        }
      }
      merged.computeBoundingBox(); merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${name}/${material.name}`;
      if (material.transparent) mesh.renderOrder = 1;
      this.group.add(mesh); this.geometry.push(merged);
      triangles += merged.getAttribute('position').count / 3; draws++;
    }
    this.batches.clear();
    this.group.userData.geometryBudget = { drawCalls: draws, triangles, imageBackdrops: 0 };
  }

  setPresence(presence: number): void {
    this.group.visible = presence > .001;
    for (const [material, base] of this.surfaces) {
      material.opacity = base.opacity * presence;
      // Opaque pieces use alpha hashing: both rooms can dissolve with stable
      // depth and without sorting every bottle/sofa cushion as a transparent object.
      material.transparent = base.transparent;
      material.depthWrite = base.depthWrite;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.geometry) geometry.dispose();
    for (const geometry of this.batches.values()) for (const part of geometry) part.dispose();
    for (const surface of this.surfaces.keys()) surface.dispose();
    for (const texture of this.textures) texture.dispose();
    this.batches.clear(); this.surfaces.clear(); this.textures.clear(); this.geometry.length = 0;
    this.group.clear(); this.group.removeFromParent();
  }
}
