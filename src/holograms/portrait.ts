/**
 * The hologram, made out of the face it is a hologram *of*.
 *
 * Everything else in this app stopped being primitives and got better for it:
 * the rooms became photographic plates, Elohim became painted layers. The
 * contour model was the last thing built out of maths, and it showed — an
 * ovoid with line-art features, sitting between two pieces of finished art and
 * losing to both. It was also, more importantly, *nobody*. A skin analysis that
 * projects a generic head is projecting a diagram.
 *
 * The capture is right there. `analyseFace` returns `imageBase64` on every
 * single scan; only *uploading* it is gated behind storage consent, so the
 * frame the measurements were taken from is in memory whether or not the user
 * ever agreed to keep it. That means the hologram can be their face — not a
 * painted stand-in, which would be claiming to have scanned someone who was
 * never scanned.
 *
 * The treatment is what makes a photograph read as a projection:
 *
 *   ramp        luminance mapped to the holographic palette, so it is light
 *               rather than a picture with a filter over it
 *   alpha       taken from luminance too — dark areas simply are not there,
 *               which is what stops it looking like a photo pasted on glass
 *   contours    luminance quantised into bands with the boundaries lit, so the
 *               form of *their* face reads as a depth scan of it
 *   edges       a Sobel pass, added as light, for the crisp structural lines
 *   regions     the measured zones, glowing, at the exact rectangles they were
 *               sampled from
 *
 * All of it is one canvas, drawn once per scan, uploaded as one texture. The
 * animation — scanlines, beam, roll bar, halo — is the projection layer over
 * the top, which already exists and does not care what it is lighting.
 */
import * as THREE from 'three';

import { subdivide } from '@/skin-analysis/roi.ts';
import { METRIC_REGIONS } from '@/skin-analysis/metrics.ts';
import {
  FACE_REGIONS,
  METRIC_HIGHER_IS_BETTER,
  METRIC_LABELS,
  type FaceRegionKey,
  type SkinAnalysis,
  type SkinMetricKey,
} from '@shared/types.ts';

/** Working resolution. The capture arrives around 512; this is plenty. */
const SIZE = 512;

/**
 * How many luminance bands the contour lines fall between.
 *
 * Fewer than it first looks like it wants. At 14 the lines were close enough
 * together that grain crossed them constantly and the lower face turned into a
 * tangle. At 8 the opposite: clean, but so sparse the face stopped being
 * recognisably anyone. Eleven is where the lines still follow real planes of
 * shading and there are enough of them to carry a likeness.
 */
const BANDS = 11;

/** Radius of the blur applied before contouring. See `smooth`. */
const SMOOTH_RADIUS = 3;

/**
 * The palette, dark to light.
 *
 * Violet through cyan to white, matching the room's own lighting so the
 * projection belongs to the same world as the plate behind it.
 */
const RAMP: Array<[number, number, number]> = [
  [10, 6, 34],
  [58, 28, 132],
  [96, 74, 220],
  [110, 170, 246],
  [186, 240, 255],
  [255, 255, 255],
];

function ramp(t: number): [number, number, number] {
  const x = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1] ?? a;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Which metric each region is most diagnostic for — used to colour its glow. */
function regionMetrics(): Map<FaceRegionKey, SkinMetricKey[]> {
  const out = new Map<FaceRegionKey, SkinMetricKey[]>();
  for (const [metric, regions] of Object.entries(METRIC_REGIONS) as Array<
    [SkinMetricKey, FaceRegionKey[]]
  >) {
    // Evenness is measured from the whole face, so it would tint every zone the
    // same and say nothing. It is a between-region statistic, not a place.
    if (metric === 'evenness') continue;
    for (const region of regions) {
      const list = out.get(region) ?? [];
      list.push(metric);
      out.set(region, list);
    }
  }
  return out;
}

const REGION_METRICS = regionMetrics();

