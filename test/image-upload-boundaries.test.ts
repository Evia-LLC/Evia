/**
 * P1-T05 — HTTP regressions for image input boundaries.
 *
 * The real Express app (real body-limit routing, real requireAuth, real
 * routers, real disposable DB from `npm run test:local`) with only egress
 * stubbed and counted: provider analyse, label reader, encrypted-blob store.
 * Every denial below asserts its spy stayed untouched — validation happens
 * BEFORE putBlob / provider calls — plus anonymous-401 and consent-403
 * cases proving consent runs before any decode. Synthetic fixtures only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { IMAGE_INPUT_LIMITS } from "../server/lib/image-input.ts";
import { CONSENT_KEYS } from "../shared/consent-keys.ts";
import {
  CONSENT_WORDING_VERSIONS,
  LEGAL_CONTENT,
} from "../shared/legal-content.ts";
import type { FixtureAccount } from "./helpers/two-accounts.ts";

// Same convention as ownership-boundaries.test.ts: routes need a real
// database, so this file only runs under `npm run test:local`.
const configured = (process.env.NETLIFY_DATABASE_URL ?? "").length > 0;
if (!configured) {
  console.warn(
    "[image-upload-boundaries] NETLIFY_DATABASE_URL is not set — database tests did not run (use `npm run test:local`).",
  );
}

const putBlobCalls = vi.hoisted(() => ({ count: 0 }));
const { analyseWithPerfectCorp } = vi.hoisted(() => ({
  analyseWithPerfectCorp: vi.fn(),
}));
const { readProductLabel } = vi.hoisted(() => ({
  readProductLabel: vi.fn(),
}));

vi.mock("../server/lib/crypto.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/crypto.ts")>();
  return {
    ...actual,
    // Counted pass-through: denials must never reach storage, while the
    // boundary-valid case still stores for real.
    putBlob: async (...args: [Buffer, string]) => {
      putBlobCalls.count += 1;
      return actual.putBlob(...args);
    },
  };
});
vi.mock("../server/ai/perfectcorp.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/ai/perfectcorp.ts")>();
  return { ...actual, analyseWithPerfectCorp };
});
vi.mock("../server/ai/claude.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/ai/claude.ts")>();
  return { ...actual, readProductLabel };
});

const { migrate } = await import("../server/db/index.ts");
const { recordConsentDecision } = await import("../server/db/consents.ts");
const { app } = await import("../server/app.ts");
const { createAccount, seedScan, sampleAnalysis, authHeaders } =
  await import("./helpers/two-accounts.ts");

/** Minimal JPEG: SOI + SOF0 declaring 16×16 + EOI, zero-padded to size. */
function sizedJpeg(totalBytes: number): string {
  const head = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x10, 0x01,
    0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
  return Buffer.concat([head, Buffer.alloc(totalBytes - head.length)]).toString(
    "base64",
  );
}
const tinyJpeg = sizedJpeg(17);
const textAsImage = Buffer.from(
  "these are words, not pixels, whatever the client claims",
).toString("base64");
const gifAsImage = Buffer.concat([
  Buffer.from("GIF89a", "latin1"),
  Buffer.alloc(32),
]).toString("base64");

const facialWording = LEGAL_CONTENT["facial-scan-consent"].wordingVersionId;
const photoWording = LEGAL_CONTENT["progress-photo-consent"].wordingVersionId;
const cloudEntry = CONSENT_WORDING_VERSIONS.find(
  (v) => v.consentType === CONSENT_KEYS.CLOUD_REASONING,
)!;
const photoEntry = CONSENT_WORDING_VERSIONS.find(
  (v) => v.consentType === CONSENT_KEYS.PROGRESS_PHOTOS,
)!;
const cloudStatusBefore = cloudEntry.status;
const photoStatusBefore = photoEntry.status;

let server: Server | undefined;
let base: string;
let faceUser: FixtureAccount;
let bareUser: FixtureAccount;
let photoUser: FixtureAccount;
let photoScanId: string;
let bareScanId: string;
let labelUser: FixtureAccount;

