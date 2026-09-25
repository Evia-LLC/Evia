/**
 * The Saved list's storage (src/products/saved.svelte.ts) under main's cookie
 * categories: stored on the device only with the Functional category allowed,
 * otherwise held for the tab (the preview's and each account's list survive a
 * switch between them; a guest's never outlives its scope), and cleared when
 * the category is refused.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

function stubStorage(storage = new Map<string, string>()) {
  vi.stubGlobal('localStorage', {
    get length() {
      return storage.size;
    },
    key: (i: number) => [...storage.keys()][i] ?? null,
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  return storage;
}

async function load() {
  vi.resetModules();
  const cookies = await import('../src/lib/cookie-preferences.ts');
  const list = await import('../src/products/saved.svelte.ts');
  return { ...cookies, ...list };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Saved list', () => {
  it('is held for the tab without functional storage, and not written', async () => {
    const storage = stubStorage(new Map([['evia.products.saved.account:u1', '["shelf:old"]']]));
    const { saved, toggleSaved, useSavedScope } = await load();
    useSavedScope('account:u1');
    // Stored before the permission lapsed: cleared, not shown.
    expect(saved.ids).toEqual([]);
    expect(storage.has('evia.products.saved.account:u1')).toBe(false);
    expect(saved.kept).toBe(false);

    toggleSaved('shelf:cat-1');
    expect(saved.ids).toEqual(['shelf:cat-1']);
    expect([...storage.keys()].some((k) => k.startsWith('evia.products.saved'))).toBe(false);

    // Sample data on and off again: the account's list is still here in this tab.
    useSavedScope('sample');
    expect(saved.ids).toEqual([]);
    useSavedScope('account:u1');
    expect(saved.ids).toEqual(['shelf:cat-1']);
  });

  it('is stored with functional storage allowed, and cleared when it is refused', async () => {
    const storage = stubStorage();
    const { saved, saveCookies, toggleSaved, useSavedScope } = await load();
    saveCookies({ functional: true });
    useSavedScope('account:u1');
    expect(saved.kept).toBe(true);
    toggleSaved('shelf:cat-1');
    expect(storage.get('evia.products.saved.account:u1')).toBe('["shelf:cat-1"]');

    saveCookies({ functional: false });
    expect(storage.has('evia.products.saved.account:u1')).toBe(false);
  });

  it('never stores or holds a guest list beyond its scope', async () => {
    const storage = stubStorage();
    const { saved, saveCookies, toggleSaved, useSavedScope } = await load();
    saveCookies({ functional: true });
    useSavedScope('guest');
    toggleSaved('shelf:cat-1');
    expect(saved.kept).toBe(false);
    expect([...storage.keys()].some((k) => k.startsWith('evia.products.saved'))).toBe(false);
    useSavedScope('sample');
    useSavedScope('guest');
    expect(saved.ids).toEqual([]);
  });
});
