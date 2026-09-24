/**
 * The Routine screen's view model (BUILD-PLAN section 3.2).
 *
 * The page renders only from a `RoutineView`. In sample mode that is the
 * mockup's own content (`src/sample/fixtures/routine.ts`); otherwise it is
 * built here from what the app actually has: the routine plan the server
 * derives from the latest scan (`RoutinePlan`: cleanse, treat, hydrate and
 * protect steps, each with its reason, its rationale and its cautions), the
 * shelf picks for that plan, and the profile.
 *
 * What the plan does not carry is never made up (specs/data-map.md section 3):
 *
 * - no durations, amounts, instructions or technique tips: those lines are
 *   null and the card leaves them out;
 * - no lesson media: there is no video or demo clip for any step, so the
 *   Video / 3D View switch and the player are not drawn;
 * - no completion records: nothing is ticked, locked or "current". Every step
 *   is simply open, and the one shown in the card is marked as shown;
 * - no morning / evening split: suggestions have no time-of-day field yet, so
 *   they are one list. If the server ever adds `slot` to each suggestion the
 *   tabs come back on their own;
 * - no order of application either. The plan is a set of suggestions, not one
 *   session: several `treat` suggestions carry cautions against using them
 *   together ("Never the same night as another acid."), and the server sinks
 *   anything already covered to the end, after SPF. So real mode never says
 *   "Step 2 of 4" or "in the order you apply them": the card counts
 *   suggestions, the list groups them by kind (cleanse, treat, hydrate,
 *   protect) and anything a logged product already covers sits in its own
 *   group below;
 * - no order of the user's own: Reorder is sample-only until an order can be
 *   saved.
 */
import type { IconName } from '@/ui/icons.ts';
import type { ProductPick, RoutinePlan, RoutineStep, SkinProfile, Suggestion } from '@shared/types.ts';

export type RoutineSlotId = 'morning' | 'evening' | 'weekly' | 'all';

/**
 * done / current / locked are the mockup's completion states and appear only
 * in sample mode, where they are the design's. `open` is real mode's only
 * state: a step with no completion record either way.
 */
export type StepState = 'done' | 'current' | 'locked' | 'open';

/** The unbranded package drawn for a step (products.md-style SVG, no marks). */
export type ProductArtKind = 'tube' | 'bottle' | 'dropper' | 'jar';

/**
 * The illustrated technique lesson on the step card. Sample only: no step in
 * the real plan has lesson media.
 */
export interface RoutineLesson {
  /** The overlay caption, one entry per rendered line. */
  caption: string[];
  /** Where the illustration's timeline starts, in seconds. */
  positionSec: number;
  durationSec: number;
}

export interface RoutineTip {
  /** "Evia tip" for the sample's technique tip, "Keep in mind" for real cautions. */
  title: string;
  /** One paragraph each (the plan's cautions are separate sentences). */
  lines: string[];
}

export interface RoutineStepView {
  key: string;
  title: string;
  /** The one line under the title (the list row and the card's subtitle). */
  description: string | null;
  /** The list row's amount or duration line ("30–60 seconds"). */
  amount: string | null;
  /** The card's duration line ("30 seconds"). */
  duration: string | null;
  /** The card's paragraph: the sample's instructions, or the plan's rationale. */
  instructions: string | null;
  tip: RoutineTip | null;
  state: StepState;
  art: ProductArtKind;
  /** A real catalogue image, when a shelf pick for this step has one. */
  imageUrl: string | null;
  /** Real: the kind of step ("Cleanse"). */
  stepLabel: string | null;
  /** Real: why the step is in the plan ("For your oiliness reading"). */
  reason: string | null;
  /** Real: the ingredients to look for on a label. */
  lookFor: string[];
  /** Real: products already in use that do this job. */
  coveredBy: string[];
  lesson: RoutineLesson | null;
  /** Real: a shelf or web pick exists for this step (Products lists it). */
  hasPick: boolean;
}

