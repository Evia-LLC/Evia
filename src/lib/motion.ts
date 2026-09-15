/**
 * Motion helpers shared by the pages.
 *
 * Two rules, both enforced here so no page has to remember them:
 *
 *  1. Reduced motion is honoured at the moment an animation starts, from both
 *     the system setting and Elohim's own preference, and it means *no*
 *     motion rather than slower motion. A number that is going to be 71
 *     should just say 71.
 *  2. Nothing here is a spring. The pages use one expo-out curve, the same
 *     one the entry screen uses, so arriving on a page and arriving at the
 *     product feel like the same hand.
 */
import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

/** Expo-out as an easing function, for JS-driven motion. */
export const expo = (t: number): number => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Whether motion should be skipped right now. Read live, never cached. */
export function stillness(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  return document.querySelector('.shell')?.getAttribute('data-reduced-motion') === 'true';
}

/**
 * Counts a number up into an element.
 *
 * `use:countUp={value}` on any element. Re-runs when the value changes, and
 * always counts *from where it currently is*, so a reading that moves from
 * 64 to 71 travels seven points rather than restarting from zero.
 */
export function countUp(
  node: HTMLElement,
  value: number | null,
): { update(next: number | null): void; destroy(): void } {
  let shown = 0;
  let raf = 0;
  const format = (v: number) => String(Math.round(v));

  const settle = (target: number) => {
    cancelAnimationFrame(raf);
    if (stillness() || Math.abs(target - shown) < 0.5) {
      shown = target;
      node.textContent = format(target);
      return;
    }
    const from = shown;
    const start = performance.now();
    const duration = 620 + Math.min(600, Math.abs(target - from) * 8);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      shown = from + (target - from) * expo(t);
      node.textContent = format(shown);
      if (t < 1) raf = requestAnimationFrame(tick);
      else shown = target;
    };
    raf = requestAnimationFrame(tick);
  };

  if (value === null) node.textContent = '—';
  else settle(value);

  return {
    update(next) {
      if (next === null) {
        cancelAnimationFrame(raf);
        node.textContent = '—';
        shown = 0;
        return;
      }
      settle(next);
    },
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}

/**
 * A page arriving.
 *
 * Rises a little and resolves, from the side the navigation went. Kept short:
 * a page transition that can be *watched* is one that is being waited for.
 */
export function arrive(
  _node: Element,
  { direction = 1, delay = 0 }: { direction?: 1 | -1; delay?: number } = {},
): TransitionConfig {
  const still = stillness();
  return {
    delay,
    duration: still ? 0 : 460,
    easing: expo,
    css: (t, u) =>
      `opacity:${t};transform:translate3d(${(u * 14 * direction).toFixed(2)}px,${(u * 8).toFixed(2)}px,0)`,
  };
}

/** A page leaving. Faster than arriving — it is already been decided against. */
export function depart(_node: Element): TransitionConfig {
  const still = stillness();
  return {
    duration: still ? 0 : 180,
    easing: cubicOut,
    css: (t) => `opacity:${t}`,
  };
}
