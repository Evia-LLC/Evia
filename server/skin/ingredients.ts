/**
 * Ingredient and routine assessment (brief §10).
 *
 * Deterministic, explainable, and explicit about the edge of its own knowledge.
 * Every finding names the ingredient that caused it, so Elohim can talk about a
 * product without inventing a reason.
 *
 * Three things it checks, in order of how often they actually matter:
 *   1. Does this clash with something on the user's profile?
 *   2. Are they already using something that does the same job?
 *   3. Do two things in the routine conflict when layered?
 */
import {
  FAMILY_LABELS,
  FAMILY_STACK_LIMIT,
  INGREDIENTS,
  type Ingredient,
  type IngredientFamily,
} from './ingredient-data.ts';
import type {
  IngredientFinding,
  Product,
  ProductAssessment,
  ProductUsage,
  SkinProfile,
} from '../../shared/types.ts';

export interface IngredientMatch {
  rule: Ingredient;
  ingredient: string;
  /** Position in the list — earlier means higher concentration, roughly. */
  index: number;
}

/** Matches an ingredient list against the knowledge base. */
export function matchIngredients(ingredients: string[]): {
  matches: IngredientMatch[];
  unrecognised: string[];
} {
  const matches: IngredientMatch[] = [];
  const unrecognised: string[] = [];

  ingredients.forEach((ingredient, index) => {
    const rule = INGREDIENTS.find((candidate) => candidate.match.test(ingredient));
    if (rule) matches.push({ rule, ingredient, index });
    else unrecognised.push(ingredient);
  });

  return { matches, unrecognised };
}

/**
 * Families whose *stacking* matters — the actives you can have too many of.
 * Used for overlap and conflict detection.
 */
function activeFamilies(matches: IngredientMatch[]): Set<IngredientFamily> {
  const families = new Set<IngredientFamily>();
  for (const m of matches) {
    if (m.rule.active || FAMILY_STACK_LIMIT[m.rule.family]) families.add(m.rule.family);
  }
  return families;
}

/** Families that are structural rather than functional. */
const BACKGROUND_FAMILIES: IngredientFamily[] = ['texture', 'preservative', 'solvent', 'fragrance'];

/**
 * Families a product *covers*, for answering "is anything doing this job?".
 *
 * Deliberately separate from `activeFamilies`: sun protection has no stacking
 * limit and is not an "active" in the exfoliating sense, so asking the stacking
 * set whether the routine has SPF returns no — which is how a routine with a
 * daily SPF in it got told it was missing sun protection.
 */
function coveredFamilies(matches: IngredientMatch[]): Set<IngredientFamily> {
  const families = new Set<IngredientFamily>();
  for (const m of matches) {
    if (!BACKGROUND_FAMILIES.includes(m.rule.family)) families.add(m.rule.family);
  }
  return families;
}

function normaliseTerms(profile: SkinProfile): string[] {
  return [...profile.sensitivities.map((s) => s.toLowerCase()), profile.skinType.toLowerCase()];
}

export function assessProduct(
  product: Product,
  profile: SkinProfile,
  currentRoutine: ProductUsage[],
): ProductAssessment {
  const { matches, unrecognised } = matchIngredients(product.ingredients);
  const findings: IngredientFinding[] = [];
  const terms = normaliseTerms(profile);

  // --- 1. profile clashes --------------------------------------------------
  for (const { rule, ingredient, index } of matches) {
    const clashes = rule.cautionFor?.filter((caution) =>
      terms.some((term) => term.includes(caution) || caution.includes(term)),
    );

    // Position matters: fragrance at the end of a list is a trace; near the top
    // it is a major component. Only mention the trivial stuff when it clashes.
    const prominent = index < Math.max(6, product.ingredients.length * 0.35);

    if (clashes?.length) {
      findings.push({
        ingredient,
        severity: rule.irritationRisk === 'none' ? 'caution' : 'avoid',
        reason: `${rule.label}. ${rule.note} Flagged because your profile lists ${clashes.join(', ')}.`,
      });
    } else if (rule.irritationRisk === 'high' || (rule.irritationRisk === 'moderate' && prominent)) {
      findings.push({
        ingredient,
        severity: 'caution',
        reason: `${rule.label}. ${rule.note}`,
      });
    } else if (rule.active) {
      findings.push({ ingredient, severity: 'info', reason: `${rule.label}. ${rule.note}` });
    }
  }

  // --- 2. routine overlap --------------------------------------------------
  const routineFamilies = new Map<IngredientFamily, Set<string>>();
  for (const usage of currentRoutine) {
    const productName = usage.product.brand
      ? `${usage.product.brand} ${usage.product.name}`
      : usage.product.name;
    for (const family of activeFamilies(matchIngredients(usage.product.ingredients).matches)) {
      const set = routineFamilies.get(family) ?? new Set<string>();
      set.add(productName);
      routineFamilies.set(family, set);
    }
  }

  const overlaps: string[] = [];
  const incoming = activeFamilies(matches);
  for (const family of incoming) {
    const existing = routineFamilies.get(family);
    if (!existing?.size) continue;
    const limit = FAMILY_STACK_LIMIT[family] ?? 3;
    if (existing.size >= limit) {
      overlaps.push(`${FAMILY_LABELS[family]} — already in ${[...existing].join(', ')}`);
    }
  }

  // --- 3. layering conflicts ----------------------------------------------
  const conflicts: string[] = [];
  for (const { rule } of matches) {
    for (const family of rule.conflictsWith ?? []) {
      if (family === rule.family) continue; // same-family is the overlap check
      const existing = routineFamilies.get(family);
      if (existing?.size) {
        const entry = `${rule.label} and ${FAMILY_LABELS[family]} are best kept to different nights`;
        if (!conflicts.includes(entry)) conflicts.push(entry);
      }
    }
  }

  // --- verdict -------------------------------------------------------------
  let verdict: ProductAssessment['verdict'];
  if (findings.some((f) => f.severity === 'avoid')) verdict = 'not_now';
  else if (overlaps.length >= 2 || (overlaps.length && conflicts.length)) verdict = 'be_cautious';
  else if (overlaps.length || conflicts.length || findings.some((f) => f.severity === 'caution'))
    verdict = 'probably_fine';
  else verdict = 'good_fit';

  return {
    product,
    verdict,
    findings,
    overlaps: [...overlaps, ...conflicts],
    rationale: buildRationale(verdict, overlaps, conflicts, findings, unrecognised, product),
  };
}

