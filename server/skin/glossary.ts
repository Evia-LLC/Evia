/**
 * The ingredient knowledge base, as a glossary anyone may read.
 *
 * The Learn page shows what the routine logic knows about each ingredient.
 * This picks out only the reference text - label, family, irritation risk and
 * note - in the knowledge base's own order, grouped by family, and leaves the
 * rest (match patterns, caution lists, layering conflicts) on the server. It
 * reads no user data, so it can sit on the public router with no session.
 *
 * Held back: entries whose note is about a prescription medicine or sends
 * the reader to a clinician (tretinoin, a topical antibiotic, hydroquinone).
 * Those notes were written for the routine engine, where they stop it
 * building around a prescription; as public reference text on a page anyone
 * can open without an account they read as treatment or referral, which
 * MED-01 rules out (SRS section 10: dermatologist referral is outside V1).
 * They are left out, not rewritten - the engine's wording stays the engine's,
 * and it still recognises all three on a product label - until counsel clears
 * them (design/counsel/misc.md, Learn). The test holds the list and the rule
 * together, so a new note in the same vein is caught rather than published.
 *
 * Plain TypeScript over a constant with no imports beyond the knowledge base,
 * so the Learn page can build the same glossary in the browser when the API
 * cannot serve it (no server, or a deploy with no database).
 *
 * Built once: the knowledge base is a constant.
 */
import type { IngredientGlossary } from '../../shared/ingredient-glossary.ts';
import { FAMILY_LABELS, INGREDIENTS, type Ingredient, type IngredientFamily } from './ingredient-data.ts';

/** A note that names a prescription or points to a clinician is not public reference text. */
const CLINICAL_NOTE = /\b(prescri\w*|clinician\w*|dermatologist\w*|doctor\w*|physician\w*)\b/i;

/** Whether an entry stays out of the public glossary. */
export function heldFromGlossary(ingredient: Pick<Ingredient, 'note'>): boolean {
  return CLINICAL_NOTE.test(ingredient.note);
}

let cached: IngredientGlossary | null = null;

export function ingredientGlossary(): IngredientGlossary {
  if (cached) return cached;

  // Families in the label table's order (actives first, formulation last),
  // entries within a family in the knowledge base's own order.
  const order = Object.keys(FAMILY_LABELS) as IngredientFamily[];
  const rank = new Map(order.map((family, i) => [family, i]));
  const entries = INGREDIENTS.filter((ingredient) => !heldFromGlossary(ingredient))
    .map((ingredient, i) => ({ ingredient, i }))
    .sort((a, b) => (rank.get(a.ingredient.family) ?? 99) - (rank.get(b.ingredient.family) ?? 99) || a.i - b.i);

  const ingredients = entries.map(({ ingredient }) => ({
    label: ingredient.label,
    family: ingredient.family,
    irritationRisk: ingredient.irritationRisk,
    note: ingredient.note,
  }));

  const families = order
    .map((id) => ({ id, label: FAMILY_LABELS[id], count: ingredients.filter((entry) => entry.family === id).length }))
    .filter((family) => family.count > 0);

  cached = { ingredients, families };
  return cached;
}
