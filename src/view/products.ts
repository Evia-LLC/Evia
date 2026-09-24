/**
 * The Products screen's view model (BUILD-PLAN section 3.2, decision 11).
 *
 * The page renders only from a `ProductsView`. In sample mode that is the
 * mockup's own shelf (`src/sample/fixtures/products.ts`), ratings and all,
 * under the Sample data badge. Otherwise it is built here from what the app
 * actually has (specs/data-map.md section 5):
 *
 * - the picks for the latest reading (`ProductPick`, from /api/routine/picks
 *   or, for a guest, the reading taken in this tab): the suggestion and the
 *   reason for it, the shelf product when the shelf has one, the price
 *   sentence the server wrote from what it really fetched, and the places to
 *   look when it does not;
 * - the operator's catalogue (/api/catalogue), which is empty until a
 *   storefront is synced or a catalogue imported - and the page then says so
 *   in a designed empty state instead of filling the grid;
 * - for a catalogue product, what its ingredient list contains and how it
 *   sits with the profile (`assessProduct`), only when the shop published a
 *   list.
 *
 * What has no source is never shown in real mode: no star ratings or review
 * counts, no "Trending" / "Popular", no "Best Match" (no score or rank is
 * exposed), no gallery beyond the one picture a storefront gives, no
 * demonstration, no similar products. "In stock" appears only for a
 * catalogue product, from the shop's own flag.
 *
 * There is no cart anywhere (decision 11): every product ends in "Shop at
 * {retailer} ↗", a plain external link the server has already tagged for that
 * retailer's affiliate programme and nothing else (ADS-01).
 */
import type { ProductAssessment, ProductPick, RoutineStep } from '@shared/types.ts';
import type { CatalogueCategory, CatalogueListing } from '@/lib/api.ts';
import type { ProductGlyphName } from '@/pages/products/glyphs.ts';
import type { IconName } from '@/ui/icons.ts';

// --- shapes -------------------------------------------------------------------

/** A chip: the seven shelf categories, plus the page's own three views. */
export type CategoryKey = 'recommended' | 'all' | 'saved' | CatalogueCategory;

export interface CategoryChipView {
  key: CategoryKey;
  label: string;
  /** The mockup sets "Recommended / For You" on two lines. */
  lines?: [string, string];
  icon: ProductGlyphName;
  iconFilled?: boolean;
}

/** The drawn package: the mockup's eight (sample only) or an unbranded one by category. */
export type BottleKind =
  | 'cerave-cleanser'
  | 'anua-toner'
  | 'ordinary-serum'
  | 'lrp-cream'
  | 'boj-sun'
  | 'pc-bha'
  | 'lrp-duo'
  | 'cerave-pm'
  | 'pump'
  | 'toner'
  | 'dropper'
  | 'jar'
  | 'tube'
  | 'slim-tube'
  | 'compact';

export type StarFill = 'full' | 'half' | 'empty';

/** A rating as the mockup draws it (sample mode only; nothing real produces one). */
export interface RatingView {
  value: string;
  /** "(12.4k)" on a card, "(12.4k reviews)" in the panel. */
  count: string;
  stars: StarFill[];
}

export interface ShopLinkView {
  /** "Shop at Ese", "Search Amazon". */
  label: string;
  retailer: string;
  /** The outbound URL; null in sample mode, where shop links are switched off. */
  url: string | null;
  /** A product page, or a search on a marketplace (no price was fetched). */
  kind: 'product' | 'search';
  /**
   * What a screen reader hears, when the label and the product name are not
   * enough: a search says what it searches for ("Search Amazon for Salicylic
   * Acid cleanser"). Otherwise "{label}: {product}".
   */
  name?: string;
}

export type BadgeVariant = 'match' | 'trending' | 'gentle' | 'neutral';

