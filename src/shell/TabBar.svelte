<!--
  The phone's navigation (< 820px, BUILD-PLAN decision 7): Home, Scan,
  Routine, Progress, and More, which opens a sheet with Products, Learn and
  Settings. The same dark rose-brown glass as the sidebar, sitting above the
  home indicator (safe-area inset).

  The More sheet is a native <dialog> opened modally, so focus is held in it,
  Escape closes it and the page behind is inert; it also closes itself when
  the route changes.
-->
<script lang="ts">
  import { link, ROUTES, type RouteId } from '@/router/router.svelte.ts';
  import Icon from '@/ui/Icon.svelte';
  import { MORE_IDS, NAV, TAB_IDS, navFor } from './nav.ts';

  interface Props {
    route: RouteId;
  }

  const { route }: Props = $props();

  const current = $derived(navFor(route));
  const tabs = NAV.filter((n) => TAB_IDS.includes(n.id));
  const more = NAV.filter((n) => MORE_IDS.includes(n.id));
  const inMore = $derived(MORE_IDS.includes(current));
  const moreLabel = $derived(inMore ? (ROUTES.find((r) => r.id === current)?.label ?? 'More') : 'More');

  let sheet: HTMLDialogElement | undefined = $state();
  let open = $state(false);

  function show() {
    if (!sheet || open) return;
    sheet.showModal();
    open = true;
  }
  function close() {
    sheet?.close();
  }

  // A route change (a link in the sheet, the back button) closes it.
  $effect(() => {
    void route;
    close();
  });
</script>