export interface RoutineSlotView {
  id: RoutineSlotId;
  /** The tab label ("Morning"). */
  label: string;
  icon: IconName;
  /** The list heading ("Your morning routine"). */
  heading: string;
  /** "4 steps • ~6 min" in the sample; the count alone in real mode. */
  meta: string;
  steps: RoutineStepView[];
  /** The step the card opens on. */
  focus: number;
  /**
   * Real mode: where the steps a logged product already covers begin (they are
   * listed as their own group, after the rest). Null when there are none.
   */
  coveredFrom: number | null;
  /** What an empty slot says instead of a list. */
  empty: { title: string; body: string } | null;
}

export interface RoutineWhyDetail {
  title: string;
  text: string;
}

export interface RoutineWhy {
  title: string;
  body: string;
  details: RoutineWhyDetail[];
}

/**
 * ready     a plan to show
 * clear     a plan with nothing in it: the latest reading called for no new
 *           step (the user has scanned; this is not "no routine yet")
 * loading   asking the server for it
 * no-plan   nothing to build one from yet (no scan; a guest who has not scanned)
 * error     the server could not be asked
 */
export type RoutineStatus = 'ready' | 'clear' | 'loading' | 'no-plan' | 'error';

export interface RoutineView {
  mode: 'sample' | 'real';
  status: RoutineStatus;
  subtitle: string;
  description: string;
  /**
   * The list is one session in order ("Step 2 of 4"): the sample. Real plans
   * are suggestions, counted as such ("Suggestion 2 of 4").
   */
  sequence: boolean;
  /** Show the Morning / Evening / Weekly tabs (only when the data splits). */
  split: boolean;
  /** Said where the tabs would be when there is no split to show. */
  splitNote: string | null;
  slots: RoutineSlotView[];
  initialSlot: RoutineSlotId;
  why: RoutineWhy | null;
  /** Reorder only where an order can be kept (the sample, locally). */
  canReorder: boolean;
}

/* ------------------------------------------------------------------------ */
/* Real mode                                                                */
/* ------------------------------------------------------------------------ */

export const STEP_LABEL: Record<RoutineStep, string> = {
  cleanse: 'Cleanse',
  treat: 'Treat',
  hydrate: 'Hydrate',
  protect: 'Protect',
};

/** The kinds in the order the list groups them (server/skin/recommend.ts STEP_ORDER). */
const KIND_ORDER: RoutineStep[] = ['cleanse', 'treat', 'hydrate', 'protect'];

/** The package each kind of step is drawn as, when there is no real image. */
export const STEP_ART: Record<RoutineStep, ProductArtKind> = {
  cleanse: 'tube',
  treat: 'dropper',
  hydrate: 'jar',
  protect: 'bottle',
};

const SLOT_META: Record<Exclude<RoutineSlotId, 'all'>, { label: string; icon: IconName; heading: string }> = {
  morning: { label: 'Morning', icon: 'sun', heading: 'Your morning routine' },
  evening: { label: 'Evening', icon: 'moon', heading: 'Your evening routine' },
  weekly: { label: 'Weekly', icon: 'calendar', heading: 'Your weekly routine' },
};

/** The server may one day say when a step belongs; today it does not. */
type SlottedSuggestion = Suggestion & { slot?: 'am' | 'pm' | 'weekly' };
const SLOT_OF: Record<'am' | 'pm' | 'weekly', Exclude<RoutineSlotId, 'all'>> = {
  am: 'morning',
  pm: 'evening',
  weekly: 'weekly',
};