export type GalleryItem =
  | { kind: 'still'; still: 'counter' | 'cream' | 'pad' | 'foam'; bottle?: BottleKind; label: string }
  | { kind: 'image'; src: string; label: string }
  | { kind: 'bottle'; bottle: BottleKind; label: string };

export interface FeatureView {
  label: string;
  icon: ProductGlyphName;
}

/** One accordion row in the panel. Rows with nothing behind them are not built. */
export interface DetailRowView {
  id: 'why' | 'ingredients' | 'how' | 'fit' | 'reviews' | 'similar';
  label: string;
  icon: ProductGlyphName;
  /** The mockup's highlighted row ("How to use"). */
  highlight?: boolean;
  /** Right-hand extra: the mockup's "★ 4.8" on Reviews. */
  trailing?: { star: boolean; text: string };
  /** Paragraphs. */
  body: string[];
  /** A list under the paragraphs (ingredients, findings, similar products). */
  list?: string[];
  /** A standing note in smaller type (the patch-test line). */
  note?: string;
}

export interface ProductDetailView {
  gallery: GalleryItem[];
  brand: string | null;
  name: string;
  rating: RatingView | null;
  price: string | null;
  /** The server's price sentence for a pick, verbatim. */
  priceNote: string | null;
  stock: 'in' | 'out' | null;
  description: string | null;
  /** "Contains" for real ingredient families; null heading for the mockup's benefit icons. */
  featuresTitle: string | null;
  features: FeatureView[];
  shop: ShopLinkView | null;
  /** Other places to look, for a pick (search links and priced offers). */
  alsoAt: ShopLinkView[];
  rows: DetailRowView[];
}

export interface ProductCardView {
  /** Unique on the page (selection, keys). */
  id: string;
  /**
   * What the heart stores (src/products/saved.svelte.ts): a shelf product's
   * `shelf:<id>` or a sample id. Null for a suggestion that is not a product
   * on the shelf - its name comes from the reading, so it is never saved.
   */
  saveId: string | null;
  /** The product as a screen reader names it ("CeraVe Hydrating Facial Cleanser"). */
  a11yName: string;
  /** The catalogue id, when the product is on the shelf (the panel fetches its detail). */
  catalogueId: string | null;
  brand: string | null;
  name: string;
  blurb: string | null;
  badge: { label: string; variant: BadgeVariant } | null;
  rating: RatingView | null;
  price: string | null;
  bottle: BottleKind;
  imageUrl: string | null;
  categories: CatalogueCategory[];
  shop: ShopLinkView | null;
  detail: ProductDetailView;
  /** Lower-cased text the sample shelf is searched in. */
  searchText: string;
}

export interface EmptyView {
  title: string;
  body: string;
  icon: IconName;
  /** An in-app action ("Take a scan"). */
  action?: { label: string; href: string };
}

export interface ProductSectionView {
  id: string;
  title: string;
  /** Set in the display serif after the title ("Recommended *for you*"). */
  accent?: string;
  subtitle?: string;
  products: ProductCardView[];
  empty: EmptyView | null;
  loading: boolean;
  /** Offer "View all" (the whole shelf). */
  viewAll: boolean;
  /** More of the shelf than is shown: "Show more" brings the next page. */
  more: { shown: number; total: number; loading: boolean } | null;
}

export interface ProductsHeroView {
  headline: [string, string];
  subtitle: string;
  /** The trust line: only claims with something behind them in real mode. */
  trust: string[];
  /** The handwritten quote, one entry per line; the last is the signature. */
  quote: string[];
}

export interface ProductsView {
  mode: 'sample' | 'real';
  hero: ProductsHeroView;
  searchPlaceholder: string;
  categories: CategoryChipView[];
  sections: ProductSectionView[];
  /** The affiliate disclosure, shown by the grid and in the panel. */
  disclosure: string;
  /** Standing guidance under "Is it right for you?" (SRS section 10). */
  fitNote: string;
}

// --- shared copy --------------------------------------------------------------

