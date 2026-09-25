/**
 * Routine recommendation — "what would actually work".
 *
 * Deterministic, explainable, and derived from the measured metrics plus what
 * the user already owns. Every suggestion carries the reason it was made and
 * the number that triggered it, because a recommendation a user cannot
 * interrogate is indistinguishable from an advert.
 *
 * Three rules hold this honest:
 *
 *  1. **Nothing is recommended off a reading inside the noise floor.** A metric
 *     that has not meaningfully moved is not evidence of anything.
 *  2. **Sensitivities and skin type veto actives, they do not merely warn.** If
 *     the profile says fragrance-sensitive, fragranced actives never surface.
 *  3. **Nothing already covered is suggested again**, and nothing that conflicts
 *     with what they already use is suggested without saying so.
 *
 * This recommends *ingredients and steps*, never brands. There is no catalogue
 * behind it and no commercial relationship — suggesting a specific product would
 * be inventing knowledge the system does not have.
 */
import {
  METRIC_LABELS,
  METRIC_NOISE_FLOOR,
  PREGNANCY_RESTRICTED,
  type SkinAppearanceMetrics,
  type SkinMetricKey,
  type SkinProfile,
  type ProductUsage,
} from '../../shared/types.ts';
import type { IngredientFamily } from './ingredient-data.ts';
import { matchIngredients } from './ingredients.ts';

export type RoutineStep = 'cleanse' | 'treat' | 'hydrate' | 'protect';

export const STEP_ORDER: RoutineStep[] = ['cleanse', 'treat', 'hydrate', 'protect'];

export const STEP_LABELS: Record<RoutineStep, string> = {
  cleanse: 'Cleanse',
  treat: 'Treat',
  hydrate: 'Hydrate',
  protect: 'Protect',
};

export interface Suggestion {
  step: RoutineStep;
  /** What to look for, in plain language. */
  title: string;
  /** INCI-ish names to look for on a label. */
  actives: string[];
  family: IngredientFamily;
  /** The metric that triggered this, and its value. */
  because: { key: SkinMetricKey; value: number; label: string } | null;
  /** Why this helps, in her voice. */
  why: string;
  /** Anything to be careful about, including layering conflicts. */
  cautions: string[];
  /** True when something in the current routine already does this job. */
  alreadyCovered: boolean;
  coveredBy: string[];
  /** 0..1 — drives ordering and how strongly she puts it. */
  priority: number;
}

export interface RoutinePlan {
  suggestions: Suggestion[];
  /** Steps with nothing in them at all. */
  gaps: RoutineStep[];
  /** Stated plainly so the plan never reads as more certain than it is. */
  caveat: string;
}

interface Rule {
  key: SkinMetricKey;
  /** Fires when the metric is at or beyond this, in the bad direction. */
  threshold: number;
  step: RoutineStep;
  title: string;
  actives: string[];
  family: IngredientFamily;
  why: string;
  /** Profile terms that veto this suggestion entirely. */
  vetoFor?: string[];
  /** A gentler alternative used when the veto fires. */
  fallback?: { title: string; actives: string[]; why: string };
  cautions?: string[];
}

/**
 * Ordered by how much difference the intervention usually makes, not by how
 * dramatic it sounds. Sun protection is first for a reason.
 */
