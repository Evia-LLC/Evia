/**
 * Demo mode (brief §34).
 *
 * Seeds one account with a plausible scan history so the full loop —
 * conversation, clinical transition, analysis, holograms, explanation, progress
 * comparison — can be exercised without scanning a real face on every reload.
 *
 * These numbers are development fixtures and are labelled as such on every scan
 * (`notes`) and in the UI. Nothing here ever runs for a real account.
 */
import { row } from '../db/index.ts';
import * as users from '../db/users.ts';
import * as scansRepo from '../db/scans.ts';
import * as productsRepo from '../db/products.ts';
import { SKIN_MODEL_VERSION, type SkinAnalysis } from '../../shared/types.ts';
import { log } from '../lib/log.ts';

const DEMO_EMAIL = 'demo@evia.local';
const DEMO_PASSWORD = 'demo1234';

/**
 * Six scans across ten weeks. Hydration climbs, texture and acne ease off,
 * redness dips then rebounds — a history with enough shape that the trend
 * engine, the noise floor and the correlation reporting all have something real
 * to chew on.
 */
const TRACK: Array<{ daysAgo: number; m: Record<string, number>; quality: number }> = [
  { daysAgo: 70, m: { hydration: 48, oiliness: 78, redness: 52, texture: 76, pores: 68, darkSpots: 63, evenness: 38, underEye: 55, acneIndicators: 70 }, quality: 0.82 },
  { daysAgo: 56, m: { hydration: 51, oiliness: 76, redness: 55, texture: 74, pores: 66, darkSpots: 62, evenness: 40, underEye: 54, acneIndicators: 67 }, quality: 0.71 },
  { daysAgo: 42, m: { hydration: 56, oiliness: 72, redness: 47, texture: 70, pores: 63, darkSpots: 59, evenness: 44, underEye: 52, acneIndicators: 62 }, quality: 0.88 },
  { daysAgo: 28, m: { hydration: 59, oiliness: 69, redness: 44, texture: 67, pores: 60, darkSpots: 57, evenness: 47, underEye: 50, acneIndicators: 58 }, quality: 0.85 },
  { daysAgo: 14, m: { hydration: 62, oiliness: 66, redness: 40, texture: 63, pores: 57, darkSpots: 54, evenness: 50, underEye: 48, acneIndicators: 54 }, quality: 0.9 },
  { daysAgo: 2, m: { hydration: 64, oiliness: 64, redness: 41, texture: 61, pores: 55, darkSpots: 52, evenness: 52, underEye: 46, acneIndicators: 51 }, quality: 0.87 },
];

export async function seedDemoUser(): Promise<{ email: string; password: string } | null> {
  const existing = await row<{ id: string }>(
    'SELECT id FROM users WHERE email = ?',
    DEMO_EMAIL,
  );

  if (existing) return { email: DEMO_EMAIL, password: DEMO_PASSWORD };

  let userId: string;
  try {
    userId = await users.createUser(DEMO_EMAIL, DEMO_PASSWORD, 'Ada');
  } catch (err) {
    log.error('demo', 'could not seed demo user', { error: (err as Error).message });
    return null;
  }

  await users.updateProfile(userId, {
    skinType: 'combination',
    fitzpatrick: 5,
    concerns: ['acne', 'texture', 'dark spots'],
    sensitivities: ['fragrance'],
  });

  for (const point of TRACK) {
    const capturedAt = new Date(Date.now() - point.daysAgo * 86_400_000).toISOString();
    const analysis: SkinAnalysis = {
      capturedAt,
      metrics: point.m as SkinAnalysis['metrics'],
      regions: {},
      quality: {
        verdict: point.quality >= 0.8 ? 'pass' : 'warn',
        score: point.quality,
        brightness: 0.52,
        sharpness: 0.6,
        faceHeightFraction: 0.44,
        centeringError: 0.05,
        issues: point.quality >= 0.8 ? [] : ['lighting was a little uneven'],
      },
      confidence: point.quality,
      modelVersion: SKIN_MODEL_VERSION,
      notes: 'DEMO FIXTURE — not a real capture.',
    };
    await scansRepo.insertScan(userId, analysis);
  }

  // A product whose usage window overlaps the improving stretch, so the
  // correlation reporting has something to describe — and something to refuse
  // to call causation.
  const serum = await productsRepo.upsertProduct({
    name: 'Niacinamide 10% + Zinc',
    brand: 'The Ordinary',
    category: 'serum',
    ingredients: ['Niacinamide', 'Zinc PCA', 'Glycerin', 'Pentylene Glycol'],
    source: 'catalogue',
  });
  await productsRepo.startUsage(userId, serum.id, {
    startedAt: new Date(Date.now() - 45 * 86_400_000).toISOString(),
    frequency: 'nightly',
  });

  const spf = await productsRepo.upsertProduct({
    name: 'Ultra Light Daily Fluid SPF50',
    brand: 'Generic',
    category: 'spf',
    ingredients: ['Zinc Oxide', 'Octocrylene', 'Glycerin', 'Squalane'],
    source: 'catalogue',
  });
  await productsRepo.startUsage(userId, spf.id, {
    startedAt: new Date(Date.now() - 80 * 86_400_000).toISOString(),
    frequency: 'every morning',
  });

  log.info('demo', 'seeded demo user with 6 scans and 2 routine products');
  return { email: DEMO_EMAIL, password: DEMO_PASSWORD };
}

export { DEMO_EMAIL, DEMO_PASSWORD };