export const SEARCH_PLACEHOLDER = 'Search products, ingredients or brands...';

/** Decision 11's wording, listed for counsel (design/counsel/products.md). */
export const AFFILIATE_DISCLOSURE =
  'Evia may earn a commission when you buy through these links. It never changes what we recommend.';

/** SRS section 10: suggestions are not a complete safety check. */
export const FIT_NOTE =
  'General skincare guidance, not medical advice, and not a complete safety check. Read the label and patch test anything new.';

export const HERO_HEADLINE: [string, string] = ['Skincare', 'that works for you.'];
export const HERO_QUOTE = ['“The right products', 'make all the', 'difference.”', '— Evia'];

export const CATEGORY_CHIPS: CategoryChipView[] = [
  { key: 'recommended', label: 'Recommended For You', lines: ['Recommended', 'For You'], icon: 'star', iconFilled: true },
  { key: 'cleansers', label: 'Cleansers', icon: 'droplet' },
  { key: 'toners', label: 'Toners', icon: 'toner-bottle' },
  { key: 'serums', label: 'Serums', icon: 'dropper' },
  { key: 'moisturisers', label: 'Moisturisers', icon: 'jar' },
  { key: 'sunscreens', label: 'Sunscreens', icon: 'sun' },
  { key: 'treatments', label: 'Treatments', icon: 'flask' },
  { key: 'makeup', label: 'Makeup', icon: 'brush' },
];

export const SAVED_CHIP: CategoryChipView = { key: 'saved', label: 'Saved', icon: 'heart' };

export function chipLabel(key: CategoryKey): string {
  if (key === 'all') return 'Everything on the shelf';
  if (key === 'saved') return 'Saved';
  return CATEGORY_CHIPS.find((c) => c.key === key)?.label ?? key;
}

export const STEP_LABEL: Record<RoutineStep, string> = {
  cleanse: 'Cleanse',
  treat: 'Treat',
  hydrate: 'Hydrate',
  protect: 'Protect',
};

const STEP_CATEGORY: Record<RoutineStep, CatalogueCategory> = {
  cleanse: 'cleansers',
  treat: 'serums',
  hydrate: 'moisturisers',
  protect: 'sunscreens',
};

const STEP_BOTTLE: Record<RoutineStep, BottleKind> = {
  cleanse: 'pump',
  treat: 'dropper',
  hydrate: 'jar',
  protect: 'tube',
};

const CATEGORY_BOTTLE: Record<CatalogueCategory, BottleKind> = {
  cleansers: 'pump',
  toners: 'toner',
  serums: 'dropper',
  moisturisers: 'jar',
  sunscreens: 'tube',
  treatments: 'slim-tube',
  makeup: 'compact',
};

/** An unbranded package for a shelf product with no picture. */
export function bottleFor(categories: CatalogueCategory[]): BottleKind {
  return categories.length ? CATEGORY_BOTTLE[categories[0]] : 'pump';
}

/** Ingredient families (server FAMILY_LABELS) to a glyph for the "Contains" row. */
const FAMILY_GLYPH: Record<string, ProductGlyphName> = {
  humectants: 'droplet',
  'barrier support': 'bag-check',
  occlusives: 'bag-check',
  'soothing agents': 'leaf',
  'sun protection': 'sun',
  'exfoliating acids': 'sparkle',
  retinoids: 'flask',
  'vitamin C': 'sparkle',
  'brightening actives': 'sparkle',
  peptides: 'orbit',
  'anti-bacterial actives': 'flask',
};

