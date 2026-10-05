/**
 * The character prototype's switch (src/character3d/switch.svelte.ts).
 *
 * Off unless this device turned it on: on from Settings (remembered only with
 * the Functional cookie category allowed, like the sample-data choice), or for
 * one visit from `?character=1`, which is read once and stripped from the
 * address. Blocked storage never breaks it. Refusing Functional storage clears
 * the stored choice with the rest of that category.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FUNCTIONAL_KEYS, readCookies, saveCookies } from '../src/lib/cookie-preferences.ts';
import { CHARACTER_STORAGE_KEY, characterProto, readCharacterAtBoot, setCharacterProto } from '../src/character3d/switch.svelte.ts';

function stubBrowser(href: string, storage: Map<string, string> | 'blocked') {
  const replaceState = vi.fn();
  vi.stubGlobal('window', { location: { href }, history: { state: null, replaceState } });
  const blocked = () => {
    throw new Error('storage blocked');
  };
  vi.stubGlobal('localStorage', storage === 'blocked'
    ? { getItem: blocked, setItem: blocked, removeItem: blocked }
    : {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
        removeItem: (k: string) => void storage.delete(k),
        key: (i: number) => [...storage.keys()][i] ?? null,
        get length() {
          return storage.size;
        },
      });
  return replaceState;
}

afterEach(() => {
  vi.unstubAllGlobals();
  characterProto.on = false;
});

describe('character prototype switch', () => {
  it('is off by default', () => {
    stubBrowser('http://127.0.0.1:5495/scan', new Map());
    readCharacterAtBoot();
    expect(characterProto.on).toBe(false);
  });

  it('turns on for the visit from ?character=1, keeps other queries, and stores nothing', () => {
    const storage = new Map<string, string>();
    const replaceState = stubBrowser('http://127.0.0.1:5495/?sample=1&character=1#x', storage);
    saveCookies({ functional: true });
    readCharacterAtBoot();
    expect(characterProto.on).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?sample=1#x');
    expect(storage.has(CHARACTER_STORAGE_KEY)).toBe(false);
  });

  it('turns off for the visit from ?character=0, even when this device keeps it on', () => {
    const storage = new Map([[CHARACTER_STORAGE_KEY, '1']]);
    stubBrowser('http://127.0.0.1:5495/scan?character=0', storage);
    saveCookies({ functional: true });
    readCharacterAtBoot();
    expect(characterProto.on).toBe(false);
    expect(storage.get(CHARACTER_STORAGE_KEY)).toBe('1');
  });

  it('remembers the Settings choice on this device with Functional storage allowed', () => {
    const storage = new Map<string, string>();
    stubBrowser('http://127.0.0.1:5495/settings', storage);
    saveCookies({ functional: true });
    setCharacterProto(true);
    expect(storage.get(CHARACTER_STORAGE_KEY)).toBe('1');
    readCharacterAtBoot();
    expect(characterProto.on).toBe(true);
    setCharacterProto(false);
    expect(storage.has(CHARACTER_STORAGE_KEY)).toBe(false);
  });

  it('holds for the tab only without Functional storage, and refusing it clears a stored choice', () => {
    const storage = new Map<string, string>();
    stubBrowser('http://127.0.0.1:5495/settings', storage);
    setCharacterProto(true);
    expect(characterProto.on).toBe(true);
    expect(storage.has(CHARACTER_STORAGE_KEY)).toBe(false);

    expect(FUNCTIONAL_KEYS).toContain(CHARACTER_STORAGE_KEY);
    storage.set(CHARACTER_STORAGE_KEY, '1');
    saveCookies({ functional: false });
    readCookies();
    expect(storage.has(CHARACTER_STORAGE_KEY)).toBe(false);
    readCharacterAtBoot();
    expect(characterProto.on).toBe(false);
  });

  it('never throws with storage blocked', () => {
    stubBrowser('http://127.0.0.1:5495/scan', 'blocked');
    expect(() => readCharacterAtBoot()).not.toThrow();
    expect(characterProto.on).toBe(false);
    expect(() => setCharacterProto(true)).not.toThrow();
    expect(characterProto.on).toBe(true);
  });
});
