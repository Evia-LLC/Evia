<!--
  What a card shows when the app honestly has nothing yet ("No scans yet",
  "Your first reading becomes the baseline"). Real mode never invents a value
  to fill a slot (BUILD-PLAN decision 2); this is the designed alternative,
  in the same visual language as the filled card.

  An icon on a soft disc, a short title, one or two lines of why, and an
  optional action (a Button, usually).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';

  interface Props {
    title: string;
    body?: string;
    icon?: IconName;
    tone?: 'light' | 'dark' | 'holo';
    align?: 'center' | 'start';
    compact?: boolean;
    /** Heading level for the title, to fit the page outline. */
    level?: 2 | 3 | 4;
    class?: string;
    action?: Snippet;
  }

  const {
    title,
    body,
    icon = 'sparkle',
    tone = 'light',
    align = 'center',
    compact = false,
    level = 3,
    class: className = '',
    action,
  }: Props = $props();
</script>

<div class="ev-empty ev-empty--{tone} ev-empty--{align} {className}" class:is-compact={compact}>
  <span class="ev-empty__disc" aria-hidden="true"><Icon name={icon} size={compact ? 20 : 24} /></span>
  <svelte:element this={`h${level}`} class="ev-empty__title">{title}</svelte:element>
  {#if body}<p class="ev-empty__body">{body}</p>{/if}
  {#if action}<div class="ev-empty__action">{@render action()}</div>{/if}
</div>

<style>
  .ev-empty {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 28px 20px;
    text-align: center;
    color: var(--text-secondary);
  }
  .ev-empty--start {
    justify-items: start;
    text-align: start;
    padding-inline: 0;
  }
  .ev-empty.is-compact {
    padding: 16px 12px;
    gap: 6px;
  }
  .ev-empty__disc {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    margin-bottom: 4px;
    border-radius: 50%;
    background: var(--rose-100);
    color: var(--terracotta-500);
  }
  .is-compact .ev-empty__disc {
    width: 40px;
    height: 40px;
  }
  .ev-empty__title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--fs-lead);
    font-weight: var(--fw-medium);
    line-height: var(--lh-snug);
    color: var(--text-strong);
  }
  .ev-empty__body {
    margin: 0;
    max-width: 44ch;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text-secondary);
  }
  .ev-empty__action {
    margin-top: 8px;
  }

  .ev-empty--dark .ev-empty__disc {
    background: var(--tint-press-dark);
    color: var(--rose-gold-300);
  }
  .ev-empty--dark .ev-empty__title {
    color: var(--text-on-dark-strong);
  }
  .ev-empty--dark .ev-empty__body {
    color: var(--text-on-dark-muted);
  }
  .ev-empty--holo .ev-empty__disc {
    background: var(--navy-700);
    color: var(--holo-cyan);
  }
  .ev-empty--holo .ev-empty__title {
    color: var(--text-on-holo-strong);
  }
  .ev-empty--holo .ev-empty__body {
    color: var(--text-on-holo);
  }
</style>
