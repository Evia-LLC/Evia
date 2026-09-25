/**
 * SAMPLE DATA - the Products mockup's own shelf (ref3.png), for sample mode
 * only. Every string, price and rating is copied from
 * work/evia-rebuild/specs/products.md sections 2.3-2.8, including the parts
 * nothing real produces: the star ratings and review counts, the
 * "Trending" / "Popular" / "Best Match" badges, the gallery and "In stock".
 * That is why it is sample data, and why it only ever shows under the Sample
 * data badge.
 *
 * The stars are drawn from each rating, to the nearest half star. The mockup
 * drew some of them wrong (4.9 with four stars, the panel's 4.8 with two),
 * which read as a bug on screen, so those two mistakes are not copied.
 *
 * Deliberate departures (BUILD-PLAN decision 11): no cart, so "Add to cart"
 * is "Shop at {retailer} ↗", naming that product's own retailer exactly as a
 * real product's button does - the brand's own site ("Shop at CeraVe") or a
 * major beauty retailer ("Shop at Ulta Beauty"). The retailers are
 * illustrative, like the prices, and in the preview the link is switched off
 * (`url: null`), because a sample price must never send anyone to a real
 * retailer.
 *
 * The mockup shows only the first product's panel. The other seven panels
 * are built from each card's own text: the description is the card's blurb,
 * and the two benefit labels under it are that blurb's (or the product
 * name's) own words shortened - "Soothes and balances sensitive skin" gives
 * "Soothe" and "Balance" - so no panel says anything its card does not.
 * "Similar products" lists only other sample products of the same kind, and
 * says so when the sample shelf has none. The accordion bodies say plainly
 * what each row would hold with a real account. Wording flagged for counsel
 * is listed in design/counsel/products.md.
 */
import {
  FIT_NOTE,
  HERO_HEADLINE,
  HERO_QUOTE,
  type BottleKind,
  type DetailRowView,
  type FeatureView,
  type GalleryItem,
  type ProductCardView,
  type RatingView,
  type SampleProducts,
  type ShopLinkView,
  type StarFill,
} from '@/view/products.ts';
import type { CatalogueCategory } from '@/lib/api.ts';

/** The sample product's own "Shop at ..." button, switched off in the preview (no URL). */
function shopAt(retailer: string): ShopLinkView {
  return { label: `Shop at ${retailer}`, retailer, url: null, kind: 'product' };
}

/** Five stars for a rating out of 5, to the nearest half: 4.7 is four and a half, 4.8 is five. */
export function starsFor(rating: string): StarFill[] {
  const halves = Math.round(Math.min(5, Math.max(0, Number(rating) || 0)) * 2);
  return [0, 1, 2, 3, 4].map((i) => (halves >= 2 * i + 2 ? 'full' : halves === 2 * i + 1 ? 'half' : 'empty'));
}

interface SampleSeed {
  id: string;
  badge: ProductCardView['badge'];
  brand: string;
  name: string;
  /** Who sells it in the sample: the brand's own site or a major beauty retailer. */
  retailer: string;
  blurb: string;
  rating: string;
  count: string;
  price: string;
  bottle: BottleKind;
  category: CatalogueCategory;
  features: FeatureView[];
}

/** The mockup's own three benefit icons, on the first product's panel. */
const MOCKUP_FEATURES: FeatureView[] = [
  { label: 'Cleanse', icon: 'orbit' },
  { label: 'Hydrate', icon: 'droplet' },
  { label: 'Protect barrier', icon: 'bag-check' },
];

