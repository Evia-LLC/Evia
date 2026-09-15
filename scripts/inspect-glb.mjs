/**
 * Reads what a .glb actually contains, without loading it into a renderer.
 *
 *   node scripts/inspect-glb.mjs <file.glb>
 *
 * A GLB is a tiny binary header wrapping a JSON chunk plus a buffer, and the
 * JSON chunk already describes the skeleton, the morph targets, the animations
 * and every texture. So the questions that decide whether a generated character
 * can actually be used — can it be posed, can its mouth move, how heavy is it —
 * are answerable by parsing the JSON alone. No three.js, no DOM shim, no deps.
 *
 * The morph-target check is the one that matters most here: our avatar contract
 * requires `setViseme`, and a rig with a skeleton but no facial blendshapes
 * gives a character who gestures beautifully and cannot speak.
 */
import { readFileSync, statSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/inspect-glb.mjs <file.glb>');
  process.exit(2);
}

const buffer = readFileSync(file);
if (buffer.readUInt32LE(0) !== 0x46546c67) {
  console.error('not a GLB (bad magic)');
  process.exit(1);
}

// Header is 12 bytes, then length-prefixed chunks. The first is always JSON.
const jsonLength = buffer.readUInt32LE(12);
const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));

const bytes = statSync(file).size;
console.log(`# ${file}`);
console.log(`file: ${(bytes / 1024 / 1024).toFixed(2)} MB\n`);

// --- geometry --------------------------------------------------------------
let triangles = 0;
let primitives = 0;
const morphed = [];
for (const mesh of gltf.meshes ?? []) {
  for (const prim of mesh.primitives ?? []) {
    primitives++;
    const accessor = gltf.accessors?.[prim.indices];
    if (accessor) triangles += accessor.count / 3;
    else if (prim.attributes?.POSITION !== undefined) {
      triangles += (gltf.accessors[prim.attributes.POSITION]?.count ?? 0) / 3;
    }
    if (prim.targets?.length) morphed.push({ mesh: mesh.name ?? '(unnamed)', count: prim.targets.length });
  }
}
console.log(`meshes: ${gltf.meshes?.length ?? 0} (${primitives} primitives)`);
console.log(`triangles: ${Math.round(triangles).toLocaleString()}`);

// --- skeleton --------------------------------------------------------------
const skins = gltf.skins ?? [];
console.log(`\nskins: ${skins.length}`);
for (const skin of skins) {
  const names = (skin.joints ?? []).map((j) => gltf.nodes?.[j]?.name ?? `node${j}`);
  console.log(`  joints: ${names.length}`);
  // Anything that could drive a face is worth calling out by name.
  const facial = names.filter((n) =>
    /jaw|mouth|lip|tongue|teeth|head|neck|eye|brow|cheek/i.test(n),
  );
  console.log(`  head/face joints: ${facial.length ? facial.join(', ') : 'NONE'}`);
  console.log(`  all: ${names.join(', ')}`);
}

// --- the viseme question ---------------------------------------------------
console.log(`\nmorph targets (blendshapes): ${morphed.length ? '' : 'NONE'}`);
for (const m of morphed) console.log(`  ${m.mesh}: ${m.count} targets`);
if (gltf.meshes?.some((m) => m.extras?.targetNames)) {
  for (const m of gltf.meshes) {
    if (m.extras?.targetNames) console.log(`  names on ${m.name}: ${m.extras.targetNames.join(', ')}`);
  }
}

// --- animation -------------------------------------------------------------
const clips = gltf.animations ?? [];
console.log(`\nanimations: ${clips.length}`);
for (const clip of clips) console.log(`  ${clip.name ?? '(unnamed)'} — ${clip.channels?.length ?? 0} channels`);

// --- textures --------------------------------------------------------------
console.log(`\nimages: ${gltf.images?.length ?? 0}`);
for (const [i, image] of (gltf.images ?? []).entries()) {
  const view = gltf.bufferViews?.[image.bufferView];
  const kb = view ? Math.round(view.byteLength / 1024) : null;
  console.log(`  [${i}] ${image.name ?? image.mimeType ?? '?'}${kb !== null ? ` — ${kb} KB` : ''}`);
}
console.log(`materials: ${gltf.materials?.length ?? 0}`);
for (const mat of gltf.materials ?? []) {
  const pbr = mat.pbrMetallicRoughness ?? {};
  const maps = Object.keys(pbr).filter((k) => k.endsWith('Texture'));
  if (mat.normalTexture) maps.push('normalTexture');
  if (mat.emissiveTexture) maps.push('emissiveTexture');
  if (mat.occlusionTexture) maps.push('occlusionTexture');
  console.log(`  ${mat.name ?? '(unnamed)'}: ${maps.join(', ') || 'no maps'}`);
}

// --- scale -----------------------------------------------------------------
// Real-world height decides whether she drops into the scene or has to be
// scaled by a magic number nobody can later explain.
const pos = [];
for (const mesh of gltf.meshes ?? []) {
  for (const prim of mesh.primitives ?? []) {
    const a = gltf.accessors?.[prim.attributes?.POSITION];
    if (a?.min && a?.max) pos.push([a.min, a.max]);
  }
}
if (pos.length) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const [min, max] of pos) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], min[i]);
      hi[i] = Math.max(hi[i], max[i]);
    }
  }
  const size = hi.map((v, i) => +(v - lo[i]).toFixed(3));
  console.log(`\nbounds: ${size.join(' x ')} (units)`);
  console.log(`origin y: min ${lo[1].toFixed(3)}, max ${hi[1].toFixed(3)}`);
}