<nav class="ev-tabbar on-dark" aria-label="Main">
  <ul class="ev-tabbar__list" role="list">
    {#each tabs as item (item.id)}
      {@const on = current === item.id}
      <li>
        <a class="ev-tabbar__item" class:is-on={on} href={item.path} use:link aria-current={on ? 'page' : undefined}>
          <span class="ev-tabbar__icon"><Icon name={item.icon} size={24} /></span>
          <span class="ev-tabbar__label">{item.label}</span>
        </a>
      </li>
    {/each}
    <li>
      <button
        type="button"
        class="ev-tabbar__item"
        class:is-on={inMore}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="ev-more-sheet"
        onclick={show}
      >
        <span class="ev-tabbar__icon"><Icon name={inMore ? (more.find((m) => m.id === current)?.icon ?? 'grid') : 'grid'} size={24} /></span>
        <span class="ev-tabbar__label">{moreLabel}</span>
      </button>
    </li>
  </ul>
</nav>

<dialog
  bind:this={sheet}
  id="ev-more-sheet"
  class="ev-sheet on-dark"
  aria-label="More"
  onclose={() => (open = false)}
  onclick={(event) => {
    // A click on the backdrop lands on the dialog element itself.
    if (event.target === sheet) close();
  }}
>
  <div class="ev-sheet__body">
    <div class="ev-sheet__head">
      <span class="ev-sheet__grip" aria-hidden="true"></span>
      <h2 class="ev-sheet__title">More</h2>
      <button type="button" class="ev-sheet__close" aria-label="Close" onclick={close}>
        <Icon name="x" size={22} />
      </button>
    </div>
    <ul class="ev-sheet__list" role="list">
      {#each more as item (item.id)}
        {@const on = current === item.id}
        <li>
          <a class="ev-sheet__item" class:is-on={on} href={item.path} use:link aria-current={on ? 'page' : undefined}>
            <Icon name={item.icon} size={24} />
            <span>{item.label}</span>
            <Icon name="chevron-right" size={20} class="ev-sheet__chev" />
          </a>
        </li>
      {/each}
    </ul>
  </div>
</dialog>

<style>
  .ev-tabbar {
    position: fixed;
    inset: auto 0 0 0;
    z-index: var(--z-nav);
    height: calc(var(--tabbar-h) + var(--safe-b));
    padding: 0 var(--safe-r) var(--safe-b) var(--safe-l);
    background:
      linear-gradient(180deg, var(--sidebar-sheen), transparent 60%),
      var(--tabbar-glass);
    -webkit-backdrop-filter: blur(20px) saturate(1.08);
    backdrop-filter: blur(20px) saturate(1.08);
    box-shadow: 0 -1px 0 var(--glass-dark-rim);
  }
  .ev-tabbar__list {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    height: var(--tabbar-h);
    margin: 0;
    padding: 0 4px;
    list-style: none;
  }
  .ev-tabbar__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-on-dark);
    font-family: var(--font-sans);
    font-size: var(--fs-meta);
    font-weight: var(--fw-medium);
    line-height: 1.1;
    text-decoration: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .ev-tabbar__item:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: -4px;
    border-radius: var(--r-md);
  }
  .ev-tabbar__icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 30px;
    border-radius: var(--r-pill);
    transition: background-color var(--dur-base) var(--ease-out);
  }
  .ev-tabbar__item.is-on {
    color: var(--text-on-dark-strong);
  }
  .ev-tabbar__item.is-on .ev-tabbar__icon {
    background: linear-gradient(100deg, var(--navpill-from), var(--navpill-to));
    color: var(--navpill-icon);
  }
  .ev-tabbar__label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- the More sheet ---- */
  .ev-sheet {
    position: fixed;
    inset: auto 0 0 0;
    width: 100%;
    max-width: 560px;
    max-height: min(80vh, 520px);
    margin: 0 auto;
    padding: 0;
    border: 0;
    border-radius: 24px 24px 0 0;
    background: var(--sheet-glass);
    color: var(--text-on-dark);
    box-shadow: var(--shadow-lg);
    overflow: auto;
  }
  .ev-sheet[open] {
    animation: ev-sheet-in var(--dur-slow) var(--ease-out);
  }
  .ev-sheet::backdrop {
    background: var(--scrim);
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
  }
  .ev-sheet__body {
    padding: 8px 16px max(20px, calc(var(--safe-b) + 12px));
  }
  .ev-sheet__head {
    display: grid;
    grid-template-columns: 44px 1fr 44px;
    align-items: center;
    position: relative;
    padding-top: 10px;
  }
  .ev-sheet__grip {
    position: absolute;
    top: 0;
    left: 50%;
    width: 40px;
    height: 4px;
    margin-left: -20px;
    border-radius: 2px;
    background: var(--glass-dark-rim-hi);
  }
  .ev-sheet__title {
    grid-column: 2;
    margin: 0;
    text-align: center;
    font-size: var(--fs-lead);
    font-weight: var(--fw-medium);
    color: var(--text-on-dark-strong);
  }
  .ev-sheet__close {
    grid-column: 3;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--text-on-dark-strong);
    cursor: pointer;
  }
  .ev-sheet__close:focus-visible,
  .ev-sheet__item:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: 2px;
  }
  .ev-sheet__list {
    display: grid;
    gap: 6px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }
  .ev-sheet__item {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 56px;
    padding: 0 18px;
    border-radius: var(--r-lg);
    color: var(--text-on-dark-strong);
    font-size: var(--fs-label);
    font-weight: var(--fw-medium);
    text-decoration: none;
    background: var(--tint-hover-dark);
  }
  .ev-sheet__item :global(.ev-sheet__chev) {
    margin-left: auto;
    color: var(--text-on-dark-muted);
  }
  .ev-sheet__item.is-on {
    background: linear-gradient(100deg, var(--navpill-from), var(--navpill-to));
    color: var(--navpill-ink);
  }
  .ev-sheet__item.is-on :global(.ev-sheet__chev) {
    color: var(--navpill-icon);
  }

  @keyframes ev-sheet-in {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
  }

  @media (min-width: 820px) {
    .ev-tabbar {
      display: none;
    }
  }
</style>
