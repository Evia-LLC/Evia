/**
 * Chart geometry for the progress timeline, kept free of Svelte so it can be
 * tested on its own.
 *
 * Two things live here: the curve and the time axis.
 *
 * The curve is a monotone cubic (Fritsch-Carlson, the same rule as d3's
 * `curveMonotoneX`). A plain smoothing spline overshoots between readings, so
 * a line through 52 and 61 could bulge to 63 in between - a reading nobody
 * took. A monotone curve never leaves the range of the two points it joins,
 * so the smoothing is decoration and never data.
 *
 * The axis is real time, not scan order: two scans a day apart sit close
 * together and a month's gap looks like a month. Ticks are chosen from the
 * span so a week reads as days, a quarter as months and years as months with
 * the year.
 */

export interface ChartPoint {
  x: number;
  y: number;
}

export interface TimeTick {
  /** Epoch milliseconds. */
  t: number;
  label: string;
}

const DAY_MS = 86_400_000;

function sign(n: number): number {
  return n < 0 ? -1 : 1;
}

/** Tangent at an interior point: zero at a peak or trough, never overshooting. */
function slope3(a: ChartPoint, b: ChartPoint, c: ChartPoint): number {
  const h0 = b.x - a.x;
  const h1 = c.x - b.x;
  const s0 = h0 ? (b.y - a.y) / h0 : 0;
  const s1 = h1 ? (c.y - b.y) / h1 : 0;
  const p = h0 + h1 ? (s0 * h1 + s1 * h0) / (h0 + h1) : 0;
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}

/** Tangent at an end point, from its neighbour's. */
function slope2(a: ChartPoint, b: ChartPoint, t: number): number {
  const h = b.x - a.x;
  return h ? ((3 * (b.y - a.y)) / h - t) / 2 : t;
}

const r = (n: number) => Math.round(n * 100) / 100;

/** An SVG path through the points (sorted by x) as a monotone cubic. */
export function monotonePath(points: ChartPoint[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${r(points[0].x)},${r(points[0].y)}`;
  if (n === 2) return `M${r(points[0].x)},${r(points[0].y)}L${r(points[1].x)},${r(points[1].y)}`;

  const m: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) m[i] = slope3(points[i - 1], points[i], points[i + 1]);
  m[0] = slope2(points[0], points[1], m[1]);
  m[n - 1] = slope2(points[n - 2], points[n - 1], m[n - 2]);

  let d = `M${r(points[0].x)},${r(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = (b.x - a.x) / 3;
    d += `C${r(a.x + dx)},${r(a.y + dx * m[i])},${r(b.x - dx)},${r(b.y - dx * m[i + 1])},${r(b.x)},${r(b.y)}`;
  }
  return d;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Ticks for a time axis from `start` to `end` (epoch ms).
 *
 * Up to about two weeks: days (every other day past a week). Up to about two
 * months: weeks. Longer: the first of each month, thinned to at most six, with
 * the year added once the span passes a year.
 */
export function timeTicks(start: number, end: number, locale?: string): TimeTick[] {
  if (!(end > start)) return [];
  const spanDays = (end - start) / DAY_MS;
  const ticks: TimeTick[] = [];

  if (spanDays <= 62) {
    const dayFormat = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    const step = spanDays <= 8 ? 1 : spanDays <= 16 ? 2 : 7;
    let t = startOfDay(start);
    if (t < start) t += DAY_MS;
    for (; t <= end; t += step * DAY_MS) ticks.push({ t, label: dayFormat.format(new Date(t)) });
    return ticks;
  }

  const monthFormat = new Intl.DateTimeFormat(
    locale,
    spanDays > 400 ? { month: 'short', year: '2-digit' } : { month: 'short' },
  );
  const cursor = new Date(start);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  if (cursor.getTime() < start) cursor.setMonth(cursor.getMonth() + 1);
  const months: number[] = [];
  while (cursor.getTime() <= end) {
    months.push(cursor.getTime());
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const every = Math.max(1, Math.ceil(months.length / 6));
  months.forEach((t, i) => {
    if (i % every === 0) ticks.push({ t, label: monthFormat.format(new Date(t)) });
  });
  return ticks;
}