const SEEDS: SampleSeed[] = [
  {
    id: 'sample:cerave-hydrating-cleanser',
    badge: { label: 'Best Match', variant: 'match' },
    brand: 'CeraVe',
    name: 'Hydrating Facial Cleanser',
    retailer: 'CeraVe',
    blurb: 'Gentle, non-foaming cleanser for normal to dry skin.',
    rating: '4.8',
    count: '12.4k',
    price: '$14.99',
    bottle: 'cerave-cleanser',
    category: 'cleansers',
    features: MOCKUP_FEATURES,
  },
  {
    id: 'sample:anua-heartleaf-toner',
    badge: { label: 'Trending', variant: 'trending' },
    brand: 'Anua',
    name: 'Heartleaf 77% Toner',
    retailer: 'YesStyle',
    blurb: 'Soothes and balances sensitive skin.',
    rating: '4.7',
    count: '8.1k',
    price: '$18.00',
    bottle: 'anua-toner',
    category: 'toners',
    // "Soothes and balances sensitive skin."
    features: [
      { label: 'Soothe', icon: 'leaf' },
      { label: 'Balance', icon: 'orbit' },
    ],
  },
  {
    id: 'sample:ordinary-niacinamide',
    badge: { label: 'Best Match', variant: 'match' },
    brand: 'The Ordinary',
    name: 'Niacinamide 10% + Zinc 1%',
    retailer: 'Ulta Beauty',
    blurb: 'Helps with oil control, pores and uneven tone.',
    rating: '4.9',
    count: '18.2k',
    price: '$8.90',
    bottle: 'ordinary-serum',
    category: 'serums',
    // "Helps with oil control, pores and uneven tone."
    features: [
      { label: 'Oil control', icon: 'droplet' },
      { label: 'Pores', icon: 'orbit' },
    ],
  },
  {
    id: 'sample:lrp-toleriane-double-repair',
    badge: { label: 'Popular', variant: 'trending' },
    brand: 'La Roche-Posay',
    name: 'Toleriane Double Repair Moisturiser',
    retailer: 'La Roche-Posay',
    blurb: 'Strengthens skin barrier and provides long-lasting hydration.',
    rating: '4.8',
    count: '10.6k',
    price: '$19.99',
    bottle: 'lrp-cream',
    category: 'moisturisers',
    // "Strengthens skin barrier and provides long-lasting hydration."
    features: [
      { label: 'Skin barrier', icon: 'bag-check' },
      { label: 'Hydration', icon: 'droplet' },
    ],
  },
  {
    id: 'sample:boj-relief-sun',
    badge: { label: 'Good for you', variant: 'match' },
    brand: 'Beauty of Joseon',
    name: 'Relief Sun SPF 50+',
    retailer: 'Stylevana',
    blurb: 'Lightweight, no white cast. Perfect for daily use.',
    rating: '4.7',
    count: '9.3k',
    price: '$17.00',
    bottle: 'boj-sun',
    category: 'sunscreens',
    // "Relief Sun SPF 50+" / "Lightweight, no white cast."
    features: [
      { label: 'SPF 50+', icon: 'sun' },
      { label: 'Lightweight', icon: 'droplet' },
    ],
  },
  {
    id: 'sample:pc-bha-exfoliant',
    badge: { label: 'For concerns', variant: 'trending' },
    brand: 'Paula’s Choice',
    name: '2% BHA Liquid Exfoliant',
    retailer: 'Paula’s Choice',
    blurb: 'Unclogs pores and helps prevent breakouts.',
    rating: '4.8',
    count: '11.7k',
    price: '$34.00',
    bottle: 'pc-bha',
    category: 'treatments',
    // "2% BHA Liquid Exfoliant" / "Unclogs pores..."
    features: [
      { label: 'Exfoliant', icon: 'sparkle' },
      { label: 'Pores', icon: 'orbit' },
    ],
  },
  {
    id: 'sample:lrp-effaclar-duo',
    badge: { label: 'Best Match', variant: 'match' },
    brand: 'La Roche-Posay',
    name: 'Effaclar Duo+',
    retailer: 'Target',
    blurb: 'Targets blemishes and helps prevent marks.',
    rating: '4.6',
    count: '7.5k',
    price: '$22.00',
    bottle: 'lrp-duo',
    category: 'treatments',
    // "Targets blemishes and helps prevent marks."
    features: [
      { label: 'Blemishes', icon: 'sparkle' },
      { label: 'Marks', icon: 'orbit' },
    ],
  },
  {
    id: 'sample:cerave-pm-lotion',
    badge: { label: 'Gentle option', variant: 'gentle' },
    brand: 'CeraVe',
    name: 'PM Facial Moisturising Lotion',
    retailer: 'Amazon',
    blurb: 'Lightweight, oil-free hydration for nighttime.',
    rating: '4.8',
    count: '9.1k',
    price: '$15.50',
    bottle: 'cerave-pm',
    category: 'moisturisers',
    // "Lightweight, oil-free hydration for nighttime."
    features: [
      { label: 'Oil-free', icon: 'droplet' },
      { label: 'Nighttime', icon: 'orbit' },
    ],
  },
];

/** The first product's panel is the mockup's; its text is verbatim. */
const HERO_DESCRIPTION =
  'A gentle, non-foaming cleanser that removes dirt, oil and makeup without stripping your skin. Formulated with ceramides and hyaluronic acid to support your skin barrier.';

