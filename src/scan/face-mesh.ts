/**
 * The live face mesh — the scan, shown to the person being scanned.
 *
 * Until now the capture screen was a mirror with a dotted oval on it. The
 * pipeline behind it is real, but nothing on the screen said so; you pressed
 * a button and numbers came back. This is the missing half: a 478-point mesh
 * found on your face as you frame it, drawn as light, that locks when the
 * framing is good and sweeps as the measurement runs. It is the same moment
 * the clinic's hologram is *about*, shown at the moment it happens.
 *
 * Presentation only, on purpose. The nine numbers still come from the skin
 * pipeline that has produced every reading in the user's history; this model
 * never touches a measurement. That is also why the model file is stored under
 * its own name — the skin pipeline probes for `face_landmarker.task` and would
 * otherwise think a landmark provider had arrived.
 *
 * Loaded lazily, like the pose model: the vision runtime is megabytes, and
 * nobody pays for it until they open the camera.
 */
import type { FaceLandmarker as FaceLandmarkerType } from '@mediapipe/tasks-vision';

const MODEL_URL = '/models/face-mesh.task';

export interface MeshFrame {
  /** Normalised x, y, z per landmark, in the source's own frame. */
  points: Float32Array;
  count: number;
  /** Bounding box of the landmarks, normalised. */
  box: { x: number; y: number; w: number; h: number };
}

export interface MeshGeometry {
  /** Index pairs. */
  tessellation: Uint16Array;
  contours: Uint16Array;
  oval: Uint16Array;
}

export class LiveFaceMesh {
  private landmarker: FaceLandmarkerType | null = null;
  private loading: Promise<boolean> | null = null;
  private mode: 'VIDEO' | 'IMAGE' = 'VIDEO';
  private lastTimestamp = 0;
  geometry: MeshGeometry | null = null;

  /** Whether the model file is served. Cached; a fresh checkout without it says no once. */
  static async available(): Promise<boolean> {
    try {
      const probe = await fetch(MODEL_URL, { method: 'HEAD' });
      const type = probe.headers.get('content-type') ?? '';
      const length = Number(probe.headers.get('content-length') ?? 0);
      return probe.ok && !type.includes('text/html') && length > 1_000_000;
    } catch {
      return false;
    }
  }

  load(): Promise<boolean> {
    this.loading ??= (async () => {
      if (!(await LiveFaceMesh.available())) return false;
      const vision = await import('@mediapipe/tasks-vision');
      const files = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const make = (delegate: 'GPU' | 'CPU') =>
        vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });
      try {
        this.landmarker = await make('GPU');
      } catch {
        // Some browsers refuse the GPU delegate. The CPU one is slower and fine.
        this.landmarker = await make('CPU');
      }
      const pairs = (list: Array<{ start: number; end: number }>) => {
        const out = new Uint16Array(list.length * 2);
        list.forEach((c, i) => {
          out[i * 2] = c.start;
          out[i * 2 + 1] = c.end;
        });
        return out;
      };
      this.geometry = {
        tessellation: pairs(vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION),
        contours: pairs(vision.FaceLandmarker.FACE_LANDMARKS_CONTOURS),
        oval: pairs(vision.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL),
      };
      return true;
    })();
    return this.loading;
  }

  get ready(): boolean {
    return this.landmarker !== null;
  }

  /** One video frame. Returns null when there is no face, which is a real answer. */
  detectVideo(video: HTMLVideoElement, now: number): MeshFrame | null {
    if (!this.landmarker || video.readyState < 2 || !video.videoWidth) return null;
    if (this.mode !== 'VIDEO') {
      this.landmarker.setOptions({ runningMode: 'VIDEO' });
      this.mode = 'VIDEO';
    }
    // Timestamps must strictly increase or the runtime throws.
    const stamp = Math.max(Math.floor(now), this.lastTimestamp + 1);
    this.lastTimestamp = stamp;
    return this.toFrame(this.landmarker.detectForVideo(video, stamp));
  }

  /** A still, for the upload path. */
  detectImage(image: HTMLImageElement | HTMLCanvasElement): MeshFrame | null {
    if (!this.landmarker) return null;
    if (this.mode !== 'IMAGE') {
      this.landmarker.setOptions({ runningMode: 'IMAGE' });
      this.mode = 'IMAGE';
    }
    return this.toFrame(this.landmarker.detect(image));
  }

  private toFrame(result: { faceLandmarks?: Array<Array<{ x: number; y: number; z: number }>> }): MeshFrame | null {
    const face = result.faceLandmarks?.[0];
    if (!face || face.length < 400) return null;
    const points = new Float32Array(face.length * 3);
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (let i = 0; i < face.length; i++) {
      const p = face[i];
      points[i * 3] = p.x;
      points[i * 3 + 1] = p.y;
      points[i * 3 + 2] = p.z;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      points,
      count: face.length,
      box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    };
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.loading = null;
  }
}

