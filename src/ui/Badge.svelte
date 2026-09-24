<!--
  A small tag pinned to a card or photo: "Best Match", "Trending", "Gentle
  option", a photo's date.

  match (green), trending (rose), gentle (blue), neutral (blush), dark (over a
  photo), blush (the "after" photo's date). Text is 12px, never smaller.

  "Trending", "Popular" and the like have no real source, so pages show them
  in sample mode only (BUILD-PLAN decision 11); the badge itself does not know.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';

  interface Props {
    variant?: 'match' | 'trending' | 'gentle' | 'neutral' | 'dark' | 'blush';
    icon?: IconName;
    class?: string;
    children: Snippet;
  }

  const { variant = 'neutral', icon, class: className = '', children }: Props = $props();
</script>

<span class="ev-badge ev-badge--{variant} {className}">
  {#if icon}<Icon name={icon} size={13} stroke={1.8} />{/if}
  {@render children()}
</span>

<style>
  .ev-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 24px;
    padding: 0 10px;
    border-radius: var(--r-pill);
    font-family: var(--font-sans);
    font-size: var(--fs-meta);
    font-weight: var(--fw-semibold);
    line-height: 1.1;
    letter-spacing: 0;
    white-space: nowrap;
  }
  .ev-badge--match {
    background: var(--sage-200);
    color: var(--badge-match-ink);
  }
  .ev-badge--trending {
    background: var(--rose-200);
    color: var(--badge-rose-ink);
  }
  .ev-badge--gentle {
    background: var(--blue-100);
    color: var(--blue-900);
  }
  .ev-badge--neutral {
    background: var(--blush-100);
    color: var(--text-strong);
    box-shadow: inset 0 0 0 1px var(--border-subtle);
  }
  .ev-badge--dark,
  .ev-badge--blush {
    min-height: 26px;
    border-radius: var(--r-sm);
    font-weight: var(--fw-medium);
    font-size: var(--fs-small);
  }
  .ev-badge--dark {
    background: var(--photo-badge-bg);
    color: var(--photo-badge-ink);
    box-shadow: inset 0 -1px 0 var(--photo-badge-rim);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
  }
  .ev-badge--blush {
    background: linear-gradient(90deg, var(--badge-blush-from), var(--badge-blush-to));
    color: var(--badge-blush-ink);
  }
</style>
