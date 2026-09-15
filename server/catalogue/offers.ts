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
import type { Offer } from '../../shared/types.ts';

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
      url: s.itemWebUrl,
      imageUrl: s.image?.imageUrl ?? null,
      compared: true,
    }));
}

// --- search links -----------------------------------------------------------

export function amazonLink(query: string): Offer {
  const domain = process.env.ELOHIM_AMAZON_DOMAIN?.trim() || 'www.amazon.com';
  const tag = process.env.ELOHIM_AMAZON_TAG?.trim();
  const url = `https://${domain}/s?k=${encodeURIComponent(query)}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`;
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
