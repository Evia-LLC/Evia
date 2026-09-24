/**
 * Sample mode: the mockups' own numbers, clearly labelled.
 *
 * With it on, every page renders from its sample fixture (`src/sample/
 * fixtures/`) instead of from the session, and the shell shows a "Sample
 * data" badge for as long as it stays on. It exists so the screens can be
 * seen as designed without an account or a history, and it never writes
 * anything to the server - the fixtures are the whole of it.
 *
 * Turned on by `?sample=1` in the address (`?sample=0` turns it off), read
 * once when the app boots. The router has no query support, so the query is
 * stripped straight away with `history.replaceState`; the choice is kept in
 * localStorage so a reload does not drop it. Storage can be blocked, in which
 * case the choice lasts as long as the tab.
 */

const STORAGE_KEY = 'evia.sample';

export const sample = $state({ on: false });

function stored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persist(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage: the choice holds for this tab only.
  }
}

/** Turns sample mode on or off, and remembers the choice on this device. */
export function setSample(on: boolean): void {
  sample.on = on;
  persist(on);
}

/**
 * Reads the address and the stored choice. Runs once, when this module is
 * first imported; exported so a test can run it against a stubbed location.
 */
export function readSampleAtBoot(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const asked = url.searchParams.get('sample');
  if (asked === '1' || asked === '0') {
    setSample(asked === '1');
    url.searchParams.delete('sample');
    const query = url.searchParams.toString();
    window.history.replaceState(window.history.state, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
    return;
  }
  sample.on = stored();
}

readSampleAtBoot();
