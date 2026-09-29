/**
 * P0-T02 — two-account HTTP ownership boundaries.
 *
 * A cannot read/delete B's scan, image, memory or usage; anonymous requests
 * fail; consent denial causes zero provider calls. Exercises the real HTTP
 * boundary (real requireAuth + real routers + real disposable DB from
 * `npm run test:local`) with only rate limiters, provider egress and blob
 * bytes stubbed — and every stub counts its calls.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { LEGAL_CONTENT } from "../shared/legal-content.ts";
import type { FixtureAccount } from "./helpers/two-accounts.ts";

// Same convention as body-store.test.ts: this file needs a real database, so
// it only runs under `npm run test:local` (which injects a disposable PGlite
// URL). A bare `vitest run` skips loudly instead of failing opaquely.
const configured = (process.env.NETLIFY_DATABASE_URL ?? "").length > 0;
if (!configured) {
  console.warn(
    "[ownership-boundaries] NETLIFY_DATABASE_URL is not set — database tests did not run (use `npm run test:local`).",
  );
}

const providerCalls = vi.hoisted(() => ({ analyse: 0, blobs: 0 }));
const { analyseWithPerfectCorp } = vi.hoisted(() => ({
  analyseWithPerfectCorp: vi.fn(),
}));

vi.mock("../server/lib/rate-limit.ts", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    loginLimiter: pass,
    registerLimiter: pass,
    chatLimiter: pass,
    visionLimiter: pass,
    voiceLimiter: pass,
    guestVoiceLimiter: pass,
    scanLimiter: pass,
  };
});
vi.mock("../server/ai/perfectcorp.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/ai/perfectcorp.ts")>();
  return {
    ...actual,
    analyseWithPerfectCorp: analyseWithPerfectCorp,
  };
});
vi.mock("../server/lib/crypto.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/crypto.ts")>();
  return {
    ...actual,
    getBlob: async (...args: unknown[]) => {
      providerCalls.blobs += 1;
      void args;
      return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    },
  };
});

const { migrate } = await import("../server/db/index.ts");
const { analysisRouter } = await import("../server/routes/analysis.ts");
const { apiRouter } = await import("../server/routes/api.ts");
const {
  createAccount,
  seedScan,
  seedMemoryWithKey,
  seedProductUsage,
  seedProgressPhoto,
  authHeaders,
} = await import("./helpers/two-accounts.ts");

let server: Server | undefined;
let base: string;
let a: FixtureAccount;
let b: FixtureAccount;
let c: FixtureAccount;
let aScanId: string;
let aPhotoId: string;
let aMemoryId: string;
let aUsageId: string;
const facialWording = LEGAL_CONTENT["facial-scan-consent"].wordingVersionId;
const jpeg = Buffer.from([255, 216, 255, 217]).toString("base64");

beforeAll(async () => {
  if (!configured) return;
  vi.stubEnv("EVIA_SAMPLE_DEMO", "1");
  vi.stubEnv("ANALYSIS_PROVIDER", "perfectcorp");
  vi.stubEnv("PERFECTCORP_API_KEY", "test-key");
  analyseWithPerfectCorp.mockImplementation(async () => {
    providerCalls.analyse += 1;
    return { hydration: 60 };
  });

  await migrate();
  a = await createAccount("owner-a");
  b = await createAccount("owner-b");
  c = await createAccount("consent-c");

  const scan = await seedScan(a.userId);
  aScanId = scan.id!;
  await seedScan(b.userId);
  await seedMemoryWithKey(a.userId, "a-memory");
  await seedMemoryWithKey(b.userId, "b-memory");
  const chat = await import("../server/db/chat.ts");
  const aMemories = await chat.listMemories(a.userId);
  aMemoryId = aMemories.find((m) => m.key === "a-memory")!.id;
  const seeded = await seedProductUsage(a.userId, "a");
  aUsageId = seeded.usageId;
  await seedProductUsage(b.userId, "b");
  const photo = await seedProgressPhoto(a.userId, aScanId);
  aPhotoId = photo.id;

  const app = express();
  app.use(express.json());
  app.use("/api/analysis", analysisRouter);
  app.use("/api", apiRouter);
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
  vi.unstubAllEnvs();
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
});

const get = (path: string, token?: string) =>
  fetch(base + path, { headers: token ? authHeaders(token) : {} });
const del = (path: string, token?: string) =>
  fetch(base + path, {
    method: "DELETE",
    headers: token ? authHeaders(token) : {},
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

describe.skipIf(!configured)("ownership boundaries", () => {
  it("rejects anonymous requests without touching providers or storage", async () => {
    const beforeAnalyse = providerCalls.analyse;
    const beforeBlobs = providerCalls.blobs;
    expect((await get("/api/scans")).status).toBe(401);
    expect((await get("/api/memories")).status).toBe(401);
    expect((await get(`/api/scans/${aScanId}`)).status).toBe(401);
    expect(
      (await post("/api/analysis/face", { imageBase64: jpeg })).status,
    ).toBe(401);
    expect(providerCalls.analyse).toBe(beforeAnalyse);
    expect(providerCalls.blobs).toBe(beforeBlobs);
  });

  it("stops B reading or deleting A's scan while A's copy survives", async () => {
    expect((await get(`/api/scans/${aScanId}`, b.token)).status).toBe(404);
    // DELETE is an owner-scoped no-op for non-owners (200 with ok:true) — the
    // ownership proof is that A's row survives, not a 404 status.
    expect((await del(`/api/scans/${aScanId}`, b.token)).status).toBe(200);
    const res = await get(`/api/scans/${aScanId}`, a.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scan?: { id?: string } };
    expect(body.scan?.id).toBe(aScanId);
  });

  it("stops B reading A's progress-photo image while A can", async () => {
    expect(
      (await get(`/api/progress-photos/${aPhotoId}/image`, b.token)).status,
    ).toBe(404);
    const res = await get(`/api/progress-photos/${aPhotoId}/image`, a.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/jpeg");
  });

  it("stops B from removing or seeing A's memory", async () => {
    await del(`/api/memories/${aMemoryId}`, b.token);
    const aList = (
      (await (await get("/api/memories", a.token)).json()) as {
        memories: { id: string }[];
      }
    ).memories;
    expect(aList.map((m) => m.id)).toContain(aMemoryId);
    const bList = (
      (await (await get("/api/memories", b.token)).json()) as {
        memories: { id: string }[];
      }
    ).memories;
    expect(bList.map((m) => m.id)).not.toContain(aMemoryId);
  });

  it("scopes product usage to the owner on read and end", async () => {
    const bRoutine = (
      (await (await get("/api/routine", b.token)).json()) as {
        usage: { id: string }[];
      }
    ).usage;
    expect(bRoutine.map((u) => u.id)).not.toContain(aUsageId);
    await del(`/api/routine/${aUsageId}`, b.token);
    const aRoutine = (
      (await (await get("/api/routine", a.token)).json()) as {
        usage: { id: string }[];
      }
    ).usage;
    expect(aRoutine.map((u) => u.id)).toContain(aUsageId);
  });

  it("causes zero provider calls on consent denial and exactly one after grant", async () => {
    const denied = await post(
      "/api/analysis/face",
      { imageBase64: jpeg },
      c.token,
    );
    expect(denied.status).toBe(403);
    expect(providerCalls.analyse).toBe(0);

    const grant = await post(
      "/api/analysis/consent",
      {
        choice: "accepted",
        wordingVersionId: facialWording,
        idempotencyKey: `p0t02-${Date.now()}`,
      },
      c.token,
    );
    expect(grant.status).toBe(201);

    const allowed = await post(
      "/api/analysis/face",
      { imageBase64: jpeg },
      c.token,
    );
    expect(allowed.status).toBe(200);
    expect(providerCalls.analyse).toBe(1);
  });
});
