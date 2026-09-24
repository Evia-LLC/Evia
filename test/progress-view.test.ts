/**
 * The Progress page's view model.
 *
 * Real mode may only say what the stored scans say: no composite score or
 * grade, changes in points (never percent) and only past each reading's noise
 * floor, the right direction for every reading (texture, redness and the rest
 * are higher-is-worse), a comparison that works without photos, and photos
 * only with progress-photo consent. Sample mode is the mockup, verbatim.
 */
import { describe, expect, it } from 'vitest';
import {
  buildProgress,
  compareReadings,
  describeChanges,
  outcomeOf,
  sampleProgress,
  scanMilestones,
  type ProgressInput,
  type ProgressUi,
  type ProgressView,
} from '../src/view/progress.ts';
import { SAMPLE_PROGRESS } from '../src/sample/fixtures/progress.ts';
import { monotonePath, timeTicks } from '../src/history/chart.ts';
import { summarise } from '../server/skin/longitudinal.ts';
import {
  SKIN_MODEL_VERSION,
  type SkinAnalysis,
  type SkinAppearanceMetrics,
  type UserSummary,
} from '../shared/types.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-24T12:00:00Z');

function scan(daysAgo: number, metrics: Partial<SkinAppearanceMetrics>, id = `s${daysAgo}`): SkinAnalysis {
  return {
    id,
    capturedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    metrics: {
      hydration: 50,
      oiliness: 50,
      redness: 50,
      texture: 50,
      pores: 50,
      darkSpots: 50,
      evenness: 50,
      underEye: 50,
      acneIndicators: 50,
      ...metrics,
    },
    regions: {},
    quality: { verdict: 'pass', score: 0.9, brightness: 0.5, sharpness: 0.5, faceHeightFraction: 0.5, centeringError: 0, issues: [] },
    confidence: 0.8,
    modelVersion: SKIN_MODEL_VERSION,
  };
}

/** Newest first, as the session holds them. */
const HISTORY = [
  scan(2, { hydration: 64, texture: 44, redness: 52, darkSpots: 45, acneIndicators: 40 }),
  scan(14, { hydration: 60, texture: 47, redness: 50, darkSpots: 47 }),
  scan(40, { hydration: 55, texture: 50, redness: 49 }),
  scan(70, { hydration: 48, texture: 52, redness: 46, darkSpots: 50, acneIndicators: 50 }),
];

function user(consented = false): UserSummary {
  return {
    id: 'u1',
    email: 'a@example.test',
    displayName: 'Ada',
    createdAt: new Date(NOW - 100 * DAY).toISOString(),
    profile: {
      skinType: 'combination',
      fitzpatrick: null,
      concerns: [],
      sensitivities: [],
      pregnancyStatus: 'unknown',
      updatedAt: new Date(NOW).toISOString(),
    },
    preferences: {
      explanationStyle: 'adaptive',
      voiceEnabled: false,
      voiceURI: null,
      reducedMotion: false,
      qualityTier: 'auto',
      locale: 'en',
    },
    consents: consented
      ? ({
          progress_photos: {
            consentType: 'progress_photos',
            state: 'granted',
            wordingVersionId: 'v1',
            recordedAt: new Date(NOW).toISOString(),
            decisionId: 'd1',
          },
        } as unknown as UserSummary['consents'])
      : ({} as UserSummary['consents']),
    scanCount: HISTORY.length,
  };
}

function input(overrides: Partial<ProgressInput> = {}): ProgressInput {
  return {
    scans: HISTORY,
    summary: summarise([...HISTORY].reverse()),
    photos: [],
    user: user(),
    guest: false,
    outcomes: [],
    now: NOW,
    locale: 'en-US',
    ...overrides,
  };
}

const UI: ProgressUi = { range: '3M', metric: null, selectedScanId: null };

/** Every string a real view would put on screen. */
function strings(view: ProgressView): string {
  return JSON.stringify(view);
}

