<!--
  The frame every /legal/* page renders in.

  Legal pages are reachable without signing in (the gate links to them), so
  they sit outside the app shell: a full-screen reading page on the light
  wash, with the wordmark and a way back at the top, the document in a card
  as a readable long-form column, and the other documents listed at the foot.
  One frame for all eight, so each page file is only which record it shows
  and what follows the document (a decision, a link to its sibling).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ROUTES, isLegalRoute, link, router } from '@/router/router.svelte.ts';
  import Logo from '@/shell/Logo.svelte';
  import Icon from '@/ui/Icon.svelte';
  import { openCookieSettings } from '@/lib/cookie-preferences.ts';

  interface Props {
    children: Snippet;
  }

  const { children }: Props = $props();

  const others = $derived(ROUTES.filter((r) => isLegalRoute(r.id) && r.id !== router.id));

  function back() {
    router.back();
  }
</script>

<div class="ev-legal">
  <header class="ev-legal__bar">
    <Logo variant="compact" tone="light" class="ev-legal__home" />
    <button type="button" class="ev-legal__back" onclick={back}>
      <Icon name="chevron-left" size={18} stroke={1.8} />
      <span>Back</span>
    </button>
  </header>

  <main class="ev-legal__main">
    {@render children()}

    <nav class="ev-legal__others" aria-label="Other legal documents">
      <h2 class="ev-legal__others-title">Other documents</h2>
      <ul role="list">
        {#each others as route (route.id)}
          <li><a href={route.path} use:link>{route.label}</a></li>
        {/each}
        <!-- main's cookie choice (P-12), reopened from here on the legal pages
             instead of the floating control, which would sit over the text. -->
        <li><button type="button" class="ev-legal__cookies" onclick={openCookieSettings}>Cookie settings</button></li>
      </ul>
    </nav>
  </main>
</div>

<style>
  .ev-legal {
    position: absolute;
    inset: 0;
    z-index: var(--z-auth);
    overflow-x: hidden;
    overflow-y: auto;
    background: var(--surface-page-flat) var(--surface-page);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: var(--fs-body);
    line-height: var(--lh-normal);
  }

  .ev-legal__bar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: max(14px, var(--safe-t)) max(20px, var(--safe-r)) 14px max(20px, var(--safe-l));
    background: var(--glass-light-strong);
    box-shadow: 0 1px 0 var(--border-subtle);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
  }
  /* The compact wordmark is 24px of type; the link around it is a full target. */
  .ev-legal__bar :global(.ev-legal__home) {
    min-width: 44px;
    min-height: 44px;
    align-content: center;
    padding: 0 6px;
    margin-left: -6px;
  }
  .ev-legal__back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    padding: 0 16px 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--text-strong);
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    cursor: pointer;
  }
  @media (hover: hover) {
    .ev-legal__back:hover {
      background: var(--tint-hover-rose);
    }
  }
  .ev-legal__back:focus-visible,
  .ev-legal__others a:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }

  .ev-legal__main {
    box-sizing: border-box;
    display: grid;
    gap: 16px;
    width: 100%;
    max-width: 880px;
    margin: 0 auto;
    padding: 28px max(16px, var(--safe-r)) max(48px, var(--safe-b)) max(16px, var(--safe-l));
  }

  .ev-legal__others {
    padding: 20px 4px 0;
  }
  .ev-legal__others-title {
    margin: 0 0 10px;
    font-size: var(--fs-micro);
    font-weight: var(--fw-semibold);
    letter-spacing: var(--tr-micro);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ev-legal__others ul {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ev-legal__cookies {
    min-height: 44px;
    padding: 0 6px;
    border: 0;
    background: none;
    color: var(--text-link);
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .ev-legal__cookies:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .ev-legal__others a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 6px;
    color: var(--text-link);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    text-underline-offset: 3px;
  }
</style>