const KIND: Record<CatalogueCategory, string> = {
  cleansers: 'cleanser',
  toners: 'toner',
  serums: 'serum',
  moisturisers: 'moisturiser',
  sunscreens: 'sunscreen',
  treatments: 'treatment',
  makeup: 'makeup product',
};

function rowsFor(seed: SampleSeed, others: string[]): DetailRowView[] {
  return [
    {
      id: 'why',
      label: 'Why Evia recommends this',
      icon: 'badge',
      body: [
        'In the preview this row is sample text. With an account it gives the reason from your latest reading, in plain words, and the ingredient it was chosen for.',
      ],
    },
    {
      id: 'ingredients',
      label: 'Ingredients (full list)',
      icon: 'badge-list',
      body: [
        'With a real catalogue this lists the ingredients exactly as the shop publishes them. The preview has no list for this product.',
      ],
    },
    {
      id: 'how',
      label: 'How to use (with demonstration)',
      icon: 'circle-play',
      highlight: true,
      body: ['Sample row. A short demonstration plays here once demonstration media exists; none is available yet.'],
    },
    {
      id: 'fit',
      label: 'Is it right for you?',
      icon: 'droplet',
      body: [
        'With an account, Evia checks the ingredient list against your profile and the products you already use, and says what it found.',
      ],
      note: FIT_NOTE,
    },
    {
      id: 'reviews',
      label: `Reviews (${seed.count})`,
      icon: 'star',
      trailing: { star: true, text: seed.rating },
      body: ['Sample ratings. Evia has no review source yet, so ratings and review counts appear only in this preview.'],
    },
    {
      id: 'similar',
      label: 'Similar products',
      icon: 'bag-split',
      body: others.length ? [] : [`The sample shelf has no other ${KIND[seed.category]} to compare it with.`],
      list: others.length ? others : undefined,
    },
  ];
}

function galleryFor(seed: SampleSeed, index: number): GalleryItem[] {
  if (index === 0) {
    return [
      { kind: 'still', still: 'counter', bottle: seed.bottle, label: `${seed.brand} ${seed.name} on a bathroom counter` },
      { kind: 'still', still: 'cream', label: 'A swatch of the product’s texture' },
      { kind: 'still', still: 'pad', label: 'A cotton pad' },
      { kind: 'still', still: 'foam', label: 'A lather' },
    ];
  }
  return [{ kind: 'still', still: 'counter', bottle: seed.bottle, label: `${seed.brand} ${seed.name} on a bathroom counter` }];
}

function card(seed: SampleSeed, index: number): ProductCardView {
  const shop = shopAt(seed.retailer);
  const rating: RatingView = { value: seed.rating, count: `(${seed.count})`, stars: starsFor(seed.rating) };
  const similar = SEEDS.filter((s) => s.category === seed.category && s.id !== seed.id).map((s) => `${s.brand} ${s.name}`);
  return {
    id: seed.id,
    saveId: seed.id,
    a11yName: `${seed.brand} ${seed.name}`,
    catalogueId: null,
    brand: seed.brand,
    name: seed.name,
    blurb: seed.blurb,
    badge: seed.badge,
    rating,
    price: seed.price,
    bottle: seed.bottle,
    imageUrl: null,
    categories: [seed.category],
    shop,
    searchText: `${seed.brand} ${seed.name} ${seed.blurb} ${seed.category}`.toLowerCase(),
    detail: {
      gallery: galleryFor(seed, index),
      brand: seed.brand,
      name: seed.name,
      rating: { value: seed.rating, count: `(${seed.count} reviews)`, stars: starsFor(seed.rating) },
      price: seed.price,
      priceNote: null,
      stock: 'in',
      description: index === 0 ? HERO_DESCRIPTION : seed.blurb,
      featuresTitle: null,
      features: seed.features,
      shop,
      alsoAt: [],
      rows: rowsFor(seed, similar),
    },
  };
}

export const SAMPLE_PRODUCTS: SampleProducts = {
  hero: {
    headline: HERO_HEADLINE,
    subtitle: 'Curated by Evia. Backed by science. Chosen for your skin.',
    trust: ['Safe for your skin type', 'Ingredient-checked', 'Dermatologist-grade brands'],
    quote: HERO_QUOTE,
  },
  section: {
    title: 'Recommended',
    accent: 'for you',
    subtitle: 'Products that match your skin, goals and sensitivities.',
  },
  products: SEEDS.map(card),
};
