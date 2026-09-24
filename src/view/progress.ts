/**
 * The Progress page's view model (BUILD-PLAN 3.2).
 *
 * The page renders only from what `progressView()` returns: the mockup's own
 * numbers while sample mode is on (`SAMPLE_PROGRESS`), and otherwise what
 * `buildProgress()` makes of the stored scans. The two share one shape, so the
 * cards cannot tell them apart - which is the point: every sample element has
 * a real counterpart that is either backed by data or honestly empty.
 *
 * What real mode deliberately does not have (data-map section 4, SRS section 5):
 *  - no composite score or grade. The ring becomes the latest scan's nine
 *    readings, grouped by which way is better for each;
 *  - no percentages. Changes are in points, because the readings are 0-100
 *    appearance indices and "-42%" of one is precision the camera does not
 *    have;
 *  - nothing called a change unless it clears that metric's noise floor
 *    (METRIC_NOISE_FLOOR, the same table the server's trend summary uses);
 *  - no adherence, streaks or routine claims - there is no data for them;
 *  - no photos unless the person opted in to progress photos and saved some.
 *    Without them (most people, and everyone on main today, data-map G1) the
 *    comparison is first-versus-latest readings instead (BUILD-PLAN decision
 *    10), with an invitation to turn photos on in Privacy.
 *
 * Direction matters everywhere: for hydration and tone evenness a higher
 * reading is better, for the other seven (texture, redness, breakout signs ...)
 * a higher reading is worse. `outcomeOf()` is the one place that decides, and
 * every label says which way a metric runs.
 */
import {
  METRIC_HIGHER_IS_BETTER,
  METRIC_LABELS,
  METRIC_NOISE_FLOOR,
  SKIN_METRIC_KEYS,
  hasConsent,
  type LongitudinalSummary,
  type ProgressPhoto,
  type RoutineOutcome,
  type SkinAnalysis,
  type SkinMetricKey,
  type UserSummary,
} from '@shared/types.ts';
import { CONSENT_KEYS } from '@shared/consent-keys.ts';
import { sample } from '@/sample/mode.svelte.ts';
import { session } from '@/state/session.svelte.ts';
import { SAMPLE_PROGRESS } from '@/sample/fixtures/progress.ts';

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

export type RangeId = '1W' | '1M' | '3M' | '6M' | '1Y' | 'All';

export const RANGES: ReadonlyArray<{ id: RangeId; label: string; days: number | null; name: string }> = [
  { id: '1W', label: '1W', days: 7, name: 'the last week' },
  { id: '1M', label: '1M', days: 30, name: 'the last month' },
  { id: '3M', label: '3M', days: 91, name: 'the last 3 months' },
  { id: '6M', label: '6M', days: 182, name: 'the last 6 months' },
  { id: '1Y', label: '1Y', days: 365, name: 'the last year' },
  { id: 'All', label: 'All', days: null, name: 'all time' },
];

export const DEFAULT_RANGE: RangeId = '3M';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// The view model
// ---------------------------------------------------------------------------

export interface DateLabel {
  /** ISO timestamp, for <time datetime>. */
  iso: string;
  /** "May 12, 2024" */
  long: string;
  /** "May 12" */
  short: string;
}

/** Which way a change went, once the noise floor has had its say. */
export type Outcome = 'improved' | 'worse' | 'steady';

export interface ReadingChange {
  key: SkinMetricKey;
  label: string;
  higherIsBetter: boolean;
  from: number;
  to: number;
  /** to - from, in points, one decimal. */
  delta: number;
  noiseFloor: number;
  outcome: Outcome;
}

export interface PhotoSide {
  date: DateLabel;
  /** A stored progress photo's id (real), or null for a sample placeholder. */
  photoId: string | null;
  /** Sample placeholders only: how much speckle the neutral texture tile shows (0..1). */
  texture?: number;
}

export interface Invite {
  text: string;
  action: string;
  href: string;
}

