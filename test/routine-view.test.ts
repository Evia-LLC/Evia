/**
 * The Routine screen's honesty.
 *
 * The sample is the mockup, word for word. The real view is built from the
 * routine plan alone, so everything the plan does not carry - durations,
 * amounts, lesson media, completion, a morning/evening split, an order of
 * application, an order of the user's own - must stay absent rather than be
 * filled in. And a guest's visit must never ask the server for routine data
 * (it used to, and got a 401).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoutinePlan, SkinProfile, Suggestion } from '../shared/types.ts';

const api = vi.hoisted(() => ({
  routinePlan: vi.fn(async () => ({ plan: null })),
  routine: vi.fn(async () => ({ usage: [], review: { stacked: [], conflicts: [], missing: [], unrecognisedCount: 0 } })),
  routineOutcomes: vi.fn(async () => ({ outcomes: [] })),
}));
vi.mock('../src/lib/api.ts', () => ({ api }));
vi.mock('../src/state/controller.ts', () => ({ refreshPicks: vi.fn(async () => {}) }));

import { SAMPLE_ROUTINE } from '../src/sample/fixtures/routine.ts';
import { buildRoutine, routineView } from '../src/view/routine.ts';
import { RoutineData } from '../src/pages/routine/routine-data.svelte.ts';
import { session } from '../src/state/session.svelte.ts';

const PROFILE: SkinProfile = {
  skinType: 'unknown',
  fitzpatrick: null,
  concerns: [],
  sensitivities: [],
  pregnancyStatus: 'unknown',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const suggestion = (over: Partial<Suggestion>): Suggestion => ({
  step: 'cleanse',
  title: 'A gentle salicylic cleanser',
  actives: ['Salicylic Acid'],
  family: 'exfoliating-acid',
  because: { key: 'oiliness', value: 64, label: 'Oiliness' },
  why: 'It is oil-soluble, so it clears the inside of pores rather than just the surface.',
  cautions: ['Once a day at most to start.'],
  alreadyCovered: false,
  coveredBy: [],
  priority: 0.4,
  ...over,
});

const PLAN: RoutinePlan = {
  suggestions: [
    suggestion({}),
    suggestion({
      step: 'protect',
      title: 'Daily broad-spectrum SPF',
      actives: ['Zinc Oxide'],
      family: 'spf',
      because: null,
      why: 'The one step that protects everything else.',
      cautions: [],
    }),
  ],
  gaps: ['hydrate'],
  caveat: "I don't know what you're currently using, so some of this may already be covered.",
};

const real = (plan: RoutinePlan | null, over: Partial<Parameters<typeof buildRoutine>[0]> = {}) =>
  buildRoutine({ plan, status: 'ready', picks: [], profile: PROFILE, guest: false, ...over });

afterEach(() => {
  session.reset();
  vi.clearAllMocks();
});

describe('the sample routine', () => {
  it('is the mockup, word for word', () => {
    const morning = SAMPLE_ROUTINE.slots.find((s) => s.id === 'morning');
    expect(SAMPLE_ROUTINE.mode).toBe('sample');
    expect(SAMPLE_ROUTINE.subtitle).toBe('Your personalised skincare plan');
    expect(SAMPLE_ROUTINE.description).toBe(
      'Step-by-step guidance, tailored to your skin, your goals and your lifestyle.',
    );
    expect(morning?.heading).toBe('Your morning routine');
    expect(morning?.meta).toBe('4 steps • ~6 min');
    expect(morning?.steps.map((s) => [s.title, s.amount, s.state])).toEqual([
      ['Gentle Cleanser', '30–60 seconds', 'done'],
      ['Hydrating Toner', '30 seconds', 'current'],
      ['Niacinamide Serum', '2–3 drops', 'locked'],
      ['Moisturiser', 'A pea-sized amount', 'locked'],
    ]);
    const toner = morning?.steps[morning.focus];
    expect(toner?.title).toBe('Hydrating Toner');
    expect(toner?.tip?.lines.join(' ')).toContain('Don’t rub.');
    expect(toner?.lesson).toEqual({ caption: ['Gentle, upward', 'motions'], positionSec: 12, durationSec: 30 });
  });

  it('shows no evening or weekly steps the mockup never drew', () => {
    for (const id of ['evening', 'weekly'] as const) {
      const slot = SAMPLE_ROUTINE.slots.find((s) => s.id === id);
      expect(slot?.steps).toEqual([]);
      expect(slot?.empty?.title).toMatch(/in this sample/);
    }
    expect(SAMPLE_ROUTINE.sequence).toBe(true);
  });

  it('is only used while sample mode is on', () => {
    const input = { plan: null, status: 'ready' as const, picks: [], profile: PROFILE, guest: false };
    expect(routineView(true, SAMPLE_ROUTINE, input)).toBe(SAMPLE_ROUTINE);
    expect(routineView(false, SAMPLE_ROUTINE, input).mode).toBe('real');
  });
});

describe('the real routine', () => {
  it('without a plan shows the empty state and nothing else', () => {
    const view = real(null);
    expect(view.status).toBe('no-plan');
    expect(view.slots).toEqual([]);
    expect(view.why).toBeNull();
    expect(real(null, { guest: true }).description).toMatch(/Nothing is kept/);
  });

  it('reports loading and failure rather than an empty plan', () => {
    expect(real(null, { status: 'loading' }).status).toBe('loading');
    expect(real(null, { status: 'error' }).status).toBe('error');
  });

  it('lists suggestions, with no invented durations, media, completion, split or order', () => {
    const view = real(PLAN);
    expect(view.status).toBe('ready');
    expect(view.sequence).toBe(false);
    expect(view.split).toBe(false);
    expect(view.splitNote).toMatch(/morning or evening/);
    expect(view.splitNote).not.toMatch(/order you apply/);
    expect(view.description).not.toMatch(/step by step/i);
    expect(view.canReorder).toBe(false);
    expect(view.slots).toHaveLength(1);
    const [slot] = view.slots;
    expect(slot.meta).toBe('2 suggestions');
    expect(slot.meta).not.toMatch(/min/);
    expect(slot.coveredFrom).toBeNull();
    expect(slot.steps.map((s) => s.title)).toEqual(['A gentle salicylic cleanser', 'Daily broad-spectrum SPF']);
    for (const step of slot.steps) {
      expect(step.state).toBe('open');
      expect(step.duration).toBeNull();
      expect(step.amount).toBeNull();
      expect(step.lesson).toBeNull();
    }
  });

  it('groups by kind and keeps what is already covered apart, whatever order the plan arrives in', () => {
    // The server's own order: uncovered first, then covered - so a covered
    // treat step arrives after SPF.
    const covered = suggestion({
      step: 'treat',
      title: 'Centella or niacinamide',
      actives: ['Niacinamide'],
      family: 'soothing',
      because: { key: 'redness', value: 58, label: 'Redness' },
      cautions: [],
      alreadyCovered: true,
      coveredBy: ['Calm Serum'],
    });
    const serverOrder = { ...PLAN, suggestions: [PLAN.suggestions[0], PLAN.suggestions[1], covered] };
    const [slot] = real(serverOrder).slots;
    expect(slot.steps.map((s) => s.title)).toEqual([
      'A gentle salicylic cleanser',
      'Daily broad-spectrum SPF',
      'Centella or niacinamide',
    ]);
    expect(slot.coveredFrom).toBe(2);
    expect(slot.meta).toBe('3 suggestions, 1 already covered');
    expect(slot.steps[2].coveredBy).toEqual(['Calm Serum']);

    // Out of order in, grouped by kind out.
    const shuffled = { ...PLAN, suggestions: [PLAN.suggestions[1], PLAN.suggestions[0]] };
    expect(real(shuffled).slots[0].steps.map((s) => s.stepLabel)).toEqual(['Cleanse', 'Protect']);
  });

  it('shows what the plan does carry: the reason, the rationale and the cautions', () => {
    const [cleanser, spf] = real(PLAN).slots[0].steps;
    expect(cleanser.stepLabel).toBe('Cleanse');
    expect(cleanser.reason).toBe('For your oiliness reading');
    expect(cleanser.description).toBe('Look for Salicylic Acid');
    expect(cleanser.instructions).toBe(PLAN.suggestions[0].why);
    expect(cleanser.tip).toEqual({ title: 'Keep in mind', lines: ['Once a day at most to start.'] });
    // SPF is added when no *logged* product has it: never a claim about what
    // the user actually uses, and a guest cannot log products at all.
    expect(spf.reason).toBe('Added because no product you have logged has SPF');
    expect(real(PLAN, { guest: true }).slots[0].steps[1].reason).toBe('Sun protection is part of every plan');
    expect(spf.tip).toBeNull();
  });

  it('writes "why" from the real inputs, with the plan caveat and its gaps', () => {
    const why = real(PLAN).why;
    expect(why?.body).toContain('your latest skin reading');
    expect(why?.body).not.toMatch(/goals|lifestyle|learn more about your skin/);
    expect(why?.body).toContain(PLAN.caveat);
    expect(why?.details.at(-1)?.text).toMatch(/hydrate/);
    const withProfile = real(PLAN, { profile: { ...PROFILE, sensitivities: ['fragrance'] } });
    expect(withProfile.why?.body).toContain('the details in your profile');
    // The plan never reads concerns, so concerns alone are not "your profile".
    const concernsOnly = real(PLAN, { profile: { ...PROFILE, concerns: ['redness'] } });
    expect(concernsOnly.why?.body).not.toContain('profile');
  });

  it('drops the caveat clause about sources and prices, which this page does not show', () => {
    const caveat =
      'Ingredients first. A product only earns a mention when it actually carries them, and I say where it is from and what it costs.';
    const body = real({ ...PLAN, caveat }).why?.body ?? '';
    expect(body).toContain('A product only earns a mention when it actually carries them.');
    expect(body).not.toMatch(/what it costs/);
  });

  it('tells a scanned user with nothing to change so, keeping the caveat and the gaps', () => {
    const view = real({ suggestions: [], gaps: ['hydrate'], caveat: PLAN.caveat });
    expect(view.status).toBe('clear');
    expect(view.description).toMatch(/did not call for any changes/);
    expect(view.why?.body).toContain(PLAN.caveat);
    expect(view.why?.details.map((d) => d.title)).toEqual(['Not covered yet']);
  });

  it('splits into morning and evening only when the plan says which is which', () => {
    const slotted = {
      ...PLAN,
      suggestions: [
        { ...PLAN.suggestions[0], slot: 'pm' },
        { ...PLAN.suggestions[1], slot: 'am' },
      ],
    } as RoutinePlan;
    const view = real(slotted);
    expect(view.split).toBe(true);
    expect(view.slots.map((s) => [s.id, s.steps.map((x) => x.title)])).toEqual([
      ['morning', ['Daily broad-spectrum SPF']],
      ['evening', ['A gentle salicylic cleanser']],
      ['weekly', []],
    ]);
    expect(view.initialSlot).toBe('morning');
  });
});

describe('what the page asks the server for', () => {
  it('asks nothing for a guest, and shows the plan their scan already made', async () => {
    session.guest = true;
    session.user = {
      id: 'guest',
      email: '',
      displayName: 'there',
      createdAt: '2026-09-01T00:00:00.000Z',
      profile: PROFILE,
      preferences: {} as never,
      consents: {},
      scanCount: 0,
    };
    session.plan = PLAN;
    const data = new RoutineData();
    await data.load();
    expect(api.routinePlan).not.toHaveBeenCalled();
    expect(api.routine).not.toHaveBeenCalled();
    expect(api.routineOutcomes).not.toHaveBeenCalled();
    expect(data.plan).toBe(PLAN);
  });

  it('asks for an account’s plan, products and outcomes, and survives a failure', async () => {
    session.user = {
      id: 'u1',
      email: 'a@b.c',
      displayName: 'Ada',
      createdAt: '2026-09-01T00:00:00.000Z',
      profile: PROFILE,
      preferences: {} as never,
      consents: {},
      scanCount: 1,
    };
    api.routinePlan.mockRejectedValueOnce(new Error('down'));
    const data = new RoutineData();
    await data.load();
    expect(api.routinePlan).toHaveBeenCalledOnce();
    expect(api.routine).toHaveBeenCalledOnce();
    expect(api.routineOutcomes).toHaveBeenCalledOnce();
    expect(data.planStatus).toBe('error');
    expect(data.productsStatus).toBe('ready');
  });
});
