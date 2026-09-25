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
 * localStorage so a reload does not drop it - but only with the Functional
 * cookie category allowed (main, Section 5: src/lib/cookie-preferences.ts,
 * which also clears it when that permission is refused or lapses). Without
 * it, or with storage blocked, the choice lasts as long as the tab.
 *
 * A sample-only deployment (the `sample_demo` legal release profile, whose
 * build sets VITE_SAMPLE_DEMO=1 - see scripts/check-legal-content.ts and
 * vercel.json) is the one place both meanings of "sample" meet. There every
 * account is a sample account on a sample-only database, the deployment says
 * so on every screen (shell/DemoDeploymentNotice.svelte), and a visitor starts
 * in sample mode unless they have switched it off on this device. Switching it
 * off stays possible, because the walkthroughs the deployment exists for -
 * registration with a date of birth, the guardian review, a guest scan, the
 * account controls - run on the live paths, with sample details only.
 */

import { functionalStorageAllowed } from '@/lib/cookie-preferences.ts';

const STORAGE_KEY = 'evia.sample';

/** Built for the hosted sample-only demo (VITE_SAMPLE_DEMO=1). */
export const SAMPLE_ONLY_DEPLOYMENT = import.meta.env.VITE_SAMPLE_DEMO === '1';

export const sample = $state({ on: false });

/** The stored choice: true, false, or null when this device has made none. */
function stored(): boolean | null {
  try {
    if (!functionalStorageAllowed()) return null;
    const value = localStorage.getItem(STORAGE_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}

function persist(on: boolean): void {
  try {
    // Functional storage (main's cookie categories): not written without it.
    if (!functionalStorageAllowed()) localStorage.removeItem(STORAGE_KEY);
    else if (on) localStorage.setItem(STORAGE_KEY, '1');
    // Off is the default everywhere except a sample-only deployment, where
    // it has to be remembered to outlast a reload.
    else if (SAMPLE_ONLY_DEPLOYMENT) localStorage.setItem(STORAGE_KEY, '0');
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
 * Back to this build's default with no remembered choice: on for a sample-only
 * deployment, off everywhere else. A sample-only deployment calls it when an
 * account signs out, so the next visitor starts where every visitor does (the
 * account had set sample data aside while it was signed in).
 */
export function resetSample(): void {
  sample.on = SAMPLE_ONLY_DEPLOYMENT;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

/** What the address or this device said at boot; null when neither said anything. */
let bootChoice: boolean | null = null;

/**
 * Reads the address and the stored choice. Runs once, when this module is
 * first imported; exported so a test can run it against a stubbed location.
 */
export function readSampleAtBoot(): void {
  bootChoice = null;
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const asked = url.searchParams.get('sample');
  if (asked === '1' || asked === '0') {
    setSample(asked === '1');
    bootChoice = asked === '1';
    url.searchParams.delete('sample');
    const query = url.searchParams.toString();
    window.history.replaceState(window.history.state, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
    return;
  }
  bootChoice = stored();
  sample.on = bootChoice ?? SAMPLE_ONLY_DEPLOYMENT;
}

/**
 * A sample-only deployment's account, found signed in when the app boots (a
 * reload, a new tab). Signing in set its sample data aside (AuthGate), and
 * that stays so: the "off" is only stored with functional storage allowed, so
 * without it the account would otherwise come back in the designed sample on
 * every reload. An explicit `?sample=` or a stored choice still wins.
 */
export function sampleForRestoredAccount(): void {
  if (SAMPLE_ONLY_DEPLOYMENT && bootChoice === null) sample.on = false;
}

readSampleAtBoot();
