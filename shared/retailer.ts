/**
 * Who sells a product: the name on its "Shop at {retailer} ↗" button
 * (BUILD-PLAN decision 11).
 *
 * Every product names its own retailer, never a house name the app made up.
 * In order:
 *
 *   1. an explicit `retailer` the catalogue import gave for the product;
 *   2. the configured store's name, but only for a product that really came
 *      from that store's sync and only when a name is configured (the server
 *      decides that and passes `store`);
 *   3. a retailer known by its site: amazon.* is Amazon, ulta.com is Ulta
 *      Beauty, and so on;
 *   4. the brand's own site, named as the brand: cerave.com for a CeraVe
 *      product is "CeraVe";
 *   5. otherwise the site's readable address ("cerave.com"), which is true
 *      even when nothing else is known.
 *
 * Shared by the server (which names each catalogue product and pick) and the
 * page (a fallback for a pick the server did not name). It only reads the
 * URL's host: nothing is added to, or taken from, the rest of the link, so a
 * name can never carry anything about the user (SRS ADS-01).
 */

export interface RetailerSource {
  /** The outbound product link. */
  url: string;
  /** The product's brand, so a brand's own site reads as the brand. */
  brand?: string | null;
  /** An explicit retailer name from a catalogue import. Wins when present. */
  retailer?: string | null;
  /**
   * The configured store this product was synced from, when it was (never
   * for an import or a hand-kept list). Used only for links on its own host.
   */
  store?: { name: string; host: string } | null;
}

/** Retailers named by their site, keyed by the site's name (amazon.co.uk is "amazon"). */
const KNOWN_RETAILERS: Record<string, string> = {
  amazon: 'Amazon',
  sephora: 'Sephora',
  ulta: 'Ulta Beauty',
  boots: 'Boots',
  target: 'Target',
  walmart: 'Walmart',
  lookfantastic: 'LOOKFANTASTIC',
  cultbeauty: 'Cult Beauty',
  yesstyle: 'YesStyle',
  stylevana: 'Stylevana',
  ebay: 'eBay',
};

/**
 * Domain endings the known retailers really trade on. A known name on any other
 * ending (amazon.xyz) is not taken at its word: the link is named by its own
 * address instead, so a lookalike never borrows a real shop's name.
 */
const STOREFRONT_SUFFIXES = new Set([
  'com', 'net', 'eu', 'us', 'co.uk', 'ie', 'de', 'fr', 'it', 'es', 'nl', 'be', 'at', 'ch', 'se', 'pl',
  'ca', 'com.au', 'co.nz', 'co.jp', 'jp', 'in', 'com.mx', 'com.br', 'sg', 'com.sg', 'ae', 'sa', 'com.tr',
  'cn', 'com.hk', 'co.za',
]);

/** Amazon's own short-link hosts. */
const KNOWN_HOSTS: Record<string, string> = {
  'amzn.to': 'Amazon',
  'amzn.eu': 'Amazon',
  'amzn.asia': 'Amazon',
};

/** Words a brand's own shop adds to the brand's name in its address (anuaskincare.com, paulaschoiceusa.com). */
const BRAND_SITE_AFFIXES = ['skincare', 'skin', 'beauty', 'cosmetics', 'usa', 'us', 'uk', 'global', 'official', 'shop', 'store'];

/** Second-level labels under a country code that are not the site's own name (co.uk, com.au). */
const SECOND_LEVEL = /^(co|com|org|net|ac|gov|edu|ne|or)$/;

const MAX_NAME = 60;

/** The lower-cased host of an http(s) link, or null. */
export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.hostname.toLowerCase().replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

/** `host` is `domain` or one of its subdomains. */
export function onDomain(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return host === d || host.endsWith(`.${d}`);
}

/**
 * The part of a host a person would call the site: "www.lookfantastic.co.uk"
 * is "lookfantastic.co.uk", "shop.cerave.com" is "cerave.com". A small rule
 * (two labels, or three under a country code's co./com.), not the full public
 * suffix list: it only ever names a link, so a rare miss reads as a slightly
 * longer address, never as a different shop.
 */
export function registrableHost(host: string): string {
  const clean = host.toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(clean) || clean.includes(':')) return clean;
  const labels = clean.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL.test(second) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** Letters and digits only, accents dropped, for comparing a brand with an address. */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

/** The site is the brand's own: "larocheposay" for La Roche-Posay, "theordinary" for The Ordinary. */
export function isBrandSite(site: string, brand: string): boolean {
  const b = fold(brand);
  const s = fold(site);
  if (b.length < 2 || !s) return false;
  if (s === b) return true;
  const bare = b.replace(/^the/, '');
  if (bare.length >= 4 && s === bare) return true;
  return b.length >= 4 && BRAND_SITE_AFFIXES.some((affix) => s === b + affix || s === affix + b);
}

/** A retailer name as given, tidied: one line, no control characters, not too long. Null when empty. */
export function cleanRetailerName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length <= MAX_NAME ? clean : `${clean.slice(0, MAX_NAME - 1).trimEnd()}…`;
}

/** A retailer known by its site, or null. */
export function knownRetailer(host: string): string | null {
  const bare = host.replace(/^www\./, '');
  if (KNOWN_HOSTS[bare]) return KNOWN_HOSTS[bare];
  const [site = '', ...rest] = registrableHost(bare).split('.');
  if (!STOREFRONT_SUFFIXES.has(rest.join('.'))) return null;
  return Object.hasOwn(KNOWN_RETAILERS, site) ? KNOWN_RETAILERS[site] : null;
}

/** The name for a product's "Shop at ..." button. See the rules at the top of this file. */
export function retailerName(source: RetailerSource): string {
  const explicit = cleanRetailerName(source.retailer);
  if (explicit) return explicit;
  const host = hostOf(source.url);
  if (!host) return 'the retailer';
  if (source.store && onDomain(host, source.store.host)) {
    const name = cleanRetailerName(source.store.name);
    if (name) return name;
  }
  const known = knownRetailer(host);
  if (known) return known;
  const site = registrableHost(host);
  const brand = cleanRetailerName(source.brand);
  if (brand && isBrandSite(site.split('.')[0] ?? '', brand)) return brand;
  return site;
}
