/**
 * From a plan to a product.
 *
 * `recommend.ts` turns a scan into suggestions — an ingredient and a step,
 * with the reading that triggered it. This turns each suggestion into a thing
 * that can be bought, in this order:
 *
 *   1. the shelf — the operator's own catalogue, matched on what the product
 *      contains when its ingredients are known and on what its name says it
 *      is when they are not, vetoed by the user's sensitivities exactly as a
 *      product they typed in would be;
 *   2. the web — real, priced offers from a marketplace when keys are
 *      configured, and search links when they are not.
 *
 * Every pick keeps the suggestion it came from, so the sentence she says is
 * always "for the redness, this — because it contains centella", never "buy
 * this". And every pick states what was actually compared, because "I found
 * the best price" is only true when prices were fetched.
 */
import { assessProduct } from '../skin/ingredients.ts';
import { matchIngredients } from '../skin/ingredients.ts';
import type { RoutinePlan, Suggestion } from '../skin/recommend.ts';
import type { IngredientFamily } from '../skin/ingredient-data.ts';
import { listCatalogue, storeName, storeUrl } from './store.ts';
import { comparisonAvailable, ebayOffers, webOffers } from './offers.ts';
import type {
  CatalogueProduct,
  Offer,
  ProductPick,
  SkinProfile,
} from '../../shared/types.ts';

/**
 * What a product's name tends to say when it contains an active. The INCI
 * name and the marketing name are different words for the same thing, and a
 * shelf without ingredient lists still has names.
 */
const ACTIVE_KEYWORDS: Record<string, RegExp> = {
  'Salicylic Acid': /salicylic|bha\b/i,
  'Azelaic Acid': /azelaic/i,
  'Centella Asiatica': /centella|cica\b|madecassoside/i,
  Niacinamide: /niacinamide|vitamin b3|b3\b/i,
  Retinol: /retinol|retinoid/i,
  Retinaldehyde: /retinal|retinaldehyde/i,
  'Mandelic Acid': /mandelic/i,
  'Tranexamic Acid': /tranexamic/i,
  'Ascorbic Acid': /vitamin c|ascorbic|ascorb/i,
  'Ethyl Ascorbic Acid': /vitamin c|ascorb/i,
  'Hyaluronic Acid': /hyaluron|\bha\b|hydrat/i,
  Glycerin: /glycerin|hydrat|moistur/i,
  'Ceramide NP': /ceramide|barrier/i,
  Squalane: /squalane/i,
  Caffeine: /caffeine|eye/i,
  Peptides: /peptide/i,
  'Zinc Oxide': /spf|sunscreen|sun screen|mineral sun/i,
  Tinosorb: /spf|sunscreen/i,
  Avobenzone: /spf|sunscreen/i,
  'Coco-Betaine': /cleanser|wash|foam/i,
};

/** What a step is called on a shelf. */
const STEP_WORDS: Record<Suggestion['step'], RegExp> = {
  cleanse: /cleanser|cleansing|wash|foam|balm/i,
  treat: /serum|treatment|toner|essence|ampoule|drops|solution|concentrate/i,
  hydrate: /moisturi|cream|lotion|gel|hydrat|eye/i,
  protect: /spf|sunscreen|sun screen|sun cream|uv/i,
};

/** Categories that rule a product out for a step, whatever its name says. */
const STEP_EXCLUDES: Record<Suggestion['step'], RegExp | null> = {
  cleanse: /serum|moisturi|spf|sunscreen/i,
  treat: /cleanser|wash|spf|sunscreen/i,
  hydrate: /cleanser|wash|spf|sunscreen/i,
  protect: /cleanser|wash|serum/i,
};

interface Scored {
  product: CatalogueProduct;
  score: number;
  matched: string[];
}

