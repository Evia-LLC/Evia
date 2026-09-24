<!--
  A button that is only an icon, so it must be given a `label` (its name for
  screen readers, and its tooltip).

  plain  no fill (the bell, the back chevron)
  soft   a quiet disc (the comparison card's expand, the product heart)
  ring   a thin outline circle (the tip card's play button)
  glass  a frosted disc for use over photos and the room plate

  The visible size can be 36px, but the hit area is never below 44px on a
  touch screen.
-->
<script lang="ts">
  import { link } from '@/router/router.svelte.ts';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';

  interface Props {
    icon: IconName;
    label: string;
    variant?: 'plain' | 'soft' | 'ring' | 'glass';
    tone?: 'light' | 'dark' | 'holo';
    size?: 'sm' | 'md' | 'lg';
    iconSize?: number;
    filled?: boolean;
    pressed?: boolean;
    expanded?: boolean;
    controls?: string;
    href?: string;
    disabled?: boolean;
    title?: boolean;
    onclick?: (event: MouseEvent) => void;
    class?: string;
  }

  const {
    icon,
    label,
    variant = 'plain',
    tone = 'light',
    size = 'md',
    iconSize,
    filled,
    pressed,
    expanded,
    controls,
    href,
    disabled = false,
    title = true,
    onclick,
    class: className = '',
  }: Props = $props();

  const glyphSize = $derived(iconSize ?? (size === 'lg' ? 24 : size === 'sm' ? 18 : 22));
  const classes = $derived(`ev-iconbtn ev-iconbtn--${variant} ev-iconbtn--${size} ev-iconbtn--${tone} ${className}`);
</script>

{#if href && !disabled}
  <a class={classes} {href} aria-label={label} title={title ? label : undefined} {onclick} use:link>
    <Icon name={icon} size={glyphSize} {filled} />
  </a>
{:else}
  <button
    type="button"
    class={classes}
    aria-label={label}
    title={title ? label : undefined}
    aria-pressed={pressed}
    aria-expanded={expanded}
    aria-controls={controls}
    {disabled}
    {onclick}
  >
    <Icon name={icon} size={glyphSize} {filled} />
  </button>
{/if}

<style>
  .ev-iconbtn {
    --d: 44px;
    position: relative;
    display: inline-grid;
    place-items: center;
    width: var(--d);
    height: var(--d);
    flex: none;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 50%;
    background: transparent;
    color: var(--text-strong);
    cursor: pointer;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--dur-base) var(--ease-out),
      border-color var(--dur-base) var(--ease-out),
      transform var(--dur-fast) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }
  .ev-iconbtn:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .ev-iconbtn:active:not(:disabled) {
    transform: scale(0.96);
  }
  .ev-iconbtn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .ev-iconbtn--sm {
    --d: 36px;
  }
  .ev-iconbtn--lg {
    --d: 56px;
  }
  @media (pointer: coarse) {
    .ev-iconbtn--sm::before {
      content: '';
      position: absolute;
      inset: -4px;
      border-radius: 50%;
    }
  }

  /* Tones set the glyph colour. */
  .ev-iconbtn--dark {
    color: var(--text-on-dark-strong);
    --focus-ring: var(--focus-ring-on-dark);
  }
  .ev-iconbtn--holo {
    color: var(--holo-ink);
    --focus-ring: var(--holo-ink);
  }

  @media (hover: hover) {
    .ev-iconbtn--plain:hover:not(:disabled) {
      background: var(--tint-hover);
    }
    .ev-iconbtn--plain.ev-iconbtn--dark:hover:not(:disabled),
    .ev-iconbtn--plain.ev-iconbtn--holo:hover:not(:disabled) {
      background: var(--tint-hover-dark);
    }
  }

  .ev-iconbtn--soft {
    background: var(--iconbtn-soft-bg);
  }
  .ev-iconbtn--soft.ev-iconbtn--dark {
    background: var(--tint-press-dark);
  }
  @media (hover: hover) {
    .ev-iconbtn--soft:hover:not(:disabled) {
      background: var(--blush-100);
    }
  }

  .ev-iconbtn--ring {
    border-color: var(--border-strong);
  }
  .ev-iconbtn--ring.ev-iconbtn--dark {
    border-color: var(--border-on-dark-strong);
    background: var(--tint-hover-dark);
  }
  .ev-iconbtn--ring.ev-iconbtn--holo {
    border-color: var(--navy-line);
  }
  @media (hover: hover) {
    .ev-iconbtn--ring:hover:not(:disabled) {
      background: var(--tint-hover-rose);
    }
    .ev-iconbtn--ring.ev-iconbtn--dark:hover:not(:disabled) {
      background: var(--tint-press-dark);
    }
  }

  .ev-iconbtn--glass {
    background: var(--glass-light);
    border-color: var(--glass-light-rim);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
  }
  .ev-iconbtn--glass.ev-iconbtn--dark {
    background: var(--glass-dark);
    border-color: var(--glass-dark-rim);
  }
  .ev-iconbtn--glass.ev-iconbtn--holo {
    background: var(--glass-holo);
    border-color: var(--glass-holo-rim);
  }

  /* Pressed (a saved heart): a colour per tone, each 3:1 on its surface. */
  .ev-iconbtn[aria-pressed='true'] {
    color: var(--pressed-on-light);
  }
  .ev-iconbtn--dark[aria-pressed='true'] {
    color: var(--pressed-on-dark);
  }
  .ev-iconbtn--holo[aria-pressed='true'] {
    color: var(--pressed-on-holo);
  }
</style>
