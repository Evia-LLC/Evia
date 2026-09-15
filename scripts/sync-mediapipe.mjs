/**
 * Copies MediaPipe's wasm runtime into `public/` so it can be served locally.
 *
 * Two things force this.
 *
 * The package exports its wasm files individually but not the directory that
 * contains them, and `FilesetResolver.forVisionTasks` wants a directory it can
 * append filenames to — so `new URL('@mediapipe/tasks-vision/wasm', ...)` fails
 * to resolve at build time.
 *
 * The obvious workaround is the CDN path MediaPipe's own examples use. That is
 * declined deliberately: this app analyses photographs of people's faces and
 * bodies, and the runtime that does it should not be fetched from a third party
 * on every load. Serving it ourselves also means body scanning keeps working
 * offline, like everything else here.
 *
 * ~33MB, so it is gitignored and regenerated rather than committed. Runs from
 * `prebuild` and can be run by hand:
 *
 *   node scripts/sync-mediapipe.mjs
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const target = path.join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(source)) {
  console.error(
    'MediaPipe wasm not found. Run `npm install` first — body scanning needs it.',
  );
  process.exit(1);
}

mkdirSync(target, { recursive: true });

/*
 * Only the variants this app can actually request.
 *
 * The resolver builds its filename as `wasm${multithread ? '_module' : ''}` +
 * `${simd ? '' : '_nosimd'}_internal`, and `FilesetResolver.forVisionTasks` is
 * called with one argument in pose.ts, so the multithread flag is false. That
 * makes `vision_wasm_module_internal.{js,wasm}` — 12.08 MB — unreachable by
 * construction. Both SIMD and non-SIMD are kept: which one is fetched depends
 * on the device, and is decided at runtime.
 *
 * If the call site ever passes `true` for multithreading, this list has to grow
 * with it or body scanning will 404 on the wasm.
 */
const WANTED = /^vision_wasm(_nosimd)?_internal\.(js|wasm)$/;

let copied = 0;
for (const name of readdirSync(source)) {
  if (!WANTED.test(name)) continue;
  cpSync(path.join(source, name), path.join(target, name));
  copied++;
}

if (copied === 0) {
  console.error(
    'No MediaPipe wasm matched the expected names. The package layout may have ' +
      'changed — check node_modules/@mediapipe/tasks-vision/wasm before shipping.',
  );
  process.exit(1);
}

const bytes = readdirSync(target).reduce(
  (sum, name) => sum + statSync(path.join(target, name)).size,
  0,
);
console.log(
  `mediapipe wasm -> public/mediapipe/wasm (${readdirSync(target).length} files, ` +
    `${(bytes / 1024 / 1024).toFixed(1)} MB)`,
);

/*
 * The pose model, fetched if it is not already here.
 *
 * The wasm above ships inside the npm package; the model file does not. It was
 * downloaded by hand once and gitignored, which is fine on a machine that has
 * it and fatal on a build machine that does not: `/models/pose_landmarker_lite.task`
 * would 404 and every body scan would fail.
 *
 * Downloaded at build time, served from our own origin at runtime — which is
 * the same arrangement the wasm has, and keeps the promise that the thing
 * looking at photographs of people is not fetched from a third party while
 * someone is using the app.
 */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const modelDir = path.join(root, 'public', 'models');
const modelPath = path.join(modelDir, 'pose_landmarker_lite.task');

/** A `.task` bundle is a zip and is megabytes; anything smaller is an error page. */
const MIN_MODEL_BYTES = 1_000_000;

/*
 * The face mesh, for the live overlay on the capture screen.
 *
 * A second model, fetched the same way. Deliberately NOT saved under the name
 * the skin pipeline probes for (`face_landmarker.task`): that provider is a
 * stub that defers to the region detector, and shipping a file under its name
 * would make it claim to be available. The mesh is presentation — it shows the
 * person their own face being read — and the measurements stay on the pipeline
 * that produced every number in their history.
 */
const MESH_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const meshPath = path.join(modelDir, 'face-mesh.task');

const haveMesh = existsSync(meshPath) && statSync(meshPath).size > MIN_MODEL_BYTES;
if (haveMesh) {
  console.log(`face mesh already present (${(statSync(meshPath).size / 1024 / 1024).toFixed(1)} MB)`);
} else {
  mkdirSync(modelDir, { recursive: true });
  const response = await fetch(MESH_URL);
  if (!response.ok) {
    throw new Error(`face mesh download failed: HTTP ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < MIN_MODEL_BYTES) {
    throw new Error(`face mesh download was only ${buffer.byteLength} bytes; refusing to write it`);
  }
  writeFileSync(meshPath, buffer);
  console.log(`face mesh -> public/models/face-mesh.task (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

const haveModel = existsSync(modelPath) && statSync(modelPath).size > MIN_MODEL_BYTES;

if (haveModel) {
  console.log(
    `pose model already present (${(statSync(modelPath).size / 1024 / 1024).toFixed(1)} MB)`,
  );
} else {
  mkdirSync(modelDir, { recursive: true });
  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`pose model download failed: HTTP ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < MIN_MODEL_BYTES) {
    throw new Error(`pose model download was only ${buffer.byteLength} bytes; refusing to write it`);
  }
  writeFileSync(modelPath, buffer);
  console.log(
    `pose model -> public/models/pose_landmarker_lite.task ` +
      `(${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`,
  );
}
