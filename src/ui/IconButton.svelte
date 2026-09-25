<!--
  A button that is only an icon, so it must be given a `label` (its name for
  screen readers, and its tooltip).

  plain    no fill (the bell, the back chevron, the chat's voice switch)
  soft     a quiet disc (the comparison card's expand, the product heart)
  ring     a thin outline circle (the tip card's play button)
  glass    a frosted disc for use over photos and the room plate
  primary  the CTA's coral gradient on a disc (the chat's send), the icon
           twin of Button's primary; disabled, it goes flat and sunken
           rather than fading, so it never reads as a paler CTA

  `pressed` makes it a toggle. On a plain button that is on (her voice, the
  microphone) the glyph gets a disc behind it; on the others only the glyph
  recolours (a saved heart). `title` is the tooltip: the label by default, a
  string of its own when the tooltip says more than the name (a switch's
  current state), or false for none.

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
    variant?: 'plain' | 'soft' | 'ring' | 'glass' | 'primary';
    tone?: 'light' | 'dark' | 'holo';
    size?: 'sm' | 'md' | 'lg';
    iconSize?: number;
    filled?: boolean;
    pressed?: boolean;
    expanded?: boolean;
    controls?: string;
    href?: string;
    disabled?: boolean;
    /** The tooltip: true for the label, a string for a longer one, false for none. */
    title?: boolean | string;
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
  const tooltip = $derived(typeof title === 'string' ? title : title ? label : undefined);
</script>

{#if href && !disabled}
  <a class={classes} {href} aria-label={label} title={tooltip} {onclick} use:link>
    <Icon name={icon} size={glyphSize} {filled} />
  </a>
{:else}
  <button
    type="button"
    class={classes}
    aria-label={label}
    title={tooltip}
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
      color var(--dur-base) var(--ease-out),
      filter var(--dur-base) var(--ease-out);
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
    /* Measured inside the 1px border: 5px each way reaches 44px. */
    .ev-iconbtn--sm::before {
      content: '';
      position: absolute;
      inset: -5px;
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
    .ev-iconbtn--plain:hover:not(:disabled):not([aria-pressed='true']) {
      background: var(--tint-hover);
    }
    .ev-iconbtn--plain.ev-iconbtn--dark:hover:not(:disabled):not([aria-pressed='true']),
    .ev-iconbtn--plain.ev-iconbtn--holo:hover:not(:disabled):not([aria-pressed='true']) {
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

  /* primary: the CTA gradient and rim, with the CTA's icon ink on any tone
     (the gradient is its own surface). No lift: it sits inside another
     surface (the composer), and a second shadow there would muddy it. */
  .ev-iconbtn--primary {
    background: linear-gradient(135deg, var(--cta-from) 0%, var(--cta-mid) 50%, var(--cta-to) 100%);
    box-shadow: inset 0 0 0 1px var(--cta-rim);
    color: var(--cta-icon);
  }
  .ev-iconbtn--primary:disabled {
    background: var(--surface-sunken);
    box-shadow: none;
    color: var(--text-muted);
    opacity: 1;
  }
  @media (hover: hover) {
    .ev-iconbtn--primary:hover:not(:disabled) {
      filter: brightness(1.04);
    }
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
  /* Pressed and plain (a switch that is on): a disc behind the glyph, so the
     state reads at a glance. Light: the selected chip's fill and icon ink;
     dark: the pressed tint with the strong cream. */
  .ev-iconbtn--plain.ev-iconbtn--light[aria-pressed='true'] {
    background: var(--rose-300);
    color: var(--chip-selected-icon);
  }
  .ev-iconbtn--plain.ev-iconbtn--dark[aria-pressed='true'] {
    background: var(--tint-press-dark);
    color: var(--text-on-dark-strong);
  }
</style>