export function money(cents: number | null, currency: string | null): string | null {
  if (cents === null || !currency) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A storefront description trimmed to something a card can hold. */
function shortText(text: string, max = 110): string | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const firstSentence = clean.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? clean;
  const pick = firstSentence.length <= max ? firstSentence : clean;
  return pick.length <= max ? pick : `${pick.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

// --- real mode ----------------------------------------------------------------

export interface CatalogueExtra {
  contains: string[];
  assessment: ProductAssessment | null;
}

export interface ProductsRealInput {
  guest: boolean;
  signedIn: boolean;
  hasScan: boolean;
  /** The picks for the latest reading (session.picks). */
  picks: ProductPick[];
  picksLoading: boolean;
  /** The shop's name (catalogue status), for copy. */
  storeName: string;
  /** How many products the shelf holds, from the public status; null if unknown. */
  shelfCount: number | null;
  catalogue: {
    status: 'idle' | 'loading' | 'ready' | 'error' | 'signed-out';
    items: CatalogueListing[];
    total: number;
    /** Another page exists for the same chip and search. */
    nextCursor: string | null;
    loadingMore: boolean;
  };
  /** Saved shelf products fetched by catalogue id; null = no longer on the shelf. */
  savedItems: Record<string, CatalogueListing | null>;
  /** Detail fetched for catalogue products, by catalogue id. */
  extras: Record<string, CatalogueExtra>;
  category: CategoryKey;
  query: string;
  savedIds: string[];
}

const VERDICT_LINE: Record<ProductAssessment['verdict'], string> = {
  good_fit: 'Nothing in the ingredient list clashes with your profile or your current routine.',
  probably_fine: 'Nothing alarming, but one thing is worth being deliberate about.',
  be_cautious: 'This overlaps with more than one product you already use.',
  not_now: 'Something in the ingredient list clashes with your profile.',
};

function fitRow(
  assessment: ProductAssessment | null,
  cautions: string[],
  hasList: boolean,
  isSuggestion = false,
): DetailRowView {
  const body: string[] = [];
  const list: string[] = [];
  if (isSuggestion) {
    body.push(
      cautions.length
        ? 'There is no particular product here to check yet. Whichever you choose, keep these in mind:'
        : 'There is no particular product here to check yet. Whichever you choose, read its ingredient list first.',
    );
  } else if (assessment) {
    body.push(VERDICT_LINE[assessment.verdict]);
    for (const f of assessment.findings.filter((f) => f.severity !== 'info')) list.push(`${f.ingredient}: ${f.reason}`);
    for (const o of assessment.overlaps) list.push(o);
  } else if (hasList) {
    body.push('Open this product to check its ingredient list against your profile.');
  } else {
    body.push('The shop has not published an ingredient list for this product, so there is nothing to check it against.');
  }
  for (const c of cautions) list.push(c);
  return { id: 'fit', label: 'Is it right for you?', icon: 'droplet', body, list: list.length ? list : undefined, note: FIT_NOTE };
}

function ingredientsRow(ingredients: string[], lookFor: string[] = []): DetailRowView {
  if (ingredients.length) {
    return { id: 'ingredients', label: 'Ingredients (full list)', icon: 'badge-list', body: [], list: [ingredients.join(', ')] };
  }
  return {
    id: 'ingredients',
    label: 'Ingredients (full list)',
    icon: 'badge-list',
    body: [
      lookFor.length
        ? `What to look for on the label: ${lookFor.join(', ')}.`
        : 'The shop has not published an ingredient list for this product.',
    ],
  };
}

function featuresFrom(contains: string[] | undefined): FeatureView[] {
  return (contains ?? []).slice(0, 3).map((label) => ({ label: capitalise(label), icon: FAMILY_GLYPH[label] ?? 'sparkle' }));
}

function shopFromListing(listing: CatalogueListing): ShopLinkView {
  return { label: `Shop at ${listing.shop.retailer}`, retailer: listing.shop.retailer, url: listing.shop.url, kind: 'product' };
}

/** The shelf product's id as the heart stores it. */
export const shelfSaveId = (catalogueId: string): string => `shelf:${catalogueId}`;

function nameOf(brand: string | null, name: string): string {
  return brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
}

function catalogueCard(listing: CatalogueListing, extra: CatalogueExtra | undefined): ProductCardView {
  const bottle = bottleFor(listing.categories);
  const price = money(listing.priceCents, listing.currency);
  const shop = shopFromListing(listing);
  return {
    id: shelfSaveId(listing.id),
    saveId: shelfSaveId(listing.id),
    a11yName: nameOf(listing.brand, listing.name),
    catalogueId: listing.id,
    brand: listing.brand,
    name: listing.name,
    blurb: shortText(listing.description),
    badge: null,
    rating: null,
    price,
    bottle,
    imageUrl: listing.imageUrl,
    categories: listing.categories,
    shop,
    searchText: `${listing.brand ?? ''} ${listing.name}`.toLowerCase(),
    detail: {
      gallery: listing.imageUrl
        ? [{ kind: 'image', src: listing.imageUrl, label: listing.name }]
        : [{ kind: 'bottle', bottle, label: listing.name }],
      brand: listing.brand,
      name: listing.name,
      rating: null,
      price,
      priceNote: null,
      stock: listing.inStock ? 'in' : 'out',
      description: listing.description.trim() || null,
      featuresTitle: extra?.contains.length ? 'Contains' : null,
      features: featuresFrom(extra?.contains),
      shop,
      alsoAt: [],
      rows: [ingredientsRow(listing.ingredients), fitRow(extra?.assessment ?? null, [], listing.ingredients.length > 0)],
    },
  };
}

function offerLink(offer: ProductPick['offers'][number]): ShopLinkView {
  const priced = offer.priceCents !== null;
  const label = priced
    ? `${offer.merchant} ${money(offer.priceCents, offer.currency) ?? ''}`.trim()
    : `Search ${offer.merchant}`;
  /* The server's title names the search term ("Search Amazon for X", "Compare prices for X"). */
  const term = priced ? null : (offer.title.match(/^.*? for (.+)$/)?.[1] ?? null);
  return {
    label,
    retailer: offer.merchant,
    url: offer.url,
    kind: priced ? 'product' : 'search',
    name: priced ? `${label}: ${offer.title}` : term ? `${label} for ${term}` : undefined,
  };
}

function pickCard(pick: ProductPick, extra: CatalogueExtra | undefined, storeName: string): ProductCardView {
  const s = pick.suggestion;
  const step = STEP_LABEL[s.step];
  const product = pick.product;
  const bottle = STEP_BOTTLE[s.step];
  const because = s.because
    ? `Picked for your ${s.because.label.toLowerCase()} reading`
    : 'An every-day step, whatever the reading';
  const offers = pick.offers.map(offerLink);
  const shop: ShopLinkView | null = product
    ? { label: `Shop at ${pick.from ?? storeName}`, retailer: pick.from ?? storeName, url: product.url, kind: 'product' }
    : (offers[0] ?? null);
  const alsoAt = product ? offers : offers.slice(1);
  const price = product ? money(product.priceCents, product.currency) : null;

  const why: string[] = [pick.reason];
  if (s.because) why.push(`Your latest scan read ${s.because.label.toLowerCase()} at ${s.because.value} out of 100.`);
  if (s.why) why.push(s.why);

  return {
    id: `pick:${s.step}:${product?.id ?? s.title}`,
    saveId: product ? shelfSaveId(product.id) : null,
    a11yName: product ? nameOf(product.brand, product.name) : s.title,
    catalogueId: product?.id ?? null,
    brand: product ? product.brand : `${step} step`,
    name: product ? product.name : s.title,
    blurb: product ? because : `Not on the ${storeName} shelf yet. ${because}.`,
    badge: { label: step, variant: 'neutral' },
    rating: null,
    price,
    bottle,
    imageUrl: product?.imageUrl ?? null,
    categories: [STEP_CATEGORY[s.step]],
    shop,
    searchText: `${product?.brand ?? ''} ${product?.name ?? ''} ${s.title} ${s.actives.join(' ')}`.toLowerCase(),
    detail: {
      gallery: product?.imageUrl
        ? [{ kind: 'image', src: product.imageUrl, label: product.name }]
        : [{ kind: 'bottle', bottle, label: product?.name ?? s.title }],
      brand: product ? product.brand : `${step} step`,
      name: product ? product.name : s.title,
      rating: null,
      price,
      priceNote: pick.priceNote || null,
      stock: product ? (product.inStock ? 'in' : 'out') : null,
      description: product ? shortText(product.description, 320) : s.why || null,
      featuresTitle: extra?.contains.length ? 'Contains' : null,
      features: featuresFrom(extra?.contains),
      shop,
      alsoAt,
      rows: [
        { id: 'why', label: 'Why Evia recommends this', icon: 'badge', body: why },
        ingredientsRow(product?.ingredients ?? [], product ? [] : s.actives),
        fitRow(extra?.assessment ?? null, s.cautions, (product?.ingredients.length ?? 0) > 0, !product),
      ],
    },
  };
}

function matches(card: ProductCardView, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => card.searchText.includes(w));
}

const SHELF_EMPTY = (storeName: string): EmptyView => ({
  title: 'The shop shelf is empty for now',
  body: `Products appear here when the ${storeName} catalogue is connected. Until then, Evia's picks point to places to look, and nothing here is invented to fill the space.`,
  icon: 'shopping-bag',
});

