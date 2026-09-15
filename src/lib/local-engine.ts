/**
 * Elohim, without a server.
 *
 * A guest has no account and, on a deployment with nothing attached, no
 * server that can answer at all. She used to fall silent - the one thing this
 * product must never do, because a consultant who cannot speak is a picture.
 *
 * The local engine the server falls back to when it has no model key is
 * plain TypeScript over the shared types: it reads a profile, the latest scan
 * and the trend summary and writes a turn. Nothing in it needs a process. So
 * it runs here, in the browser, over the same in-memory scans a guest already
 * has, and every number it says is one the device just measured. It is the
 * same engine and it is labelled the same way: Demo Elohim, local engine.
 */
import { classifyLocally } from '../../shared/classify-local.ts';
import { respond, respondToEvent } from '../../server/ai/fallback.ts';
import type { ElohimContext } from '../../server/ai/context.ts';
import { session } from '@/state/session.svelte.ts';
import {
  METRIC_HIGHER_IS_BETTER,
  METRIC_NOISE_FLOOR,
  SKIN_METRIC_KEYS,
  type BodySnapshot,
  type ElohimTurn,
  type LongitudinalSummary,
  type MetricTrend,
  type ProductPick,
  type SkinAnalysis,
} from '@shared/types.ts';

/**
 * A trend summary from whatever scans the tab holds.
 *
 * The server's longitudinal engine does more - slopes, product overlap,
 * headlines. This does the part a conversation needs: where each reading is,
 * where it was, whether the difference clears the noise floor.
 */
function guestSummary(scans: SkinAnalysis[]): LongitudinalSummary {
  const latest = scans[0] ?? null;
  const version = latest?.modelVersion;
  const same = scans.filter((s) => s.modelVersion === version);
  const previous = same[1] ?? null;
  const first = same[same.length - 1] ?? null;
  const trends: MetricTrend[] = latest
    ? SKIN_METRIC_KEYS.map((key) => {
        const current = latest.metrics[key];
        const prev = previous ? previous.metrics[key] : null;
        const start = first ? first.metrics[key] : null;
        const delta = prev === null ? null : current - prev;
        const significant = delta !== null && Math.abs(delta) >= METRIC_NOISE_FLOOR[key];
        const better = delta !== null && (METRIC_HIGHER_IS_BETTER[key] ? delta > 0 : delta < 0);
        return {
          key,
          current,
          previous: prev,
          first: start,
          deltaFromPrevious: delta,
          deltaFromFirst: start === null ? null : current - start,
          slopePerWeek: null,
          significant,
          direction: !significant ? 'steady' : better ? 'improving' : 'declining',
        };
      })
    : [];
  const days =
    first && latest
      ? Math.max(
          1,
          Math.round(
            (new Date(latest.capturedAt).getTime() - new Date(first.capturedAt).getTime()) / 86_400_000,
          ),
        )
      : 0;
  return {
    scanCount: same.length,
    windowDays: days,
    trends,
    correlations: [],
    mixedModelVersions: same.length !== scans.length,
    headline: null,
  };
}

function guestContext(body?: BodySnapshot, picks: ProductPick[] = []): ElohimContext {
  const user = session.user;
  if (!user) throw new Error('No guest to speak to.');
  return {
    user,
    latest: session.latestScan,
    summary: guestSummary(session.scans),
    block: '',
    picks,
    ...(body ? { body } : {}),
  };
}

/** A reply to something the guest typed. */
export function guestTurn(message: string): ElohimTurn {
  /*
   * The recent transcript rides along so she can refer back to what a guest
   * already told her — "the chin breakouts", not "that". The controller pushes
   * the guest's message into session.messages before asking for the reply, so
   * the tail is usually the message itself; respond() skips an exact echo of
   * the current text when it reads history, so the raw tail is safe to pass.
   */
  const history = session.messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
  return respond(message, classifyLocally(message), guestContext(), history);
}

/**
 * A reply to something that happened.
 *
 * Takes the picks rather than fetching them, so the caller decides whether
 * a network request is appropriate - the engine itself stays offline.
 *
 * `opts.introSkipped` exists for the caller that raises `opened` on a client
 * where the intro sequence never played: the default greeting assumes she has
 * already introduced herself, and this is the one path that must not.
 */
export function guestEvent(
  event: 'opened' | 'scan_complete' | 'body_scan_complete',
  body?: BodySnapshot,
  picks: ProductPick[] = [],
  opts: { introSkipped?: boolean } = {},
): ElohimTurn {
  return respondToEvent(event, classifyLocally(''), guestContext(body, picks), opts);
}
