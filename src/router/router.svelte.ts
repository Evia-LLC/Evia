/**
 * Where you are in the app.
 *
 * Every feature is a page with an address, not a panel that appears over the
 * room when a chip is pressed. That is what makes the back button work, what
 * lets a link land someone on their progress rather than on the lounge, and —
 * more than either — what stops four unrelated features from fighting over the
 * same 400px of screen.
 *
 * History routing rather than hash routing: the deploy already sends every
 * unknown path to `index.html` (netlify.toml), and Vite does the same in dev,
 * so `/progress` is a real address on both.
 *
 * Deliberately tiny. There are six pages, none of them take parameters, and a
 * dependency for that would be a dependency for a `switch`.
 */

export type RouteId = 'home' | 'scan' | 'progress' | 'routine' | 'profile' | 'privacy';

export interface Route {
  id: RouteId;
  path: string;
  /** Short, for a tab. */
  label: string;
  /** Long, for the document title. */
  title: string;
  /** Whether the page belongs in the main navigation. */
  nav: boolean;
}

export const ROUTES: readonly Route[] = [
  { id: 'home', path: '/', label: 'Talk', title: 'Evia', nav: true },
  { id: 'scan', path: '/scan', label: 'Scan', title: 'Scan — Evia', nav: true },
  { id: 'progress', path: '/progress', label: 'Progress', title: 'Progress — Evia', nav: true },
  { id: 'routine', path: '/routine', label: 'Routine', title: 'Routine — Evia', nav: true },
  { id: 'profile', path: '/profile', label: 'You', title: 'You — Evia', nav: true },
  { id: 'privacy', path: '/privacy', label: 'Privacy', title: 'Privacy — Evia', nav: false },
];

const HOME = ROUTES[0];

function match(pathname: string): Route {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return ROUTES.find((r) => r.path === clean) ?? HOME;
}

class Router {
  path = $state(typeof location === 'undefined' ? '/' : location.pathname);

  /** Which way the last navigation went, so a page can enter from that side. */
  direction = $state<1 | -1>(1);

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('popstate', () => {
      this.direction = -1;
      this.path = location.pathname;
    });
  }

  get route(): Route {
    return match(this.path);
  }

  get id(): RouteId {
    return this.route.id;
  }

  is(id: RouteId): boolean {
    return this.route.id === id;
  }

  go(path: string, opts: { replace?: boolean } = {}): void {
    const target = match(path).path;
    if (target === match(this.path).path) return;

    const from = ROUTES.findIndex((r) => r.path === match(this.path).path);
    const to = ROUTES.findIndex((r) => r.path === target);
    this.direction = to >= from ? 1 : -1;

    if (opts.replace) history.replaceState(null, '', target);
    else history.pushState(null, '', target);
    this.path = target;
  }

  back(): void {
    if (history.length > 1) history.back();
    else this.go('/');
  }
}

export const router = new Router();

/** A link that stays inside the app. Use as `<a href="/progress" use:link>`. */
export function link(node: HTMLAnchorElement) {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = node.getAttribute('href');
    if (!href || !href.startsWith('/')) return;
    event.preventDefault();
    router.go(href);
  };
  node.addEventListener('click', onClick);
  return {
    destroy() {
      node.removeEventListener('click', onClick);
    },
  };
}