/**
 * Whether a frame is framed well enough to measure: a face large enough in
 * the frame, near the centre, not clipped. Mirrors the pipeline's own capture
 * gate loosely, so "locked" on screen and "accepted" by the analysis agree
 * nearly always — and when they do not, the pipeline wins and says why.
 */
export function wellFramed(frame: MeshFrame): boolean {
  const { box } = frame;
  const centreX = box.x + box.w / 2;
  const centreY = box.y + box.h / 2;
  return (
    box.h >= 0.3 &&
    box.h <= 0.9 &&
    Math.abs(centreX - 0.5) < 0.16 &&
    Math.abs(centreY - 0.5) < 0.2 &&
    box.x > 0.02 &&
    box.x + box.w < 0.98
  );
}

/** How a source's normalised coordinates land on a `cover`-fitted element. */
export interface CoverMap {
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export function coverMap(
  sourceW: number,
  sourceH: number,
  boxW: number,
  boxH: number,
): CoverMap {
  const scale = Math.max(boxW / sourceW, boxH / sourceH);
  const w = sourceW * scale;
  const h = sourceH * scale;
  return { ox: (boxW - w) / 2, oy: (boxH - h) / 2, w, h };
}

export interface DrawOptions {
  /** Seconds. */
  t: number;
  /** 0..1 how locked the framing is. */
  lock: number;
  /** 0..1 position of the measuring sweep, or null when not measuring. */
  sweep: number | null;
  /** 0..1 how far the measurement has run — the mesh lifts off as it completes. */
  progress: number;
  reduced: boolean;
}

/*
 * One hue, the projection cyan, matching PALETTE.holo. The mesh used to swap
 * from violet to cyan at lock, which read as a different instrument switching
 * on rather than the same one succeeding. Lock is now said with brightness —
 * every alpha below already scales with it — and with the champagne corners,
 * the interface's own emphasis colour.
 */
const HUE = '127,212,255';
const LOCK = '207,187,160';

/**
 * Draws the mesh as projected light.
 *
 * Three layers, cheapest first: the tessellation as a faint lattice, the
 * contours brighter, then the points — brighter where they are nearer the
 * camera, which is what turns a flat net into a face. No `shadowBlur`: it is
 * the one canvas feature that costs a full-surface pass, and the glow comes
 * from a wide faint stroke under a thin bright one instead.
 */
export function drawMesh(
  ctx: CanvasRenderingContext2D,
  frame: MeshFrame,
  geometry: MeshGeometry,
  map: CoverMap,
  width: number,
  height: number,
  opts: DrawOptions,
): void {
  ctx.clearRect(0, 0, width, height);
  const { points } = frame;
  const lift = opts.progress * opts.progress * height * 0.12;
  const px = (i: number) => map.ox + points[i * 3] * map.w;
  const py = (i: number) => map.oy + points[i * 3 + 1] * map.h - lift * (1 - points[i * 3 + 1]);
  const pz = (i: number) => points[i * 3 + 2];

  const lock = opts.lock;
  const tint = HUE;

  // Lattice.
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = `rgba(${tint},${(0.1 + lock * 0.08).toFixed(3)})`;
  ctx.beginPath();
  const tess = geometry.tessellation;
  for (let i = 0; i < tess.length; i += 2) {
    ctx.moveTo(px(tess[i]), py(tess[i]));
    ctx.lineTo(px(tess[i + 1]), py(tess[i + 1]));
  }
  ctx.stroke();

  // Contours: wide and faint, then thin and bright.
  const contour = (pairs: Uint16Array, wide: number, alphaWide: number, thin: number, alphaThin: number) => {
    ctx.beginPath();
    for (let i = 0; i < pairs.length; i += 2) {
      ctx.moveTo(px(pairs[i]), py(pairs[i]));
      ctx.lineTo(px(pairs[i + 1]), py(pairs[i + 1]));
    }
    ctx.lineWidth = wide;
    ctx.strokeStyle = `rgba(${tint},${alphaWide.toFixed(3)})`;
    ctx.stroke();
    ctx.lineWidth = thin;
    ctx.strokeStyle = `rgba(${tint},${alphaThin.toFixed(3)})`;
    ctx.stroke();
  };
  contour(geometry.contours, 3.5, 0.08 + lock * 0.08, 1.1, 0.5 + lock * 0.3);
  contour(geometry.oval, 5, 0.1 + lock * 0.16, 1.4, 0.55 + lock * 0.4);

  // Points, brighter when nearer. z is negative towards the camera.
  const sweepY = opts.sweep === null ? null : map.oy + opts.sweep * map.h;
  for (let i = 0; i < frame.count; i++) {
    const x = px(i);
    const y = py(i);
    const near = Math.max(0, Math.min(1, 0.5 - pz(i) * 4));
    let alpha = 0.25 + near * 0.55;
    let size = 1.2 + near * 0.9;
    let colour = tint;
    if (sweepY !== null) {
      const d = Math.abs(y - sweepY);
      if (d < 22) {
        const k = 1 - d / 22;
        alpha = Math.min(1, alpha + k);
        size += k * 1.6;
        colour = '255,255,255';
      }
    }
    ctx.fillStyle = `rgba(${colour},${alpha.toFixed(3)})`;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }

  // The sweep itself: a bright line across the face, with a soft band above it.
  if (sweepY !== null) {
    const left = map.ox + frame.box.x * map.w - 30;
    const right = map.ox + (frame.box.x + frame.box.w) * map.w + 30;
    const band = ctx.createLinearGradient(0, sweepY - 60, 0, sweepY);
    band.addColorStop(0, `rgba(${HUE},0)`);
    band.addColorStop(1, `rgba(${HUE},0.22)`);
    ctx.fillStyle = band;
    ctx.fillRect(left, sweepY - 60, right - left, 60);
    ctx.fillStyle = `rgba(${HUE},0.95)`;
    ctx.fillRect(left, sweepY - 1, right - left, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(left, sweepY - 0.5, right - left, 1);
  }

  // Locked: machined corners around the face, in champagne — the emphasis
  // voice, saved for the one moment the framing succeeds.
  if (lock > 0.02) {
    const pad = 18;
    const l = map.ox + frame.box.x * map.w - pad;
    const t = map.oy + frame.box.y * map.h - pad - lift * 0.5;
    const r = map.ox + (frame.box.x + frame.box.w) * map.w + pad;
    const b = map.oy + (frame.box.y + frame.box.h) * map.h + pad;
    const arm = Math.min(28, (r - l) * 0.16) * lock;
    ctx.strokeStyle = `rgba(${LOCK},${(0.9 * lock).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [
      [l, t, 1, 1],
      [r, t, -1, 1],
      [l, b, 1, -1],
      [r, b, -1, -1],
    ] as const) {
      ctx.moveTo(cx, cy + sy * arm);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + sx * arm, cy);
    }
    ctx.stroke();

    // A slow idle raster over the locked face, so the lock is alive.
    if (!opts.reduced) {
      const phase = (opts.t * 0.35) % 1;
      const y = t + (b - t) * phase;
      ctx.fillStyle = `rgba(${LOCK},${(0.16 * lock).toFixed(3)})`;
      ctx.fillRect(l, y, r - l, 1);
    }
  }
}
