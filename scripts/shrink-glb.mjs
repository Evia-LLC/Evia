/**
 * Re-encodes the textures inside a .glb, in place.
 *
 * The character ships as a 7 MB file of which nearly 5 MB is a single 2048²
 * PNG. PNG is lossless, which a photographic skin-and-fabric texture does not
 * need and cannot benefit from — the same image as WebP at quality 0.82 is
 * around a tenth of the size with no difference visible at the scale she is
 * ever drawn.
 *
 * The re-encoding itself happens in the browser, because Node has no image
 * codec built in and adding one for a build step nobody runs twice is a poor
 * trade. This script does the container work — unpacking the GLB, swapping the
 * image buffer, re-packing with corrected offsets — and takes the encoded bytes
 * from a file the page wrote.
 *
 *   1. node scripts/shrink-glb.mjs <in.glb> --extract <out-dir>
 *      writes each embedded image so the page can load it
 *   2. the page re-encodes and POSTs the result back to the shot sink
 *   3. node scripts/shrink-glb.mjs <in.glb> --repack <dir> <out.glb>
 *
 * A GLB is a 12-byte header followed by length-prefixed chunks: JSON, then a
 * binary blob that every buffer view indexes into. Replacing an image means
 * rewriting that blob and every offset after it, which is what `--repack` does.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const [, , file, mode, arg, outFile] = process.argv;
if (!file || !mode) {
  console.error('usage: node scripts/shrink-glb.mjs <in.glb> --extract <dir> | --repack <dir> <out.glb>');
  process.exit(2);
}

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function readGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  // The BIN chunk follows the JSON chunk, itself 8 bytes of header.
  const binStart = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binStart);
  const bin = buffer.subarray(binStart + 8, binStart + 8 + binLength);
  return { json, bin };
}

const { json, bin } = readGlb(readFileSync(file));
const images = json.images ?? [];

if (mode === '--extract') {
  mkdirSync(arg, { recursive: true });
  images.forEach((image, i) => {
    const view = json.bufferViews[image.bufferView];
    const offset = view.byteOffset ?? 0;
    const ext = MIME_EXT[image.mimeType] ?? 'bin';
    const out = path.join(arg, `image-${i}.${ext}`);
    writeFileSync(out, bin.subarray(offset, offset + view.byteLength));
    console.log(`${out} ${(view.byteLength / 1024 / 1024).toFixed(2)} MB ${image.mimeType}`);
  });
  process.exit(0);
}

if (mode !== '--repack') {
  console.error('unknown mode ' + mode);
  process.exit(2);
}

// --- repack ----------------------------------------------------------------
// Rebuild the binary blob from scratch: every buffer view is copied across in
// order, so replacing one image with a differently sized one just shifts the
// views after it rather than corrupting them.
const replacements = new Map();
images.forEach((image, i) => {
  const candidate = path.join(arg, `image-${i}.webp`);
  if (existsSync(candidate)) replacements.set(image.bufferView, readFileSync(candidate));
});

if (!replacements.size) {
  console.error('no replacement images found in ' + arg);
  process.exit(1);
}

const pieces = [];
let cursor = 0;
json.bufferViews.forEach((view, index) => {
  const replacement = replacements.get(index);
  const data = replacement ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  // glTF requires buffer views to be 4-byte aligned.
  const pad = (4 - (cursor % 4)) % 4;
  if (pad) {
    pieces.push(Buffer.alloc(pad));
    cursor += pad;
  }
  view.byteOffset = cursor;
  view.byteLength = data.length;
  pieces.push(data);
  cursor += data.length;
});

for (const image of images) {
  if (replacements.has(image.bufferView)) image.mimeType = 'image/webp';
}
// A WebP texture needs the extension declared, or a strict loader will refuse it.
json.extensionsUsed = Array.from(new Set([...(json.extensionsUsed ?? []), 'EXT_texture_webp']));
for (const texture of json.textures ?? []) {
  if (texture.source !== undefined && replacements.has(images[texture.source]?.bufferView)) {
    texture.extensions = { ...(texture.extensions ?? {}), EXT_texture_webp: { source: texture.source } };
  }
}

const newBin = Buffer.concat(pieces);
json.buffers = [{ byteLength: newBin.length }];

const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
const jsonPad = (4 - (jsonBuffer.length % 4)) % 4;
const binPad = (4 - (newBin.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPad, 0x20)]);
const binChunk = Buffer.concat([newBin, Buffer.alloc(binPad)]);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);

const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binChunk.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);

const out = Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
writeFileSync(outFile, out);
console.log(`${outFile} ${(out.length / 1024 / 1024).toFixed(2)} MB`);
