<!--
  The one sidebar (BUILD-PLAN decision 9).

  >= 1200px  248px: the wordmark and tagline, the seven destinations with
             labels, the chosen one on the Progress mockup's blush pill, and
             the Talk to Evia card at the foot.
  820-1199   an 80px icon rail: the same items as icons (named for screen
             readers and on hover), the Talk card as a round chat button.
  < 820px    hidden; the tab bar takes over.

  Background: on most pages its own blurred lounge-window plate under a graded
  rose-brown tint (--sidebar-glass), light enough for the room to read through
  and heavy only under the wordmark and the Talk card, as on Progress. On Home
  and Routine (`overRoom`) it sits over the live room behind the whole page and
  frosts that with the full dark glass instead. On a phone the sidebar is not
  shown, so its plate is not mounted either.
-->
<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { link, type RouteId } from '@/router/router.svelte.ts';
  import Room from '@/stage/Room.svelte';
  import Icon from '@/ui/Icon.svelte';
  import Logo from './Logo.svelte';
  import TalkCard from './TalkCard.svelte';
  import { openCookieSettings } from '@/lib/cookie-preferences.ts';
  import { NAV, navFor } from './nav.ts';

  interface Props {
    route: RouteId;
    overRoom?: boolean;
    /** Show the Talk to Evia card (not on Home, which has its own CTA). */
    talk?: boolean;
  }

  const { route, overRoom = false, talk = true }: Props = $props();
  const current = $derived(navFor(route));

  /** Below 820px the tab bar replaces the sidebar (the same breakpoint as the CSS). */
  const shown = new MediaQuery('min-width: 820px', true);

  /*
   * In a very short window (a phone on its side) the list can still be taller
   * than the rail: then a soft fade at the foot (or head) says there is more
   * to scroll to, and goes once the end is reached.
   */
  let inner = $state<HTMLElement | null>(null);
  let more = $state({ up: false, down: false });
  function measureScroll() {
    const el = inner;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const up = el.scrollTop > 2;
    const down = max > 2 && el.scrollTop < max - 2;
    if (up !== more.up || down !== more.down) more = { up, down };
  }
  $effect(() => {
    const el = inner;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureScroll);
    ro.observe(el);
    return () => ro.disconnect();
  });
</script>

