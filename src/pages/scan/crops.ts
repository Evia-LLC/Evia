/**
 * Zone thumbnails from this session's own capture.
 *
 * The measured frame (`director.hologram.capture`, the canonical face crop the
 * skin pipeline read) is still in memory while the reading is on screen. The
 * callouts show the part of it each region was measured from, cut with the
 * pipeline's own region rectangles (`subdivide`), so a thumbnail is exactly
 * the pixels the finding came from - no stock macro art, no other face.
 *
 * Session-only (SRS RET-01, CNS-04): the crops are object URLs made here and
 * revoked by `releaseCrops`, which the page calls when the capture goes and
 * when it leaves. Nothing is written anywhere or sent anywhere (AI-01).
 */
import type { FaceRegionKey } from '@shared/types.ts';
import { subdivide } from '@/skin-analysis/roi.ts';

export type CropSet = Partial<Record<FaceRegionKey, string>>;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The capture could not be read.'));
    img.src = src;
  });
}

function toUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), 'image/jpeg', 0.9);
  });
}

/**
 * Cuts one square-ish thumbnail per region asked for. A region's rectangle is
 * widened to a square around its centre (clamped to the frame) so the tile is
 * not a sliver, and drawn at 2x the tile's CSS size.
 */
export async function cropRegions(capture: string, regions: readonly FaceRegionKey[], tile = 72): Promise<CropSet> {
  const img = await loadImage(capture);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  if (!W || !H) return {};
  const rects = subdivide({ x: 0, y: 0, width: W, height: H, confidence: 1 });
  const out: CropSet = {};
  const px = tile * 2;
  for (const region of new Set(regions)) {
    const r = rects[region];
    if (!r) continue;
    const side = Math.min(Math.max(r.width, r.height), W, H);
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const sx = Math.max(0, Math.min(W - side, cx - side / 2));
    const sy = Math.max(0, Math.min(H - side, cy - side / 2));
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, px, px);
    const url = await toUrl(canvas);
    // The canvas held the pixels too; drop them now rather than at GC.
    canvas.width = canvas.height = 0;
    if (url) out[region] = url;
  }
  return out;
}

/** Revokes every URL in a set, so the crops cannot outlive the reading. */
export function releaseCrops(set: CropSet): void {
  for (const url of Object.values(set)) if (url) URL.revokeObjectURL(url);
}
