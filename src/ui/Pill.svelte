<!--
  A static label in a rounded capsule: a status ("Good"), a change chip
  ("-42% dark spots"), a small note on a photo. Not interactive; use Chip for
  something that can be picked.

  Tones: neutral (blush), rose, sage (good), amber, blue, dark (over photos),
  glass (dark glass), holo (the scan's navy).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';

  interface Props {
    tone?: 'neutral' | 'rose' | 'sage' | 'amber' | 'blue' | 'dark' | 'glass' | 'holo';
    size?: 'sm' | 'md';
    /** A coloured status dot before the text. */
    dot?: boolean;
    icon?: IconName;
    /** A squarer capsule (the "Good" pill under the score ring). */
    shape?: 'pill' | 'soft';
    class?: string;
    children: Snippet;
  }

  const { tone = 'neutral', size = 'md', dot = false, icon, shape = 'pill', class: className = '', children }: Props =
    $props();
</script>

<span class="ev-pill ev-pill--{tone} ev-pill--{size} ev-pill--{shape} {className}">
  {#if dot}<span class="ev-pill__dot" aria-hidden="true"></span>{/if}
  {#if icon}<Icon name={icon} size={size === 'sm' ? 14 : 16} />{/if}
  <span class="ev-pill__text">{@render children()}</span>
</span>

<style>
  .ev-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 14px;
    border: 1px solid transparent;
    border-radius: var(--r-pill);
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    line-height: 1.2;
    white-space: nowrap;
    background: var(--surface-pill);
    border-color: var(--border-subtle);
    color: var(--text-strong);
  }
  .ev-pill--sm {
    min-height: 26px;
    padding: 0 10px;
    gap: 6px;
    font-size: var(--fs-meta);
  }
  .ev-pill--soft {
    border-radius: var(--r-lg);
  }
  .ev-pill--sm.ev-pill--soft {
    border-radius: var(--r-sm);
  }

  .ev-pill__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    flex: none;
  }

  .ev-pill--rose {
    background: var(--rose-200);
    border-color: transparent;
    color: var(--badge-rose-ink);
  }
  .ev-pill--sage {
    background: var(--sage-100);
    border-color: var(--border-subtle);
    color: var(--sage-900);
  }
  .ev-pill--sage .ev-pill__dot {
    background: var(--sage-600);
  }
  .ev-pill--amber {
    background: var(--amber-100);
    border-color: transparent;
    color: var(--amber-900);
  }
  .ev-pill--amber .ev-pill__dot {
    background: var(--amber-500);
  }
  .ev-pill--blue {
    background: var(--blue-100);
    border-color: transparent;
    color: var(--blue-900);
  }
  .ev-pill--dark {
    background: var(--photo-badge-bg);
    border-color: var(--photo-badge-rim);
    color: var(--photo-badge-ink);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
  }
  .ev-pill--glass {
    background: var(--glass-dark);
    border-color: var(--glass-dark-rim);
    color: var(--text-on-dark-strong);
    -webkit-backdrop-filter: blur(var(--glass-blur));
    backdrop-filter: blur(var(--glass-blur));
  }
  .ev-pill--holo {
    background: var(--glass-holo);
    border-color: var(--glass-holo-rim);
    color: var(--holo-ink);
  }
  .ev-pill--holo .ev-pill__dot {
    background: var(--holo-cyan);
    box-shadow: 0 0 6px 1px rgba(var(--holo-cyan-rgb), 0.35);
  }
</style>
