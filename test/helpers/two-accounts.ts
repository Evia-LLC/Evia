/**
 * P0-T02 — reusable two-account HTTP fixtures.
 *
 * Isolated A/B users with sessions plus seeded scans, memories, products,
 * usage and progress photos. Uses the real repositories against whatever
 * `npm run test:local` provides (disposable PGlite); never touches prod DB
 * URLs. Provider calls are stubbed by the *test file* with request counters
 * (see ownership-boundaries.test.ts) — this helper only seeds data.
 */
import * as users from "../../server/db/users.ts";
import * as scansRepo from "../../server/db/scans.ts";
import * as chat from "../../server/db/chat.ts";
import * as productsRepo from "../../server/db/products.ts";
import * as progressPhotos from "../../server/db/progress-photos.ts";
import type { SkinAnalysis } from "../../shared/types.ts";

export interface FixtureAccount {
  userId: string;
  token: string;
  email: string;
}

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function createAccount(tag: string): Promise<FixtureAccount> {
  const email = `${tag}-${stamp()}@test.local`;
  const userId = await users.createUser(email, "Password123!", tag);
  const token = await users.createSession(userId);
  return { userId, token, email };
}

export const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

export function sampleAnalysis(): SkinAnalysis {
  return {
    capturedAt: new Date().toISOString(),
    metrics: {
      hydration: 50,
      evenness: 50,
      oiliness: 50,
      redness: 50,
      texture: 50,
      pores: 50,
      darkSpots: 50,
      underEye: 50,
      acneIndicators: 50,
    },
    regions: {},
    quality: {
      verdict: "pass",
      score: 0.9,
      brightness: 0.8,
      sharpness: 0.8,
      faceHeightFraction: 0.5,
      centeringError: 0.05,
      issues: [],
    },
    confidence: 0.9,
    modelVersion: "fixture-v1",
  };
}

export async function seedScan(userId: string): Promise<SkinAnalysis> {
  return scansRepo.insertScan(userId, sampleAnalysis());
}

export async function seedMemory(
  userId: string,
  key = `k-${stamp()}`,
): Promise<void> {
  await chat.upsertMemory(userId, {
    kind: "preference",
    key,
    value: `v-${stamp()}`,
    confidence: 0.9,
  });
}

export async function seedMemoryWithKey(
  userId: string,
  key: string,
): Promise<void> {
  await chat.upsertMemory(userId, {
    kind: "preference",
    key,
    value: "a-value",
    confidence: 0.9,
  });
}

export async function seedProductUsage(userId: string, tag: string) {
  const product = await productsRepo.upsertProduct({
    name: `Fixture Product ${tag} ${stamp()}`,
    brand: `Brand ${stamp()}`,
    ingredients: ["aqua"],
    source: "user",
  });
  const usageId = await productsRepo.startUsage(userId, product.id, {});
  return { product, usageId };
}

export async function seedProgressPhoto(userId: string, scanId: string) {
  // progress_photos.consent_event_id is a real FK to consent_events — record a
  // granted decision first rather than inventing an ID.
  const { recordConsentDecision } = await import("../../server/db/consents.ts");
  const { CONSENT_KEYS } = await import("../../shared/consent-keys.ts");
  const { LEGAL_CONTENT } = await import("../../shared/legal-content.ts");
  const decision = await recordConsentDecision(
    userId,
    CONSENT_KEYS.PROGRESS_PHOTOS,
    LEGAL_CONTENT["progress-photo-consent"].wordingVersionId,
    "granted",
    {
      idempotencyKey: `fixture-photo-consent-${stamp()}`,
      actorType: "account",
      actorId: userId,
      source: "fixture",
    },
  );
  const { photo } = await progressPhotos.createProgressPhoto(userId, {
    skinScanId: scanId,
    blobRef: `test-blob-${stamp()}`,
    capturedAt: new Date().toISOString(),
    consentEventId: decision.id,
  });
  return photo;
}