/**
 * A separable box blur, run twice for a near-Gaussian falloff.
 *
 * The contour and edge passes are both derivatives of luminance, and a
 * derivative of a noisy signal is mostly noise: JPEG grain crossing a band
 * boundary draws a contour line that has nothing to do with the face. Blurring
 * first means the lines follow the shading of the *form* — brow, cheekbone,
 * jaw — which is the entire reason they read as a depth scan.
 *
 * Deliberately not applied to the tone: the base luminance stays sharp so the
 * projection keeps its fine detail, and only the line work is smoothed.
 */
function smooth(src: Float32Array, size: number, radius: number): Float32Array {
  const len = src.length;
  /*
   * Two buffers, ping-ponged, instead of the five this used to allocate.
   *
   * At 512² that is 4 MB of garbage per call rather than 10 MB, and render()
   * runs this twice.
   */
  const a = new Float32Array(len);
  const b = new Float32Array(len);

  /*
   * A running sum rather than re-reading the whole window per pixel.
   *
   * The window still shrinks at the edges — the divisor is the live span, not
   * a constant — so the result matches the naive form. What changes is the
   * cost: (2r+1) reads per pixel becomes one add and one subtract, which at
   * radius 3 is the difference between ~70 ms and single-digit ms per render.
   */
  const blur = (input: Float32Array, out: Float32Array, stride: number, step: number): void => {
    for (let line = 0; line < size; line++) {
      const base = line * stride;
      let hi = Math.min(size - 1, radius);
      let sum = 0;
      for (let i = 0; i <= hi; i++) sum += input[base + i * step];
      out[base] = sum / (hi + 1);

      for (let i = 1; i < size; i++) {
        const leaving = i - radius - 1;
        const entering = i + radius;
        if (leaving >= 0) sum -= input[base + leaving * step];
        if (entering < size) {
          sum += input[base + entering * step];
          hi = entering;
        }
        const lo = leaving >= 0 ? leaving + 1 : 0;
        out[base + i * step] = sum / (hi - lo + 1);
      }
    }
  };

  // Horizontal walks a row (stride = size, step = 1); vertical walks a column
  // (stride = 1, step = size). Same kernel, transposed indexing.
  blur(src, a, size, 1);
  blur(a, b, 1, size);
  blur(b, a, size, 1);
  blur(a, b, 1, size);
  return b;
}

export class HoloPortrait {
  readonly texture: THREE.CanvasTexture;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** The last capture, kept so a new analysis can be re-drawn over it. */
  private source: HTMLCanvasElement | null = null;
  /**
   * Width over height of the capture, before it was squared onto the canvas.
   *
   * The projection quad is sized from this. A face crop is roughly square; a
   * body crop is much taller than it is wide, and drawing one on the other's
   * quad stretches a person sideways — the same mistake the backdrop plate made
   * when it assumed every picture was square.
   */
  private sourceAspect = 1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas is unavailable');
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  /** True once a capture has been handed over and processed. */
  get ready(): boolean {
    return this.source !== null;
  }

  /** Width over height of the capture, for sizing the quad it is drawn on. */
  get aspect(): number {
    return this.sourceAspect;
  }

