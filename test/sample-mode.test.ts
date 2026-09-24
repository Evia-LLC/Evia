/**
 * Sample mode's switch.
 *
 * On from `?sample=1` (read once, then stripped from the address because the
 * router has no query support) or from the stored choice; remembered on the
 * device; and never a crash when storage is blocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSampleAtBoot, sample, setSample } from '../src/sample/mode.svelte.ts';
import { session } from '../src/state/session.svelte.ts';

function stubBrowser(href: string, storage: Map<string, string> | 'blocked') {
  const replaceState = vi.fn();
  vi.stubGlobal('window', {
    location: { href },
    history: { state: null, replaceState },
  });
  const blocked = () => {
    throw new Error('storage blocked');
  };
  vi.stubGlobal('localStorage', storage === 'blocked'
    ? { getItem: blocked, setItem: blocked, removeItem: blocked }
    : {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
        removeItem: (k: string) => void storage.delete(k),
      });
  return replaceState;
}

afterEach(() => {
  vi.unstubAllGlobals();
  sample.on = false;
});

describe('sample mode', () => {
  it('turns on from ?sample=1, strips the query and remembers the choice', () => {
    const storage = new Map<string, string>();
    const replaceState = stubBrowser('http://127.0.0.1:5495/progress?sample=1#top', storage);
    readSampleAtBoot();
    expect(sample.on).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/progress#top');
    expect(storage.get('evia.sample')).toBe('1');

    setSample(false);
    expect(sample.on).toBe(false);
    expect(storage.has('evia.sample')).toBe(false);
  });

  it('keeps any other query, and turns off from ?sample=0', () => {
    const storage = new Map([['evia.sample', '1']]);
    const replaceState = stubBrowser('http://127.0.0.1:5495/?sample=0&ref=mail', storage);
    readSampleAtBoot();
    expect(sample.on).toBe(false);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?ref=mail');
    expect(storage.has('evia.sample')).toBe(false);
  });

  it('reads the stored choice when the address says nothing', () => {
    const replaceState = stubBrowser('http://127.0.0.1:5495/scan', new Map([['evia.sample', '1']]));
    readSampleAtBoot();
    expect(sample.on).toBe(true);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('survives blocked storage', () => {
    stubBrowser('http://127.0.0.1:5495/', 'blocked');
    expect(() => readSampleAtBoot()).not.toThrow();
    expect(sample.on).toBe(false);
    expect(() => setSample(true)).not.toThrow();
    expect(sample.on).toBe(true);
  });
});

describe('the end of a session', () => {
  it('clears guest mode, so a guest who signs in is not left on the guest paths', () => {
    session.guest = true;
    session.reset();
    expect(session.guest).toBe(false);
  });
});
