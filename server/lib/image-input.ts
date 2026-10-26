/**
 * P1-T05 — one validated front door for every image the browser sends.
 *
 * Three endpoints accept image bytes: POST /api/analysis/face (provider
 * scan), POST /api/products/read-label (provider label read) and
 * POST /api/scans/:id/progress-photo (encrypted storage via putBlob). Before
 * this module the first stored arbitrary bytes with no checks at all, the
 * second checked only string length, and the third carried its own ad-hoc
 * base64/JPEG checks. All three now share identical semantics here.
 *
 * Ordering contract (enforced by the routes, not here): consent is checked
 * FIRST, before this module ever sees the payload, so a denial never even
 * decodes. On denial nothing downstream runs — no putBlob, no provider call.
 *
 * ---------------------------------------------------------------------------
 * Limits table. Every decoded ceiling sits below the 12 MB JSON transport
 * ceiling in server/app.ts (base64 inflates ~4/3, so 12 MB of JSON carries at
 * most ~9 MB of decoded bytes before framing overhead), and below the ~6 MB
 * platform request-payload caps that apply in front of it (documented on the
 * web-lambda bridge). Deployment headroom reasoning per purpose:
 * ---------------------------------------------------------------------------
 * purpose    decoded     base64*   dims / pixels        why this number
 * -------    -------     -------   -------------        ---------------
 * face       3_000_000   4_000_000 ≤2048px, ≤2.5M px     Frontend sends the provider frame from
 *                                                       src/skin-analysis/pipeline.ts: the frozen capture
 *                                                       rescaled to long-edge ≤1280, encoded JPEG q0.9
 *                                                       (and only when its short edge is ≥480px).
 *                                                       Real captures land ~300–800 KB; pathological
 *                                                       high-entropy frames approach ~2.5 MB, so 3 MB
 *                                                       admits them with headroom while staying far
 *                                                       under transport.
 * label      7_500_000  10_000_000 ≤4096px, ≤12.5M px    Frontend sends the FULL camera frame at native
 *                                                       resolution, JPEG q0.9 (src/products/label-reader.ts
 *                                                       over src/products/LabelScanner.svelte, whose camera
 *                                                       asks for ideal width 1920 — plus arbitrary user
 *                                                       uploads re-encoded at their own resolution). A 12 MP
 *                                                       upload can approach ~6 MB, so 7.5 MB admits it with
 *                                                       headroom while its ~10 MB base64 still clears the
 *                                                       12 MB transport ceiling.
 * progress     768_000   1_024_000 ≤1024px, ≤500K px     Frontend sends the canonical 288×384 crop, JPEG q0.86
 *                                                       (src/skin-analysis/pipeline.ts — ~30–60 KB on the
 *                                                       wire). These bytes are STORED encrypted, so the
 *                                                       ceiling is deliberately the tightest: 768 KB is
 *                                                       ~12× headroom for future crop changes, and the
 *                                                       dimension/pixel caps pin it to photo scale.
 * ---------------------------------------------------------------------------
 * * maxBase64Chars is ceil(maxDecodedBytes / 3) * 4, enforced BEFORE decoding
 * so an absurd payload never materialises as a Buffer. All three decoded
 * ceilings are multiples of 3, so an exactly-at-ceiling payload encodes to
 * exactly maxBase64Chars with no padding: boundary-valid inputs pass.
 *
 * Typed errors map to HTTP: 400 malformed input or bytes that are not an
 * image at all (including text "mislabeled" as an image), 413 decoded size
 * or dimensions over the per-purpose ceiling, 415 bytes that ARE an image
 * of a type outside the JPEG/PNG allowlist (e.g. GIF, BMP, WebP, TIFF).
 *
 * Zero new npm dependencies: dimension checks are minimal header parses —
 * PNG IHDR at its fixed offset, JPEG SOF markers walked without a decoder.
 * A JPEG with valid magic but no discoverable SOF segment (e.g. the historic
 * 4-byte SOI+EOI fixture) is accepted with unknown dimensions: it carries no
 * pixels to blow any budget, and the decoded-byte ceiling still applies.
 * Anything claiming dimensions via SOF/IHDR has them enforced.
 */

