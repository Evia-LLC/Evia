<!--
  A row of rating stars exactly as the mockup draws them - sample mode only,
  because nothing real produces a rating (BUILD-PLAN decision 11). The
  numbers beside them carry the meaning; the stars are decoration and hidden
  from assistive technology. Each row makes its own clip id (a page shows
  many rows at once).
-->
<script module lang="ts">
  let nextId = 0;
</script>

<script lang="ts">
  import { GLYPHS } from '@/ui/icons.ts';
  import type { StarFill } from '@/view/products.ts';

  interface Props {
    stars: StarFill[];
    size?: number;
  }

  const { stars, size = 12 }: Props = $props();
  const path = GLYPHS.star.d;
  const uid = `st${nextId++}`;
</script>

<span class="stars" aria-hidden="true">
  {#each stars as fill, i (i)}
    <svg class="star star--{fill}" width={size} height={size} viewBox="0 0 24 24" focusable="false">
      {#if fill === 'half'}
        <defs>
          <clipPath id="{uid}-half-{i}"><rect x="0" y="0" width="12" height="24" /></clipPath>
        </defs>
        <g class="star__empty">{@html path}</g>
        <g class="star__full" clip-path="url(#{uid}-half-{i})">{@html path}</g>
      {:else}
        <g class={fill === 'full' ? 'star__full' : 'star__empty'}>{@html path}</g>
      {/if}
    </svg>
  {/each}
</span>

<style>
  .stars {
    display: inline-flex;
    gap: 1.5px;
    flex: none;
  }
  .star {
    display: block;
  }
  .star :global(path) {
    stroke: none;
  }
  .star__full :global(path) {
    fill: var(--star);
  }
  .star__empty :global(path) {
    fill: var(--blush-250);
  }
</style>
