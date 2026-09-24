/**
 * The ingredient glossary's wire shape: `GET /api/public/ingredients`.
 *
 * A public read of the server's ingredient knowledge base
 * (`server/skin/ingredient-data.ts`) for the Learn page. It carries the
 * reference text only - the name, the family it belongs to, how likely it is
 * to irritate, and the short note - and nothing about any person. The match
 * patterns, the caution lists and the layering rules stay on the server,
 * where the routine logic uses them.
 */

export type GlossaryIrritationRisk = 'none' | 'low' | 'moderate' | 'high';

export interface GlossaryFamily {
  /** The family's id, e.g. `exfoliating-acid`. */
  id: string;
  /** Its reader-facing name, lower case as the server writes it ("exfoliating acids"). */
  label: string;
  /** How many entries in the glossary belong to it. */
  count: number;
}

export interface GlossaryEntry {
  label: string;
  /** A `GlossaryFamily.id`. */
  family: string;
  irritationRisk: GlossaryIrritationRisk;
  note: string;
}

export interface IngredientGlossary {
  ingredients: GlossaryEntry[];
  families: GlossaryFamily[];
}