function scoreProduct(product: CatalogueProduct, suggestion: Suggestion, profile: SkinProfile): Scored | null {
  const haystack = `${product.name} ${product.category ?? ''} ${product.tags.join(' ')} ${product.description.slice(0, 600)}`;
  const label = `${product.name} ${product.category ?? ''}`;
  if (STEP_EXCLUDES[suggestion.step]?.test(label)) return null;

  let score = 0;
  const matched: string[] = [];

  // What it contains, when that is known.
  if (product.ingredients.length) {
    const { matches } = matchIngredients(product.ingredients);
    const families = new Set<IngredientFamily>(matches.map((m) => m.rule.family));
    if (families.has(suggestion.family)) score += 3;
    for (const active of suggestion.actives) {
      const hit = product.ingredients.find((i) => i.toLowerCase().includes(active.toLowerCase().split(' ')[0]));
      if (hit) {
        score += 2;
        matched.push(hit);
      }
    }
  }

  // What its name says it is.
  for (const active of suggestion.actives) {
    const pattern = ACTIVE_KEYWORDS[active];
    if (pattern && pattern.test(haystack)) {
      score += product.ingredients.length ? 1 : 2.5;
      if (!matched.includes(active)) matched.push(active);
    }
  }

  // The right kind of product for the step.
  if (STEP_WORDS[suggestion.step].test(label)) score += 1;
  if (!product.inStock) score -= 1.5;

  if (score <= 0) return null;

  // The same veto a product they typed in gets: sensitivities rule things out.
  if (product.ingredients.length) {
    const verdict = assessProduct(
      { id: product.id, name: product.name, brand: product.brand, category: product.category, ingredients: product.ingredients, source: 'catalogue' },
      profile,
      [],
    ).verdict;
    if (verdict === 'not_now') return null;
    if (verdict === 'be_cautious') score -= 1;
  }

  return { product, score, matched };
}

