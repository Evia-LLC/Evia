<!--
  The one responsive frame every signed-in page renders in (BUILD-PLAN
  decisions 7 and 9).

  >= 1200px   the 248px sidebar, the page beside it
  820-1199    the 80px icon rail, the page beside it
  < 820px     the page full width, the tab bar across the bottom (with the
              home-indicator inset), Products / Learn / Settings under More
  Scan        immersive at every size: no sidebar or tab bar, a back control
              pinned top-left instead

  The page scrolls inside `main`; the shell itself never does. The shell is an
  isolated stack with the light page wash as its ground, so a page can put a
  room behind everything (<Room layout="viewport">, z-index -1) and have it
  show under the sidebar glass - which is what Home and Routine do, and why
  the sidebar frosts the room there instead of drawing its own plate.

  The sample-data badge is mounted here too, so no page can forget it (the app
  root mounts one for the auth gate as well; only one ever draws). While it is
  up, `--sample-space` (44px, else 0) is set on the shell for pages whose top
  bar would otherwise sit under it on a phone.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { router, type RouteId } from '@/router/router.svelte.ts';
  import Icon from '@/ui/Icon.svelte';
  import Sidebar from './Sidebar.svelte';
  import TabBar from './TabBar.svelte';
  import SampleBadge from './SampleBadge.svelte';
  import ChatDrawer from '@/chat/ChatDrawer.svelte';
  import { sample } from '@/sample/mode.svelte.ts';
  import { hasRoomBackdrop, isImmersive } from './nav.ts';

  interface Props {
    /** The route being shown, for the current nav item and the frame. */
    route: RouteId;
    children: Snippet;
  }

  const { route, children }: Props = $props();

  const immersive = $derived(isImmersive(route));
  const overRoom = $derived(hasRoomBackdrop(route));

  /*
   * How many pages this visit has shown. Back on the immersive Scan page only
   * steps back through history when there is a page of ours to return to;
   * someone who arrived on /scan from another site (or a bookmark) goes Home
   * instead of out of the app. (router.back() checks history.length, which
   * counts the other site's pages too.)
   */
  let pagesShown = 0;
  $effect(() => {
    void route;
    pagesShown += 1;
  });

  function back() {
    if (pagesShown > 1) router.back();
    else router.go('/');
  }
</script>

<div
  class="evia-shell"
  data-frame={immersive ? 'immersive' : 'framed'}
  data-backdrop={overRoom ? 'room' : 'page'}
  data-sample={sample.on ? 'true' : null}
>
  <a class="evia-shell__skip" href="#main">Skip to content</a>

  {#if !immersive}
    <Sidebar {route} {overRoom} talk={route !== 'home'} />
  {/if}

  <main class="evia-shell__main" id="main" tabindex="-1">
    {@render children()}
  </main>

  {#if immersive}
    <button type="button" class="evia-shell__back on-holo" onclick={back}>
      <Icon name="chevron-left" size={22} stroke={1.8} />
      <span>Back</span>
    </button>
  {:else}
    <TabBar {route} />
  {/if}

  <!-- The one conversation drawer; closed until something opens it. -->
  <ChatDrawer />

  <SampleBadge />
</div>

<style>
  .evia-shell {
    --shell-nav-w: var(--sidebar-w);
    --shell-bottom: 0px;
    /* Room the sample badge takes at the top; pages with a phone top bar can
       pad by it so nothing sits under the badge. */
    --sample-space: 0px;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    isolation: isolate;
    background: var(--surface-page-flat) var(--surface-page);
  }
  @media (max-width: 1199px) {
    .evia-shell {
      --shell-nav-w: var(--navrail-w);
    }
  }
  @media (max-width: 819px) {
    .evia-shell {
      --shell-nav-w: 0px;
      --shell-bottom: calc(var(--tabbar-h) + var(--safe-b));
    }
  }
  .evia-shell[data-sample='true'] {
    --sample-space: 44px;
  }
  .evia-shell[data-frame='immersive'] {
    --shell-nav-w: 0px;
    --shell-bottom: 0px;
    background: var(--navy-900);
  }
  /* Under a room the wash is only what shows while the plate loads. */
  .evia-shell[data-backdrop='room'] {
    background: var(--choc-600);
  }

  .evia-shell__main {
    position: absolute;
    top: 0;
    right: 0;
    bottom: var(--shell-bottom);
    left: var(--shell-nav-w);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .evia-shell__main:focus {
    outline: none;
  }

  .evia-shell__skip {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: calc(var(--z-badge) + 1);
    padding: 10px 16px;
    border-radius: var(--r-pill);
    background: var(--cream-0);
    color: var(--text-strong);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    text-decoration: none;
    transform: translateY(-160%);
    transition: transform var(--dur-base) var(--ease-out);
  }
  .evia-shell__skip:focus-visible {
    transform: none;
  }

  .evia-shell__back {
    position: fixed;
    top: max(16px, var(--safe-t));
    left: max(16px, var(--safe-l));
    z-index: var(--z-nav);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    padding: 0 16px 0 10px;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--glass-holo);
    box-shadow: inset 0 0 0 1px var(--glass-holo-rim);
    color: var(--holo-ink);
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    cursor: pointer;
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    transition: background-color var(--dur-base) var(--ease-out);
  }
  .evia-shell__back:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  @media (hover: hover) {
    .evia-shell__back:hover {
      background: var(--navy-700);
    }
  }
</style>
