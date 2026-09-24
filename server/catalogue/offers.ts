/**
 * Where else a product can be bought, and for how much.
 *
 * The shelf comes first — see picks.ts — and this is what she reaches for
 * when the shelf has nothing for a suggestion, or to check whether the shelf
 * price is a good one. Two kinds of answer come back and the difference is
 * kept on the record:
 *
 *   an **offer** has a price that was actually fetched from a marketplace
 *   (eBay's Browse API, when keys are configured), so it can be compared;
 *
 *   a **link** is a search on a marketplace with no price attached (Amazon
 *   without the Product Advertising API, Google Shopping), so it can only be
 *   offered as somewhere to look.
 *
 * She never says she compared prices she did not fetch. The pick's note is
 * written from `compared`, which counts real offers only.
 */
import { log } from '../lib/log.ts';
import type { Offer, ProductPick } from '../../shared/types.ts';

// --- affiliate links ----------------------------------------------------------

/*
 * Affiliate tagging (BUILD-PLAN decision 11; SRS ADS-01).
 *
 * The Products page sends people to the retailer to buy ("Shop at ... ↗"),
 * and the operator may be paid a commission for that. Each retailer's
 * affiliate programme is configured in the environment on its own, and a
 * retailer's tag is only ever added to that retailer's own links:
 *
 *   ELOHIM_AFFILIATE_AMAZON_TAG     Amazon Associates tag, sent as `tag=`
 *                                   (ELOHIM_AMAZON_TAG, the older name, still
 *                                   works)
 *   ELOHIM_AFFILIATE_EBAY_PARAMS    eBay Partner Network query, as issued
 *                                   (`mkevt=1&mkcid=1&mkrid=...&campid=...`)
 *   ELOHIM_AFFILIATE_STORE_PARAMS   a query for the operator's own shop
 *                                   (ELOHIM_STORE_URL), e.g. `ref=evia`
 *   ELOHIM_AFFILIATE_LINKS          any other retailer an imported catalogue
 *                                   links to: space-separated `host:query`
 *                                   pairs, e.g. `sephora.com:om_mmc=aff-evia`
 *
 * What goes on the link is the operator's static string and nothing else.
 * ADS-01 forbids advertising or affiliate traffic carrying anything the app
 * learned from a scan, so no code path here takes a user, a reading or a
 * profile, and a configured parameter whose name looks like it is meant for
 * that kind of data (skin, scan, concern, score...) is refused outright rather
 * than trusted to hold a campaign id.
 *
 * Tagging never overrides a parameter the URL already carries, so running a
 * link through twice (an offer inside a pick) leaves it as it was.
 */

/** Parameter names that could only be there to carry personal or skin data. */
const SENSITIVE_PARAM =
  /skin|scan|concern|metric|score|analysis|health|condition|sensitiv|allerg|pregnan|fitzpatrick|redness|acne|email|user|profile/i;

function queryFrom(raw: string | undefined, where: string): Array<[string, string]> {
  const text = raw?.trim().replace(/^\?/, '');
  if (!text) return [];
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of new URLSearchParams(text)) {
    if (!key) continue;
    if (SENSITIVE_PARAM.test(key)) {
      log.warn('affiliate', 'refused a parameter that could carry personal data', { where, key });
      continue;
    }
    pairs.push([key, value]);
  }
  return pairs;
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** `host` is `domain` or one of its subdomains. */
function onDomain(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return host === d || host.endsWith(`.${d}`);
}

/** A brand's own country domains (amazon.com, amazon.co.uk, amazon.com.au, amazon.de), not lookalikes. */
const brandDomain = (brand: string) => new RegExp(`(^|\\.)${brand}\\.(com|co\\.[a-z]{2}|com\\.[a-z]{2}|[a-z]{2})$`);
const AMAZON = brandDomain('amazon');
const EBAY = brandDomain('ebay');
const GOOGLE = brandDomain('google');
const isAmazon = (host: string) => AMAZON.test(host) || host === 'amzn.to';
const isEbay = (host: string) => EBAY.test(host);
const isGoogleShopping = (host: string) => GOOGLE.test(host);

function storeHost(): string | null {
  const raw = process.env.ELOHIM_STORE_URL?.trim();
  return raw ? hostOf(raw) : null;
}

/** The configured `host:query` pairs for retailers beyond the named ones. */
function otherRetailers(): Array<{ domain: string; query: string }> {
  return (process.env.ELOHIM_AFFILIATE_LINKS ?? '')
    .split(/\s+/)
    .map((entry) => {
      const at = entry.indexOf(':');
      return at > 0 ? { domain: entry.slice(0, at).toLowerCase(), query: entry.slice(at + 1) } : null;
    })
    .filter((e): e is { domain: string; query: string } => e !== null && e.query.length > 0);
}

/** The affiliate parameters configured for the retailer this URL belongs to. */
function affiliateParams(host: string): Array<[string, string]> {
  if (isAmazon(host)) {
    const tag = (process.env.ELOHIM_AFFILIATE_AMAZON_TAG ?? process.env.ELOHIM_AMAZON_TAG)?.trim();
    return tag ? queryFrom(`tag=${encodeURIComponent(tag)}`, 'amazon') : [];
  }
  if (isEbay(host)) return queryFrom(process.env.ELOHIM_AFFILIATE_EBAY_PARAMS, 'ebay');
  const shop = storeHost();
  if (shop && onDomain(host, shop)) return queryFrom(process.env.ELOHIM_AFFILIATE_STORE_PARAMS, 'store');
  const other = otherRetailers().find((r) => onDomain(host, r.domain));
  return other ? queryFrom(other.query, other.domain) : [];
}