describe('direction and the noise floor', () => {
  it('reads texture, redness and the rest as higher-is-worse', () => {
    expect(outcomeOf('texture', 6)).toBe('worse');
    expect(outcomeOf('texture', -6)).toBe('improved');
    expect(outcomeOf('redness', -5)).toBe('improved');
    expect(outcomeOf('acneIndicators', 5)).toBe('worse');
    expect(outcomeOf('hydration', 5)).toBe('improved');
    expect(outcomeOf('evenness', -5)).toBe('worse');
  });

  it('calls nothing a change inside the noise floor', () => {
    expect(outcomeOf('hydration', 3.9)).toBe('steady');
    expect(outcomeOf('darkSpots', -7)).toBe('steady');
    expect(outcomeOf('darkSpots', -8)).toBe('improved');
  });

  it('matches the server trend summary for first-versus-latest over all time', () => {
    const summary = summarise([...HISTORY].reverse());
    const rows = compareReadings(HISTORY[HISTORY.length - 1], HISTORY[0]);
    for (const row of rows) {
      const trend = summary.trends.find((t) => t.key === row.key)!;
      expect(row.delta).toBe(trend.deltaFromFirst);
    }
  });

  it('describes only changes past the floor, with direction in the words', () => {
    const sentence = describeChanges(compareReadings(HISTORY[3], HISTORY[0]));
    expect(sentence).toBe(
      'Hydration improved by 16 points, breakout signs improved by 10 points and redness moved the wrong way by 6 points; 1 more improved; the other 5 readings held within measurement noise.',
    );
    expect(sentence).not.toMatch(/%/);
  });
});

