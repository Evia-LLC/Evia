/**
 * The character prototype switch: off unless this device turned it on.
 *
 * The prototype is a stand-in mannequin (not Evia: BUILD-PLAN decision 3
 * still holds for the product) that looks at, reaches for and points at the
 * Scan hologram. With the switch off nothing of it loads - no three.js beyond
 * the hologram's own, no model - and the consult tour plays without her (a
 * light pulse taps each place).
 *
 * On from Settings ("Character prototype"), remembered on this device - with
 * the Functional cookie category allowed, like the sample-data choice (main,
 * Section 5; the key is in cookie-preferences' FUNCTIONAL_KEYS so refusing
 * that category clears it); without it, or with storage blocked, the choice
 * lasts as long as the tab. `?character=1` in the address turns it on for the
 * visit (`?character=0` off), read once at boot and stripped from the address
 * the way `?sample=` is.
 *
 * This module is tiny and three-free on purpose: the pages import it
 * statically to decide whether to load anything at all.
 */
import { functionalStorageAllowed } from '@/lib/cookie-preferences.ts';

export const CHARACTER_STORAGE_KEY = 'evia.character.proto';

export const characterProto = $state({ on: false });

function stored(): boolean {
  try {
    if (!functionalStorageAllowed()) return false;
    return localStorage.getItem(CHARACTER_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persist(on: boolean): void {
  try {
    if (on && functionalStorageAllowed()) localStorage.setItem(CHARACTER_STORAGE_KEY, '1');
    else localStorage.removeItem(CHARACTER_STORAGE_KEY);
  } catch {
    // Blocked storage: the choice holds for this tab only.
  }
}

/** Turns the prototype on or off, and remembers it on this device where that is allowed. */
export function setCharacterProto(on: boolean): void {
  characterProto.on = on;
  persist(on);
}

/**
 * Reads the address and the stored choice. Runs once when this module is first imported;
 * exported so a test can run it against a stubbed location.
 */
export function readCharacterAtBoot(): void {
  characterProto.on = false;
  if (typeof window === 'undefined') return;
  let asked: string | null = null;
  try {
    const url = new URL(window.location.href);
    asked = url.searchParams.get('character');
    if (asked !== null) {
      url.searchParams.delete('character');
      const query = url.searchParams.toString();
      window.history.replaceState(window.history.state, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
    }
  } catch {
    asked = null;
  }
  // The address wins for this visit and is not stored: a shared link does not change a device.
  if (asked === '1' || asked === '0') {
    characterProto.on = asked === '1';
    return;
  }
  characterProto.on = stored();
}

readCharacterAtBoot();