const RULES: Rule[] = [
  {
    key: 'oiliness',
    threshold: 58,
    step: 'cleanse',
    title: 'A gentle salicylic cleanser',
    actives: ['Salicylic Acid'],
    family: 'exfoliating-acid',
    why: 'It is oil-soluble, so it clears the inside of pores rather than just the surface.',
    vetoFor: ['dry', 'sensitive'],
    fallback: {
      title: 'A non-stripping gel cleanser',
      actives: ['Glycerin', 'Coco-Betaine'],
      why: 'Cuts the oil without the tightness that pushes skin to make more of it.',
    },
    cautions: ['Once a day at most to start.'],
  },
  {
    key: 'acneIndicators',
    threshold: 45,
    step: 'treat',
    title: 'Azelaic acid',
    actives: ['Azelaic Acid'],
    family: 'exfoliating-acid',
    why: 'Unusually versatile — it works on breakouts, redness and the marks they leave, and it is well tolerated.',
    cautions: ['Give it six to eight weeks before judging it.'],
  },
  {
    key: 'redness',
    threshold: 48,
    step: 'treat',
    title: 'Centella or niacinamide',
    actives: ['Centella Asiatica', 'Niacinamide'],
    family: 'soothing',
    why: 'Calms visible irritation and supports the barrier that is letting it show.',
    cautions: [],
  },
  {
    key: 'texture',
    threshold: 55,
    step: 'treat',
    title: 'A low-strength retinoid',
    actives: ['Retinol', 'Retinaldehyde'],
    family: 'retinoid',
    why: 'The most evidence-backed thing there is for surface texture. Slowly is the whole trick.',
    vetoFor: ['sensitive', 'rosacea', 'eczema', 'pregnancy'],
    fallback: {
      title: 'Mandelic acid',
      actives: ['Mandelic Acid'],
      why: 'A large, slow acid — the gentlest way to work on texture when a retinoid is off the table.',
    },
    cautions: ['Two nights a week to begin with.', 'Never the same night as another acid.'],
  },
  {
    key: 'darkSpots',
    threshold: 45,
    step: 'treat',
    title: 'Tranexamic or azelaic acid',
    actives: ['Tranexamic Acid', 'Azelaic Acid'],
    family: 'brightening',
    why: 'Works on existing marks. Without daily sun protection alongside it, though, you are refilling the bath with the plug out.',
    cautions: ['Pointless without daily SPF.'],
  },
  {
    key: 'evenness',
    threshold: 45,
    step: 'treat',
    title: 'Vitamin C in the morning',
    actives: ['Ascorbic Acid', 'Ethyl Ascorbic Acid'],
    family: 'vitamin-c',
    why: 'Evens tone over time and adds antioxidant cover under your SPF.',
    vetoFor: ['sensitive'],
    fallback: {
      title: 'Niacinamide',
      actives: ['Niacinamide'],
      why: 'Slower on tone than vitamin C, and far less likely to sting.',
    },
    cautions: [],
  },
  {
    key: 'hydration',
    threshold: 55,
    step: 'hydrate',
    title: 'Humectants sealed with ceramides',
    actives: ['Hyaluronic Acid', 'Glycerin', 'Ceramide NP', 'Squalane'],
    family: 'hydration',
    why: 'Draws water in and then keeps it there. On damp skin, not dry.',
    cautions: [],
  },
  {
    key: 'underEye',
    threshold: 55,
    step: 'hydrate',
    title: 'A light eye cream',
    actives: ['Caffeine', 'Peptides', 'Glycerin'],
    family: 'hydration',
    why: 'Helps with the look of puffiness and keeps thin skin comfortable. Genetics and sleep do most of the work here, and no cream changes either.',
    cautions: [],
  },
];

/**
 * Which metric each ingredient family is prescribed to move.
 *
 * Derived from `RULES` rather than written out again, so the two can never
 * drift apart: the family that gets recommended *because* oiliness is high is
 * by definition the family that gets judged on oiliness later. Outcome checking
 * reads this to ask whether a product achieved the thing it was suggested for.
 *
 * First rule wins where a family appears twice — `RULES` is already ordered by
 * how much difference the intervention makes, so the first mention is the
 * primary indication.
 */
/**
 * Families that are never what a product is *for*, whatever order they appear
 * in. Ingredient lists are ordered by concentration, so water is almost always
 * first — and water's family is `texture`. Without this, every product in the
 * routine would be judged as a texture treatment.
 */
const INERT_FAMILIES: IngredientFamily[] = [
  'solvent',
  'preservative',
  'texture',
  'fragrance',
];

/**
 * Families that are understood but are not judged on a single number.
 *
 * SPF is the clearest case: it is recommended unconditionally rather than
 * because a metric was bad, so there is no reading it promised to move and
 * grading it against one would be inventing a claim it never made. Occlusives
 * are similar — they hold water in rather than change a measured property.
 */
const UNSCORED_FAMILIES: IngredientFamily[] = ['spf', 'occlusive'];

/**
 * Which metric each ingredient family is prescribed to move.
 *
 * The bulk is derived from `RULES` rather than written out again, so the two
 * can never drift apart: the family recommended *because* oiliness was high is
 * by definition the family judged on oiliness later. First rule wins where a
 * family appears twice — `RULES` is ordered by how much difference the
 * intervention makes, so the first mention is the primary indication.
 *
 * The explicit additions below are families the rules table never reaches,
 * because nothing in it is triggered by them. They still belong to a metric,
 * and a routine full of them would otherwise be unjudgeable.
 */