describe('real mode', () => {
  it('shows no composite score, grade or percentage anywhere', () => {
    const view = buildProgress(input(), UI);
    const text = strings(view);
    expect(view.mode).toBe('real');
    expect(view.score.kind).toBe('readings');
    expect(text).not.toMatch(/health score|out of 100|Premium|\d%/i);
    expect(text).not.toMatch(/"(Good|Fair|Needs care)"/);
    expect(text).not.toMatch(/Score:/);
    expect(text).not.toMatch(/routine for \d+ days|doing great/i);
  });

  it('puts the latest scan’s nine readings where the ring was, split by direction', () => {
    const view = buildProgress(input(), UI);
    if (view.score.kind !== 'readings') throw new Error('expected readings');
    const [higher, lower] = view.score.groups;
    expect(higher.rows.map((r) => r.key)).toEqual(['hydration', 'evenness']);
    expect(lower.rows.map((r) => r.key)).toContain('texture');
    expect(lower.rows).toHaveLength(7);
    expect(lower.rows.find((r) => r.key === 'texture')!.value).toBe(44);
  });

  it('lists only real improvements, in points, biggest first', () => {
    const view = buildProgress(input(), UI);
    expect(view.improvements.items.map((i) => i.key)).toEqual(['hydration', 'acneIndicators', 'texture']);
    expect(view.improvements.items[0].value).toBe('+16 pts');
    expect(view.improvements.items[1].value).toBe('−10 pts');
    expect(view.improvements.items[1].hint).toBe('lower is better');
    expect(view.improvements.meta).toBe('Compared to your first scan');
  });

  it('compares readings, not photos, without consent, and invites turning photos on', () => {
    const photos = [
      { id: 'p1', skinScanId: 's70', createdAt: '', capturedAt: HISTORY[3].capturedAt, consentEventId: 'c' },
      { id: 'p2', skinScanId: 's2', createdAt: '', capturedAt: HISTORY[0].capturedAt, consentEventId: 'c' },
    ];
    const view = buildProgress(input({ photos }), UI);
    expect(view.comparison.kind).toBe('readings');
    if (view.comparison.kind !== 'readings') return;
    expect(view.comparison.invite?.href).toBe('/privacy');
    expect(view.comparison.rows).toHaveLength(9);
    expect(view.recent.items.every((i) => i.thumb === null)).toBe(true);

    const consented = buildProgress(input({ photos, user: user(true) }), UI);
    expect(consented.comparison.kind).toBe('photos');
    if (consented.comparison.kind === 'photos') {
      expect(consented.comparison.before.photoId).toBe('p1');
      expect(consented.comparison.after.photoId).toBe('p2');
    }
  });

  it('filters by range on capturedAt', () => {
    const week = buildProgress(input(), { ...UI, range: '1W' });
    expect(week.recent.items.map((i) => i.id)).toEqual(['s2']);
    expect(week.comparison.kind).toBe('empty');
    expect(week.improvements.items).toHaveLength(0);
    expect(week.timeline.points).toHaveLength(1);

    const month = buildProgress(input(), { ...UI, range: '1M' });
    if (month.comparison.kind !== 'readings') throw new Error('expected readings');
    expect(month.comparison.from.iso).toBe(HISTORY[1].capturedAt);
    expect(month.improvements.meta).toMatch(/^Compared to /);
    expect(month.improvements.meta).not.toContain('first scan');
  });

  it('compares up to the chosen scan', () => {
    const view = buildProgress(input(), { ...UI, selectedScanId: 's14' });
    expect(view.selectedScanId).toBe('s14');
    if (view.comparison.kind !== 'readings') throw new Error('expected readings');
    expect(view.comparison.to.iso).toBe(HISTORY[1].capturedAt);
  });

  it('keeps the comparison when the oldest scan in the range is chosen', () => {
    /* Choosing the range's first scan (s70) must not empty the comparison or key improvements. */
    const view = buildProgress(input(), { ...UI, range: '3M', selectedScanId: 's70' });
    expect(view.selectedScanId).toBe('s70');
    if (view.comparison.kind !== 'readings') throw new Error('expected readings');
    expect(view.comparison.from.iso).toBe(HISTORY[3].capturedAt);
    expect(view.comparison.to.iso).toBe(HISTORY[0].capturedAt);
    expect(view.comparison.latest).toBe(true);
    expect(view.improvements.empty).toBeNull();
    expect(strings(view)).not.toMatch(/No scans in|once this range holds two scans/);
  });

  it('labels a chosen scan as chosen, and names both dates in key improvements', () => {
    const view = buildProgress(input(), { ...UI, selectedScanId: 's14' });
    if (view.comparison.kind !== 'readings') throw new Error('expected readings');
    expect(view.comparison.latest).toBe(false);
    expect(view.improvements.meta).toBe(`From ${view.comparison.from.short} to ${view.comparison.to.short}`);
    const latest = buildProgress(input(), UI);
    if (latest.comparison.kind !== 'readings') throw new Error('expected readings');
    expect(latest.comparison.latest).toBe(true);
    expect(latest.selectedScanId).toBe('s2');
  });

  it('lets a guest choose among scans that have no id', () => {
    const idless = HISTORY.map(({ id: _id, ...rest }) => rest as SkinAnalysis);
    const base = buildProgress(input({ scans: idless, summary: null, guest: true, user: null }), UI);
    expect(base.selectedScanId).toBe(idless[0].capturedAt);
    expect(base.recent.items.map((i) => i.id)).toContain(base.selectedScanId);
    const chosen = buildProgress(input({ scans: idless, summary: null, guest: true, user: null }), {
      ...UI,
      selectedScanId: idless[1].capturedAt,
    });
    expect(chosen.selectedScanId).toBe(idless[1].capturedAt);
    if (chosen.comparison.kind !== 'readings') throw new Error('expected readings');
    expect(chosen.comparison.to.iso).toBe(idless[1].capturedAt);
  });

  it('marks tiles that cannot change the card as not selectable', () => {
    const week = buildProgress(input(), { ...UI, range: '1W' });
    expect(week.recent.items.every((i) => !i.selectable)).toBe(true);
    expect(week.selectedScanId).toBeNull();
    expect(buildProgress(input(), UI).recent.items.every((i) => i.selectable)).toBe(true);
  });

  it('captions a photo pair with the two photos’ own scans, never the range’s first scan', () => {
    const photos = [
      { id: 'p14', skinScanId: 's14', createdAt: '', capturedAt: HISTORY[1].capturedAt, consentEventId: 'c' },
      { id: 'p2', skinScanId: 's2', createdAt: '', capturedAt: HISTORY[0].capturedAt, consentEventId: 'c' },
    ];
    const view = buildProgress(input({ photos, user: user(true) }), UI);
    if (view.comparison.kind !== 'photos') throw new Error('expected photos');
    expect(view.comparison.before.photoId).toBe('p14');
    expect(view.comparison.caption).toBe(describeChanges(compareReadings(HISTORY[1], HISTORY[0])));
    expect(view.comparison.caption).not.toBe(describeChanges(compareReadings(HISTORY[3], HISTORY[0])));
    expect(view.selectedScanId).toBe('s2');
    /* Scans without a photo cannot be put on a photo comparison, so they are not buttons. */
    expect(view.recent.items.filter((i) => i.selectable).map((i) => i.id)).toEqual(['s2', 's14']);

    const unlinked = buildProgress(
      input({ photos: [{ ...photos[0], skinScanId: null }, photos[1]], user: user(true) }),
      UI,
    );
    if (unlinked.comparison.kind !== 'photos') throw new Error('expected photos');
    expect(unlinked.comparison.caption).toBeNull();
  });

  it('opens the timeline on the biggest mover either way, not the most flattering one', () => {
    const worse = [
      scan(2, { hydration: 55, texture: 70 }),
      scan(30, { hydration: 50, texture: 50 }),
    ];
    const view = buildProgress(input({ scans: worse, summary: null }), UI);
    expect(view.timeline.metric).toBe('texture');
    /* Choosing a scan does not change the plotted reading. */
    expect(buildProgress(input(), { ...UI, selectedScanId: 's14' }).timeline.metric).toBe(
      buildProgress(input(), UI).timeline.metric,
    );
  });

  it('gives each recent scan its real changes since the one before', () => {
    const view = buildProgress(input(), UI);
    const first = view.recent.items.find((i) => i.id === 's70')!;
    expect(first.chips[0].label).toBe('First scan');
    const latest = view.recent.items[0];
    expect(latest.chips.map((c) => c.label)).toEqual(['Breakout signs −10 pts', 'Hydration +4 pts']);
    expect(latest.chips.map((c) => c.tone)).toEqual(['good', 'good']);
  });

  it('claims only scan-count milestones, the next at its real fraction', () => {
    expect(scanMilestones(4, 68).map((m) => m.label)).toEqual([
      'Completed your first scan',
      'Completed 3 scans',
      'Tracking your skin for 68 days',
      '5 scans: 4 of 5 done',
    ]);
    expect(scanMilestones(4, 68).at(-1)!.fraction).toBeCloseTo(0.8);
    expect(scanMilestones(0, 0)).toEqual([{ label: 'Your first scan', state: 'progress', fraction: 0 }]);
  });

  it('raises a toast only for a fresh scan with a real improvement', () => {
    expect(buildProgress(input(), UI).toast).toBeNull();
    const fresh = [scan(0.5, { ...HISTORY[0].metrics, hydration: 70 }, 'new'), ...HISTORY];
    const view = buildProgress(input({ scans: fresh, summary: summarise([...fresh].reverse()) }), UI);
    expect(view.toast?.body).toBe('Hydration improved by 6 points since the scan before.');
    const flat = [scan(0.5, { ...HISTORY[0].metrics, hydration: 65 }, 'flat'), ...HISTORY];
    expect(buildProgress(input({ scans: flat, summary: null }), UI).toast).toBeNull();
  });

  it('is honestly empty with no scans, for an account or a guest', () => {
    for (const guest of [false, true]) {
      const view = buildProgress(input({ scans: [], summary: null, guest, user: guest ? null : user() }), UI);
      expect(view.score.kind).toBe('empty');
      expect(view.comparison.kind).toBe('empty');
      expect(view.improvements.items).toHaveLength(0);
      expect(view.recent.items).toHaveLength(0);
      expect(view.insights.paragraphs).toHaveLength(0);
      expect(view.toast).toBeNull();
      if (view.comparison.kind === 'empty') expect(view.comparison.invite === null).toBe(guest);
    }
  });

  it('never compares across analysis versions', () => {
    const old = { ...scan(80, { hydration: 10 }), modelVersion: 'elohim-skin-0.9.0' };
    const view = buildProgress(input({ scans: [...HISTORY, old], summary: null }), { ...UI, range: 'All' });
    if (view.comparison.kind !== 'readings') throw new Error('expected readings');
    expect(view.comparison.from.iso).toBe(HISTORY[3].capturedAt);
    expect(view.timeline.points).toHaveLength(4);
    expect(view.timeline.note).toMatch(/analysis version/);
  });
});

