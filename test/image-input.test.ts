/**
 * P1-T05 — unit contract for server/lib/image-input.ts.
 *
 * Pure function, no DB: malformed/truncated/mislabeled inputs, per-purpose
 * oversized (±1 byte around each decoded ceiling), crafted excessive
 * dimensions (tiny bytes claiming huge IHDR/SOF), boundary-valid inputs
 * exactly at each ceiling, unsupported-type mapping, and identical
 * JPEG/PNG semantics across all three purposes. Synthetic fixtures only.
 */
import { describe, expect, it } from "vitest";
import {
  IMAGE_INPUT_LIMITS,
  ImageInputError,
  validateImageInput,
  type ImagePurpose,
} from "../server/lib/image-input.ts";

const PURPOSES: ImagePurpose[] = ["face", "label", "progress"];

/** Minimal JPEG: SOI + SOF0 declaring w×h + EOI, then zero padding. */
function jpegBytes(width: number, height: number, totalBytes?: number): Buffer {
  const head = Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
  if (totalBytes === undefined) return head;
  if (totalBytes < head.length) throw new Error("fixture too small");
  return Buffer.concat([head, Buffer.alloc(totalBytes - head.length)]);
}

/** Minimal PNG: signature + IHDR declaring w×h (no CRC check server-side). */
function pngBytes(width: number, height: number): Buffer {
  const out = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(out, 0);
  out.writeUInt32BE(13, 8);
  out.subarray(12, 16).write("IHDR", "latin1");
  out.writeUInt32BE(width, 16);
  out.writeUInt32BE(height, 20);
  out[24] = 8; // bit depth
  out[25] = 2; // truecolor
  return out;
}

const b64 = (bytes: Buffer): string => bytes.toString("base64");
const tinyJpeg = b64(jpegBytes(16, 16));
const tinyPng = b64(pngBytes(16, 16));

function statusOf(fn: () => unknown): number {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ImageInputError);
    return (err as ImageInputError).status;
  }
  throw new Error("expected an ImageInputError");
}

describe("strict base64 decoding", () => {
  it.each([undefined, null, 42, "", "abc", "abcde", "ab=c", "a b c d"])(
    "rejects malformed input %p with 400",
    (input) => {
      expect(statusOf(() => validateImageInput(input, "face"))).toBe(400);
    },
  );

  it("rejects non-alphabet bytes and data-URL prefixes with 400", () => {
    expect(statusOf(() => validateImageInput("!!!not-base64!!!", "face"))).toBe(
      400,
    );
    expect(
      statusOf(() =>
        validateImageInput(`data:image/jpeg;base64,${tinyJpeg}`, "face"),
      ),
    ).toBe(400);
  });

  it("rejects truncated base64 whose length is not a multiple of 4", () => {
    expect(
      statusOf(() => validateImageInput(tinyJpeg.slice(0, -1), "face")),
    ).toBe(400);
    expect(
      statusOf(() => validateImageInput(tinyJpeg.slice(0, -2), "face")),
    ).toBe(400);
  });
});

describe("magic bytes and type sniffing", () => {
  it("rejects plain text mislabeled as an image with 400, not 415", () => {
    const text = b64(
      Buffer.from(
        "these are words, not pixels, no matter what the client claims",
      ),
    );
    for (const purpose of PURPOSES) {
      try {
        validateImageInput(text, purpose);
        throw new Error("expected denial");
      } catch (err) {
        expect(err).toBeInstanceOf(ImageInputError);
        expect((err as ImageInputError).status).toBe(400);
        expect((err as ImageInputError).code).toBe("not_an_image");
      }
    }
  });

  it("rejects a truncated JPEG that ends mid-header with 400", () => {
    const cut = b64(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00]));
    expect(statusOf(() => validateImageInput(cut, "face"))).toBe(400);
  });

  it("rejects a truncated PNG that ends before IHDR with 400", () => {
    const cut = b64(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(statusOf(() => validateImageInput(cut, "face"))).toBe(400);
  });

  it("rejects real GIF/BMP bytes with 415 unsupported type", () => {
    const gif = b64(
      Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(32)]),
    );
    const bmp = b64(
      Buffer.concat([Buffer.from("BM", "latin1"), Buffer.alloc(32)]),
    );
    for (const payload of [gif, bmp]) {
      for (const purpose of PURPOSES) {
        try {
          validateImageInput(payload, purpose);
          throw new Error("expected denial");
        } catch (err) {
          expect((err as ImageInputError).status).toBe(415);
          expect((err as ImageInputError).code).toBe("unsupported_image_type");
        }
      }
    }
  });

  it("accepts PNG for every purpose with type sniffed, never trusted", () => {
    for (const purpose of PURPOSES) {
      const out = validateImageInput(tinyPng, purpose);
      expect(out.type).toBe("png");
      expect(out.width).toBe(16);
      expect(out.height).toBe(16);
    }
  });

  it("accepts JPEG for every purpose with SOF dimensions parsed", () => {
    for (const purpose of PURPOSES) {
      const out = validateImageInput(tinyJpeg, purpose);
      expect(out.type).toBe("jpeg");
      expect(out.width).toBe(16);
      expect(out.height).toBe(16);
    }
  });

  it("tolerates valid magic with no discoverable SOF under the byte ceiling", () => {
    // The historic 4-byte SOI+EOI fixture: no pixels, so no dimension budget
    // to blow. Existing route suites rely on this acceptance.
    const out = validateImageInput(
      b64(Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
      "face",
    );
    expect(out.type).toBe("jpeg");
    expect(out.width).toBeNull();
  });
});

