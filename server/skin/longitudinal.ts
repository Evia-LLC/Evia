/**
 * The longitudinal skin model (ARCHITECTURE §4).
 *
 * A scan is never interpreted alone. Two rules are load-bearing here and both
 * exist to stop the product telling comfortable lies:
 *
 *  1. A delta smaller than the metric's noise floor is "steady", not progress.
 *  2. Trends never cross model versions — different formulas, incomparable numbers.
 */
import {
  METRIC_HIGHER_IS_BETTER,
  METRIC_LABELS,
  METRIC_NOISE_FLOOR,
  SKIN_METRIC_KEYS,
  type LongitudinalSummary,
  type MetricTrend,
  type ProductCorrelation,
  type SkinAnalysis,
  type SkinMetricKey,
  type TrendDirection,
} from '../../shared/types.ts';
import type { ProductUsage } from '../../shared/types.ts';

const DAY_MS = 86_400_000;

function slopePerWeek(points: Array<{ t: number; v: number }>): number | null {
  if (points.length < 3) return null;
  const n = points.length;
  const meanT = points.reduce((s, p) => s + p.t, 0) / n;
  const meanV = points.reduce((s, p) => s + p.v, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - meanT) * (p.v - meanV);
    den += (p.t - meanT) ** 2;
  }
  if (den === 0) return null;
  // points carry t in days; convert the per-day slope to per-week.
  return (num / den) * 7;
}

function direction(key: SkinMetricKey, delta: number | null, significant: boolean): TrendDirection {
  if (delta === null || !significant) return 'steady';
  const better = METRIC_HIGHER_IS_BETTER[key] ? delta > 0 : delta < 0;
  return better ? 'improving' : 'declining';
}

/**
 * `history` must be oldest-first. Only scans sharing the newest scan's model
 * version take part in the trend maths.
 */
export function summarise(
  history: SkinAnalysis[],
  usage: ProductUsage[] = [],
): LongitudinalSummary {
  if (history.length === 0) {
    return {
      scanCount: 0,
      windowDays: 0,
      trends: [],
      correlations: [],
      mixedModelVersions: false,
      headline: null,
    };
  }

  const latest = history[history.length - 1];
  const comparable = history.filter((s) => s.modelVersion === latest.modelVersion);
  const mixedModelVersions = comparable.length !== history.length;

  const firstTime = new Date(comparable[0].capturedAt).getTime();
  const lastTime = new Date(latest.capturedAt).getTime();
  const windowDays = Math.max(0, Math.round((lastTime - firstTime) / DAY_MS));

  const previous = comparable.length > 1 ? comparable[comparable.length - 2] : null;
  const first = comparable.length > 1 ? comparable[0] : null;

  const trends: MetricTrend[] = SKIN_METRIC_KEYS.map((key) => {
    const current = latest.metrics[key];
    const prev = previous ? previous.metrics[key] : null;
    const start = first ? first.metrics[key] : null;
    const deltaFromPrevious = prev === null ? null : round1(current - prev);
    const deltaFromFirst = start === null ? null : round1(current - start);
    const significant =
      deltaFromPrevious !== null && Math.abs(deltaFromPrevious) >= METRIC_NOISE_FLOOR[key];

    const points = comparable.map((s) => ({
      t: (new Date(s.capturedAt).getTime() - firstTime) / DAY_MS,
      v: s.metrics[key],
    }));

    return {
      key,
      current,
      previous: prev,
      first: start,
      deltaFromPrevious,
      deltaFromFirst,
      slopePerWeek: round1(slopePerWeek(points)),
      significant,
      direction: direction(key, deltaFromPrevious, significant),
    };
  });

  return {
    scanCount: history.length,
    windowDays,
    trends,
    correlations: correlate(comparable, usage),
    mixedModelVersions,
    headline: headlineFor(trends, comparable.length),
  };
}

function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}

/**
 * Correlation, explicitly. Reports what the metrics did across the window a
 * product was in use — the persona prompt is responsible for never upgrading
 * that into a causal claim, and this function never gives it the vocabulary to.
 */
function correlate(history: SkinAnalysis[], usage: ProductUsage[]): ProductCorrelation[] {
  const out: ProductCorrelation[] = [];

  for (const u of usage) {
    const start = new Date(u.startedAt).getTime();
    const end = u.endedAt ? new Date(u.endedAt).getTime() : Date.now();

    const during = history.filter((s) => {
      const t = new Date(s.capturedAt).getTime();
      return t >= start && t <= end;
    });
    if (during.length < 2) continue;

    const deltas: Partial<Record<SkinMetricKey, number>> = {};
    for (const key of SKIN_METRIC_KEYS) {
      const d = during[during.length - 1].metrics[key] - during[0].metrics[key];
      if (Math.abs(d) >= METRIC_NOISE_FLOOR[key]) deltas[key] = round1(d)!;
    }

    out.push({
      productId: u.product.id,
      productName: u.product.brand ? `${u.product.brand} ${u.product.name}` : u.product.name,
      overlapDays: Math.round((end - start) / DAY_MS),
      scansDuringUse: during.length,
      metricDeltasDuringUse: deltas,
    });
  }

  return out;
}

/** The single most notable significant movement, or null when nothing moved. */
function headlineFor(trends: MetricTrend[], scanCount: number): string | null {
  if (scanCount < 2) return null;
  const moved = trends
    .filter((t) => t.significant && t.deltaFromPrevious !== null)
    .sort((a, b) => Math.abs(b.deltaFromPrevious!) - Math.abs(a.deltaFromPrevious!));
  if (moved.length === 0) return 'Nothing moved beyond measurement noise since the last scan.';

  const top = moved[0];
  const verb = top.direction === 'improving' ? 'improved' : 'moved the wrong way';
  const n = Math.round(Math.abs(top.deltaFromPrevious!));
  return `${METRIC_LABELS[top.key]} ${verb} by ${n} point${n === 1 ? '' : 's'} since the last scan.`;
}

/** Compact, model-readable rendering of the summary for the context block. */
export function renderSummary(summary: LongitudinalSummary): string {
  if (summary.scanCount === 0) return 'No scans on record — you have never seen this user\'s face.';

  const lines: string[] = [
    `${summary.scanCount} scan(s) over ${summary.windowDays} day(s).`,
  ];
  if (summary.mixedModelVersions) {
    lines.push(
      'NOTE: history spans multiple analysis versions; only same-version scans were compared.',
    );
  }

  for (const t of summary.trends) {
    const parts = [`${METRIC_LABELS[t.key]}: ${t.current}`];
    if (t.deltaFromPrevious !== null) {
      parts.push(
        t.significant
          ? `${t.deltaFromPrevious > 0 ? '+' : ''}${t.deltaFromPrevious} vs last (${t.direction})`
          : 'steady vs last (within noise)',
      );
    }
    if (t.deltaFromFirst !== null && Math.abs(t.deltaFromFirst) >= METRIC_NOISE_FLOOR[t.key]) {
      parts.push(`${t.deltaFromFirst > 0 ? '+' : ''}${t.deltaFromFirst} vs first`);
    }
    lines.push('- ' + parts.join('; '));
  }

  for (const c of summary.correlations) {
    const deltas = Object.entries(c.metricDeltasDuringUse)
      .map(([k, v]) => `${METRIC_LABELS[k as SkinMetricKey]} ${v > 0 ? '+' : ''}${v}`)
      .join(', ');
    lines.push(
      `- While using ${c.productName} (${c.overlapDays}d, ${c.scansDuringUse} scans): ${deltas || 'no significant movement'}. CORRELATION ONLY.`,
    );
  }

  return lines.join('\n');
}
