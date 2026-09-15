/**
 * Finding a body in a photograph (ARCHITECTURE §3, body).
 *
 * The face pipeline can get away with skin-chroma segmentation because a face
 * is bare skin filling the frame. A body is mostly clothing, so the same
 * approach finds a head and two forearms and nothing that describes a posture.
 * This uses MediaPipe's pose landmarker instead: 33 points, real joints.
 *
 * Which is also what makes the body half of this app defensible. A photograph
 * cannot honestly give you a body fat percentage — pose, camera angle, lens and
 * clothing move that number more than the body does. What it *can* give you is
 * where the joints are relative to each other, and the useful, checkable things
 * are all ratios of those: is one shoulder higher than the other, does the head
 * sit forward of the shoulders, how does waist width compare to shoulder width.
 *
 * Those are measurements. "You have a pot belly" is a guess with a diet plan
 * attached to it. The body pipeline only ever reports the first kind.
 *
 * Follows the same rule as `MediapipeLandmarkProvider`: if the model is not
 * there, this refuses rather than returning something plausible.
 */
import type { PoseLandmarker as PoseLandmarkerType } from '@mediapipe/tasks-vision';
import type { Mask } from './silhouette.ts';

/** Where the model file lives, relative to the web root. */
const MODEL_URL = '/models/pose_landmarker_lite.task';

/**
 * Indices into MediaPipe's 33-point pose topology.
 *
 * Named rather than inlined because a bare `landmarks[24]` in a measurement is
 * unreviewable — nobody can tell whether it is the hip it was meant to be.
 */
export const POSE = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** 0..1 — how sure the model is this point is where it says. */
  visibility: number;
}

export interface PoseResult {
  landmarks: Landmark[];
  /** Mean visibility across the points the measurements actually use. */
  confidence: number;
  /**
   * The body outline, when the model produced one.
   *
   * Nullable on purpose. Widths measured from the mask and widths estimated
   * from joints are different measurements of different things, and a reading
   * must never silently switch between them across scans — so the caller
   * records which one it used rather than treating a missing mask as a detail.
   */
  mask: Mask | null;
}

export class PoseUnavailable extends Error {
  constructor() {
    super(`The pose model is not available at ${MODEL_URL}.`);
    this.name = 'PoseUnavailable';
  }
}

/** Points without which no body measurement means anything. */
const REQUIRED = [
  POSE.leftShoulder,
  POSE.rightShoulder,
  POSE.leftHip,
  POSE.rightHip,
] as const;

export class PoseProvider {
  readonly name = 'mediapipe-pose-lite';
  private landmarker: PoseLandmarkerType | null = null;
  private checked = false;
  private ok = false;

  /**
   * Whether the model file is actually there.
   *
   * The same care as the face provider: a dev server with SPA fallback answers
   * 200 with index.html for any unknown path, so `ok` alone proves nothing.
   * A `.task` bundle is a zip and is megabytes; both are checked.
   */
  async available(): Promise<boolean> {
    if (this.checked) return this.ok;
    this.checked = true;
    try {
      const probe = await fetch(MODEL_URL, { method: 'HEAD' });
      const type = probe.headers.get('content-type') ?? '';
      const length = Number(probe.headers.get('content-length') ?? 0);
      this.ok = probe.ok && !type.includes('text/html') && length > 1_000_000;
    } catch {
      this.ok = false;
    }
    return this.ok;
  }

  private async load(): Promise<PoseLandmarkerType> {
    if (this.landmarker) return this.landmarker;
    if (!(await this.available())) throw new PoseUnavailable();

    // Imported lazily: the vision bundle and its wasm are megabytes, and a
    // user who only ever scans their face should never pay for them.
    const vision = await import('@mediapipe/tasks-vision');
    /*
     * Served from our own origin, not MediaPipe's CDN.
     *
     * The package exports its wasm files individually but not the directory,
     * and `forVisionTasks` needs a directory to append names to — so the files
     * are copied into `public/` by `scripts/sync-mediapipe.mjs`. Which is also
     * the right answer on its own merits: the runtime that looks at
     * photographs of people should not be fetched from a third party, and this
     * way body scanning works offline like everything else.
     */
    const files = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
    this.landmarker = await vision.PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'IMAGE',
      numPoses: 1,
      /*
       * The outline, not just the joints.
       *
       * This is what makes a waist measurable at all. None of the 33 landmarks
       * is a waist, so every width built from them alone is a stand-in for one;
       * the mask has the actual abdomen in it. Costs one extra output head on a
       * model that is already loaded.
       */
      outputSegmentationMasks: true,
    });
    return this.landmarker;
  }

  /**
   * Finds the pose, or explains why it could not.
   *
   * Returns null when there is no body in the frame — a real outcome, not an
   * error, and the caller says so rather than measuring noise.
   */
  async detect(image: ImageData): Promise<PoseResult | null> {
    const landmarker = await this.load();
    const result = landmarker.detect(image as unknown as ImageData);
    const first = result.landmarks?.[0];
    if (!first || first.length < 33) return null;

    /*
     * Copied out immediately, before anything else touches the landmarker.
     *
     * MediaPipe hands back a view onto a buffer it owns and reuses on the next
     * detect, so keeping the reference would give a mask that silently becomes
     * a different frame's outline. The copy is a few hundred KB and lives for
     * one scan.
     */
    let mask: Mask | null = null;
    const raw = result.segmentationMasks?.[0];
    if (raw) {
      try {
        mask = {
          data: new Float32Array(raw.getAsFloat32Array()),
          width: raw.width,
          height: raw.height,
        };
      } finally {
        raw.close();
      }
    }

    const landmarks: Landmark[] = first.map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z,
      visibility: p.visibility ?? 0,
    }));

    // Confidence is the *weakest* required joint, not the average: a
    // measurement is only as trustworthy as the point it is least sure of, and
    // averaging lets four confident points hide one that was guessed.
    const confidence = Math.min(...REQUIRED.map((i) => landmarks[i].visibility));
    return { landmarks, confidence, mask };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
