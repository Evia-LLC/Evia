/**
 * P1-T06 — structured writes are validated and consent evidence is
 * server-owned.
 *
 * Real HTTP boundary (real requireAuth + real routers + real disposable DB
 * from `npm run test:local`) with only rate limiters and provider egress
 * stubbed — and every stub counts its calls. Each malformed class answers 400
 * with zero writes (per-user row counts unchanged); forged consent metadata
 * is attributed to the caller with spoofed values absent; valid payloads keep
 * working. Synthetic data only.
 *
 * Skipped — loudly — when nothing is configured. A test that quietly passes
 * with no database is worse than one that never ran.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { FixtureAccount } from "./helpers/two-accounts.ts";

const configured = (process.env.NETLIFY_DATABASE_URL ?? "").length > 0;
if (!configured) {
  console.warn(
    "[request-validation] NETLIFY_DATABASE_URL is not set — database tests did not run (use `npm run test:local`).",
  );
}

const providerCalls = vi.hoisted(() => ({ analyse: 0, labels: 0 }));
const { analyseWithPerfectCorp } = vi.hoisted(() => ({
  analyseWithPerfectCorp: vi.fn(),
}));
const { readProductLabel } = vi.hoisted(() => ({
  readProductLabel: vi.fn(),
}));

vi.mock("../server/lib/rate-limit.ts", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    rateLimit: () => pass,
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
  return { ...actual, analyseWithPerfectCorp };
});
vi.mock("../server/ai/claude.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/ai/claude.ts")>();
  return { ...actual, readProductLabel };
});

const { migrate } = await import("../server/db/index.ts");
const { app } = await import("../server/app.ts");
const users = await import("../server/db/users.ts");
const scansRepo = await import("../server/db/scans.ts");
const productsRepo = await import("../server/db/products.ts");
const consentsRepo = await import("../server/db/consents.ts");
const { CONSENT_WORDING_VERSIONS } = await import("../shared/legal-content.ts");
const { createAccount, sampleAnalysis, authHeaders } =
  await import("./helpers/two-accounts.ts");

let server: Server | undefined;
let base: string;
let a: FixtureAccount;
let b: FixtureAccount;

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const photoWording = CONSENT_WORDING_VERSIONS.find(
  (v) => v.consentType === "progress_photos",
)!;
const photoStatusBefore = photoWording.status;

const patch = (path: string, body: unknown, token: string) =>
  fetch(base + path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body),
  });
const post = (path: string, body: unknown, token: string) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body),
  });

async function counts(userId: string) {
  const [scans, owned, usage, history, profile, preferences] =
    await Promise.all([
      scansRepo.listScans(userId, 100),
      productsRepo.listOwnedProducts(userId),
      productsRepo.listUsage(userId),
      consentsRepo.consentHistory(userId),
      users.getProfile(userId),
      users.getPreferences(userId),
    ]);
  return {
    scans: scans.length,
    owned: owned.length,
    usage: usage.length,
    consents: history.length,
    profile: JSON.stringify(profile),
    preferences: JSON.stringify(preferences),
  };
}

function futureIso() {
  return new Date(Date.now() + 24 * 3600_000).toISOString();
}

beforeAll(async () => {
  if (!configured) return;
  analyseWithPerfectCorp.mockImplementation(async () => {
    providerCalls.analyse += 1;
    return { hydration: 60 };
  });
  readProductLabel.mockImplementation(async () => {
    providerCalls.labels += 1;
    return { ingredients: ["aqua"] };
  });
  await migrate();
  a = await createAccount("reqval-a");
  b = await createAccount("reqval-b");
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
  photoWording.status = photoStatusBefore;
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
});

describe.skipIf(!configured)(
  "profile validation rejects malformed writes",
  () => {
    it("rejects an unknown skinType enum with zero writes", async () => {
      const before = await counts(a.userId);
      const res = await patch(
        "/api/me/profile",
        { skinType: "crystalline" },
        a.token,
      );
      expect(res.status).toBe(400);
      expect(await counts(a.userId)).toEqual(before);
    });

    it("rejects objects inside concerns with zero writes", async () => {
      const before = await counts(a.userId);
      const res = await patch(
        "/api/me/profile",
        { concerns: ["acne", { ingredient: "retinol" }] },
        a.token,
      );
      expect(res.status).toBe(400);
      expect(await counts(a.userId)).toEqual(before);
    });

    it("rejects bad fitzpatrick values and excessive lists", async () => {
      const before = await counts(a.userId);
      expect(
        (await patch("/api/me/profile", { fitzpatrick: "III" }, a.token))
          .status,
      ).toBe(400);
      expect(
        (await patch("/api/me/profile", { fitzpatrick: 2.5 }, a.token)).status,
      ).toBe(400);
      expect(
        (await patch("/api/me/profile", { fitzpatrick: 7 }, a.token)).status,
      ).toBe(400);
      expect(
        (await patch("/api/me/profile", { pregnancyStatus: "maybe" }, a.token))
          .status,
      ).toBe(400);
      expect(
        (
          await patch(
            "/api/me/profile",
            { concerns: Array(31).fill("acne") },
            a.token,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await patch(
            "/api/me/profile",
            { sensitivities: ["x".repeat(81)] },
            a.token,
          )
        ).status,
      ).toBe(400);
      expect(await counts(a.userId)).toEqual(before);
    });

    it("stores a valid profile patch", async () => {
      const res = await patch(
        "/api/me/profile",
        {
          skinType: "combination",
          fitzpatrick: 3,
          concerns: ["acne", "texture"],
          sensitivities: ["fragrance"],
          pregnancyStatus: "no",
        },
        a.token,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        profile: { skinType: string; fitzpatrick: number; concerns: string[] };
      };
      expect(body.profile.skinType).toBe("combination");
      expect(body.profile.fitzpatrick).toBe(3);
      expect(body.profile.concerns).toEqual(["acne", "texture"]);
    });
  },
);

describe.skipIf(!configured)(
  "preferences validation rejects malformed writes",
  () => {
    it("rejects bad enums/types with zero writes", async () => {
      const before = await counts(a.userId);
      expect(
        (
          await patch(
            "/api/me/preferences",
            { explanationStyle: "verbose" },
            a.token,
          )
        ).status,
      ).toBe(400);
      expect(
        (await patch("/api/me/preferences", { voiceEnabled: "yes" }, a.token))
          .status,
      ).toBe(400);
      expect(
        (await patch("/api/me/preferences", { qualityTier: "ultra" }, a.token))
          .status,
      ).toBe(400);
      expect(
        (
          await patch(
            "/api/me/preferences",
            { locale: "not a locale!" },
            a.token,
          )
        ).status,
      ).toBe(400);
      expect(await counts(a.userId)).toEqual(before);
    });

    it("stores a valid preferences patch", async () => {
      const res = await patch(
        "/api/me/preferences",
        { explanationStyle: "simple", voiceEnabled: false, locale: "en" },
        a.token,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        preferences: { explanationStyle: string; voiceEnabled: boolean };
      };
      expect(body.preferences.explanationStyle).toBe("simple");
      expect(body.preferences.voiceEnabled).toBe(false);
    });
  },
);

describe.skipIf(!configured)("scan validation rejects malformed writes", () => {
  it("rejects missing/out-of-range metrics with zero writes", async () => {
    const before = await counts(a.userId);
    expect((await post("/api/scans", {}, a.token)).status).toBe(400);
    const bad = {
      ...sampleAnalysis(),
      metrics: { ...sampleAnalysis().metrics, hydration: 101 },
    };
    expect((await post("/api/scans", { analysis: bad }, a.token)).status).toBe(
      400,
    );
    expect(await counts(a.userId)).toEqual(before);
  });

  it("rejects bad confidence, timestamps, landmarks and observations", async () => {
    const before = await counts(a.userId);
    const good = sampleAnalysis();
    expect(
      (
        await post(
          "/api/scans",
          { analysis: { ...good, confidence: 1.5 } },
          a.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/api/scans",
          { analysis: { ...good, capturedAt: futureIso() } },
          a.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/api/scans",
          { analysis: { ...good, capturedAt: "not-a-date" } },
          a.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/api/scans",
          { analysis: { ...good, landmarks: [{ x: 1 }] } },
          a.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/api/scans",
          { analysis: { ...good, observations: ["fine", { m: 1 }] } },
          a.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/api/scans",
          { analysis: { ...good, observations: Array(31).fill("x") } },
          a.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/api/scans",
          { analysis: { ...good, quality: { verdict: "superb" } } },
          a.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/api/scans",
          { analysis: { ...good, regions: { elbow: { samples: 1 } } } },
          a.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/api/scans",
          { analysis: { ...good, notes: "x".repeat(2001) } },
          a.token,
        )
      ).status,
    ).toBe(400);
    expect(await counts(a.userId)).toEqual(before);
    expect(providerCalls.analyse).toBe(0);
  });

  it("stores a valid structured reading", async () => {
    const before = (await counts(a.userId)).scans;
    const res = await post(
      "/api/scans",
      { analysis: sampleAnalysis() },
      a.token,
    );
    expect(res.status).toBe(200);
    expect((await counts(a.userId)).scans).toBe(before + 1);
  });
});

describe.skipIf(!configured)(
  "product + routine validation rejects malformed writes",
  () => {
    it("rejects malformed product inputs with zero writes", async () => {
      const before = await counts(a.userId);
      expect((await post("/api/products", {}, a.token)).status).toBe(400);
      expect(
        (await post("/api/products", { name: "x".repeat(201) }, a.token))
          .status,
      ).toBe(400);
      expect(
        (
          await post(
            "/api/products",
            { name: "Serum", ingredients: ["aqua", { x: 1 }] },
            a.token,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await post(
            "/api/products",
            { name: "Serum", ingredients: "aqua" },
            a.token,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await post(
            "/api/products",
            { name: "Serum", ingredients: Array(51).fill("aqua") },
            a.token,
          )
        ).status,
      ).toBe(400);
      expect(await counts(a.userId)).toEqual(before);
    });

    it("rejects malformed routine inputs with zero writes", async () => {
      const created = await post(
        "/api/products",
        { name: `Routine Base ${stamp()}`, ingredients: ["aqua"] },
        a.token,
      );
      expect(created.status).toBe(200);
      const productId = ((await created.json()) as { product: { id: string } })
        .product.id;
      const before = await counts(a.userId);
      expect((await post("/api/routine", {}, a.token)).status).toBe(400);
      expect(
        (
          await post(
            "/api/routine",
            { productId, frequency: "x".repeat(101) },
            a.token,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await post(
            "/api/routine",
            { productId, startedAt: "not-a-date" },
            a.token,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await post(
            "/api/routine",
            { productId, startedAt: futureIso() },
            a.token,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await post(
            "/api/routine",
            { productId, notes: "x".repeat(2001) },
            a.token,
          )
        ).status,
      ).toBe(400);
      expect(await counts(a.userId)).toEqual(before);
    });

    it("stores valid product + routine rows", async () => {
      const created = await post(
        "/api/products",
        {
          name: `Valid Serum ${stamp()}`,
          brand: "Evia Lab",
          ingredients: ["aqua", "glycerin"],
        },
        a.token,
      );
      expect(created.status).toBe(200);
      const productId = ((await created.json()) as { product: { id: string } })
        .product.id;
      const res = await post(
        "/api/routine",
        { productId, frequency: "daily", notes: "evening only" },
        a.token,
      );
      expect(res.status).toBe(200);
      const usage = await productsRepo.listUsage(a.userId);
      expect(usage.map((u) => u.product.id)).toContain(productId);
    });
  },
);

describe.skipIf(!configured)("consent evidence is server-owned", () => {
  const decisionPath = (type: string) =>
    `/api/me/consents/${encodeURIComponent(type)}/decisions`;

  it("rejects missing/oversized idempotency keys and non-object metadata with zero writes", async () => {
    const before = await counts(a.userId);
    const type = "progress_photos";
    const baseBody = {
      wordingVersionId: photoWording.id,
      state: "withdrawn",
    };
    expect(
      (await post(decisionPath(type), { ...baseBody }, a.token)).status,
    ).toBe(400);
    expect(
      (
        await post(
          decisionPath(type),
          { ...baseBody, idempotencyKey: "x".repeat(101) },
          a.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          decisionPath(type),
          { ...baseBody, idempotencyKey: `k-${stamp()}`, metadata: "forged" },
          a.token,
        )
      ).status,
    ).toBe(400);
    expect(await counts(a.userId)).toEqual(before);
  });

  it("attributes forged metadata to the caller and drops spoofed values", async () => {
    const res = await post(
      decisionPath("progress_photos"),
      {
        wordingVersionId: photoWording.id,
        state: "withdrawn",
        idempotencyKey: `forge-${stamp()}`,
        metadata: {
          actorId: b.userId,
          actorType: "admin",
          source: "fake-source",
          ip: "1.2.3.4",
          choice: "declined",
          injected: "nope",
        },
      },
      a.token,
    );
    expect(res.status).toBe(201);
    const history = await consentsRepo.consentHistory(
      a.userId,
      "progress_photos",
    );
    const latest = history[0];
    expect(latest.actorId).toBe(a.userId);
    expect(latest.actorType).toBe("account");
    expect(latest.metadata?.["choice"]).toBe("declined");
    expect(latest.metadata).not.toMatchObject({ actorId: b.userId });
    expect(latest.metadata?.["actorType"]).toBeUndefined();
    expect(latest.metadata?.["source"]).toBe("consent-decision");
    expect(latest.metadata?.["injected"]).toBeUndefined();
    // The spoofed identity must not leak into B's history either.
    const bHistory = await consentsRepo.consentHistory(
      b.userId,
      "progress_photos",
    );
    expect(bHistory.map((d) => d.id)).not.toContain(latest.id);
  });

  it("records a valid decision and resolves history for the caller", async () => {
    const before = (await counts(a.userId)).consents;
    const res = await post(
      decisionPath("progress_photos"),
      {
        wordingVersionId: photoWording.id,
        state: "withdrawn",
        idempotencyKey: `valid-${stamp()}`,
        metadata: { choice: "declined" },
      },
      a.token,
    );
    expect(res.status).toBe(201);
    expect((await counts(a.userId)).consents).toBe(before + 1);
    const viaHttp = (await (
      await fetch(base + "/api/me/consents/history?type=progress_photos", {
        headers: authHeaders(a.token),
      })
    ).json()) as { decisions: { actorId: string }[] };
    expect(viaHttp.decisions[0]?.actorId).toBe(a.userId);
  });

  it("records a granted decision once its wording is approved", async () => {
    photoWording.status = "approved";
    try {
      const res = await post(
        decisionPath("progress_photos"),
        {
          wordingVersionId: photoWording.id,
          state: "granted",
          idempotencyKey: `grant-${stamp()}`,
        },
        a.token,
      );
      expect(res.status).toBe(201);
    } finally {
      photoWording.status = photoStatusBefore;
    }
  });
});
