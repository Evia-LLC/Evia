/**
 * Same light, same distance.
 *
 * Two scans of the same face taken under different light are two different
 * readings, and the noise floors in `shared/types.ts` are as wide as they are
 * mostly because of that. The guide measures the two things that move a
 * reading before the shutter, not after:
 *
 *   light     mean luminance of the face region of the live frame;
 *   distance  the face's height as a fraction of the frame, from the mesh.
 *
 * Both are compared with the scan she will be compared against when there is
 * one - its capture quality carries the same two numbers - so the hint is
 * "a touch closer than last time" rather than a generic oval. With no
 * previous scan the targets are the pipeline's own comfort zone.
 */
import type { MeshFrame } from './face-mesh.ts';
import type { SkinAnalysis } from '@shared/types.ts';

export interface GuideVerdict {
  light: 'ok' | 'dark' | 'bright';
  distance: 'ok' | 'far' | 'near';
  /** Something to say, or null when both are fine. */
  hint: string | null;
  /** True when the targets came from a previous scan rather than defaults. */
  reference: boolean;
  brightness: number;
  faceHeight: number;
}

/** Where the pipeline's quality gate is happiest. */
const DEFAULT_BRIGHTNESS = 0.5;
const DEFAULT_FACE_HEIGHT = 0.55;

export class CaptureGuide {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D | null;

  constructor() {
    this.canvas.width = 48;
    this.canvas.height = 48;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /** Mean luminance of the face box, 0..1, from a tiny resample of the frame. */
  private brightness(
    source: HTMLVideoElement | HTMLImageElement,
    frame: MeshFrame,
  ): number {
    if (!this.ctx) return DEFAULT_BRIGHTNESS;
    const w = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const h = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!w || !h) return DEFAULT_BRIGHTNESS;
    const box = frame.box;
    const sx = Math.max(0, box.x * w);
    const sy = Math.max(0, box.y * h);
    const sw = Math.max(1, Math.min(w - sx, box.w * w));
    const sh = Math.max(1, Math.min(h - sy, box.h * h));
    try {
      this.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, 48, 48);
    } catch {
      return DEFAULT_BRIGHTNESS;
    }
    const data = this.ctx.getImageData(0, 0, 48, 48).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    return sum / (data.length / 4) / 255;
  }

  assess(
    source: HTMLVideoElement | HTMLImageElement,
    frame: MeshFrame,
    previous: SkinAnalysis | null,
  ): GuideVerdict {
    const brightness = this.brightness(source, frame);
    const faceHeight = frame.box.h;

    const reference = Boolean(previous?.quality?.brightness && previous?.quality?.faceHeightFraction);
    const targetBrightness = reference ? previous!.quality.brightness : DEFAULT_BRIGHTNESS;
    const targetHeight = reference ? previous!.quality.faceHeightFraction : DEFAULT_FACE_HEIGHT;

    // Tolerances: light within ±18% of the target, distance within ±15%.
    const lightRatio = brightness / Math.max(0.05, targetBrightness);
    const light: GuideVerdict['light'] =
      brightness < 0.16 ? 'dark' : lightRatio < 0.82 ? 'dark' : lightRatio > 1.22 || brightness > 0.9 ? 'bright' : 'ok';
    const heightRatio = faceHeight / Math.max(0.05, targetHeight);
    const distance: GuideVerdict['distance'] =
      heightRatio < 0.85 ? 'far' : heightRatio > 1.18 ? 'near' : 'ok';

    let hint: string | null = null;
    if (light === 'dark') {
      hint = reference
        ? 'Darker than last time — turn toward the light, or bring one closer.'
        : 'A bit dark — turn toward a window or a lamp.';
    } else if (light === 'bright') {
      hint = reference
        ? 'Brighter than last time — ease off the light a little.'
        : 'Too much light on your face — ease off it a little.';
    } else if (distance === 'far') {
      hint = reference ? 'A touch closer than this — match your last scan.' : 'A touch closer.';
    } else if (distance === 'near') {
      hint = reference ? 'A touch further back — match your last scan.' : 'A touch further back.';
    }

    return { light, distance, hint, reference, brightness, faceHeight };
  }
}
