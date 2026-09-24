<!--
  Foundation-B replaces this file; keep the props { route, children }.

  A minimal stand-in so the app has a way around while the designed shell
  (sidebar variants, top bar, sample badge) is built: the sidebar's
  destinations as a plain list, and the page beside it. It borrows the old
  rail's classes so it is usable in the meantime; nothing else depends on it.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ROUTES, link, type RouteId } from '@/router/router.svelte.ts';
  import { sample } from '@/sample/mode.svelte.ts';

  interface Props {
    /** The route being shown, for the sidebar's current item and its variant. */
    route: RouteId;
    children: Snippet;
  }

  const { route, children }: Props = $props();
  const items = ROUTES.filter((r) => r.nav);
</script>

<nav class="nav" aria-label="Evia">
  <a class="nav__brand" href="/" use:link aria-label="Evia, home">
    <span class="nav__mark">Evia</span>
    {#if sample.on}<span class="nav__note" role="status">Sample data</span>{/if}
  </a>
  <ul class="nav__list" role="list">
    {#each items as item (item.id)}
      <li>
        <a class="nav__item" href={item.path} use:link aria-current={route === item.id ? 'page' : undefined}>
          <span>{item.label}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>

{@render children()}