export interface RoutineRealInput {
  plan: RoutinePlan | null;
  /** Where the plan request stands. */
  status: 'loading' | 'ready' | 'error';
  picks: ProductPick[];
  profile: SkinProfile | null;
  guest: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Whether the profile holds anything the plan could have used. The plan reads
 * the skin type, the sensitivities and the pregnancy answer (profileTerms in
 * server/skin/recommend.ts); it never reads `concerns`, so concerns alone do
 * not make it "built from your profile".
 */
function profileUsed(profile: SkinProfile | null): boolean {
  if (!profile) return false;
  return (
    profile.skinType !== 'unknown' ||
    profile.sensitivities.length > 0 ||
    profile.pregnancyStatus !== 'unknown'
  );
}

/**
 * Why a step is in the plan, from the rule that put it there.
 *
 * SPF is the only rule without a reading behind it. The server adds it
 * whenever no *logged* product carries SPF - which is every guest (a guest
 * cannot log products) and every account with an empty list - so the reason
 * speaks of logged products, never of what the user actually uses.
 */
function reasonFor(s: Suggestion, guest: boolean): string | null {
  if (s.because) return `For your ${s.because.label.toLowerCase()} reading`;
  if (s.family === 'spf') {
    return guest ? 'Sun protection is part of every plan' : 'Added because no product you have logged has SPF';
  }
  return null;
}

/**
 * The plan's caveat as this page can stand behind it. One of the server's
 * caveats ends "and I say where it is from and what it costs", which is true in
 * chat and on Products but not here: this page names no source and no price.
 * That clause is dropped; any other caveat is shown word for word.
 */
function caveatHere(caveat: string): string {
  return caveat.replace(/,? and I say where it is from and what it costs\./, '.');
}

/** Kinds in list order; within a kind the server's order (most severe first) stands. */
const byKind = (a: Suggestion, b: Suggestion) => KIND_ORDER.indexOf(a.step) - KIND_ORDER.indexOf(b.step);

function pickFor(s: Suggestion, picks: ProductPick[]): ProductPick | undefined {
  return picks.find((p) => p.suggestion.step === s.step && p.suggestion.title === s.title);
}

function stepFromSuggestion(s: Suggestion, index: number, picks: ProductPick[], guest: boolean): RoutineStepView {
  const pick = pickFor(s, picks);
  return {
    key: `${s.step}-${index}-${s.title}`,
    title: s.title,
    description: s.actives.length ? `Look for ${s.actives.join(', ')}` : null,
    amount: null,
    duration: null,
    instructions: s.why || null,
    tip: s.cautions.length ? { title: 'Keep in mind', lines: s.cautions } : null,
    state: 'open',
    art: STEP_ART[s.step],
    imageUrl: pick?.product?.imageUrl ?? null,
    stepLabel: STEP_LABEL[s.step],
    reason: reasonFor(s, guest),
    lookFor: s.actives,
    coveredBy: s.alreadyCovered ? s.coveredBy : [],
    lesson: null,
    hasPick: Boolean(pick && (pick.product || pick.offers.length || pick.bestUrl)),
  };
}

/**
 * The list's order, whatever order the suggestions arrive in: grouped by
 * kind, and what a logged product already covers after the rest (it is
 * context, not something to add).
 */
function grouped(suggestions: Suggestion[]): { todo: Suggestion[]; covered: Suggestion[] } {
  return {
    todo: suggestions.filter((s) => !s.alreadyCovered).sort(byKind),
    covered: suggestions.filter((s) => s.alreadyCovered).sort(byKind),
  };
}

function realSlot(
  id: RoutineSlotId,
  suggestions: Suggestion[],
  picks: ProductPick[],
  guest: boolean,
): RoutineSlotView {
  const { todo, covered } = grouped(suggestions);
  const steps = [...todo, ...covered].map((s, i) => stepFromSuggestion(s, i, picks, guest));
  const meta = id === 'all' ? null : SLOT_META[id];
  return {
    id,
    label: meta?.label ?? 'All suggestions',
    icon: meta?.icon ?? 'clipboard-list',
    heading: meta?.heading ?? 'Your plan',
    // No durations exist, so the count stands alone (no "~6 min").
    meta: plural(steps.length, 'suggestion') + (covered.length ? `, ${covered.length} already covered` : ''),
    steps,
    focus: 0,
    coveredFrom: covered.length && todo.length ? todo.length : null,
    empty: steps.length
      ? null
      : { title: 'Nothing here yet', body: 'Your plan has no suggestions for this part of the day.' },
  };
}

const REAL_SUBTITLE = 'Your personalised skincare plan';

export function buildRoutine(input: RoutineRealInput): RoutineView {
  const { plan, status, picks, profile, guest } = input;
  const usedProfile = profileUsed(profile);

  const base = {
    mode: 'real' as const,
    subtitle: REAL_SUBTITLE,
    sequence: false,
    split: false,
    splitNote: null,
    slots: [] as RoutineSlotView[],
    initialSlot: 'all' as RoutineSlotId,
    why: null,
    canReorder: false,
  };

  if (status === 'loading' && !plan) {
    return { ...base, status: 'loading', description: 'Fetching the plan from your latest reading.' };
  }
  if (status === 'error' && !plan) {
    return { ...base, status: 'error', description: 'Your plan could not be loaded just now.' };
  }
  if (!plan) {
    return {
      ...base,
      status: 'no-plan',
      description: guest
        ? 'Scan your skin and the steps are built from that reading. Nothing is kept after you leave.'
        : 'Scan your skin once and the steps are built from that reading.',
    };
  }

  const source = usedProfile
    ? 'your latest skin reading and the details in your profile'
    : 'your latest skin reading';
  const caveat = caveatHere(plan.caveat);
  const gapDetail: RoutineWhyDetail[] = plan.gaps.length
    ? [
        {
          title: 'Not covered yet',
          text: `Nothing in your plan or your products covers ${plan.gaps.map((g) => STEP_LABEL[g].toLowerCase()).join(', ')}.`,
        },
      ]
    : [];

  /* A scan with nothing to change is not "no routine yet": the user has
     scanned, and the caveat and the gaps still apply. */
  if (plan.suggestions.length === 0) {
    return {
      ...base,
      status: 'clear',
      description: 'Your latest reading did not call for any changes.',
      why: {
        title: 'Why no changes?',
        body: `This is worked out from ${source} each time you open it. A step is only suggested when a reading is past its threshold by more than the measurement noise. ${caveat}`,
        details: gapDetail,
      },
    };
  }

  const suggestions = plan.suggestions as SlottedSuggestion[];
  const slotted = suggestions.every((s) => s.slot && s.slot in SLOT_OF);
  const bySlot: [RoutineSlotId, Suggestion[]][] = slotted
    ? (['morning', 'evening', 'weekly'] as const).map((id) => [
        id,
        suggestions.filter((s) => s.slot && SLOT_OF[s.slot] === id),
      ])
    : [['all', suggestions]];
  const slots = bySlot.map(([id, list]) => realSlot(id, list, picks, guest));

  const initial = slots.find((s) => s.steps.length)?.id ?? slots[0].id;

  // Opened, the why card walks the list in its own order.
  const details: RoutineWhyDetail[] = bySlot
    .flatMap(([, list]) => {
      const { todo, covered } = grouped(list);
      return [...todo, ...covered];
    })
    .map((s) => {
      const coveredBy = s.alreadyCovered && s.coveredBy.length ? `Already covered by ${s.coveredBy.join(', ')}.` : '';
      const reason = reasonFor(s, guest);
      return {
        title: s.title,
        text: [reason ? `${reason}.` : `${STEP_LABEL[s.step]} step.`, coveredBy].filter(Boolean).join(' '),
      };
    });
  details.push(...gapDetail);

  return {
    ...base,
    status: 'ready',
    description: `Suggestions built from ${source}.`,
    split: slotted,
    splitNote: slotted
      ? null
      : 'These are suggestions grouped by kind, not steps to do in one go: your plan does not say which are for morning or evening. Read each one’s notes before using two together.',
    slots,
    initialSlot: initial,
    why: {
      title: 'Why this routine?',
      body: `This routine is built from ${source}. It is worked out again from your newest scan each time you open it. ${caveat}`,
      details,
    },
  };
}

/**
 * The view the page renders: the sample when sample mode is on, otherwise the
 * real builder. The sample is passed in rather than imported so this module
 * stays free of the fixture (and the fixture free of the page).
 */
export function routineView(sampleOn: boolean, sampleView: RoutineView, real: RoutineRealInput): RoutineView {
  return sampleOn ? sampleView : buildRoutine(real);
}