<nav class="ev-side on-dark" class:is-over-room={overRoom} aria-label="Main">
  {#if !overRoom && shown.current}
    <div class="ev-side__plate" aria-hidden="true">
      <Room room="lounge-strip-window" blurred />
    </div>
  {/if}
  <div class="ev-side__glass" aria-hidden="true"></div>

  <div class="ev-side__inner" class:has-up={more.up} class:has-down={more.down} bind:this={inner} onscroll={measureScroll}>
    <div class="ev-side__brand ev-side__brand--full"><Logo /></div>
    <div class="ev-side__brand ev-side__brand--rail"><Logo variant="compact" /></div>

    <ul class="ev-side__list" role="list">
      {#each NAV as item (item.id)}
        {@const on = current === item.id}
        <li>
          <a
            class="ev-side__item"
            class:is-on={on}
            href={item.path}
            use:link
            aria-current={on ? 'page' : undefined}
            title={item.label}
          >
            <Icon name={item.icon} size={24} class="ev-side__icon" />
            <span class="ev-side__label">{item.label}</span>
          </a>
        </li>
      {/each}
    </ul>

    <div class="ev-side__end">
      {#if talk}
        <!-- The full sidebar (>= 1200) shows Routine docked beside Home (ref1),
             whose own "Talk to Evia" is on screen: no second one here. -->
        {#if route !== 'routine'}
          <div class="ev-side__foot ev-side__foot--full"><TalkCard /></div>
        {/if}
        <div class="ev-side__foot ev-side__foot--rail"><TalkCard variant="button" /></div>
      {/if}
      <!-- main's cookie choice (P-12), reopened from the foot of the sidebar
           rather than a control floating over the page. -->
      <div class="ev-side__cookies">
        <button type="button" class="ev-side__cookie-btn" onclick={openCookieSettings}>Cookie settings</button>
      </div>
    </div>
  </div>
</nav>

<style>
  .ev-side {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: var(--z-nav);
    width: var(--shell-nav-w);
    overflow: hidden;
    color: var(--text-on-dark);
  }
  .ev-side__plate {
    position: absolute;
    inset: 0;
  }
  .ev-side__glass {
    position: absolute;
    inset: 0;
    background: var(--sidebar-insurance), var(--sidebar-glass);
  }
  /* Over the live room: frost what is behind instead of drawing a plate. */
  .is-over-room .ev-side__glass {
    background:
      linear-gradient(180deg, var(--sidebar-sheen) 0%, transparent 30%),
      var(--sidebar-glass-room);
    -webkit-backdrop-filter: blur(24px) saturate(1.08);
    backdrop-filter: blur(24px) saturate(1.08);
  }
  /* The seam against a light page: one warm hairline, as on Progress. */
  .ev-side:not(.is-over-room)::after {
    content: '';
    position: absolute;
    inset: 0 0 0 auto;
    width: 1px;
    background: var(--sidebar-seam);
  }

  .ev-side__inner {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: max(30px, var(--safe-t)) 16px max(20px, var(--safe-b)) max(16px, var(--safe-l));
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }
  .ev-side__brand--full {
    padding: 0 0 0 18px;
  }
  .ev-side__brand--rail {
    display: none;
  }

  .ev-side__list {
    display: grid;
    gap: 8px;
    margin: 44px 0 24px;
    padding: 0;
    list-style: none;
  }
  .ev-side__item {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 54px;
    padding: 0 18px;
    border-radius: var(--r-pill);
    color: var(--text-on-dark-strong);
    font-size: var(--fs-label);
    font-weight: var(--fw-medium);
    line-height: 1.2;
    text-decoration: none;
    /* Insurance for a plate brighter than the spec's: a soft lift under the
       label, which the active pill does not need. */
    text-shadow: var(--text-lift);
    transition:
      background-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }
  .ev-side__item :global(.ev-side__icon) {
    filter: drop-shadow(var(--icon-lift));
  }
  @media (hover: hover) {
    .ev-side__item:not(.is-on):hover {
      background: var(--tint-hover-dark);
    }
  }
  .ev-side__item:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: 2px;
  }
  .ev-side__item.is-on {
    background: linear-gradient(100deg, var(--navpill-from) 0%, var(--navpill-mid) 30%, var(--navpill-mid2) 65%, var(--navpill-to) 100%);
    box-shadow:
      var(--shadow-inset-hi),
      var(--shadow-navpill);
    color: var(--navpill-ink);
    text-shadow: none;
  }
  .ev-side__item.is-on :global(.ev-side__icon) {
    color: var(--navpill-icon);
    filter: none;
  }

  .ev-side__foot {
    margin-top: auto;
  }
  .ev-side__foot--rail {
    display: none;
  }
  /* The foot: the Talk card (where there is one) and the cookie control under it. */
  .ev-side__end {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ev-side__cookies {
    display: flex;
    justify-content: center;
  }
  .ev-side__cookie-btn {
    min-height: 44px;
    padding: 0 8px;
    border: 0;
    background: none;
    color: var(--text-on-dark-muted);
    font-family: var(--font-sans);
    font-size: var(--fs-meta);
    font-weight: var(--fw-medium);
    line-height: 1.25;
    text-align: center;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .ev-side__cookie-btn:hover {
    color: var(--text-on-dark-strong);
  }
  .ev-side__cookie-btn:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: 2px;
  }

  /* Short windows: tighter rhythm, and the Talk card goes before the nav would. */
  @media (max-height: 820px) {
    .ev-side__list {
      margin-top: 32px;
      gap: 4px;
    }
    .ev-side__item {
      min-height: 50px;
    }
  }
  @media (max-height: 700px) {
    .ev-side__foot--full {
      display: none;
    }
  }

  /* ---- the icon rail ---- */
  @media (max-width: 1199px) {
    .ev-side__inner {
      align-items: center;
      padding: max(22px, var(--safe-t)) 12px max(16px, var(--safe-b)) max(12px, var(--safe-l));
    }
    .ev-side__brand--full,
    .ev-side__foot--full {
      display: none;
    }
    .ev-side__brand--rail,
    .ev-side__foot--rail {
      display: block;
    }
    .ev-side__foot--rail {
      margin-top: auto;
    }
    .ev-side__list {
      margin-top: 36px;
      gap: 8px;
    }
    .ev-side__item {
      justify-content: center;
      width: 56px;
      min-height: 48px;
      padding: 0;
      border-radius: 16px;
    }
    .ev-side__label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
  /* A phone on its side (the rail with 390px or less of height): the brand
     goes and the rhythm tightens so all seven places and Talk fit at 44px
     targets; anything still below the fold fades out to say it scrolls. */
  @media (max-width: 1199px) and (max-height: 520px) {
    .ev-side__inner {
      padding-top: max(10px, var(--safe-t));
      padding-bottom: max(8px, var(--safe-b));
    }
    .ev-side__brand--rail {
      display: none;
    }
    .ev-side__list {
      margin: 0 0 8px;
      gap: 2px;
    }
    .ev-side__item {
      min-height: 44px;
    }
  }
  .ev-side__inner.has-down {
    -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 36px), transparent);
    mask-image: linear-gradient(180deg, #000 calc(100% - 36px), transparent);
  }
  .ev-side__inner.has-up {
    -webkit-mask-image: linear-gradient(0deg, #000 calc(100% - 36px), transparent);
    mask-image: linear-gradient(0deg, #000 calc(100% - 36px), transparent);
  }
  .ev-side__inner.has-up.has-down {
    -webkit-mask-image: linear-gradient(180deg, transparent, #000 36px calc(100% - 36px), transparent);
    mask-image: linear-gradient(180deg, transparent, #000 36px calc(100% - 36px), transparent);
  }
  @media (max-width: 819px) {
    .ev-side {
      display: none;
    }
  }
</style>