function picksEmpty(input: ProductsRealInput): EmptyView {
  if (!input.hasScan) {
    return {
      title: 'Your picks start with a scan',
      body: 'Evia suggests products by ingredient, from what your latest reading shows. Take a scan and they appear here, each with the reason for it.',
      icon: 'sparkle',
      action: { label: 'Take a scan', href: '/scan' },
    };
  }
  return {
    title: 'Nothing to suggest right now',
    body: 'Your latest reading did not call for a product the shelf or the web could point to. Evia says so rather than filling the space.',
    icon: 'sparkle',
  };
}

export function buildProducts(input: ProductsRealInput): ProductsView {
  const { category, query } = input;
  const q = query.trim();
  const picks = input.picks.map((p) => pickCard(p, p.product ? input.extras[p.product.id] : undefined, input.storeName));
  const shelf = input.catalogue.items.map((l) => catalogueCard(l, input.extras[l.id]));
  const shelfLoading = input.catalogue.status === 'loading' || input.catalogue.status === 'idle';
  const noShelf = input.catalogue.status === 'ready' && input.catalogue.total === 0 && !q && (category === 'all' || category === 'recommended');

  const shelfEmpty = (): EmptyView => {
    if (input.catalogue.status === 'signed-out') {
      return input.shelfCount
        ? {
            title: 'Sign in to browse the shelf',
            body: `The ${input.storeName} catalogue is open to signed-in accounts. Your picks from this visit stay above.`,
            icon: 'shopping-bag',
          }
        : SHELF_EMPTY(input.storeName);
    }
    if (input.catalogue.status === 'error') {
      return { title: 'The shelf did not load', body: 'Something went wrong reaching the catalogue. Try again in a moment.', icon: 'info' };
    }
    if (input.shelfCount === 0 || noShelf) return SHELF_EMPTY(input.storeName);
    if (q) return { title: `Nothing matches “${q}”`, body: 'Try a brand, a product name or an ingredient.', icon: 'search' };
    return {
      title: `Nothing under ${chipLabel(category)} yet`,
      body: `The ${input.storeName} shelf has nothing in this category right now.`,
      icon: 'shopping-bag',
    };
  };

  /* "From the Ese catalogue." - and how much of it, when not all of it is shown. */
  const shelfSubtitle = (shown: number): string =>
    input.catalogue.total > shown
      ? `From the ${input.storeName} catalogue. Showing ${shown} of ${input.catalogue.total}.`
      : `From the ${input.storeName} catalogue.`;

  const sections: ProductSectionView[] = [];

  if (category === 'saved') {
    /*
     * Each saved id, in the order it was saved: the pick's card when the
     * product is one of the picks (it keeps its reason), otherwise the shelf
     * product fetched by id - it may sit on any page of the shelf.
     */
    const cards: ProductCardView[] = [];
    let waiting = false;
    let gone = 0;
    for (const saveId of input.savedIds) {
      const fromPicks = picks.find((c) => c.saveId === saveId);
      const catalogueId = saveId.startsWith('shelf:') ? saveId.slice('shelf:'.length) : null;
      const listing = catalogueId ? input.savedItems[catalogueId] : null;
      if (fromPicks) cards.push(fromPicks);
      else if (listing) cards.push(catalogueCard(listing, input.extras[listing.id]));
      else if (catalogueId && listing === undefined && input.signedIn) waiting = true;
      else gone += 1;
    }
    const saved = cards.filter((c) => !q || matches(c, q));
    sections.push({
      id: 'saved',
      title: 'Saved',
      subtitle: 'Kept on this device, for this account only.',
      products: saved,
      empty:
        saved.length || waiting
          ? null
          : q && cards.length
            ? { title: `No saved products match “${q}”`, body: 'Try a brand, a product name or an ingredient.', icon: 'search' }
            : gone && !cards.length
              ? {
                  title: 'Your saved products have left the shelf',
                  body: `The ${input.storeName} catalogue no longer has what you saved here.`,
                  icon: 'heart',
                }
              : { title: 'Nothing saved yet', body: 'Tap the heart on a product to keep it here. Saved items stay on this device.', icon: 'heart' },
      loading: waiting && !saved.length,
      viewAll: false,
      more: null,
    });
  } else if (category === 'recommended') {
    const shownPicks = q ? picks.filter((c) => matches(c, q)) : picks;
    sections.push({
      id: 'picks',
      title: q ? 'Your picks' : 'Recommended',
      accent: q ? undefined : 'for you',
      subtitle: input.picks.length
        ? 'Suggested by ingredient from your latest reading. Each one says why.'
        : undefined,
      products: shownPicks,
      empty:
        input.picksLoading || shownPicks.length
          ? null
          : q && picks.length
            ? {
                title: `No picks match “${q}”`,
                body: shelf.length ? 'The shelf results are below.' : 'Try a brand, a product name or an ingredient.',
                icon: 'search',
              }
            : picksEmpty(input),
      loading: input.picksLoading && !picks.length,
      viewAll: false,
      more: null,
    });
    sections.push({
      id: 'shelf',
      title: q ? `On the shelf: “${q}”` : 'On the shelf',
      subtitle: shelf.length ? shelfSubtitle(shelf.length) : undefined,
      products: shelf,
      empty: shelfLoading || shelf.length ? null : shelfEmpty(),
      loading: shelfLoading && input.catalogue.status !== 'signed-out',
      viewAll: !q && input.catalogue.total > shelf.length,
      more: null,
    });
  } else {
    /* The user's own picks that fall under this chip come first (a treat step is a serum). */
    const chipPicks =
      category === 'all'
        ? []
        : picks.filter((c) => c.categories.includes(category) && (!q || matches(c, q)));
    if (chipPicks.length) {
      sections.push({
        id: 'picks',
        title: 'Your picks',
        subtitle: `${chipLabel(category)} suggested from your latest reading.`,
        products: chipPicks,
        empty: null,
        loading: false,
        viewAll: false,
        more: null,
      });
    }
    sections.push({
      id: 'shelf',
      title: q ? `${chipLabel(category)}: “${q}”` : chipLabel(category),
      subtitle: shelf.length ? shelfSubtitle(shelf.length) : undefined,
      products: shelf,
      empty: shelfLoading || shelf.length ? null : shelfEmpty(),
      loading: shelfLoading && input.catalogue.status !== 'signed-out',
      viewAll: false,
      more:
        input.catalogue.nextCursor && shelf.length
          ? { shown: shelf.length, total: input.catalogue.total, loading: input.catalogue.loadingMore }
          : null,
    });
  }

  /*
   * Only claims with something behind them: shelf products are checked
   * against the profile (assessProduct) when the shop lists ingredients, so
   * the line needs an account and a shelf with products on it. There is no
   * cart or checkout in Evia (decision 11), so every purchase happens at the
   * shop itself - true of a search link too (Google Shopping lists shops;
   * it sells nothing), which is why the line does not say "straight to".
   */
  const trust: string[] = [];
  if (input.signedIn && (input.shelfCount ?? input.catalogue.total) > 0) {
    trust.push('Ingredient lists checked against your profile');
  }
  trust.push('You buy from the shop itself, not through Evia');

  return {
    mode: 'real',
    hero: {
      headline: HERO_HEADLINE,
      subtitle: input.picks.length
        ? 'Curated by Evia, ingredient first. Chosen for your latest reading.'
        : 'Curated by Evia, ingredient first.',
      trust,
      quote: HERO_QUOTE,
    },
    searchPlaceholder: SEARCH_PLACEHOLDER,
    /* The ids are this account's own (saved.svelte.ts keeps one list per scope). */
    categories: input.savedIds.length || category === 'saved' ? [...CATEGORY_CHIPS, SAVED_CHIP] : CATEGORY_CHIPS,
    sections,
    disclosure: AFFILIATE_DISCLOSURE,
    fitNote: FIT_NOTE,
  };
}

