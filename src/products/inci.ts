/**
 * INCI parsing — turning the back of a bottle into a usable ingredient list.
 *
 * OCR of a curved, glossy, 5pt ingredient panel is messy by nature: it drops
 * spaces, confuses O/0 and l/1, wraps mid-word, and often catches the marketing
 * copy above the list. This module is the cleanup, and it is deliberately
 * conservative — it would rather hand back a slightly odd ingredient name than
 * silently discard a real one, because a dropped ingredient is a missed warning.
 */

/** Sentinel used to protect commas inside parentheses while splitting. */
const COMMA_SENTINEL = '\u0001';

/**
 * Common OCR confusions on cosmetic labels. Applied only to a fragment that
 * matched nothing known, so correctly-read text is never "corrected".
 */
const OCR_SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/0/g, 'o'],
  [/1/g, 'l'],
  [/5/g, 's'],
  [/\|/g, 'l'],
  [/¢/g, 'c'],
  [/€/g, 'c'],
  [/§/g, 's'],
];

/** Where the ingredient list actually starts, if the label says so. */
const LIST_MARKER =
  /\b(ingredients?|ingr[ée]dients?|inci|composition|zutaten|ingredientes|contains)\b\s*[:.\-]?/i;

/** Text that is never an ingredient, however confidently the OCR read it. */
const NOISE: RegExp[] = [
  /^\s*$/,
  /^\d+\s*(ml|g|oz|fl)\b/i,
  /^made in\b/i,
  /^batch\b/i,
  /^exp\b/i,
  /^www\./i,
  /^\d{5,}$/,
  /^[^a-z]*$/i,
  /^(net|wt|vol)\b/i,
];

export interface ParsedLabel {
  ingredients: string[];
  /** True when an explicit "Ingredients:" marker was found. */
  markerFound: boolean;
  /** Fragments that were dropped, so the UI can be honest about the read. */
  discarded: string[];
}

/**
 * Extracts an ingredient list from raw OCR text.
 *
 * Handles the two layouts that actually occur: comma-separated running text,
 * and one-per-line columns.
 */
export function parseIngredients(raw: string): ParsedLabel {
  const discarded: string[] = [];
  let text = raw.replace(/\r/g, '');

  // Everything before "Ingredients:" is marketing copy.
  const marker = text.match(LIST_MARKER);
  const markerFound = Boolean(marker);
  if (marker && marker.index !== undefined) {
    text = text.slice(marker.index + marker[0].length);
  }

  // A trailing sentence after the list is usually a claim or an address.
  text = text.replace(/\.\s+[A-Z][^,]{40,}$/s, '');

  // Rejoin words the OCR broke across a line. A hyphen at end of line is a
  // wrap; a bare newline is a genuine separator and stays.
  text = text.replace(/-\s*\n\s*/g, '');

  // Parenthetical qualifiers frequently contain commas — "Aqua (Water, Eau)" —
  // which would otherwise split into fake ingredients. Swap those commas for a
  // sentinel, split on the rest, then restore them.
  const protectedText = text.replace(/\([^)]*\)/g, (match) =>
    match.replace(/,/g, COMMA_SENTINEL),
  );

  const parts = protectedText
    .split(/[,;\n•·]+/)
    .map((part) => part.split(COMMA_SENTINEL).join(',').trim());

  const ingredients: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const cleaned = cleanFragment(part);
    if (!cleaned) {
      if (part.trim()) discarded.push(part.trim());
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ingredients.push(cleaned);
  }

  return { ingredients, markerFound, discarded };
}

function cleanFragment(fragment: string): string | null {
  const value = fragment
    .replace(/[*†‡]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}(]+/u, '')
    .replace(/[.\s]+$/u, '')
    .trim();

  if (!value) return null;
  if (NOISE.some((re) => re.test(value))) return null;

  // A real INCI name is short. Anything long is a sentence the OCR swept up.
  if (value.length > 60) return null;
  // And it has letters in it.
  if (!/\p{L}{2,}/u.test(value)) return null;
  // A percentage attached to an active is useful; a bare number is not.
  if (/^\d+(\.\d+)?%?$/.test(value)) return null;

  return titleCaseInci(value);
}

/**
 * INCI names are conventionally title case. Normalising means the ingredient
 * matcher and the display layer agree, and that two spellings of the same thing
 * do not appear twice in a routine.
 */
function titleCaseInci(value: string): string {
  const LOWER = new Set(['and', 'or', 'of', 'the']);
  const CHEM_PREFIX = /^(sh|rh|d|l|dl|n|o|p|m)$/;

  return value
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map((token, index) => {
      if (/^(\s+|-|\/)$/.test(token)) return token;
      if (index > 0 && LOWER.has(token)) return token;
      // Keep chemical prefixes lowercase: "sh-Oligopeptide", "d-Alpha".
      if (CHEM_PREFIX.test(token)) return token;
      // Capitalise the first *letter*, not the first character — otherwise a
      // leading bracket swallows it and "(water)" never becomes "(Water)".
      return token.replace(/\p{L}/u, (letter) => letter.toUpperCase());
    })
    .join('');
}

/**
 * Candidate spellings for a fragment that matched nothing known, best first.
 * Used only as a second pass, so a clean read is never second-guessed.
 */
export function ocrVariants(value: string): string[] {
  const variants = new Set<string>([value]);

  let repaired = value;
  for (const [pattern, replacement] of OCR_SUBSTITUTIONS) {
    repaired = repaired.replace(pattern, replacement);
  }
  if (repaired !== value) variants.add(titleCaseInci(repaired));

  // Labels frequently lose the space in "Sodium Hyaluronate".
  const spaced = value.replace(/([a-z])([A-Z])/g, '$1 $2');
  if (spaced !== value) variants.add(spaced);

  return [...variants];
}