/**
 * A retailer link with that retailer's affiliate parameters added, and
 * whether any were. Links to unknown hosts, search engines and anything that
 * is not http(s) come back untouched.
 */
export function affiliateLink(url: string): { url: string; affiliate: boolean } {
  const host = hostOf(url);
  if (!host) return { url, affiliate: false };
  const params = affiliateParams(host);
  if (!params.length) return { url, affiliate: false };
  const parsed = new URL(url);
  let added = false;
  for (const [key, value] of params) {
    if (parsed.searchParams.has(key)) continue;
    parsed.searchParams.append(key, value);
    added = true;
  }
  const already = params.every(([key]) => parsed.searchParams.has(key));
  return { url: added ? parsed.toString() : url, affiliate: added || already };
}

export function withAffiliate(url: string): string {
  return affiliateLink(url).url;
}

/** The name to put on a "Shop at ..." button for this link. */
export function retailerFor(url: string): string {
  const host = hostOf(url);
  if (!host) return 'the retailer';
  const shop = storeHost();
  if (shop && onDomain(host, shop)) return process.env.ELOHIM_STORE_NAME?.trim() || 'Ese';
  if (isAmazon(host)) return 'Amazon';
  if (isEbay(host)) return 'eBay';
  if (isGoogleShopping(host)) return 'Google Shopping';
  const label = host.replace(/^www\./, '').split('.')[0] ?? host;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The same picks with every outbound link tagged for its own retailer. The
 * reasoning, the suggestion and the reading it came from stay in the
 * response for the page to show; none of it goes near a URL.
 */
export function tagPicks(picks: ProductPick[]): ProductPick[] {
  return picks.map((pick) => ({
    ...pick,
    product: pick.product ? { ...pick.product, url: withAffiliate(pick.product.url) } : null,
    offers: pick.offers.map((offer) => ({ ...offer, url: withAffiliate(offer.url) })),
    bestUrl: pick.bestUrl ? withAffiliate(pick.bestUrl) : null,
  }));
}

// --- eBay -------------------------------------------------------------------

let ebayToken: { value: string; expiresAt: number } | null = null;

function ebayConfigured(): boolean {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}

async function ebayAccessToken(): Promise<string | null> {
  if (!ebayConfigured()) return null;
  if (ebayToken && ebayToken.expiresAt > Date.now() + 30_000) return ebayToken.value;
  const basic = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`,
  ).toString('base64');
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });
  if (!response.ok) {
    log.warn('offers', 'ebay token refused', { status: response.status });
    return null;
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  ebayToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return ebayToken.value;
}

interface EbaySummary {
  title: string;
  price?: { value: string; currency: string };
  itemWebUrl: string;
  image?: { imageUrl?: string };
  condition?: string;
  seller?: { username?: string };
}

/** Priced listings for a query, new condition, fixed price. Empty without keys. */
export async function ebayOffers(query: string, limit = 4): Promise<Offer[]> {
  const token = await ebayAccessToken().catch(() => null);
  if (!token) return [];
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    filter: 'buyingOptions:{FIXED_PRICE},conditions:{NEW}',
  });
  const response = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': process.env.EBAY_MARKETPLACE ?? 'EBAY_US',
      },
    },
  );
  if (!response.ok) {
    log.warn('offers', 'ebay search failed', { status: response.status });
    return [];
  }
  const data = (await response.json()) as { itemSummaries?: EbaySummary[] };
  return (data.itemSummaries ?? [])
    .filter((s) => s.price?.value && s.itemWebUrl)
    .map((s) => ({
      merchant: 'eBay',
      title: s.title,
      priceCents: Math.round(Number(s.price!.value) * 100),
      currency: s.price!.currency,
      url: withAffiliate(s.itemWebUrl),
      imageUrl: s.image?.imageUrl ?? null,
      compared: true,
    }));
}

// --- search links -----------------------------------------------------------

export function amazonLink(query: string): Offer {
  const domain = process.env.ELOHIM_AMAZON_DOMAIN?.trim() || 'www.amazon.com';
  const url = withAffiliate(`https://${domain}/s?k=${encodeURIComponent(query)}`);
  return { merchant: 'Amazon', title: `Search Amazon for ${query}`, priceCents: null, currency: null, url, imageUrl: null, compared: false };
}

export function shoppingLink(query: string): Offer {
  return {
    merchant: 'Google Shopping',
    title: `Compare prices for ${query}`,
    priceCents: null,
    currency: null,
    url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`,
    imageUrl: null,
    compared: false,
  };
}

/** Everything the web can say about a query: real offers first, then links. */
export async function webOffers(query: string): Promise<Offer[]> {
  const priced = await ebayOffers(query).catch((err: Error) => {
    log.warn('offers', 'ebay lookup failed', { error: err.message });
    return [] as Offer[];
  });
  return [...priced, amazonLink(query), shoppingLink(query)];
}

export function comparisonAvailable(): boolean {
  return ebayConfigured();
}
