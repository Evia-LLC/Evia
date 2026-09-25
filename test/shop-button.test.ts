/**
 * The "Shop at {retailer} ↗" button as a screen reader and a browser meet it
 * (BUILD-PLAN decision 11): its accessible name says which retailer and that
 * it opens a new tab, it opens one, it is marked sponsored, and the URL is the
 * server's, untouched.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ShopButton from '../src/pages/products/ShopButton.svelte';

describe('ShopButton', () => {
  it('names the retailer and the new tab, and opens one', () => {
    const { body } = render(ShopButton, {
      props: {
        shop: { label: 'Shop at CeraVe', retailer: 'CeraVe', url: 'https://www.cerave.com/p/1?tag=evia-20', kind: 'product' },
        product: 'CeraVe Hydrating Facial Cleanser',
      },
    });
    expect(body).toContain('aria-label="Shop at CeraVe: CeraVe Hydrating Facial Cleanser (opens in a new tab)"');
    expect(body).toContain('target="_blank"');
    expect(body).toContain('rel="sponsored noopener noreferrer"');
    expect(body).toContain('href="https://www.cerave.com/p/1?tag=evia-20"');
    // Drawn as "Shop at" + the retailer, so the retailer can take its own line in a narrow card.
    expect(body).toMatch(/<span class="shop-btn__lead[^"]*">Shop at<\/span> <span class="shop-btn__who[^"]*">CeraVe<\/span>/);
    expect(body).not.toMatch(/\bEse\b/);
  });

  it('leaves a search link its own words', () => {
    const { body } = render(ShopButton, {
      props: {
        shop: { label: 'Search Amazon', retailer: 'Amazon', url: 'https://www.amazon.com/s?k=Retinol%20serum', kind: 'search', name: 'Search Amazon for Retinol serum' },
        product: 'A low-strength retinoid',
      },
    });
    expect(body).toContain('aria-label="Search Amazon for Retinol serum (opens in a new tab)"');
    expect(body).not.toContain('shop-btn__who');
    expect(body).toMatch(/>\s*Search Amazon\s*</);
  });

  it('says a sample button is switched off rather than opening a shop', () => {
    const { body } = render(ShopButton, {
      props: {
        shop: { label: 'Shop at Ulta Beauty', retailer: 'Ulta Beauty', url: null, kind: 'product' },
        product: 'The Ordinary Niacinamide 10% + Zinc 1%',
      },
    });
    expect(body).toContain('Shop at Ulta Beauty: The Ordinary Niacinamide 10% + Zinc 1% (sample: shop links are off in the preview)');
    expect(body).not.toContain('href=');
    expect(body).not.toContain('target="_blank"');
  });
});
