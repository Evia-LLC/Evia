/**
 * The heart on a product: a "Saved" list kept on this device only
 * (BUILD-PLAN decision 11), until there is a favourites table to keep it on
 * the account.
 *
 * Only product ids are stored - a shelf product's catalogue id
 * (`shelf:<id>`) or a sample product's id (`sample:<id>`) - never anything
 * about the reading that suggested it. A suggestion that is not a product on
 * the shelf ("a gentle salicylic cleanser") has no heart at all: its name
 * comes from the reading, so it is never written down.
 *
 * Each list belongs to one scope, so nobody sees anyone else's:
 * - `sample` - the preview's shelf;
 * - `account:<id>` - one signed-in account on this device;
 * - `guest` - held for this tab only, never stored (a guest has no account
 *   to come back to, and the next person at the device must not inherit it).
 *
 * Stored only with the Functional cookie category allowed (main, Section 5:
 * src/lib/cookie-preferences.ts, which also clears these lists when that
 * permission is refused or lapses). Without it, or with storage blocked
 * (private windows, strict settings), a list lasts as long as the tab and
 * nothing breaks; `saved.kept` says which, so the page can say so.
 */
import { functionalStorageAllowed } from '@/lib/cookie-preferences.ts';

export type SavedScope = 'sample' | 'guest' | `account:${string}`;

const PREFIX = 'evia.products.saved';
/** The first version kept one list for everyone, pick names included. */
const LEGACY_KEY = PREFIX;

function keyFor(scope: SavedScope): string | null {
  return scope === 'guest' ? null : `${PREFIX}.${scope}`;
}

/** Whether this device may keep the lists (the Functional category). */
function mayStore(): boolean {
  try {
    return functionalStorageAllowed();
  } catch {
    return false;
  }
}

function read(key: string): string[] {
  try {
    if (!mayStore()) return [];
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, 200) : [];
  } catch {
    return [];
  }
}

function write(key: string, ids: string[]): void {
  try {
    if (!mayStore()) return;
    if (ids.length) localStorage.setItem(key, JSON.stringify(ids));
    else localStorage.removeItem(key);
  } catch {
    // Blocked storage: the list holds for this tab only.
  }
}

/*
 * The old shared list: its sample ids move to the sample scope, and the rest
 * (which could name a suggestion from someone's reading) is dropped.
 */
function migrateLegacy(): void {
  try {
    const old = read(LEGACY_KEY);
    if (!old.length) return;
    const sampleKey = `${PREFIX}.sample`;
    const kept = old.filter((id) => id.startsWith('sample:'));
    if (kept.length) write(sampleKey, [...new Set([...read(sampleKey), ...kept])]);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Nothing to do when storage is blocked.
  }
}

/** `kept`: whether the list on screen is stored on this device, or held for the tab. */
export const saved = $state<{ scope: SavedScope | null; ids: string[]; kept: boolean }>({ scope: null, ids: [], kept: false });

let migrated = false;

/**
 * The lists this tab holds when they cannot be stored (no Functional
 * permission): the preview's and each account's, so switching sample data on
 * and off does not empty them. Never the guest's, which ends with the visit.
 */
const held = new Map<SavedScope, string[]>();

/** Show the list that belongs to whoever is here now. */
export function useSavedScope(scope: SavedScope): void {
  if (saved.scope === scope) return;
  if (!migrated && typeof window !== 'undefined') {
    migrated = true;
    migrateLegacy();
  }
  const key = keyFor(scope);
  saved.scope = scope;
  saved.kept = Boolean(key) && mayStore();
  saved.ids = !key ? [] : saved.kept ? read(key) : (held.get(scope) ?? []);
}

export function isSaved(id: string): boolean {
  return saved.ids.includes(id);
}

export function toggleSaved(id: string): void {
  if (!saved.scope) return;
  saved.ids = saved.ids.includes(id) ? saved.ids.filter((x) => x !== id) : [id, ...saved.ids];
  const key = keyFor(saved.scope);
  if (!key) return;
  saved.kept = mayStore();
  if (saved.kept) write(key, saved.ids);
  else held.set(saved.scope, saved.ids);
}
