<!--
  The light card every dashboard section sits on (Progress, Products, Learn,
  Settings): a warm off-white panel, 14px corners, a whisper of shadow.

  tone      default (card blush), raised (lighter, for product cards), sunken
            (inset blush), rose (the "why this routine" note)
  padding   none | sm 16 | md 24 | lg 28 (steps down on phones)
  selected  the product grid's chosen card: a 2px rose rim
  as        the element: section (default), article, div, li, aside

  Any other attribute (aria-labelledby, id, style ...) is passed through.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLElement> {
    as?: 'section' | 'article' | 'div' | 'li' | 'aside';
    tone?: 'default' | 'raised' | 'sunken' | 'rose';
    padding?: 'none' | 'sm' | 'md' | 'lg';
    selected?: boolean;
    /** Lift a little on hover (for cards that are one big link). */
    interactive?: boolean;
    class?: string;
    children: Snippet;
  }

  const {
    as = 'section',
    tone = 'default',
    padding = 'md',
    selected = false,
    interactive = false,
    class: className = '',
    children,
    ...rest
  }: Props = $props();
</script>

<svelte:element
  this={as}
  class="ev-card ev-card--{tone} ev-card--pad-{padding} {className}"
  class:is-selected={selected}
  class:is-interactive={interactive}
  {...rest}
>
  {@render children()}
</svelte:element>

<style>
  .ev-card {
    --card-pad: 24px;
    position: relative;
    min-width: 0;
    padding: var(--card-pad);
    border-radius: var(--r-lg);
    background: var(--surface-card);
    border: 1px solid var(--card-rim);
    box-shadow: var(--shadow-sm);
    color: var(--text);
  }
  .ev-card--pad-none {
    --card-pad: 0px;
  }
  .ev-card--pad-sm {
    --card-pad: 16px;
  }
  .ev-card--pad-lg {
    --card-pad: 28px;
  }
  @media (max-width: 819px) {
    .ev-card--pad-md,
    .ev-card--pad-lg {
      --card-pad: 18px;
    }
  }

  .ev-card--raised {
    background: var(--surface-card-raised);
    border-color: var(--card-rim-raised);
  }
  .ev-card--sunken {
    background: var(--surface-sunken);
    box-shadow: none;
  }
  .ev-card--rose {
    background: var(--blush-300);
    border-color: var(--why-border);
    box-shadow: none;
  }

  .ev-card.is-selected {
    border: 2px solid var(--card-selected-rim);
    box-shadow:
      0 0 0 1px var(--card-selected-halo),
      var(--shadow-sm);
  }

  .ev-card.is-interactive {
    transition:
      transform var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  @media (hover: hover) {
    .ev-card.is-interactive:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }
  }
  .ev-card.is-interactive:focus-within {
    box-shadow: var(--shadow-md);
  }
</style>