function buildRationale(
  verdict: ProductAssessment['verdict'],
  overlaps: string[],
  conflicts: string[],
  findings: IngredientFinding[],
  unrecognised: string[],
  product: Product,
): string {
  if (product.ingredients.length === 0) {
    return 'No ingredient list on file for this one, so there is nothing here for me to go on yet.';
  }

  const parts: string[] = [];

  switch (verdict) {
    case 'not_now':
      parts.push('This clashes with something already on your profile.');
      break;
    case 'be_cautious':
      parts.push('This overlaps with more than one thing you are already using.');
      break;
    case 'probably_fine':
      parts.push('Nothing alarming, but there is something worth being deliberate about.');
      break;
    case 'good_fit':
      parts.push('Nothing in here conflicts with what you are already doing.');
      break;
  }

  const avoid = findings.filter((f) => f.severity === 'avoid');
  if (avoid.length) parts.push(avoid.map((f) => f.reason).join(' '));

  if (overlaps.length) parts.push(`Doing the same job as: ${overlaps.join('; ')}.`);
  if (conflicts.length) parts.push(`${conflicts.join('. ')}.`);

  // The honesty clause. Coverage is finite and saying so is the difference
  // between a partial read and a false all-clear.
  if (unrecognised.length) {
    const shown = unrecognised.slice(0, 3).join(', ');
    parts.push(
      `${unrecognised.length} ingredient${unrecognised.length === 1 ? '' : 's'} ` +
        `fell outside what I recognise (${shown}${unrecognised.length > 3 ? ', …' : ''}), ` +
        'so treat this as a partial read.',
    );
  }

  return parts.join(' ');
}

/**
 * Whole-routine review: what is doubled up, what is missing, what is scheduled
 * against itself. Used by the routine panel and available to Elohim as context.
 */
export interface RoutineReview {
  stacked: Array<{ family: IngredientFamily; label: string; products: string[] }>;
  conflicts: string[];
  missing: string[];
  unrecognisedCount: number;
}

export function reviewRoutine(usage: ProductUsage[]): RoutineReview {
  /** Stack-relevant families — "am I doubling up?" */
  const stacking = new Map<IngredientFamily, Set<string>>();
  /** Everything the routine covers — "is anything doing this job?" */
  const covered = new Set<IngredientFamily>();
  let unrecognisedCount = 0;

  for (const item of usage) {
    const name = item.product.brand
      ? `${item.product.brand} ${item.product.name}`
      : item.product.name;
    const { matches, unrecognised } = matchIngredients(item.product.ingredients);
    unrecognisedCount += unrecognised.length;

    for (const family of activeFamilies(matches)) {
      const set = stacking.get(family) ?? new Set<string>();
      set.add(name);
      stacking.set(family, set);
    }
    for (const family of coveredFamilies(matches)) covered.add(family);
  }

  const stacked: RoutineReview['stacked'] = [];
  for (const [family, products] of stacking) {
    const limit = FAMILY_STACK_LIMIT[family] ?? 3;
    if (products.size > limit) {
      stacked.push({ family, label: FAMILY_LABELS[family], products: [...products] });
    }
  }

  const conflicts: string[] = [];
  const hasRetinoid = covered.has('retinoid');
  const hasAcid = covered.has('exfoliating-acid');
  if (hasRetinoid && hasAcid) {
    conflicts.push(
      'You have a retinoid and an exfoliating acid — alternate nights rather than layering them.',
    );
  }
  if (covered.has('antibacterial') && hasRetinoid) {
    conflicts.push('Benzoyl peroxide and retinoids are best used at different times of day.');
  }

  const missing: string[] = [];
  if (!covered.has('spf')) missing.push('daily sun protection');
  if (!covered.has('hydration') && !covered.has('occlusive') && !covered.has('barrier')) {
    missing.push('anything moisturising');
  }

  return { stacked, conflicts, missing, unrecognisedCount };
}