describe('sample mode', () => {
  it('is the mockup, verbatim', () => {
    expect(SAMPLE_PROGRESS.mode).toBe('sample');
    expect(SAMPLE_PROGRESS.subtitle).toBe('Real changes. A healthier, brighter you.');
    if (SAMPLE_PROGRESS.score.kind !== 'sample-score') throw new Error('expected the sample score');
    expect(SAMPLE_PROGRESS.score.value).toBe(82);
    expect(SAMPLE_PROGRESS.score.bars.map((b) => `${b.label} ${b.value}`)).toEqual([
      'Texture 85',
      'Clarity 78',
      'Even tone 72',
      'Hydration 88',
      'Firmness 80',
    ]);
    expect(SAMPLE_PROGRESS.improvements.items.map((i) => i.value)).toEqual(['-42%', '+36%', '+28%', '-31%']);
    expect(SAMPLE_PROGRESS.recent.items.map((i) => i.score?.value)).toEqual([82, 76, 68, 64]);
    expect(SAMPLE_PROGRESS.comparison.kind).toBe('photos');
  });

  it('moves the sample comparison to the chosen tile, and says the ranges do not re-cut it', () => {
    const base = sampleProgress({ range: '3M', metric: null, selectedScanId: null });
    expect(base.selectedScanId).toBe('s-aug');
    expect(base.rangeNote).toBeNull();
    const jul = sampleProgress({ range: '3M', metric: null, selectedScanId: 's-jul' });
    expect(jul.selectedScanId).toBe('s-jul');
    if (jul.comparison.kind !== 'photos') throw new Error('expected photos');
    expect(jul.comparison.after.date.short).toBe('Jul 15');
    expect(jul.comparison.latest).toBe(false);
    const may = sampleProgress({ range: '3M', metric: null, selectedScanId: 's-may' });
    expect(may.selectedScanId).toBe('s-may');
    expect(may.comparison).toEqual(SAMPLE_PROGRESS.comparison);
    expect(sampleProgress({ range: '1W', metric: null, selectedScanId: null }).rangeNote).toMatch(/every range/);
  });
});

describe('chart geometry', () => {
  it('never overshoots between two readings', () => {
    const d = monotonePath([
      { x: 0, y: 50 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 30, y: 60 },
    ]);
    const ys = (d.match(/-?[\d.]+/g) ?? []).map(Number).filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...ys)).toBeLessThanOrEqual(60);
  });

  it('labels months across a quarter and days across a week', () => {
    const q = timeTicks(Date.UTC(2024, 3, 12), Date.UTC(2024, 7, 10), 'en-US');
    expect(q.map((t) => t.label)).toEqual(['May', 'Jun', 'Jul', 'Aug']);
    const w = timeTicks(Date.UTC(2024, 7, 1, 12), Date.UTC(2024, 7, 8, 12), 'en-US');
    expect(w.length).toBeGreaterThanOrEqual(6);
  });
});