export const FAMILY_TARGETS: Partial<Record<IngredientFamily, SkinMetricKey>> = (() => {
  const map: Partial<Record<IngredientFamily, SkinMetricKey>> = {
    // Barrier repair (niacinamide, ceramides) is prescribed for water loss.
    barrier: 'hydration',
    // Antibacterials are in a routine for one reason.
    antibacterial: 'acneIndicators',
    // Peptides are sold on firmness, which this app reads as texture.
    peptide: 'texture',
  };
  for (const rule of RULES) {
    if (!map[rule.family]) map[rule.family] = rule.key;
  }
  for (const family of [...INERT_FAMILIES, ...UNSCORED_FAMILIES]) delete map[family];
  return map;
})();

/** True when the family is recognised but deliberately not graded on a metric. */
export function isUnscoredFamily(family: IngredientFamily): boolean {
  return UNSCORED_FAMILIES.includes(family);
}

/** Higher is worse for every metric except these two. */
const HIGHER_IS_BETTER: SkinMetricKey[] = ['hydration', 'evenness'];

function severity(key: SkinMetricKey, value: number, threshold: number): number {
  // For hydration/evenness the rule threshold means "at or below".
  if (HIGHER_IS_BETTER.includes(key)) {
    if (value > threshold) return 0;
    return Math.min(1, (threshold - value) / Math.max(1, threshold));
  }
  if (value < threshold) return 0;
  return Math.min(1, (value - threshold) / Math.max(1, 100 - threshold));
}

function profileTerms(profile: SkinProfile): string[] {
  return [
    ...profile.sensitivities.map((s) => s.toLowerCase()),
    profile.skinType.toLowerCase(),
    /*
     * Pregnancy comes from its own field rather than from whatever the user
     * happened to type into a free-text box.
     *
     * The retinoid rule has always carried `vetoFor: ['pregnancy']`, but the
     * only way to trigger it was to type the word into a "sensitivities" input
     * whose placeholder reads "fragrance, essential oils". A veto nobody can
     * reach is not a safety mechanism.
     */
    ...(PREGNANCY_RESTRICTED.includes(profile.pregnancyStatus) ? ['pregnancy'] : []),
  ];
}

const vetoed = (terms: string[], vetoFor?: string[]): boolean =>
  Boolean(vetoFor?.some((v) => terms.some((t) => t.includes(v) || v.includes(t))));

