/**
 * "Shop at {retailer} ↗" names the product's own retailer (BUILD-PLAN
 * decision 11) - never a house name like the catalogue's old default.
 *
 * The name comes from, in order: the import's explicit `retailer`, the
 * configured store (only for its own synced products), a retailer known by
 * its site, the brand's own site, and otherwise the site's readable address.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanRetailerName,
  isBrandSite,
  knownRetailer,
  registrableHost,
  retailerName,
} from '../shared/retailer.ts';

describe('retailerName: retailers known by their site', () => {
  it.each([
    ['https://www.amazon.com/dp/B00TTD9BRC', 'Amazon'],
    ['https://www.amazon.co.uk/dp/B00TTD9BRC?tag=evia-21', 'Amazon'],
    ['https://amazon.com.au/dp/1', 'Amazon'],
    ['https://www.amazon.de/dp/1', 'Amazon'],
    ['https://smile.amazon.com/dp/1', 'Amazon'],
    ['https://amzn.to/3xYz', 'Amazon'],
    ['https://www.sephora.com/product/p1', 'Sephora'],
    ['https://www.sephora.co.uk/p/1', 'Sephora'],
    ['https://www.ulta.com/p/cleanser-pimprod1', 'Ulta Beauty'],
    ['https://www.boots.com/cerave-cleanser-10277283', 'Boots'],
    ['https://www.target.com/p/-/A-1', 'Target'],
    ['https://www.walmart.com/ip/1', 'Walmart'],
    ['https://www.lookfantastic.com/p/1', 'LOOKFANTASTIC'],
    ['https://www.lookfantastic.co.uk/p/1', 'LOOKFANTASTIC'],
    ['https://www.cultbeauty.co.uk/p/1', 'Cult Beauty'],
    ['https://www.yesstyle.com/en/p/1', 'YesStyle'],
    ['https://www.stylevana.com/en_US/p.html', 'Stylevana'],
    ['https://www.ebay.com/itm/1', 'eBay'],
  ])('%s is %s', (url, name) => {
    expect(retailerName({ url, brand: 'CeraVe' })).toBe(name);
  });

  it('does not take a lookalike host for the retailer it imitates', () => {
    expect(retailerName({ url: 'https://amazon.evil.example/dp/1' })).toBe('evil.example');
    expect(retailerName({ url: 'https://sephora-deals.example/p/1' })).toBe('sephora-deals.example');
    expect(knownRetailer('notamazon.com')).toBeNull();
  });

  it('does not lend a known name to the same word on an unusual domain ending', () => {
    expect(retailerName({ url: 'https://amazon.xyz/dp/1' })).toBe('amazon.xyz');
    expect(knownRetailer('ulta.shop')).toBeNull();
    expect(knownRetailer('www.amazon.co.uk')).toBe('Amazon');
    expect(knownRetailer('www.lookfantastic.com.au')).toBe('LOOKFANTASTIC');
  });
});

describe('retailerName: a brand’s own site', () => {
  it.each([
    ['https://www.cerave.com/skincare/cleansers/hydrating', 'CeraVe', 'CeraVe'],
    ['https://www.laroche-posay.us/toleriane', 'La Roche-Posay', 'La Roche-Posay'],
    ['https://theordinary.com/en-us/niacinamide.html', 'The Ordinary', 'The Ordinary'],
    ['https://www.paulaschoice.com/bha', 'Paula’s Choice', 'Paula’s Choice'],
    ['https://beautyofjoseon.com/products/relief-sun', 'Beauty of Joseon', 'Beauty of Joseon'],
    ['https://anuaskincare.com/products/toner', 'Anua', 'Anua'],
    ['https://shop.cerave.co.uk/p/1', 'CeraVe', 'CeraVe'],
  ])('%s sold by %s is "%s"', (url, brand, name) => {
    expect(retailerName({ url, brand })).toBe(name);
  });

  it('falls back to the readable address when the site is not the brand’s', () => {
    expect(retailerName({ url: 'https://www.cerave.com/p/1', brand: 'La Roche-Posay' })).toBe('cerave.com');
    expect(retailerName({ url: 'https://www.cerave.com/p/1' })).toBe('cerave.com');
    expect(retailerName({ url: 'https://shop.example/products/a', brand: 'Brand' })).toBe('shop.example');
    expect(retailerName({ url: 'https://www.skinshop.co.uk/p/1', brand: null })).toBe('skinshop.co.uk');
  });

  it('matches a brand to its address, not to any address that contains it', () => {
    expect(isBrandSite('cerave', 'CeraVe')).toBe(true);
    expect(isBrandSite('larocheposay', 'La Roche-Posay')).toBe(true);
    expect(isBrandSite('ceraveoutlet', 'CeraVe')).toBe(false);
    expect(isBrandSite('bestcerave', 'CeraVe')).toBe(false);
    expect(isBrandSite('x', 'X')).toBe(false);
  });
});

describe('retailerName: what the catalogue says first', () => {
  it('uses an explicit retailer from the import over anything in the link', () => {
    expect(retailerName({ url: 'https://www.amazon.com/dp/1', retailer: 'Sephora' })).toBe('Sephora');
    expect(retailerName({ url: 'https://www.cerave.com/p/1', brand: 'CeraVe', retailer: '  Cult   Beauty ' })).toBe('Cult Beauty');
  });

  it('ignores an empty explicit retailer', () => {
    expect(retailerName({ url: 'https://www.ulta.com/p/1', retailer: '   ' })).toBe('Ulta Beauty');
    expect(retailerName({ url: 'https://www.ulta.com/p/1', retailer: null })).toBe('Ulta Beauty');
  });

  it('uses the configured store’s name only for links on the store’s own host', () => {
    const store = { name: 'Northside Apothecary', host: 'shop.northside.example' };
    expect(retailerName({ url: 'https://shop.northside.example/products/a', store })).toBe('Northside Apothecary');
    expect(retailerName({ url: 'https://www.sephora.com/p/1', store })).toBe('Sephora');
  });

  it('never invents a name: no host is "the retailer"', () => {
    expect(retailerName({ url: 'not a url' })).toBe('the retailer');
    expect(retailerName({ url: 'javascript:alert(1)' })).toBe('the retailer');
  });

  it('never answers with the old house name', () => {
    const urls = [
      'https://shop.example/products/a',
      'https://www.cerave.com/p/1',
      'https://www.amazon.com/dp/1',
      'https://www.google.com/search?tbm=shop&q=x',
    ];
    for (const url of urls) expect(retailerName({ url, brand: 'Brand' })).not.toBe('Ese');
  });
});

describe('helpers', () => {
  it('reads the registrable part of a host', () => {
    expect(registrableHost('www.lookfantastic.co.uk')).toBe('lookfantastic.co.uk');
    expect(registrableHost('shop.cerave.com')).toBe('cerave.com');
    expect(registrableHost('amazon.com.au')).toBe('amazon.com.au');
    expect(registrableHost('cerave.com')).toBe('cerave.com');
    expect(registrableHost('localhost')).toBe('localhost');
    expect(registrableHost('127.0.0.1')).toBe('127.0.0.1');
  });

  it('tidies an imported name and caps its length', () => {
    expect(cleanRetailerName('  Sephora\n')).toBe('Sephora');
    expect(cleanRetailerName('')).toBeNull();
    expect(cleanRetailerName(42)).toBeNull();
    expect(cleanRetailerName('x'.repeat(80))!.length).toBe(60);
  });
});