export type ComparisonView =
  | {
      kind: 'photos';
      sample: boolean;
      before: PhotoSide;
      after: PhotoSide;
      /** Whether the "after" side is the newest photo in the range, or one the person chose. */
      latest: boolean;
      /** Describes the two photos' own scans, or null when either photo has no scan to read. */
      caption: string | null;
      attribution: string | null;
    }
  | {
      kind: 'readings';
      from: DateLabel;
      to: DateLabel;
      /** Whether `to` is the newest scan in the range ("Latest") or one the person chose. */
      latest: boolean;
      rows: ReadingChange[];
      caption: string;
      invite: Invite | null;
    }
  | { kind: 'empty'; title: string; body: string; cta: 'scan' | 'range' | null; invite: Invite | null };

export interface ReadingRow {
  key: SkinMetricKey;
  label: string;
  value: number;
}

export type ScoreView =
  | {
      kind: 'sample-score';
      title: string;
      value: number;
      max: number;
      grade: string;
      delta: string;
      since: string;
      /** fill: the bar length the mockup draws (it disagrees with the number, sample only). */
      bars: Array<{ label: string; value: number; fill: number }>;
    }
  | {
      kind: 'readings';
      title: string;
      at: DateLabel;
      scanCount: number;
      groups: Array<{ id: 'higher' | 'lower'; heading: string; rows: ReadingRow[] }>;
    }
  | { kind: 'empty'; title: string; emptyTitle: string; body: string };

export interface ImprovementItem {
  key: string;
  value: string;
  label: string;
  /** "lower is better", for metrics where a falling number is the good news. */
  hint: string | null;
  /** Read aloud in place of the terse figure. */
  spoken: string;
}

export interface ImprovementsView {
  meta: string;
  items: ImprovementItem[];
  empty: { title: string; body: string } | null;
}

export interface TimelinePoint {
  t: number;
  value: number;
  date: DateLabel;
}

export interface TimelineView {
  subtitle: string;
  /** The dropdown; one fixed option in sample mode. */
  options: Array<{ id: string; label: string }>;
  metric: string;
  metricLabel: string;
  /** "Higher is better" / "Lower is better", or null (sample). */
  direction: string | null;
  domain: { start: number; end: number };
  /** Axis ticks; null lets the chart choose from the domain. */
  ticks: Array<{ t: number; label: string }> | null;
  points: TimelinePoint[];
  /** Sample only: where the drawn line starts and ends beyond the first/last marker. */
  lead: number | null;
  tail: number | null;
  tooltip: { t: number; y: number; value: string; date: string } | null;
  note: string | null;
  empty: string | null;
}

export type Thumb = { kind: 'sample'; texture: number } | { kind: 'photo'; photoId: string } | null;

export interface Chip {
  label: string;
  tone: 'good' | 'worse' | 'neutral';
  spoken: string;
}

export interface RecentScan {
  /** The scan's key on this page (`scanKey`): its id, or its capture time for a guest's scan. */
  id: string;
  /**
   * Whether choosing this tile changes the comparison. False where it could
   * not: a scan from an older analysis version, the only scan in the range,
   * or (in the photo variant) a scan without a photo.
   */
  selectable: boolean;
  date: DateLabel;
  thumb: Thumb;
  /** Sample only: the mockup's per-scan "Score". */
  score: { value: number; tone: 'good' | 'fair' } | null;
  chips: Chip[];
}

export interface RecentScansView {
  items: RecentScan[];
  /** How many scans the range holds (the "View all" count). */
  total: number;
  empty: { title: string; body: string } | null;
}

export interface Milestone {
  label: string;
  state: 'done' | 'progress';
  /** 0..1, the real fraction for an in-progress milestone. */
  fraction: number | null;
}

export interface MilestonesView {
  subtitle: string | null;
  items: Milestone[];
}

export interface InsightsView {
  paragraphs: string[];
  /** Sample only: the handwritten "Evia" mark and the caps tagline. */
  signature: boolean;
  tagline: [string, string] | null;
  /** Real mode: what "Ask Evia" sends. */
  ask: string | null;
  empty: string | null;
}

