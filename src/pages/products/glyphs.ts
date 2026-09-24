/**
 * The Products page's extra glyphs: the category chips' packages, the detail
 * panel's benefit and accordion icons.
 *
 * Drawn in the same idiom as the one icon set (src/ui/icons.ts: 24-unit grid,
 * round caps and joins, outline) and rendered the same way, so they sit beside
 * its glyphs without a seam. They live here only because the set is another
 * lane's file; they are meant to move into icons.ts (see the lead's list), at
 * which point `Glyph.svelte` becomes a plain `Icon`.
 *
 * Two are two-tone (a filled disc with a light mark cut into it, as the
 * mockup draws "How to use" and the trust checks); their light part is styled
 * with the cream token rather than a hard-coded white.
 */
import { GLYPHS, type IconName } from '@/ui/icons.ts';

interface Glyph {
  d: string;
  solid?: boolean;
}

const g = (d: string, solid = false): Glyph => ({ d, solid });

export const PRODUCT_GLYPHS = {
  /** Toners: a tall bottle, narrow cap, a label tick. */
  'toner-bottle': g('<path d="M10 7V3.2h4V7"/><rect x="7.5" y="7" width="9" height="14.8" rx="1.8"/><path d="M10.2 12.2h3.6"/>'),
  /** Serums: a dropper bottle - bulb, collar, pear body. */
  dropper: g(
    '<path d="M10.4 6.2V4.1a1.6 1.6 0 0 1 3.2 0v2.1"/><rect x="9.6" y="6.2" width="4.8" height="2.6" rx=".8"/><path d="M10.4 8.8C7.6 10.3 6.2 12.7 6.2 15.4 6.2 19 8.8 21.6 12 21.6s5.8-2.6 5.8-6.2c0-2.7-1.4-5.1-4.2-6.6"/>',
  ),
  /** Moisturisers: a cream jar - lid band, jar, a smile and two dots. */
  jar: g(
    '<rect x="4.2" y="4.6" width="15.6" height="4.6" rx="1.5"/><path d="M5.3 9.2v8.2a3.1 3.1 0 0 0 3.1 3.1h7.2a3.1 3.1 0 0 0 3.1-3.1V9.2"/><path d="M9.6 15.2c1.4 1.1 3.4 1.1 4.8 0"/><path d="M9.7 12.4h.01"/><path d="M14.3 12.4h.01"/>',
  ),
  /** Treatments: a conical flask with a liquid line. */
  flask: g(
    '<path d="M10 2.8v6.7a2 2 0 0 1-.21.9l-5 10.1a1 1 0 0 0 .9 1.5h12.62a1 1 0 0 0 .9-1.5l-5-10.1a2 2 0 0 1-.21-.9V2.8"/><path d="M8.6 2.8h6.8"/><path d="M7.4 16h2.8"/><path d="M13.2 16h3.4"/>',
  ),
  /** Makeup: a brush slanted up and to the right. */
  brush: g(
    '<path d="m11 10 3 3"/><path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.6 2.6 0 0 1-.7 1.8A1 1 0 0 0 3 21z"/><path d="M9.97 17.03 21.38 5.62a1 1 0 0 0-3-3L6.97 14.03"/>',
  ),
  /** "Cleanse": two offset rings. */
  orbit: g('<circle cx="12" cy="12" r="8.6"/><circle cx="13.3" cy="10.9" r="4.4"/>'),
  /** "Protect barrier": a bag-shaped lock with a check. */
  'bag-check': g(
    '<rect x="4.4" y="9" width="15.2" height="12.2" rx="2.4"/><path d="M8.5 9V7.2a3.5 3.5 0 0 1 7 0V9"/><path d="m9.4 15.2 1.9 1.9 3.4-3.6"/>',
  ),
  /** "Why Evia recommends this": the scalloped badge. */
  badge: g(
    '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/>',
  ),
  /** "Ingredients (full list)": the badge with a list mark inside. */
  'badge-list': g(
    '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="M10.4 9v5.6h3.6"/>',
  ),
  /** "How to use": a filled disc with a light play mark. */
  'circle-play': g(
    '<circle cx="12" cy="12" r="10" style="fill:currentColor;stroke:none"/><path d="M10.2 8.4v7.2l5.6-3.6z" style="fill:var(--cream-0);stroke:none"/>',
  ),
  /** The hero's trust checks: a filled disc with a light tick. */
  'check-disc': g(
    '<circle cx="12" cy="12" r="10" style="fill:currentColor;stroke:none"/><path d="m7.6 12.3 2.8 2.8 5.8-6" style="stroke:var(--cream-0)"/>',
  ),
  /** "Similar products": a bag split in two, a dot in the right half. */
  'bag-split': g(
    '<rect x="3.8" y="8" width="16.4" height="13" rx="2.6"/><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/><path d="M12 8v13"/><path d="M15.6 13.2h.01"/>',
  ),
  /** Soothing ingredient families. */
  leaf: g(
    '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  ),
} satisfies Record<string, Glyph>;

export type ProductGlyphName = IconName | keyof typeof PRODUCT_GLYPHS;

export function glyphFor(name: ProductGlyphName): Glyph {
  return (PRODUCT_GLYPHS as Record<string, Glyph>)[name] ?? (GLYPHS as Record<string, Glyph>)[name];
}
