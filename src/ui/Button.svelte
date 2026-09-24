<!--
  The one button.

  primary    the mockups' CTA: a warm coral-to-rose gradient pill with dark ink
             (Home "Talk to Evia"). One per view, for the main thing to do.
  secondary  an outline pill, for the second choice.
  soft       a flat blush fill (the product card's shop button, "Reorder").
  ghost      text only, with a tint on hover (a "View all" link, a dismiss).

  `tone="dark"` recolours secondary, soft and ghost for dark glass and photos.
  Sizes: sm 36px (still a 44px target on touch screens), md 44px, lg 64px.

  With `href` it is a link: in-app paths route without a reload, and
  `external` opens a new tab with rel="noopener" (pass `rel` to add
  "sponsored" for affiliate links).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { link } from '@/router/router.svelte.ts';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';

  interface Props {
    variant?: 'primary' | 'secondary' | 'soft' | 'ghost';
    tone?: 'light' | 'dark';
    size?: 'sm' | 'md' | 'lg';
    shape?: 'pill' | 'rounded';
    iconStart?: IconName;
    iconEnd?: IconName;
    /** Draw the start icon solid (the CTA's chat bubbles are). */
    iconStartSolid?: boolean;
    /** Push the end icon to the far edge (a wide CTA with a chevron). */
    spread?: boolean;
    full?: boolean;
    href?: string;
    external?: boolean;
    rel?: string;
    type?: HTMLButtonAttributes['type'];
    disabled?: boolean;
    pressed?: boolean;
    label?: string;
    onclick?: (event: MouseEvent) => void;
    class?: string;
    children?: Snippet;
  }

  const {
    variant = 'primary',
    tone = 'light',
    size = 'md',
    shape = 'pill',
    iconStart,
    iconEnd,
    iconStartSolid,
    spread = false,
    full = false,
    href,
    external = false,
    rel,
    type = 'button',
    disabled = false,
    pressed,
    label,
    onclick,
    class: className = '',
    children,
  }: Props = $props();

  const iconSize = $derived(size === 'lg' ? 26 : size === 'sm' ? 18 : 20);
  const classes = $derived(
    [
      'ev-btn',
      `ev-btn--${variant}`,
      `ev-btn--${size}`,
      `ev-btn--${shape}`,
      tone === 'dark' && 'ev-btn--dark',
      spread && 'ev-btn--spread',
      full && 'ev-btn--full',
      className,
    ]
      .filter(Boolean)
      .join(' '),
  );
  const relValue = $derived(external ? (rel ?? 'noopener') : rel);
</script>

{#snippet inner()}
  {#if iconStart}<Icon name={iconStart} size={iconSize} filled={iconStartSolid} class="ev-btn__icon" />{/if}
  {#if children}<span class="ev-btn__label">{@render children()}</span>{/if}
  {#if iconEnd}<Icon name={iconEnd} size={size === 'lg' ? 22 : iconSize} class="ev-btn__icon ev-btn__icon--end" />{/if}
  {#if external}<span class="visually-hidden"> (opens in a new tab)</span>{/if}
{/snippet}

{#if href && !disabled}
  <a
    class={classes}
    {href}
    target={external ? '_blank' : undefined}
    rel={relValue}
    aria-label={label}
    {onclick}
    use:link
  >
    {@render inner()}
  </a>
{:else}
  <button class={classes} {type} {disabled} aria-label={label} aria-pressed={pressed} {onclick}>
    {@render inner()}
  </button>
{/if}

<style>
  .ev-btn {
    --btn-h: 44px;
    --btn-px: 22px;
    --btn-fs: var(--fs-label);
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: var(--btn-h);
    padding: 0 var(--btn-px);
    border: 1px solid transparent;
    border-radius: var(--r-pill);
    font-family: var(--font-sans);
    font-size: var(--btn-fs);
    font-weight: var(--fw-medium);
    line-height: 1.2;
    letter-spacing: 0;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform var(--dur-fast) var(--ease-out),
      background-color var(--dur-base) var(--ease-out),
      border-color var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out),
      filter var(--dur-base) var(--ease-out);
  }
  .ev-btn:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .ev-btn:active:not(:disabled) {
    transform: translateY(1px) scale(0.99);
  }
  .ev-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .ev-btn--rounded {
    border-radius: var(--r-md);
  }
  .ev-btn--full {
    display: flex;
    width: 100%;
  }
  .ev-btn--spread {
    justify-content: flex-start;
  }
  .ev-btn--spread :global(.ev-btn__icon--end) {
    margin-left: auto;
  }

  /* Sizes. */
  .ev-btn--sm {
    --btn-h: 36px;
    --btn-px: 16px;
    --btn-fs: var(--fs-body-sm);
    gap: 8px;
  }
  .ev-btn--lg {
    --btn-h: 64px;
    --btn-px: 30px;
    --btn-fs: 18px;
    gap: 22px;
  }
  /* Small buttons stay small to the eye but not to the thumb. */
  @media (pointer: coarse) {
    .ev-btn--sm::before {
      content: '';
      position: absolute;
      inset: -4px 0;
    }
  }

  .ev-btn__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ev-btn :global(.ev-btn__icon) {
    flex: none;
  }

  /* primary: the CTA gradient. */
  .ev-btn--primary {
    color: var(--cta-ink);
    background: linear-gradient(90deg, var(--cta-from) 0%, var(--cta-mid) 50%, var(--cta-to) 100%);
    box-shadow:
      inset 0 0 0 1px var(--cta-rim),
      var(--shadow-cta);
  }
  .ev-btn--primary :global(.ev-btn__icon) {
    color: var(--cta-icon);
  }
  .ev-btn--primary :global(.ev-btn__icon--end) {
    transition: transform var(--dur-base) var(--ease-out);
  }
  @media (hover: hover) {
    .ev-btn--primary:hover:not(:disabled) {
      filter: brightness(1.04);
      transform: translateY(-1px);
    }
    .ev-btn--primary:hover:not(:disabled) :global(.ev-btn__icon--end) {
      transform: translateX(2px);
    }
  }

  /* secondary: outline. */
  .ev-btn--secondary {
    color: var(--text-strong);
    background: transparent;
    border-color: var(--border-strong);
  }
  @media (hover: hover) {
    .ev-btn--secondary:hover:not(:disabled) {
      background: var(--tint-hover-rose);
    }
  }
  .ev-btn--secondary.ev-btn--dark {
    color: var(--text-on-dark-strong);
    border-color: var(--border-on-dark-strong);
  }
  @media (hover: hover) {
    .ev-btn--secondary.ev-btn--dark:hover:not(:disabled) {
      background: var(--tint-hover-dark);
    }
  }

  /* soft: flat blush. */
  .ev-btn--soft {
    color: var(--soft-ink);
    background: var(--soft-bg);
    border-color: var(--soft-border);
  }
  @media (hover: hover) {
    .ev-btn--soft:hover:not(:disabled) {
      background: var(--soft-bg-hover);
    }
  }
  .ev-btn--soft.ev-btn--dark {
    color: var(--text-on-dark-strong);
    background: var(--tint-press-dark);
    border-color: var(--glass-dark-rim);
  }

  /* ghost: text only. */
  .ev-btn--ghost {
    color: var(--text-secondary);
    background: transparent;
    --btn-px: 14px;
  }
  @media (hover: hover) {
    .ev-btn--ghost:hover:not(:disabled) {
      color: var(--text-strong);
      background: var(--tint-hover);
    }
  }
  .ev-btn--ghost.ev-btn--dark {
    color: var(--text-on-dark);
  }
  @media (hover: hover) {
    .ev-btn--ghost.ev-btn--dark:hover:not(:disabled) {
      color: var(--text-on-dark-strong);
      background: var(--tint-hover-dark);
    }
  }
</style>
