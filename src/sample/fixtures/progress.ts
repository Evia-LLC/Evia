/**
 * Sample data for the Progress page: the mockup's own numbers and words
 * (ref2.png, transcribed in specs/progress.md sections 2 and 7), shown only
 * while sample mode is on and its badge is up.
 *
 * Nothing here is anyone's reading, and several things here are exactly what
 * real mode refuses to show - the composite "Skin health score", percentage
 * changes, "Clarity" and "Firmness" (which no analysis measures), the routine
 * streak. They are kept verbatim so the design can be reviewed as drawn, and
 * each is listed for counsel in design/counsel/progress.md.
 *
 * The photo variant of the comparison is shown here (BUILD-PLAN decision 10)
 * with neutral skin-texture tiles in place of faces (decision 3). Choosing a
 * recent-scan tile moves the comparison's "after" side to it
 * (`sampleProgress` in src/view/progress.ts).
 *
 * The timeline reproduces the mockup's geometry: its markers and line ends
 * (section 2.13), on a time axis that puts May 1 to Aug 1 where the mockup's
 * month gridlines are. The tooltip keeps the mockup's own inconsistency (it
 * reads 82 while the line ends near 77), sample only.
 */
import type { DateLabel, ProgressView } from '@/view/progress.ts';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

const DAY = (iso: string, long: string, short: string): DateLabel => ({ iso, long, short });

const MAY_12 = DAY('2024-05-12', 'May 12, 2024', 'May 12');
const AUG_12 = DAY('2024-08-12', 'Aug 12, 2024', 'Aug 12');

/*
 * The mockup's plot runs from x 399 to 896, with May 1 at 475 and Aug 1 at
 * 857: a linear time scale that fits those two gridlines starts about Apr 12
 * and ends about Aug 10.
 */
const DOMAIN_START = at(2024, 4, 12) + 16 * 3_600_000;
const DOMAIN_END = at(2024, 8, 10) + 10 * 3_600_000;

const point = (m: number, d: number, value: number) => {
  const t = at(2024, m, d);
  const date = new Date(t);
  const short = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
  return { t, value, date: DAY(date.toISOString().slice(0, 10), `${short}, 2024`, short) };
};

export const SAMPLE_PROGRESS: ProgressView = {
  mode: 'sample',
  title: 'Progress',
  subtitle: 'Real changes. A healthier, brighter you.',
  range: '3M',
  toast: { title: "You're doing great!", body: 'Consistency is working.', celebrate: true },
  comparison: {
    kind: 'photos',
    sample: true,
    before: { date: MAY_12, photoId: null, texture: 0.9 },
    after: { date: AUG_12, photoId: null, texture: 0.12 },
    latest: true,
    caption: '“Your skin texture looks smoother, and dark marks are less visible.”',
    attribution: '— Evia',
  },
  score: {
    kind: 'sample-score',
    title: 'Skin health score',
    value: 82,
    max: 100,
    grade: 'Good',
    delta: '+18%',
    since: 'since May',
    bars: [
      { label: 'Texture', value: 85, fill: 0.86 },
      { label: 'Clarity', value: 78, fill: 0.76 },
      { label: 'Even tone', value: 72, fill: 0.67 },
      { label: 'Hydration', value: 88, fill: 0.85 },
      { label: 'Firmness', value: 80, fill: 0.75 },
    ],
  },
  improvements: {
    meta: 'Compared to your first scan',
    items: [
      { key: 'acne', value: '-42%', label: 'Acne spots', hint: null, spoken: 'Acne spots down 42 percent' },
      { key: 'hydration', value: '+36%', label: 'Hydration', hint: null, spoken: 'Hydration up 36 percent' },
      { key: 'tone', value: '+28%', label: 'Even tone', hint: null, spoken: 'Even tone up 28 percent' },
      { key: 'redness', value: '-31%', label: 'Redness', hint: null, spoken: 'Redness down 31 percent' },
    ],
    empty: null,
  },
  timeline: {
    subtitle: 'See how your skin has changed over time',
    options: [{ id: 'score', label: 'Skin health score' }],
    metric: 'score',
    metricLabel: 'Skin health score',
    direction: null,
    domain: { start: DOMAIN_START, end: DOMAIN_END },
    ticks: [
      { t: at(2024, 5, 1), label: 'May' },
      { t: at(2024, 6, 1), label: 'Jun' },
      { t: at(2024, 7, 1), label: 'Jul' },
      { t: at(2024, 8, 1), label: 'Aug' },
    ],
    points: [
      point(4, 21, 37.4),
      point(5, 19, 51.7),
      point(6, 19, 58.0),
      point(7, 3, 66.4),
      point(7, 21, 72.0),
      point(8, 6, 76.5),
    ],
    lead: 36.1,
    tail: 77.3,
    tooltip: { t: at(2024, 8, 1), y: 79.8, value: '82', date: 'Aug 12, 2024' },
    note: null,
    empty: null,
  },
  recent: {
    items: [
      { id: 's-aug', selectable: true, date: AUG_12, thumb: { kind: 'sample', texture: 0.14 }, score: { value: 82, tone: 'good' }, chips: [] },
      {
        id: 's-jul',
        selectable: true,
        date: DAY('2024-07-15', 'Jul 15, 2024', 'Jul 15'),
        thumb: { kind: 'sample', texture: 0.34 },
        score: { value: 76, tone: 'good' },
        chips: [],
      },
      {
        id: 's-jun',
        selectable: true,
        date: DAY('2024-06-10', 'Jun 10, 2024', 'Jun 10'),
        thumb: { kind: 'sample', texture: 0.58 },
        score: { value: 68, tone: 'fair' },
        chips: [],
      },
      { id: 's-may', selectable: true, date: MAY_12, thumb: { kind: 'sample', texture: 0.85 }, score: { value: 64, tone: 'fair' }, chips: [] },
    ],
    total: 10,
    empty: null,
  },
  milestones: {
    subtitle: "You're making great progress!",
    items: [
      { label: 'Completed 10 scans', state: 'done', fraction: null },
      { label: 'Stuck to routine for 30 days', state: 'done', fraction: null },
      { label: 'Improved skin score by 20%', state: 'done', fraction: null },
      /* The mockup's arc runs to about 213 degrees. */
      { label: 'Fewer acne spots', state: 'progress', fraction: 213 / 360 },
    ],
  },
  insights: {
    paragraphs: [
      'Your consistency is paying off! Your skin is clearer and more balanced. Let’s keep focusing on hydration and maintaining your routine. I recommend continuing your current products and re-scanning in 2 weeks.',
    ],
    signature: true,
    tagline: ['SMALL STEPS.', 'REAL RESULTS.'],
    ask: null,
    empty: null,
  },
  selectedScanId: 's-aug',
  rangeNote: null,
};