describe("decoded-byte ceilings", () => {
  it("has every per-purpose ceiling below the 12mb transport ceiling", () => {
    for (const purpose of PURPOSES) {
      expect(IMAGE_INPUT_LIMITS[purpose].maxDecodedBytes).toBeLessThan(
        12 * 1024 * 1024,
      );
    }
  });

  it.each(PURPOSES)(
    "rejects 1 byte over the %s ceiling with 413",
    (purpose) => {
      const max = IMAGE_INPUT_LIMITS[purpose].maxDecodedBytes;
      try {
        validateImageInput(b64(jpegBytes(16, 16, max + 1)), purpose);
        throw new Error("expected denial");
      } catch (err) {
        expect((err as ImageInputError).status).toBe(413);
        expect((err as ImageInputError).code).toBe("image_too_large");
      }
    },
  );

  it.each(PURPOSES)("accepts exactly at the %s ceiling", (purpose) => {
    const max = IMAGE_INPUT_LIMITS[purpose].maxDecodedBytes;
    // Ceilings are multiples of 3, so the boundary encodes with no padding
    // and exactly maxBase64Chars characters.
    expect(max % 3).toBe(0);
    const out = validateImageInput(b64(jpegBytes(16, 16, max)), purpose);
    expect(out.bytes.length).toBe(max);
    expect(out.type).toBe("jpeg");
    out.bytes.fill(0);
  });

  it("applies different ceilings per purpose: 4MB fails face but passes label", () => {
    const payload = b64(jpegBytes(16, 16, 4_000_000));
    expect(statusOf(() => validateImageInput(payload, "face"))).toBe(413);
    expect(statusOf(() => validateImageInput(payload, "progress"))).toBe(413);
    const out = validateImageInput(payload, "label");
    expect(out.bytes.length).toBe(4_000_000);
    out.bytes.fill(0);
  });
});

describe("dimension and pixel ceilings", () => {
  it("rejects tiny bytes claiming huge SOF dimensions with 413", () => {
    for (const purpose of PURPOSES) {
      expect(
        statusOf(() =>
          validateImageInput(b64(jpegBytes(10000, 10000)), purpose),
        ),
      ).toBe(413);
    }
  });

  it("rejects tiny bytes claiming huge IHDR dimensions with 413", () => {
    for (const purpose of PURPOSES) {
      expect(
        statusOf(() =>
          validateImageInput(b64(pngBytes(10000, 10000)), purpose),
        ),
      ).toBe(413);
    }
  });

  it("enforces the long-edge ceiling even when pixels fit", () => {
    // face allows 2048px edges: 2049×10 is few pixels but too wide.
    expect(
      statusOf(() => validateImageInput(b64(jpegBytes(2049, 10)), "face")),
    ).toBe(413);
    const ok = validateImageInput(b64(jpegBytes(2048, 10)), "face");
    expect(ok.width).toBe(2048);
  });

  it("accepts exactly maxPixels and rejects one row over", () => {
    // progress allows 500_000 pixels: 1000×500 passes, 1000×501 does not.
    const ok = validateImageInput(b64(pngBytes(1000, 500)), "progress");
    expect(ok.width).toBe(1000);
    expect(ok.height).toBe(500);
    expect(
      statusOf(() => validateImageInput(b64(pngBytes(1000, 501)), "progress")),
    ).toBe(413);
  });
});