  /**
   * Takes the frame the measurements were made from.
   *
   * `base64` is a raw JPEG payload, exactly as `analyseFace` returns it.
   */
  async setCapture(base64: string, analysis: SkinAnalysis | null = null): Promise<void> {
    /*
     * `createImageBitmap`, not `new Image()` + `decode()`.
     *
     * `HTMLImageElement.decode()` resolves when the image is ready *to be
     * painted*, and a tab that is not compositing never paints — so in a
     * backgrounded tab it simply never resolves and the projection silently
     * never appears. `createImageBitmap` decodes off the rendering path and
     * does not care whether anything is on screen.
     */
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));

    const square = document.createElement('canvas');
    square.width = SIZE;
    square.height = SIZE;
    const sctx = square.getContext('2d', { willReadFrequently: true });
    if (!sctx) {
      bitmap.close();
      return;
    }
    this.sourceAspect = bitmap.width / Math.max(1, bitmap.height);
    // Drawn square on purpose: the region rectangles and the vignette are both
    // in canvas space, and the quad restores the true shape by being that shape.
    sctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
    bitmap.close();
    this.source = square;
    /*
     * Rendered once, with the analysis if the caller already has one.
     *
     * This used to render with null and let the caller immediately render
     * again — a full pass whose output was always overwritten. render() is the
     * most expensive thing in this file, so the discarded one was not free.
     */
    this.render(analysis);
  }

  /** Drops the capture, so the abstract model takes over again. */
  clear(): void {
    this.source = null;
  }

  /**
   * Redraws the projection, optionally lighting the measured zones.
   *
   * Called once when the capture arrives and again when an analysis is
   * presented — never per frame. Everything that moves lives in the projection
   * layer over the top.
   */
  render(analysis: SkinAnalysis | null): void {
    const source = this.source;
    if (!source) return;

    const sctx = source.getContext('2d', { willReadFrequently: true });
    if (!sctx) return;
    const input = sctx.getImageData(0, 0, SIZE, SIZE);
    const src = input.data;

    // Luminance first: everything below is a function of it.
    const lum = new Float32Array(SIZE * SIZE);
    for (let i = 0, p = 0; i < src.length; i += 4, p++) {
      lum[p] = (0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) / 255;
    }

    // Stretch to the observed range. A capture normalised for *measurement* is
    // not necessarily well spread for *display*, and a flat one projects as fog.
    let lo = 1;
    let hi = 0;
    for (let p = 0; p < lum.length; p++) {
      if (lum[p] < lo) lo = lum[p];
      if (lum[p] > hi) hi = lum[p];
    }
    const span = Math.max(0.001, hi - lo);
    for (let p = 0; p < lum.length; p++) lum[p] = (lum[p] - lo) / span;

    // Line work comes off the smoothed copy; tone stays on the sharp one.
    const form = smooth(lum, SIZE, SMOOTH_RADIUS);

    const out = this.ctx.createImageData(SIZE, SIZE);
    const dst = out.data;

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = y * SIZE + x;
        const l = lum[p];

        // Sobel, on the luminance we already have.
        let edge = 0;
        if (x > 0 && x < SIZE - 1 && y > 0 && y < SIZE - 1) {
          const gx =
            -form[p - SIZE - 1] - 2 * form[p - 1] - form[p + SIZE - 1] +
            form[p - SIZE + 1] + 2 * form[p + 1] + form[p + SIZE + 1];
          const gy =
            -form[p - SIZE - 1] - 2 * form[p - SIZE] - form[p - SIZE + 1] +
            form[p + SIZE - 1] + 2 * form[p + SIZE] + form[p + SIZE + 1];
          edge = Math.min(1, Math.hypot(gx, gy) * 2.6);
        }

        /*
         * Contour lines.
         *
         * Quantise luminance into bands and light the boundaries. Because the
         * bands follow the shading of a real face, the lines land on its actual
         * form — brow, nose, cheekbone, jaw — which is what makes this read as a
         * depth scan rather than a photograph with a filter on it.
         */
        const band = form[p] * BANDS;
        const toEdge = Math.abs(band - Math.round(band));
        const contour = Math.pow(Math.max(0, 1 - toEdge * 5), 2.6);

        /*
         * Structure carries the brightness, not the photograph.
         *
         * Weighting raw luminance heavily produced an evenly pale face — a
         * washed photo rather than a projection, and additive light over a
         * bright wall has no headroom to spare on flat mid-tones. Spending it
         * on the contours and edges instead means the parts that read as a
         * *scan* are the parts that are bright.
         */
        const [r, g, b] = ramp(l * 0.58 + contour * 0.44 + edge * 0.4);
        const glow = contour * 0.8 + edge * 0.72;
        const i = p * 4;
        dst[i] = Math.min(255, r + glow * 90);
        dst[i + 1] = Math.min(255, g + glow * 110);
        dst[i + 2] = Math.min(255, b + glow * 120);

        /*
         * Alpha from luminance, not a flat rectangle.
         *
         * A hologram is light: where the face was dark there is simply nothing
         * to project. This is what stops the result reading as a photograph
         * stuck on a pane of glass, and it gives the silhouette a soft falloff
         * for free.
         */
/*
         * More body than before, because this has to read as *your* face.
         *
         * At 152 the luminance term topped out at 0.6 alpha, and additively
         * blended over a lit room that leaves a pale wash — legible as "a
         * holographic head", which is exactly the complaint, but not legible as
         * a particular person. The projection is the one place the app shows
         * you yourself, so the features have to survive the room behind them.
         *
         * The exponent comes down with it. 1.35 crushed the mid-tones, and
         * mid-tones are where a face's shape lives: cheek, temple, the side of
         * the nose. Raising the alpha without this would have brightened the
         * highlights and left the form as flat as before.
         */
        const presence = Math.pow(Math.max(0, l - 0.06) / 0.94, 1.12);
        dst[i + 3] = Math.min(255, (presence * 196 + glow * 210) * this.vignette(x, y));
      }
    }

    this.ctx.clearRect(0, 0, SIZE, SIZE);
    this.ctx.putImageData(out, 0, 0);
    if (analysis) this.drawRegions(analysis);
    this.texture.needsUpdate = true;
  }

  /** Fades the frame's corners, so the projection has no rectangular edge. */
  private vignette(x: number, y: number): number {
    const dx = (x / SIZE - 0.5) * 2;
    const dy = (y / SIZE - 0.5) * 2.05;
    return Math.max(0, Math.min(1, 1.42 - Math.hypot(dx, dy) * 1.42));
  }

  /**
   * Lights each measured zone on the face it was measured from.
   *
   * The rectangles come from `subdivide` over the whole frame, which is exactly
   * how they were derived at measurement time — the capture is the canonical
   * crop, in which the face fills the frame by construction. So these land on
   * the same pixels the numbers came from, not near them.
   */
  private drawRegions(analysis: SkinAnalysis): void {
    const rects = subdivide({ x: 0, y: 0, width: SIZE, height: SIZE, confidence: 1 });
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const region of FACE_REGIONS) {
      const rect = rects[region];
      const metrics = REGION_METRICS.get(region);
      if (!rect || !metrics?.length) continue;

      // How bad this zone is reading, 0..1, over the metrics measured from it.
      let worst = 0;
      for (const metric of metrics) {
        const value = analysis.metrics[metric];
        const bad = METRIC_HIGHER_IS_BETTER[metric] ? 100 - value : value;
        worst = Math.max(worst, bad / 100);
      }
      // Nothing to say about a zone that is reading fine.
      if (worst < 0.42) continue;

      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const radius = Math.max(rect.width, rect.height) * 0.78;
      const strength = Math.min(0.5, (worst - 0.42) * 1.15);

      // Warmer as it worsens: cyan is fine, amber is worth talking about.
      const hue = 190 - worst * 150;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, `hsla(${hue}, 100%, 68%, ${strength})`);
      gradient.addColorStop(0.55, `hsla(${hue}, 100%, 60%, ${strength * 0.42})`);
      gradient.addColorStop(1, `hsla(${hue}, 100%, 55%, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, radius * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Keep the nine metric readouts on the captured face itself.  These are
    // deliberately anchored to the same ROI rectangles used by the local
    // measurement, rather than to a generic head or a fixed side panel.
    ctx.font = '600 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [metric, regions] of Object.entries(METRIC_REGIONS) as [SkinMetricKey, FaceRegionKey[]][]) {
      const region = regions[0];
      const rect = rects[region];
      if (!rect) continue;
      const value = analysis.metrics[metric];
      const x = Math.max(34, Math.min(SIZE - 34, rect.x + rect.width / 2));
      const y = Math.max(18, rect.y + rect.height / 2);
      ctx.strokeStyle = 'rgba(93, 232, 255, .9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(8, 15, 35, .78)';
      ctx.fill();
      ctx.fillStyle = '#f4fbff';
      ctx.fillText(String(Math.round(value / 10) / 1), x, y);
      ctx.font = '600 9px Inter, sans-serif';
      ctx.fillText(METRIC_LABELS[metric], x, Math.min(SIZE - 8, y + 27));
      ctx.font = '600 13px Inter, sans-serif';
    }
    ctx.restore();
  }

  dispose(): void {
    this.texture.dispose();
  }
}
