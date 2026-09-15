/**
 * Colour space conversions.
 *
 * Skin metrics are computed in CIELAB, not RGB. Redness in RGB is entangled with
 * brightness and with how dark the skin is; a* separates the red-green axis from
 * lightness, which is the whole reason the measurement transfers across skin
 * tones at all.
 */

/** sRGB 0..255 to linear 0..1. */
export function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// D65 reference white.
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

const labF = (t: number): number =>
  t > 0.008856451679 ? Math.cbrt(t) : 7.787037 * t + 16 / 116;

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export function rgbToLab(r: number, g: number, b: number, out: Lab): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / XN;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / YN;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / ZN;

  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);

  out.L = 116 * fy - 16;
  out.a = 500 * (fx - fy);
  out.b = 200 * (fy - fz);
  return out;
}

/** Rec. 709 luma on gamma-encoded values, 0..255. Cheap and adequate for gating. */
export const luma = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function rgbToHsv(r: number, g: number, b: number, out: Hsv): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  out.v = max;
  out.s = max === 0 ? 0 : d / max;

  if (d === 0) {
    out.h = 0;
  } else if (max === rn) {
    out.h = (60 * ((gn - bn) / d) + 360) % 360;
  } else if (max === gn) {
    out.h = 60 * ((bn - rn) / d) + 120;
  } else {
    out.h = 60 * ((rn - gn) / d) + 240;
  }
  return out;
}

/**
 * YCbCr skin-likeness. The chroma bounds below are the widely used Hsu/Chai
 * ranges, which hold across skin tones because melanin moves luminance far more
 * than it moves chroma — the reason this is done in Cb/Cr and not in RGB.
 */
export function isSkinChroma(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  // The luma bound only rejects clipped highlights and near-black, never a tone.
  return y > 40 && y < 250 && cb >= 77 && cb <= 133 && cr >= 133 && cr <= 180;
}