export type ImagePurpose = "face" | "label" | "progress";

export type ImageType = "jpeg" | "png";

export interface ImageLimits {
  /** Decoded-byte ceiling. Inputs decoding to more are rejected (413). */
  maxDecodedBytes: number;
  /** Base64-character ceiling, enforced before decoding (413). */
  maxBase64Chars: number;
  /** Largest accepted width/height in pixels when headers declare them (413). */
  maxDimension: number;
  /** Largest accepted width × height when headers declare them (413). */
  maxPixels: number;
}

const limits = (
  maxDecodedBytes: number,
  maxDimension: number,
  maxPixels: number,
): ImageLimits => ({
  maxDecodedBytes,
  maxBase64Chars: Math.ceil(maxDecodedBytes / 3) * 4,
  maxDimension,
  maxPixels,
});

export const IMAGE_INPUT_LIMITS: Record<ImagePurpose, ImageLimits> = {
  face: limits(3_000_000, 2048, 2_500_000),
  label: limits(7_500_000, 4096, 12_500_000),
  progress: limits(768_000, 1024, 500_000),
};

export class ImageInputError extends Error {
  readonly status: 400 | 413 | 415;
  readonly code: string;
  constructor(status: 400 | 413 | 415, code: string, message: string) {
    super(message);
    this.name = "ImageInputError";
    this.status = status;
    this.code = code;
  }
}

export interface ValidatedImage {
  /** Decoded bytes. Owned by the caller, which must zero them after use. */
  bytes: Buffer;
  /** Sniffed from magic bytes — never trusted from any client label. */
  type: ImageType;
  /** From IHDR/SOF when the headers declare them, else null (see above). */
  width: number | null;
  height: number | null;
}

const BASE64_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;

function fail(status: 400 | 413 | 415, code: string, message: string): never {
  throw new ImageInputError(status, code, message);
}

/** Strict base64 → bytes. Node's decoder is lenient, so every property the
 *  spec forbids (non-alphabet chars, bad padding, truncation) is checked here
 *  first; a canonical-length cross-check catches anything else it drops. */
function strictDecode(encoded: string, lim: ImageLimits): Buffer {
  if (encoded.length === 0) fail(400, "missing_image", "An image is required.");
  if (encoded.length % 4 !== 0) {
    fail(
      400,
      "malformed_base64",
      "That image data is truncated or mis-padded.",
    );
  }
  if (!BASE64_ALPHABET.test(encoded)) {
    fail(400, "malformed_base64", "That image data is not valid base64.");
  }
  const firstPad = encoded.indexOf("=");
  if (firstPad !== -1 && firstPad < encoded.length - 2) {
    fail(400, "malformed_base64", "That image data is not valid base64.");
  }
  if (encoded.length > lim.maxBase64Chars) {
    fail(
      413,
      "image_too_large",
      "That image is larger than this endpoint accepts.",
    );
  }
  const bytes = Buffer.from(encoded, "base64");
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (bytes.length !== (encoded.length / 4) * 3 - padding) {
    bytes.fill(0);
    fail(400, "malformed_base64", "That image data could not be decoded.");
  }
  return bytes;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function sniffType(bytes: Buffer): ImageType {
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  if (jpeg) return "jpeg";
  const png = bytes.length >= 8 && PNG_MAGIC.every((b, i) => bytes[i] === b);
  if (png) return "png";
  // Bytes that ARE an image, just not one on the allowlist → 415 so the
  // caller learns the type is the problem, not the encoding.
  const ascii = bytes.subarray(0, 12).toString("latin1");
  const knownOther =
    ascii.startsWith("GIF87a") ||
    ascii.startsWith("GIF89a") ||
    ascii.startsWith("BM") ||
    ascii.startsWith("II*\0") ||
    ascii.startsWith("MM\0*") ||
    (bytes.length >= 12 &&
      bytes.subarray(4, 8).toString("latin1") === "ftyp") ||
    (bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
      bytes.subarray(8, 12).toString("latin1") === "WEBP") ||
    ascii.trimStart().startsWith("<svg");
  if (knownOther) {
    fail(
      415,
      "unsupported_image_type",
      "Only JPEG and PNG images are accepted.",
    );
  }
  fail(400, "not_an_image", "Those bytes are not a JPEG or PNG image.");
}

/**
 * PNG dimensions from IHDR at its fixed offset. A PNG without a readable
 * IHDR is not a decodable image → 400, never silent acceptance.
 */
function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 33)
    fail(400, "not_an_image", "That PNG ends before its header.");
  // Length (must be 13) + type IHDR.
  if (
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString("latin1") !== "IHDR"
  ) {
    fail(
      400,
      "not_an_image",
      "That PNG has no header where its header must be.",
    );
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1)
    fail(400, "not_an_image", "That PNG declares no pixels.");
  return { width, height };
}