function money(cents: number | null, currency: string | null): string {
  if (cents === null || !currency) return '';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * The sentence about price, written from what was actually fetched.
 *
 * `compared` counts sources with a real price — the shelf and any marketplace
 * offers. One source is a price, not a comparison, and the note says so.
 */
function priceNote(store: CatalogueProduct | null, offers: Offer[]): { note: string; compared: number; bestUrl: string | null } {
  const priced: Array<{ label: string; cents: number; url: string; own: boolean }> = [];
  if (store?.priceCents !== null && store?.priceCents !== undefined) {
    priced.push({ label: storeName(), cents: store.priceCents, url: store.url, own: true });
  }
  for (const o of offers) {
    if (o.compared && o.priceCents !== null && (!store || o.currency === store.currency)) {
      priced.push({ label: o.merchant, cents: o.priceCents, url: o.url, own: false });
    }
  }
  if (priced.length === 0) {
    return { note: store ? 'No price listed yet.' : 'No prices fetched — these are places to look.', compared: 0, bestUrl: null };
  }
  if (priced.length === 1) {
    return {
      note: priced[0].own
        ? `${money(priced[0].cents, store!.currency)} on the ${storeName()} shelf. I have not compared other shops.`
        : `${money(priced[0].cents, offers.find((o) => o.compared)?.currency ?? null)} at ${priced[0].label}. One price, not a comparison.`,
      compared: 1,
      bestUrl: priced[0].url,
    };
  }
  const sorted = [...priced].sort((a, b) => a.cents - b.cents);
  const best = sorted[0];
  const currency = store?.currency ?? offers.find((o) => o.compared)?.currency ?? null;
  const note = best.own
    ? `Best price of the ${priced.length} I checked: ${money(best.cents, currency)} on the ${storeName()} shelf.`
    : `Cheapest of the ${priced.length} I checked is ${best.label} at ${money(best.cents, currency)}` +
      (store ? `; the ${storeName()} shelf has it at ${money(store.priceCents, currency)}.` : '.');
  return { note, compared: priced.length, bestUrl: best.url };
}

function queryFor(suggestion: Suggestion): string {
  const active = suggestion.actives[0] ?? suggestion.title;
  const kind = { cleanse: 'cleanser', treat: 'serum', hydrate: 'moisturiser', protect: 'sunscreen SPF 50' }[suggestion.step];
  return `${active} ${kind}`;
}

/**
 * Picks for a plan: at most `limit` suggestions, one product each, plus
 * where else it can be found.
 */
export async function pickProducts(
  plan: RoutinePlan,
  profile: SkinProfile,
  opts: { limit?: number; web?: boolean } = {},
): Promise<ProductPick[]> {
  const limit = opts.limit ?? 4;
  const web = opts.web ?? true;
  const shelf = await listCatalogue().catch(() => [] as CatalogueProduct[]);
  const picks: ProductPick[] = [];
  const used = new Set<string>();

  const suggestions = plan.suggestions.filter((s) => !s.alreadyCovered).slice(0, limit);

  for (const suggestion of suggestions) {
    const candidates = shelf
      .filter((p) => !used.has(p.id))
      .map((p) => scoreProduct(p, suggestion, profile))
      .filter((s): s is Scored => s !== null)
      .sort((a, b) => b.score - a.score);

    const top = candidates[0] ?? null;
    if (top) used.add(top.product.id);

    // Offers: to compare a shelf price, or to stand in for a missing one.
    let offers: Offer[] = [];
    if (web) {
      const query = top ? `${top.product.brand ? top.product.brand + ' ' : ''}${top.product.name}` : queryFor(suggestion);
      if (top) {
        if (comparisonAvailable()) offers = await ebayOffers(query).catch(() => []);
      } else {
        offers = await webOffers(query).catch(() => []);
      }
    }

    const { note, compared, bestUrl } = priceNote(top?.product ?? null, offers);
    if (!top && offers.length === 0) continue;

    picks.push({
      suggestion: {
        step: suggestion.step,
        title: suggestion.title,
        actives: suggestion.actives,
        because: suggestion.because,
        why: suggestion.why,
        cautions: suggestion.cautions,
      },
      product: top?.product ?? null,
      matched: top?.matched ?? [],
      from: top ? storeName() : null,
      offers,
      priceNote: note,
      compared,
      bestUrl: bestUrl ?? top?.product.url ?? offers[0]?.url ?? null,
      reason: top
        ? top.matched.length
          ? `${top.product.name} carries ${top.matched.slice(0, 2).join(' and ')}, which is what I want on this.`
          : `${top.product.name} is the ${suggestion.step === 'protect' ? 'sun protection' : suggestion.title.toLowerCase()} I would reach for on the ${storeName()} shelf.`
        : `Nothing on the ${storeName()} shelf does this yet, so here is where I would look.`,
    });
  }

  return picks;
}

/** A compact rendering for the prompt, so she can talk about the picks. */
export function renderPicks(picks: ProductPick[]): string {
  if (!picks.length) return '';
  const lines = picks.map((p) => {
    const where = p.product
      ? `${p.product.brand ? p.product.brand + ' ' : ''}${p.product.name} — ${p.priceNote} Link: ${p.product.url}`
      : `no shelf product; ${p.priceNote} ${p.offers
          .slice(0, 2)
          .map((o) => `${o.merchant}${o.priceCents !== null ? ' ' + money(o.priceCents, o.currency) : ''}: ${o.url}`)
          .join(' | ')}`;
    const because = p.suggestion.because ? ` (${p.suggestion.because.label} ${p.suggestion.because.value})` : '';
    return `- [${p.suggestion.step}] for ${p.suggestion.title}${because}: ${where}`;
  });
  return [
    '# Products you can point to',
    `The shop behind you is ${storeName()}${storeUrl() ? ` (${storeUrl()})` : ''}. These are the only products you may name, with the prices exactly as written:`,
    ...lines,
    'Rules: recommend the ingredient first and the product second. Say where it is from and the price as written above. Only claim a price comparison when the line says prices were checked; otherwise say plainly that you have not compared. Never invent a product, price or shop.',
  ].join('\n');
}