async function grant(
  userId: string,
  consentType: string,
  wordingVersionId: string,
) {
  await recordConsentDecision(
    userId,
    consentType,
    wordingVersionId,
    "granted",
    {
      idempotencyKey: `p1t05-${consentType}-${userId}`,
      actorType: "account",
      actorId: userId,
      source: "fixture",
    },
  );
}

beforeAll(async () => {
  if (!configured) return;
  vi.stubEnv("EVIA_SAMPLE_DEMO", "1");
  vi.stubEnv("ANALYSIS_PROVIDER", "perfectcorp");
  vi.stubEnv("PERFECTCORP_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ELOHIM_BLOB_KEY", "a".repeat(64));
  // Both wordings ship as placeholders; approve them in-memory so granted
  // decisions count as approved consent for exactly this file's lifetime.
  cloudEntry.status = "approved";
  photoEntry.status = "approved";
  analyseWithPerfectCorp.mockResolvedValue({ hydration: 60 });
  readProductLabel.mockResolvedValue({
    ingredients: ["aqua"],
    rawText: "aqua",
    confidence: 0.9,
  });

  await migrate();
  faceUser = await createAccount("p1t05-face");
  bareUser = await createAccount("p1t05-bare");
  photoUser = await createAccount("p1t05-photo");
  labelUser = await createAccount("p1t05-label");
  await grant(faceUser.userId, CONSENT_KEYS.FACIAL_SCAN, facialWording);
  await grant(photoUser.userId, CONSENT_KEYS.PROGRESS_PHOTOS, photoWording);
  await grant(
    labelUser.userId,
    CONSENT_KEYS.CLOUD_REASONING,
    "cloud-reasoning-v1",
  );
  photoScanId = (await seedScan(photoUser.userId)).id!;
  bareScanId = (await seedScan(bareUser.userId)).id!;

  const listener = createServer(app);
  server = listener;
  await new Promise<void>((resolve) =>
    listener.listen(0, "127.0.0.1", resolve),
  );
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("no listener");
  base = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  cloudEntry.status = cloudStatusBefore;
  photoEntry.status = photoStatusBefore;
  vi.unstubAllEnvs();
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
});

const post = (path: string, body: unknown, token?: string) =>
  fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? authHeaders(token) : {}),
    },
    body: JSON.stringify(body),
  });

describe.skipIf(!configured)("face scan input boundary", () => {
  it("rejects anonymous uploads with 401 and touches no provider", async () => {
    const before = analyseWithPerfectCorp.mock.calls.length;
    expect(
      (await post("/api/analysis/face", { imageBase64: tinyJpeg })).status,
    ).toBe(401);
    expect(analyseWithPerfectCorp.mock.calls.length).toBe(before);
  });

  it("denies consent refusal with 403 before decoding garbage", async () => {
    // '!!!' is not even base64: a 403 (not 400) proves consent ran first and
    // nothing was decoded, let alone sent anywhere.
    const before = analyseWithPerfectCorp.mock.calls.length;
    const res = await post(
      "/api/analysis/face",
      { imageBase64: "!!!" },
      bareUser.token,
    );
    expect(res.status).toBe(403);
    expect(analyseWithPerfectCorp.mock.calls.length).toBe(before);
  });

  it("rejects malformed base64 with 400 and calls no provider", async () => {
    const before = analyseWithPerfectCorp.mock.calls.length;
    expect(
      (
        await post(
          "/api/analysis/face",
          { imageBase64: "!!!not-base64!!!" },
          faceUser.token,
        )
      ).status,
    ).toBe(400);
    expect(analyseWithPerfectCorp.mock.calls.length).toBe(before);
  });

  it("rejects text mislabeled as an image with 400", async () => {
    const before = analyseWithPerfectCorp.mock.calls.length;
    expect(
      (
        await post(
          "/api/analysis/face",
          { imageBase64: textAsImage },
          faceUser.token,
        )
      ).status,
    ).toBe(400);
    expect(analyseWithPerfectCorp.mock.calls.length).toBe(before);
  });

  it("rejects genuine GIF bytes with 415", async () => {
    const before = analyseWithPerfectCorp.mock.calls.length;
    expect(
      (
        await post(
          "/api/analysis/face",
          { imageBase64: gifAsImage },
          faceUser.token,
        )
      ).status,
    ).toBe(415);
    expect(analyseWithPerfectCorp.mock.calls.length).toBe(before);
  });

  it("rejects 1 byte over the face ceiling with 413", async () => {
    const before = analyseWithPerfectCorp.mock.calls.length;
    const payload = sizedJpeg(IMAGE_INPUT_LIMITS.face.maxDecodedBytes + 1);
    expect(
      (
        await post(
          "/api/analysis/face",
          { imageBase64: payload },
          faceUser.token,
        )
      ).status,
    ).toBe(413);
    expect(analyseWithPerfectCorp.mock.calls.length).toBe(before);
  });

  it("analyses a valid capture once, with no-store and no retained bytes", async () => {
    const before = analyseWithPerfectCorp.mock.calls.length;
    const res = await post(
      "/api/analysis/face",
      { imageBase64: tinyJpeg },
      faceUser.token,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).provider).toBe("perfectcorp");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(analyseWithPerfectCorp.mock.calls.length).toBe(before + 1);
  });
});