export function buildRoutinePlan(
  metrics: SkinAppearanceMetrics,
  profile: SkinProfile,
  currentRoutine: ProductUsage[],
  confidence: number,
): RoutinePlan {
  const terms = profileTerms(profile);

  // What the current routine already does, and which product does it.
  const covered = new Map<IngredientFamily, string[]>();
  const coveredSteps = new Set<RoutineStep>();

  for (const usage of currentRoutine) {
    const name = usage.product.brand
      ? `${usage.product.brand} ${usage.product.name}`
      : usage.product.name;
    for (const { rule } of matchIngredients(usage.product.ingredients).matches) {
      const list = covered.get(rule.family) ?? [];
      if (!list.includes(name)) list.push(name);
      covered.set(rule.family, list);
      if (rule.family === 'spf') coveredSteps.add('protect');
      if (rule.family === 'hydration' || rule.family === 'occlusive') coveredSteps.add('hydrate');
      if (rule.active) coveredSteps.add('treat');
    }
  }

  const suggestions: Suggestion[] = [];

  for (const rule of RULES) {
    const value = metrics[rule.key];
    const weight = severity(rule.key, value, rule.threshold);
    if (weight <= 0) continue;

    // A reading that has not cleared its own noise floor is not evidence.
    const distance = HIGHER_IS_BETTER.includes(rule.key)
      ? rule.threshold - value
      : value - rule.threshold;
    if (distance < METRIC_NOISE_FLOOR[rule.key]) continue;

    const blocked = vetoed(terms, rule.vetoFor);
    if (blocked && !rule.fallback) continue;

    const chosen = blocked && rule.fallback ? rule.fallback : rule;
    const family = blocked && rule.fallback ? 'soothing' : rule.family;
    const coveredBy = covered.get(rule.family) ?? [];

    const cautions = [...(rule.cautions ?? [])];
    if (blocked) {
      const reason = rule.vetoFor?.filter((v) => terms.some((t) => t.includes(v) || v.includes(t)));
      cautions.unshift(`Swapped off ${rule.title.toLowerCase()} because your profile lists ${reason?.join(', ')}.`);
    }
    /*
     * Unknown pregnancy status is not a "no".
     *
     * A hard veto on every unanswered profile would withhold the best-evidenced
     * treatment there is from most users over a question they were never asked.
     * So the suggestion stands and carries the condition on its face — which
     * also invites the disclosure, rather than waiting for the user to think of
     * volunteering it.
     */
    if (!blocked && rule.vetoFor?.includes('pregnancy') && profile.pregnancyStatus === 'unknown') {
      cautions.unshift(
        'Not for use if you are pregnant, trying to conceive, or breastfeeding — ' +
          'tell me if any of those apply and I will swap it.',
      );
    }

    // Layering conflicts, stated where they actually bite.
    if (family === 'retinoid' && covered.has('exfoliating-acid')) {
      cautions.push('You already use an acid — alternate nights rather than layering.');
    }
    if (family === 'exfoliating-acid' && covered.has('retinoid')) {
      cautions.push('You already use a retinoid — keep these to different nights.');
    }

    suggestions.push({
      step: rule.step,
      title: chosen.title,
      actives: chosen.actives,
      family,
      because: { key: rule.key, value: Math.round(value), label: METRIC_LABELS[rule.key] },
      why: chosen.why,
      cautions,
      alreadyCovered: coveredBy.length > 0,
      coveredBy,
      priority: weight,
    });
  }

  // Sun protection is not conditional on a reading — it is the one step that
  // matters regardless of what the scan said, so it is added on absence.
  if (!covered.has('spf')) {
    suggestions.push({
      step: 'protect',
      title: 'Daily broad-spectrum SPF',
      actives: ['Zinc Oxide', 'Tinosorb', 'Avobenzone'],
      family: 'spf',
      because: null,
      why: 'The single highest-value thing in any routine, and the one that protects everything else you are doing.',
      cautions: [],
      alreadyCovered: false,
      coveredBy: [],
      // Always worth including, but it must not outrank the concern that this
      // particular scan actually surfaced.
      priority: 0.12,
    });
  }

  // The scan decides the order. Previously STEP_ORDER won before severity, so
  // two very different faces still read as the same cleanse/treat/hydrate list.
  // Anything already covered still sinks: it is context, not an action.
  suggestions.sort((a, b) => {
    if (a.alreadyCovered !== b.alreadyCovered) return a.alreadyCovered ? 1 : -1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step);
  });

  const gaps = STEP_ORDER.filter(
    (step) => !coveredSteps.has(step) && !suggestions.some((s) => s.step === step),
  );

  return { suggestions, gaps, caveat: caveatFor(confidence, currentRoutine.length) };
}

function caveatFor(confidence: number, routineSize: number): string {
  if (confidence < 0.55) {
    return 'That capture was not a confident one, so treat this as a starting point rather than a verdict.';
  }
  if (routineSize === 0) {
    return "I don't know what you're currently using, so some of this may already be covered.";
  }
  return 'Ingredients first. A product only earns a mention when it actually carries them, and I say where it is from and what it costs.';
}

/** Compact rendering for the prompt context, so she can talk about the plan. */
export function renderPlan(plan: RoutinePlan): string {
  if (plan.suggestions.length === 0) return 'No routine changes indicated by the latest scan.';

  const lines = plan.suggestions.map((s) => {
    const why = s.because ? ` (${s.because.label} ${s.because.value})` : '';
    const covered = s.alreadyCovered ? ` — ALREADY COVERED by ${s.coveredBy.join(', ')}` : '';
    return `- [${STEP_LABELS[s.step]}] ${s.title}${why}: ${s.actives.join(', ')}${covered}` +
      (s.cautions.length ? ` Caution: ${s.cautions.join(' ')}` : '');
  });
  lines.push(`NOTE: ${plan.caveat}`);
  return lines.join('\n');
}
