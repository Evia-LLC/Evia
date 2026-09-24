<!--
  A pickable chip: the Products category row, filter toggles.

  It is a toggle button (aria-pressed) by default, which is also the right
  pattern for a single-choice filter row. `mode="radio"` reports aria-checked
  instead, for a parent that gives the row role="radiogroup" (every chip stays
  in the tab order, since the chip does not handle arrow keys itself).
  Selected chips take the mockups' pink fill with a soft glow, the rest a
  quiet blush. The fill alone is too close to the blush to carry the state
  (1.2:1), so a selected chip also gets a 3:1 edge and heavier type.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';

  interface Props {
    selected?: boolean;
    icon?: IconName;
    /** Fill the icon (the Recommended star is solid). */
    iconFilled?: boolean;
    mode?: 'toggle' | 'radio';
    size?: 'sm' | 'md';
    disabled?: boolean;
    onclick?: (event: MouseEvent) => void;
    class?: string;
    children: Snippet;
  }

  const {
    selected = false,
    icon,
    iconFilled,
    mode = 'toggle',
    size = 'md',
    disabled = false,
    onclick,
    class: className = '',
    children,
  }: Props = $props();
</script>

<button
  type="button"
  class="ev-chip ev-chip--{size} {className}"
  class:is-selected={selected}
  role={mode === 'radio' ? 'radio' : undefined}
  aria-checked={mode === 'radio' ? selected : undefined}
  aria-pressed={mode === 'toggle' ? selected : undefined}
  {disabled}
  {onclick}
>
  {#if icon}<Icon name={icon} size={size === 'sm' ? 18 : 20} filled={iconFilled} class="ev-chip__icon" />{/if}
  <span class="ev-chip__label">
    <span>{@render children()}</span>
    <!-- The same words at the selected weight, invisible: the chip keeps one
         width whether it is chosen or not. -->
    <span class="ev-chip__ghost" aria-hidden="true">{@render children()}</span>
  </span>
</button>

<style>
  .ev-chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    padding: 0 18px 0 16px;
    border: 1px solid var(--chip-border);
    border-radius: var(--r-md);
    background: var(--surface-sunken);
    box-shadow: var(--hi-inset-white);
    color: var(--text-strong);
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--dur-base) var(--ease-out),
      border-color var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }
  .ev-chip--sm {
    min-height: 36px;
    padding: 0 14px 0 12px;
    gap: 8px;
  }
  @media (pointer: coarse) {
    .ev-chip--sm::before {
      content: '';
      position: absolute;
      inset: -4px 0;
    }
  }
  .ev-chip:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .ev-chip:active:not(:disabled) {
    transform: scale(0.98);
  }
  .ev-chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (hover: hover) {
    .ev-chip:hover:not(:disabled):not(.is-selected) {
      background: var(--blush-100);
      border-color: var(--border);
    }
  }
  .ev-chip__label {
    display: inline-flex;
    flex-direction: column;
  }
  .ev-chip__ghost {
    height: 0;
    overflow: hidden;
    visibility: hidden;
    font-weight: var(--fw-semibold);
  }
  .ev-chip.is-selected {
    background: var(--rose-300);
    border-color: var(--chip-selected-border);
    box-shadow:
      0 0 0 1px var(--chip-selected-halo),
      var(--shadow-glow-rose);
    color: var(--chip-selected-ink);
    font-weight: var(--fw-semibold);
  }
  .ev-chip.is-selected :global(.ev-chip__icon) {
    color: var(--chip-selected-icon);
  }
</style>