describe.skipIf(!configured)("progress-photo input boundary", () => {
  it("denies consent refusal with 403 and stores nothing", async () => {
    const before = putBlobCalls.count;
    const res = await post(
      `/api/scans/${bareScanId}/progress-photo`,
      { imageBase64: "!!!" },
      bareUser.token,
    );
    expect(res.status).toBe(403);
    expect(putBlobCalls.count).toBe(before);
  });

  it("rejects malformed bytes with 400 and stores nothing", async () => {
    const before = putBlobCalls.count;
    const res = await post(
      `/api/scans/${photoScanId}/progress-photo`,
      { imageBase64: textAsImage },
      photoUser.token,
    );
    expect(res.status).toBe(400);
    expect(putBlobCalls.count).toBe(before);
  });

  it("stores a boundary-valid capture exactly at the progress ceiling", async () => {
    const freshScanId = (await seedScan(photoUser.userId)).id!;
    const before = putBlobCalls.count;
    const payload = sizedJpeg(IMAGE_INPUT_LIMITS.progress.maxDecodedBytes);
    const res = await post(
      `/api/scans/${freshScanId}/progress-photo`,
      { imageBase64: payload },
      photoUser.token,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).photo).toBeTruthy();
    expect(putBlobCalls.count).toBe(before + 1);
  });
});

describe.skipIf(!configured)("label-read input boundary", () => {
  it("denies consent refusal with 403 and reads nothing", async () => {
    const before = readProductLabel.mock.calls.length;
    const res = await post(
      "/api/products/read-label",
      { imageBase64: "!!!" },
      bareUser.token,
    );
    expect(res.status).toBe(403);
    expect(readProductLabel.mock.calls.length).toBe(before);
  });

  it("rejects 1 byte over the label ceiling with 413", async () => {
    const before = readProductLabel.mock.calls.length;
    const payload = sizedJpeg(IMAGE_INPUT_LIMITS.label.maxDecodedBytes + 1);
    expect(
      (
        await post(
          "/api/products/read-label",
          { imageBase64: payload },
          labelUser.token,
        )
      ).status,
    ).toBe(413);
    expect(readProductLabel.mock.calls.length).toBe(before);
  });

  it("reads a valid label once, forwarding the validated bytes", async () => {
    const before = readProductLabel.mock.calls.length;
    const res = await post(
      "/api/products/read-label",
      { imageBase64: tinyJpeg },
      labelUser.token,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ingredients).toEqual(["aqua"]);
    expect(readProductLabel.mock.calls.length).toBe(before + 1);
    expect(readProductLabel.mock.calls[before][0]).toBe(tinyJpeg);
  });
});

describe.skipIf(!configured)("structured scans ride the small body", () => {
  it("rejects a 70kb structured reading with 413 at the transport ceiling", async () => {
    const analysis = { ...sampleAnalysis(), notes: "x".repeat(70_000) };
    const res = await post("/api/scans", { analysis }, faceUser.token);
    expect(res.status).toBe(413);
  });

  it("still stores an ordinary structured reading under the small body", async () => {
    const res = await post(
      "/api/scans",
      { analysis: sampleAnalysis() },
      faceUser.token,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).scan).toBeTruthy();
  });
});
