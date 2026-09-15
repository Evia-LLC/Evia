/**
 * Routes with no account behind them.
 *
 * A guest has no session, so nothing here reads or writes anything of theirs.
 * What they can get is what a shop window gives anyone: what is on the shelf,
 * and — given the nine numbers their own device just measured — which of it
 * would suit them. The numbers arrive in the request, are checked, are used
 * for one answer, and are gone.
 */
import { asyncRouter } from '../lib/async-router.ts';
import { rateLimit } from '../lib/rate-limit.ts';
import { buildRoutinePlan } from '../skin/recommend.ts';
import { pickProducts } from '../catalogue/picks.ts';
import { catalogueStatus } from '../catalogue/store.ts';
import {
  PREGNANCY_STATUSES,
  SKIN_METRIC_KEYS,
  type PregnancyStatus,
  type SkinAppearanceMetrics,
  type SkinProfile,
} from '../../shared/types.ts';

export const publicRouter = asyncRouter();

const picksLimiter = rateLimit({
  name: 'public-picks',
  max: 30,
  windowMs: 10 * 60_000,
  keyOf: (req) => req.ip ?? 'unknown',
  message: 'That is a lot of looking. Give it a few minutes.',
});

publicRouter.get('/catalogue/status', async (_req, res) => {
  res.json({ status: await catalogueStatus() });
});

/** Rebuilds a profile from untrusted JSON, keeping only what is known. */
function guestProfile(raw: unknown): SkinProfile {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 40)).slice(0, 12) : [];
  const skinType = ['dry', 'oily', 'combination', 'normal', 'sensitive'].includes(String(p.skinType))
    ? (p.skinType as SkinProfile['skinType'])
    : 'unknown';
  const pregnancyStatus = PREGNANCY_STATUSES.includes(p.pregnancyStatus as PregnancyStatus)
    ? (p.pregnancyStatus as PregnancyStatus)
    : 'unknown';
  return {
    skinType,
    fitzpatrick: null,
    concerns: strings(p.concerns),
    sensitivities: strings(p.sensitivities),
    pregnancyStatus,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Picks for a reading that was never stored.
 *
 * The plan is built the same way it is for an account, from the same rules,
 * against the same shelf. The only difference is where the numbers came from.
 */
publicRouter.post('/picks', picksLimiter, async (req, res) => {
  const raw = req.body?.metrics as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') {
    res.status(400).json({ error: 'Metrics are required.' });
    return;
  }
  const metrics = {} as SkinAppearanceMetrics;
  for (const key of SKIN_METRIC_KEYS) {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
      res.status(400).json({ error: `Metric ${key} is missing or out of range.` });
      return;
    }
    metrics[key] = v;
  }
  const confidence =
    typeof req.body?.confidence === 'number' ? Math.max(0, Math.min(1, req.body.confidence)) : 1;
  const plan = buildRoutinePlan(metrics, guestProfile(req.body?.profile), [], confidence);
  const picks = await pickProducts(plan, guestProfile(req.body?.profile), { web: true });
  res.json({ plan, picks });
});
