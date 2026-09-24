/**
 * The navigation, in the mockups' order, with the glyph each item wears.
 *
 * One list feeds the sidebar, the icon rail and the phone's tab bar, so the
 * three can never disagree. Labels come from the route table.
 */

import { ROUTES, type RouteId } from '@/router/router.svelte.ts';
import type { IconName } from '@/ui/icons.ts';

export interface NavItem {
  id: RouteId;
  path: string;
  label: string;
  icon: IconName;
}

const ICONS: Partial<Record<RouteId, IconName>> = {
  home: 'house',
  scan: 'camera',
  routine: 'clipboard-list',
  progress: 'bar-chart',
  products: 'shopping-bag',
  learn: 'book-open',
  settings: 'settings',
};

export const NAV: NavItem[] = ROUTES.filter((r) => r.nav && ICONS[r.id]).map((r) => ({
  id: r.id,
  path: r.path,
  label: r.label,
  icon: ICONS[r.id] as IconName,
}));

/** The phone's tab bar: four destinations and "More". */
export const TAB_IDS: RouteId[] = ['home', 'scan', 'routine', 'progress'];
/** What "More" opens. */
export const MORE_IDS: RouteId[] = ['products', 'learn', 'settings'];

/** Pages that live under a nav item without being one (Settings' children). */
const PARENT: Partial<Record<RouteId, RouteId>> = {
  profile: 'settings',
  privacy: 'settings',
  data: 'settings',
};

/** The nav item a route lights up. */
export function navFor(route: RouteId): RouteId {
  return PARENT[route] ?? route;
}

/** Scan is immersive: full-bleed, no sidebar or tab bar, a back control instead. */
export function isImmersive(route: RouteId): boolean {
  return route === 'scan';
}

/**
 * Routes whose page puts the lounge plate behind the whole shell, so the
 * sidebar glass sits over the live room rather than over its own plate.
 */
export function hasRoomBackdrop(route: RouteId): boolean {
  return route === 'home' || route === 'routine';
}