export interface ToastView {
  title: string;
  body: string;
  /** The mockup's party popper (sample only). */
  celebrate: boolean;
}

export interface ProgressView {
  mode: 'sample' | 'real';
  title: string;
  subtitle: string;
  range: RangeId;
  toast: ToastView | null;
  comparison: ComparisonView;
  score: ScoreView;
  improvements: ImprovementsView;
  timeline: TimelineView;
  recent: RecentScansView;
  milestones: MilestonesView;
  insights: InsightsView;
  /**
   * The scan tile to show as chosen: always one of the two scans the
   * comparison card is showing, or null when it shows none.
   */
  selectedScanId: string | null;
  /** Sample mode, on a range other than the mockup's own: why the cards did not change. */
  rangeNote: string | null;
}

/** What the page holds itself: the chosen range, metric and scan. */
export interface ProgressUi {
  range: RangeId;
  metric: SkinMetricKey | null;
  selectedScanId: string | null;
}

export interface ProgressInput {
  scans: SkinAnalysis[];
  summary: LongitudinalSummary | null;
  photos: ProgressPhoto[];
  user: UserSummary | null;
  guest: boolean;
  outcomes: RoutineOutcome[];
  now: number;
  locale?: string;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** The page's model: the sample while sample mode is on, the real builder otherwise. */
export function progressView(ui: ProgressUi, outcomes: RoutineOutcome[] = []): ProgressView {
  if (sample.on) return sampleProgress(ui);
  return buildProgress(
    {
      scans: session.scans,
      summary: session.summary,
      photos: session.progressPhotos,
      user: session.user,
      guest: session.guest,
      outcomes,
      now: Date.now(),
    },
    ui,
  );
}

/*
 * The sample is one fixed example quarter, so two things are made to behave
 * rather than merely look interactive:
 *  - choosing a scan tile moves the "after" side of the sample comparison to
 *    that tile (choosing the oldest keeps it as "before", against the newest),
 *    so the tile marked as chosen is always on the card;
 *  - the range tabs cannot re-cut invented numbers honestly, so on any range
 *    but the mockup's own the page says the sample does not change with it.
 */
export function sampleProgress(ui: ProgressUi): ProgressView {
  const base: ProgressView = { ...SAMPLE_PROGRESS, range: ui.range };
  if (ui.range !== SAMPLE_PROGRESS.range) {
    base.rangeNote =
      'This sample is one example quarter, May to August 2024, so it looks the same on every range. With your own scans, the range filters each card.';
  }
  const items = SAMPLE_PROGRESS.recent.items;
  const picked = items.find((i) => i.id === ui.selectedScanId);
  const newest = items[0];
  const oldest = items[items.length - 1];
  if (!picked || picked === newest || picked === oldest || base.comparison.kind !== 'photos') {
    return { ...base, selectedScanId: picked?.id ?? SAMPLE_PROGRESS.selectedScanId };
  }
  const texture = picked.thumb?.kind === 'sample' ? picked.thumb.texture : undefined;
  return {
    ...base,
    comparison: { ...base.comparison, after: { date: picked.date, photoId: null, texture }, latest: false },
    selectedScanId: picked.id,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** A scan's key on this page: its stored id, or its capture time (a guest's scans have no id). */
export function scanKey(scan: SkinAnalysis): string {
  return scan.id ?? scan.capturedAt;
}

/** Improved, worse, or steady: the noise floor first, then which way is better. */
export function outcomeOf(key: SkinMetricKey, delta: number): Outcome {
  if (Math.abs(delta) < METRIC_NOISE_FLOOR[key]) return 'steady';
  return delta > 0 === METRIC_HIGHER_IS_BETTER[key] ? 'improved' : 'worse';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Every metric from one reading to another, noise floor applied. */
export function compareReadings(from: SkinAnalysis, to: SkinAnalysis): ReadingChange[] {
  return SKIN_METRIC_KEYS.map((key) => {
    const delta = round1(to.metrics[key] - from.metrics[key]);
    return {
      key,
      label: METRIC_LABELS[key],
      higherIsBetter: METRIC_HIGHER_IS_BETTER[key],
      from: from.metrics[key],
      to: to.metrics[key],
      delta,
      noiseFloor: METRIC_NOISE_FLOOR[key],
      outcome: outcomeOf(key, delta),
    };
  });
}

/** Biggest movement first, measured in noise floors so the metrics compare fairly. */
function byStrength(a: ReadingChange, b: ReadingChange): number {
  return Math.abs(b.delta) / b.noiseFloor - Math.abs(a.delta) / a.noiseFloor;
}

/** "+6 pts" / "−6 pts" (a real minus sign). */
export function points(delta: number): string {
  const n = Math.round(Math.abs(delta));
  return `${delta < 0 ? '−' : '+'}${n} pt${n === 1 ? '' : 's'}`;
}

function pointsWords(delta: number): string {
  const n = Math.round(Math.abs(delta));
  return `${n} point${n === 1 ? '' : 's'}`;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * One plain sentence about a comparison. Only changes past the noise floor
 * are named; everything else is said to have held.
 */
export function describeChanges(rows: ReadingChange[]): string {
  const moved = rows.filter((r) => r.outcome !== 'steady').sort(byStrength);
  if (moved.length === 0) return 'All nine readings held within measurement noise between these two scans.';
  /* Three named at most, and a reading that moved the wrong way is always
     among them: good news never crowds out the bad. */
  const better = moved.filter((r) => r.outcome === 'improved');
  const worse = moved.filter((r) => r.outcome === 'worse');
  const picked = [...better.slice(0, worse.length ? 2 : 3), ...worse.slice(0, better.length ? 1 : 3)].sort(byStrength);
  const named = picked.map((r, i) => {
    const label = i === 0 ? r.label : lower(r.label);
    return r.outcome === 'improved'
      ? `${label} improved by ${pointsWords(r.delta)}`
      : `${label} moved the wrong way by ${pointsWords(r.delta)}`;
  });
  const others = rows.length - moved.length;
  const beyond = moved.filter((r) => !picked.includes(r));
  const moreBetter = beyond.filter((r) => r.outcome === 'improved').length;
  const moreWorse = beyond.length - moreBetter;
  const restParts = [
    moreBetter ? `${moreBetter} more improved` : '',
    moreWorse ? `${moreWorse} more moved the wrong way` : '',
  ].filter(Boolean);
  const rest = restParts.length ? `; ${joinWords(restParts)}` : '';
  const held =
    others === 0 ? '' : `; the other ${others === 1 ? 'reading' : `${others} readings`} held within measurement noise`;
  return `${joinWords(named)}${rest}${held}.`;
}

export function scansInRange(scans: SkinAnalysis[], range: RangeId, now: number): SkinAnalysis[] {
  const days = RANGES.find((r) => r.id === range)?.days ?? null;
  if (days === null) return scans;
  const since = now - days * DAY_MS;
  return scans.filter((s) => Date.parse(s.capturedAt) >= since);
}

function dateLabel(iso: string, locale?: string): DateLabel {
  const d = new Date(iso);
  return {
    iso,
    long: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(d),
    short: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d),
  };
}

const MILESTONE_COUNTS = [1, 3, 5, 10, 25, 50, 100];

/** Scan-count milestones: facts from the history, plus the next one at its real fraction. */
export function scanMilestones(count: number, trackedDays: number): Milestone[] {
  const done = MILESTONE_COUNTS.filter((n) => n <= count).map<Milestone>((n) => ({
    label: n === 1 ? 'Completed your first scan' : `Completed ${n} scans`,
    state: 'done',
    fraction: null,
  }));
  const items = done.slice(-3);
  if (trackedDays >= 7 && items.length < 3) {
    items.push({ label: `Tracking your skin for ${trackedDays} days`, state: 'done', fraction: null });
  }
  const next = MILESTONE_COUNTS.find((n) => n > count);
  if (next) {
    items.push({
      label: next === 1 ? 'Your first scan' : `${next} scans: ${count} of ${next} done`,
      state: 'progress',
      fraction: count / next,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// The real builder
// ---------------------------------------------------------------------------

const PHOTO_INVITE: Invite = {
  text: 'Progress photos are off. Turn them on to compare side by side.',
  action: 'Turn on in Privacy',
  href: '/privacy',
};

const PHOTOS_ON_NOTE: Invite = {
  text: 'Progress photos are on. Save a photo after your next scans to compare them here.',
  action: 'Privacy settings',
  href: '/privacy',
};

export function buildProgress(input: ProgressInput, ui: ProgressUi): ProgressView {
  const { summary, photos, user, guest, outcomes, now, locale } = input;
  const all = input.scans;
  const range = ui.range;
  const rangeName = RANGES.find((r) => r.id === range)?.name ?? 'this range';
  const latest = all[0] ?? null;
  const version = latest?.modelVersion ?? null;
  /* Nothing crosses a model version: the formulas changed between them. */
  const comparable = all.filter((s) => s.modelVersion === version);
  const mixedVersions = Boolean(summary?.mixedModelVersions) || comparable.length !== all.length;
  const inRange = scansInRange(comparable, range, now);
  const allInRange = scansInRange(all, range, now);
  const photosOn = !guest && hasConsent(user?.consents, CONSENT_KEYS.PROGRESS_PHOTOS);
  const invite = guest ? null : photosOn ? PHOTOS_ON_NOTE : PHOTO_INVITE;

  /*
   * The comparison runs from the first scan in the range to the newest, or
   * to the scan the person chose. Choosing the first scan itself keeps it as
   * the "from" side against the newest, so whatever is chosen is always one
   * of the two scans on the card and the range's other states never show
   * while it holds two scans.
   */
  const newest = inRange[0] ?? null;
  const oldest = inRange[inRange.length - 1] ?? null;
  const picked = (ui.selectedScanId && inRange.find((s) => scanKey(s) === ui.selectedScanId)) || null;
  const to = picked && picked !== oldest ? picked : newest;
  const compared = to && oldest && to !== oldest ? compareReadings(oldest, to) : null;
  const toIsLatest = to === newest;
  const isFirstEver = oldest !== null && oldest === comparable[comparable.length - 1];
  const olderVersionInRange = allInRange.length > inRange.length;

  // ---- comparison ----------------------------------------------------------
  let comparison: ComparisonView;
  /* The tile shown as chosen: the person's pick when it is on the card, else the "to" side. */
  let shownScanId: string | null = compared && to ? (picked ? scanKey(picked) : scanKey(to)) : null;
  const rangePhotos = photos
    .filter((p) => {
      const days = RANGES.find((r) => r.id === range)?.days ?? null;
      return days === null || Date.parse(p.capturedAt) >= now - days * DAY_MS;
    })
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const photoVariant = photosOn && rangePhotos.length >= 2;
  if (photoVariant) {
    /*
     * The photos pair up on their own: the first photo in the range and the
     * chosen scan's photo (or the newest photo). The caption then compares
     * the two photos' own scans - never the range's first scan, which may be
     * older than any photo - and says nothing when a photo has no scan.
     */
    const pickedPhoto = picked ? rangePhotos.find((p) => p.skinScanId === picked.id) : undefined;
    const before = rangePhotos[0];
    const newestPhoto = rangePhotos[rangePhotos.length - 1];
    const after = pickedPhoto && pickedPhoto !== before ? pickedPhoto : newestPhoto;
    const scanOf = (photo: ProgressPhoto) =>
      photo.skinScanId ? (comparable.find((s) => s.id === photo.skinScanId) ?? null) : null;
    const beforeScan = scanOf(before);
    const afterScan = scanOf(after);
    comparison = {
      kind: 'photos',
      sample: false,
      before: { date: dateLabel(before.capturedAt, locale), photoId: before.id },
      after: { date: dateLabel(after.capturedAt, locale), photoId: after.id },
      latest: after === newestPhoto,
      caption:
        beforeScan && afterScan && beforeScan !== afterScan
          ? describeChanges(compareReadings(beforeScan, afterScan))
          : null,
      attribution: null,
    };
    shownScanId =
      pickedPhoto && (pickedPhoto === before || pickedPhoto === after) && picked
        ? scanKey(picked)
        : (after.skinScanId ?? null);
  } else if (compared && to && oldest) {
    comparison = {
      kind: 'readings',
      from: dateLabel(oldest.capturedAt, locale),
      to: dateLabel(to.capturedAt, locale),
      latest: toIsLatest,
      rows: compared,
      caption: describeChanges(compared),
      invite,
    };
  } else if (!latest) {
    comparison = {
      kind: 'empty',
      title: 'Your first scan is your baseline',
      body: 'After a second scan, this card compares your first and latest readings, metric by metric.',
      cta: 'scan',
      invite,
    };
  } else if (inRange.length === 0) {
    comparison = {
      kind: 'empty',
      title: `No scans in ${rangeName}`,
      body: `Your latest scan was on ${dateLabel(latest.capturedAt, locale).long}. Choose a longer range, or scan again.`,
      cta: 'range',
      invite,
    };
  } else {
    comparison = {
      kind: 'empty',
      title: 'One scan in this range',
      body: `The next scan becomes the comparison for ${dateLabel(inRange[0].capturedAt, locale).long}.${
        olderVersionInRange ? ' Earlier scans in this range used an older analysis version, so they are not compared.' : ''
      }${comparable.length > 1 ? ' Or choose a longer range to compare with earlier scans.' : ''}`,
      cta: comparable.length > 1 ? 'range' : 'scan',
      invite,
    };
  }

  // ---- latest readings (in place of the score) ----------------------------
  const score: ScoreView = latest
    ? {
        kind: 'readings',
        title: 'Latest readings',
        at: dateLabel(latest.capturedAt, locale),
        scanCount: user?.scanCount && !guest ? Math.max(user.scanCount, all.length) : all.length,
        groups: [
          {
            id: 'higher',
            heading: 'Higher is better',
            rows: SKIN_METRIC_KEYS.filter((k) => METRIC_HIGHER_IS_BETTER[k]).map((key) => ({
              key,
              label: METRIC_LABELS[key],
              value: Math.round(latest.metrics[key]),
            })),
          },
          {
            id: 'lower',
            heading: 'Lower is better',
            rows: SKIN_METRIC_KEYS.filter((k) => !METRIC_HIGHER_IS_BETTER[k]).map((key) => ({
              key,
              label: METRIC_LABELS[key],
              value: Math.round(latest.metrics[key]),
            })),
          },
        ],
      }
    : {
        kind: 'empty',
        title: 'Latest readings',
        emptyTitle: 'No readings yet',
        body: 'A scan measures nine things about how your skin looks, each on a 0 to 100 scale.',
      };

  // ---- key improvements ----------------------------------------------------
  const improved = (compared ?? []).filter((r) => r.outcome === 'improved').sort(byStrength).slice(0, 4);
  const firstDate = oldest ? dateLabel(oldest.capturedAt, locale).short : '';
  const toDate = to ? dateLabel(to.capturedAt, locale).short : '';
  /* Name both ends whenever the "to" side is a chosen scan rather than the newest. */
  const span = toIsLatest ? '' : ` to ${toDate}`;
  const improvements: ImprovementsView = {
    meta:
      oldest && compared
        ? toIsLatest
          ? isFirstEver
            ? 'Compared to your first scan'
            : `Compared to ${firstDate}`
          : `From ${firstDate} to ${toDate}`
        : '',
    items: improved.map((r) => ({
      key: r.key,
      value: points(r.delta),
      label: r.label,
      hint: r.higherIsBetter ? null : 'lower is better',
      spoken: `${r.label} ${r.delta < 0 ? 'down' : 'up'} ${pointsWords(r.delta)}${r.higherIsBetter ? '' : ', lower is better'}`,
    })),
    empty: !compared
      ? {
          title: 'Two scans make a comparison',
          body: !latest
            ? 'Changes appear here after your second scan.'
            : olderVersionInRange
              ? 'Changes appear here once this range holds two scans from the current analysis version.'
              : 'Changes appear here once this range holds two scans.',
        }
      : improved.length === 0
        ? {
            title: 'Nothing improved past measurement noise',
            body: `From ${firstDate}${span || ' to your latest scan'}. Small moves under each reading's noise floor are not called changes.`,
          }
        : null,
  };

  // ---- timeline ------------------------------------------------------------
  /*
   * The reading plotted first is the one that moved most across the range
   * (first to newest, measured in noise floors), whichever way it moved - not
   * the most flattering one - and it does not jump when a scan is chosen.
   */
  const rangeChanges = oldest && newest && oldest !== newest ? compareReadings(oldest, newest) : [];
  const metric: SkinMetricKey =
    ui.metric ?? rangeChanges.filter((r) => r.outcome !== 'steady').sort(byStrength)[0]?.key ?? 'hydration';
  const days = RANGES.find((r) => r.id === range)?.days ?? null;
  const series = [...inRange].reverse().map<TimelinePoint>((s) => ({
    t: Date.parse(s.capturedAt),
    value: s.metrics[metric],
    date: dateLabel(s.capturedAt, locale),
  }));
  let domain: { start: number; end: number };
  if (days !== null) domain = { start: now - days * DAY_MS, end: now };
  else if (series.length >= 2) {
    const pad = Math.max(DAY_MS, (series[series.length - 1].t - series[0].t) * 0.04);
    domain = { start: series[0].t - pad, end: Math.min(now, series[series.length - 1].t + pad) };
  } else domain = { start: now - 30 * DAY_MS, end: now };
  const last = series[series.length - 1];
  const timeline: TimelineView = {
    subtitle: 'How each reading has changed over time',
    options: SKIN_METRIC_KEYS.map((key) => ({ id: key, label: METRIC_LABELS[key] })),
    metric,
    metricLabel: METRIC_LABELS[metric],
    direction: METRIC_HIGHER_IS_BETTER[metric] ? 'Higher is better' : 'Lower is better',
    domain,
    ticks: null,
    points: series,
    lead: null,
    tail: null,
    tooltip: last ? { t: last.t, y: last.value, value: String(Math.round(last.value)), date: last.date.long } : null,
    note: mixedVersions ? 'Only scans from the current analysis version are plotted; earlier ones measured differently.' : null,
    empty: series.length === 0 ? (latest ? `No scans in ${rangeName}.` : 'Your readings appear here as a line, one point per scan.') : null,
  };

  // ---- recent scans --------------------------------------------------------
  const recentItems = allInRange.slice(0, 4).map<RecentScan>((scan) => {
    const index = all.indexOf(scan);
    const previous = all.slice(index + 1).find((s) => s.modelVersion === scan.modelVersion) ?? null;
    const photo = photosOn ? photos.find((p) => p.skinScanId === scan.id) : undefined;
    let chips: Chip[];
    if (!previous) chips = [{ label: 'First scan', tone: 'neutral', spoken: 'First scan, your baseline' }];
    else {
      const moved = compareReadings(previous, scan).filter((r) => r.outcome !== 'steady').sort(byStrength).slice(0, 2);
      chips = moved.length
        ? moved.map((r) => ({
            label: `${r.label} ${points(r.delta)}`,
            tone: r.outcome === 'improved' ? 'good' : 'worse',
            spoken: `${r.label} ${r.outcome === 'improved' ? 'improved' : 'moved the wrong way'}, ${pointsWords(r.delta)}`,
          }))
        : [{ label: 'Steady', tone: 'neutral', spoken: 'No change past measurement noise since the scan before' }];
    }
    return {
      id: scanKey(scan),
      selectable:
        inRange.length >= 2 && inRange.includes(scan) && (!photoVariant || Boolean(photo && rangePhotos.includes(photo))),
      date: dateLabel(scan.capturedAt, locale),
      thumb: photo ? { kind: 'photo', photoId: photo.id } : null,
      score: null,
      chips,
    };
  });
  const recent: RecentScansView = {
    items: recentItems,
    total: allInRange.length,
    empty:
      recentItems.length === 0
        ? latest
          ? { title: `No scans in ${rangeName}`, body: 'Choose a longer range to see earlier scans.' }
          : { title: 'No scans yet', body: 'Each scan you take is listed here with what changed since the one before.' }
        : null,
  };

  // ---- milestones ----------------------------------------------------------
  const count = !guest && user?.scanCount ? Math.max(user.scanCount, all.length) : all.length;
  const trackedDays =
    comparable.length >= 2
      ? Math.round((Date.parse(comparable[0].capturedAt) - Date.parse(comparable[comparable.length - 1].capturedAt)) / DAY_MS)
      : 0;
  const milestones: MilestonesView = {
    subtitle: count > 0 ? 'From your scan history' : null,
    items: scanMilestones(count, trackedDays),
  };

  // ---- insights ------------------------------------------------------------
  const paragraphs: string[] = [];
  if (summary?.headline) paragraphs.push(summary.headline);
  else if (comparable.length >= 2) {
    const sinceLast = compareReadings(comparable[1], comparable[0]).filter((r) => r.outcome !== 'steady').sort(byStrength);
    const top = sinceLast[0];
    paragraphs.push(
      top
        ? `${top.label} ${top.outcome === 'improved' ? 'improved' : 'moved the wrong way'} by ${pointsWords(top.delta)} since the last scan.`
        : 'Nothing moved beyond measurement noise since the last scan.',
    );
  }
  /*
   * One more sentence at most, about the routine: a routine outcome if there
   * is one (it states its own association caveat), otherwise a "while you were
   * using" correlation, said as a correlation.
   */
  const outcome = guest
    ? undefined
    : outcomes.find((o) => o.verdict !== 'not_scored' && o.verdict !== 'unrecognised' && o.statement);
  const correlation = summary?.correlations.find((c) => Object.keys(c.metricDeltasDuringUse).length > 0);
  if (outcome) paragraphs.push(outcome.statement);
  else if (correlation) {
    const moves = Object.entries(correlation.metricDeltasDuringUse)
      .slice(0, 2)
      .map(([key, delta]) => `${lower(METRIC_LABELS[key as SkinMetricKey])} ${points(delta as number)}`);
    paragraphs.push(
      `While ${correlation.productName} was in your routine (${correlation.overlapDays} days, ${correlation.scansDuringUse} scans): ${joinWords(moves)}. That is a correlation, not proof the product caused it.`,
    );
  }
  const insights: InsightsView = {
    paragraphs,
    signature: false,
    tagline: null,
    ask: paragraphs.length ? 'What has changed in my skin since my first scan?' : null,
    empty:
      paragraphs.length === 0
        ? latest
          ? 'After your next scan, what changed (and what only looks like it did) is summarised here.'
          : 'Once you have two scans, what changed between them is summarised here.'
        : null,
  };

  // ---- toast: a fresh scan with a real improvement -------------------------
  let toast: ToastView | null = null;
  if (latest && comparable.length >= 2 && now - Date.parse(latest.capturedAt) < 2 * DAY_MS) {
    const best = compareReadings(comparable[1], comparable[0]).filter((r) => r.outcome === 'improved').sort(byStrength)[0];
    if (best) {
      toast = {
        title: 'New scan added',
        body: `${best.label} improved by ${pointsWords(best.delta)} since the scan before.`,
        celebrate: false,
      };
    }
  }

  return {
    mode: 'real',
    title: 'Progress',
    subtitle: 'Your scans, compared over time.',
    range,
    toast,
    comparison,
    score,
    improvements,
    timeline,
    recent,
    milestones,
    insights,
    selectedScanId: shownScanId,
    rangeNote: null,
  };
}