const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const JPEG_STANDALONE = new Set([
  0x01,
  0xd8,
  0xd9,
  ...[0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7],
]);

/**
 * JPEG dimensions from the first SOF marker, walking segment lengths with
 * bounds checks. Returns null when no SOF is discoverable before SOS/EOI —
 * a degenerate but pixel-less file (see module header) — so callers can
 * accept it under the byte ceiling rather than invent dimensions for it.
 * Truncated mid-structure is malformed (400), not "unknown".
 */
function jpegDimensions(
  bytes: Buffer,
): { width: number; height: number } | null {
  let pos = 2; // past SOI, whose magic is already verified
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff)
      fail(400, "not_an_image", "That JPEG is structurally corrupt.");
    const marker = bytes[pos + 1];
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / start-of-scan: no frame header
    if (JPEG_STANDALONE.has(marker)) {
      pos += 2;
      continue;
    }
    if (pos + 3 >= bytes.length)
      fail(400, "not_an_image", "That JPEG ends mid-header.");
    const segLen = bytes.readUInt16BE(pos + 2);
    if (segLen < 2 || pos + 2 + segLen > bytes.length) {
      fail(400, "not_an_image", "That JPEG ends mid-header.");
    }
    if (JPEG_SOF.has(marker)) {
      if (segLen < 7)
        fail(400, "not_an_image", "That JPEG frame header is corrupt.");
      const height = bytes.readUInt16BE(pos + 5);
      const width = bytes.readUInt16BE(pos + 7);
      if (width < 1 || height < 1)
        fail(400, "not_an_image", "That JPEG declares no pixels.");
      return { width, height };
    }
    pos += 2 + segLen;
  }
  return null;
}

/**
 * Validate one base64 image payload for one purpose. Throws ImageInputError
 * (with .status 400/413/415) on any denial — after zeroing any decoded
 * buffer — so routes can map it straight to HTTP without touching providers
 * or storage. Returns the owned decoded bytes plus sniffed type/dimensions.
 */
export function validateImageInput(
  encoded: unknown,
  purpose: ImagePurpose,
): ValidatedImage {
  const lim = IMAGE_INPUT_LIMITS[purpose];
  if (typeof encoded !== "string") {
    fail(400, "missing_image", "An image is required.");
  }
  const bytes = strictDecode(encoded, lim);
  try {
    if (bytes.length > lim.maxDecodedBytes) {
      fail(
        413,
        "image_too_large",
        "That image is larger than this endpoint accepts.",
      );
    }
    const type = sniffType(bytes);
    const dims = type === "png" ? pngDimensions(bytes) : jpegDimensions(bytes);
    if (dims) {
      if (dims.width > lim.maxDimension || dims.height > lim.maxDimension) {
        fail(
          413,
          "image_dimensions_too_large",
          "That image is larger than this endpoint accepts.",
        );
      }
      if (dims.width * dims.height > lim.maxPixels) {
        fail(
          413,
          "image_dimensions_too_large",
          "That image is larger than this endpoint accepts.",
        );
      }
    }
    return {
      bytes,
      type,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    };
  } catch (err) {
    bytes.fill(0);
    throw err;
  }
}