// --- sample mode --------------------------------------------------------------

export interface SampleProducts {
  hero: ProductsHeroView;
  section: { title: string; accent: string; subtitle: string };
  products: ProductCardView[];
}

/** The sample shelf, filtered the way the real one is (on the client: it is all here). */
export function buildSampleProducts(
  sample: SampleProducts,
  category: CategoryKey,
  query: string,
  savedIds: string[],
): ProductsView {
  const q = query.trim();
  let products = sample.products;
  if (category === 'saved') {
    products = savedIds.flatMap((id) => products.find((p) => p.saveId === id) ?? []);
  }
  else if (category !== 'recommended' && category !== 'all') products = products.filter((p) => p.categories.includes(category));
  if (q) products = products.filter((p) => matches(p, q));

  const isRecommended = category === 'recommended' && !q;
  return {
    mode: 'sample',
    hero: sample.hero,
    searchPlaceholder: SEARCH_PLACEHOLDER,
    categories:
      category === 'saved' || savedIds.some((id) => sample.products.some((p) => p.saveId === id))
        ? [...CATEGORY_CHIPS, SAVED_CHIP]
        : CATEGORY_CHIPS,
    sections: [
      {
        id: 'sample',
        title: isRecommended ? sample.section.title : q ? `Results for “${q}”` : chipLabel(category),
        accent: isRecommended ? sample.section.accent : undefined,
        subtitle: isRecommended ? sample.section.subtitle : undefined,
        products,
        empty: products.length
          ? null
          : category === 'saved'
            ? { title: 'Nothing saved yet', body: 'Tap the heart on a product to keep it here.', icon: 'heart' }
            : { title: 'Nothing in the sample shelf here', body: 'The sample shows the mockup’s eight products.', icon: 'search' },
        loading: false,
        viewAll: isRecommended,
        more: null,
      },
    ],
    disclosure: AFFILIATE_DISCLOSURE,
    fitNote: FIT_NOTE,
  };
}

/** Sample or real, as the mode says (the page's one entry point). */
export function productsView(
  sampleOn: boolean,
  sample: SampleProducts,
  real: ProductsRealInput,
): ProductsView {
  return sampleOn ? buildSampleProducts(sample, real.category, real.query, real.savedIds) : buildProducts(real);
}
