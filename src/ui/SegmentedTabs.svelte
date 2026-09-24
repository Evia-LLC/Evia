<!--
  A segmented control: Morning / Evening / Weekly on Routine, 1W..All on
  Progress, Video / 3D View on the lesson card, Detailed / Gen-Z on Scan.

  One geometry everywhere: a track with the chosen segment as a pill that
  slides between options. Tones: `light` (blush track, rose pill), `glass`
  (outline on dark glass, blush pill), `holo` (navy track, rose pill, for the
  scan).

  The chosen segment is told apart by more than its fill (the pill is only
  about 1.2:1 against the track): its label also turns heavier.

  `kind="radio"` (default) is a value picker: role=radiogroup. `kind="tabs"`
  switches panels: role=tablist, and each option's `controls` names the panel
  it shows. Either way the arrow keys, Home and End move the choice, and only
  the chosen segment sits in the tab order.
-->
<script module lang="ts">
  import type { IconName } from './icons.ts';

  export interface SegmentOption {
    id: string;
    label: string;
    icon?: IconName;
    /** Id of the tab panel this option shows (kind="tabs"). */
    controls?: string;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    options: SegmentOption[];
    value: string;
    /** Name of the whole control, for screen readers. */
    label: string;
    kind?: 'radio' | 'tabs';
    tone?: 'light' | 'glass' | 'holo';
    size?: 'sm' | 'md';
    /** Stretch to the container with equal segments. */
    full?: boolean;
    onchange?: (id: string) => void;
    class?: string;
  }

  let {
    options,
    value = $bindable(),
    label,
    kind = 'radio',
    tone = 'light',
    size = 'md',
    full = false,
    onchange,
    class: className = '',
  }: Props = $props();

  let track: HTMLDivElement | undefined = $state();
  let indicator = $state<{ x: number; w: number } | null>(null);

  function choose(id: string, focus = false) {
    if (id !== value) {
      value = id;
      onchange?.(id);
    }
    if (focus) {
      const button = track?.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(id)}"]`);
      button?.focus();
    }
  }

  function onkeydown(event: KeyboardEvent) {
    const index = options.findIndex((o) => o.id === value);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    choose(options[next].id, true);
  }

  /* The sliding pill follows the chosen segment, and is re-measured when the
     control changes size (fonts landing, a container resizing). */
  function measure() {
    const button = track?.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(value)}"]`);
    if (!track || !button) {
      indicator = null;
      return;
    }
    indicator = { x: button.offsetLeft, w: button.offsetWidth };
  }

  $effect(() => {
    void value;
    void options.length;
    measure();
  });

  $effect(() => {
    if (!track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(track);
    return () => observer.disconnect();
  });
</script>

<div
  bind:this={track}
  class="ev-seg ev-seg--{tone} ev-seg--{size} {className}"
  class:ev-seg--full={full}
  role={kind === 'tabs' ? 'tablist' : 'radiogroup'}
  aria-label={label}
  tabindex="-1"
  {onkeydown}
>
  {#if indicator}
    <span
      class="ev-seg__pill"
      style:transform="translateX({indicator.x}px)"
      style:width="{indicator.w}px"
      aria-hidden="true"
    ></span>
  {/if}
  {#each options as option (option.id)}
    {@const on = option.id === value}
    <button
      type="button"
      class="ev-seg__opt"
      class:is-on={on}
      class:is-measured={indicator !== null}
      data-id={option.id}
      role={kind === 'tabs' ? 'tab' : 'radio'}
      aria-selected={kind === 'tabs' ? on : undefined}
      aria-checked={kind === 'radio' ? on : undefined}
      aria-controls={kind === 'tabs' ? option.controls : undefined}
      tabindex={on ? 0 : -1}
      onclick={() => choose(option.id)}
    >
      {#if option.icon}
        <Icon name={option.icon} size={size === 'sm' ? 18 : 22} stroke={1.5} class="ev-seg__icon" />
      {/if}
      <span class="ev-seg__label">
        <span>{option.label}</span>
        <span class="ev-seg__ghost" aria-hidden="true">{option.label}</span>
      </span>
    </button>
  {/each}
</div>

<style>
  .ev-seg {
    --seg-h: 44px;
    --seg-pad: 3px;
    position: relative;
    display: inline-flex;
    align-items: stretch;
    gap: 0;
    min-height: var(--seg-h);
    padding: var(--seg-pad);
    border-radius: var(--r-lg);
    background: var(--surface-track);
    isolation: isolate;
    max-width: 100%;
  }
  .ev-seg:focus {
    outline: none;
  }
  .ev-seg--sm {
    --seg-h: 38px;
  }
  .ev-seg--full {
    display: flex;
    width: 100%;
  }
  .ev-seg--full .ev-seg__opt {
    flex: 1 1 0;
  }

  .ev-seg__pill {
    position: absolute;
    top: var(--seg-pad);
    bottom: var(--seg-pad);
    left: 0;
    z-index: -1;
    border-radius: calc(var(--r-lg) - 3px);
    background: var(--rose-400);
    box-shadow: var(--shadow-seg-pill);
    transition:
      transform var(--dur-base) var(--ease-out),
      width var(--dur-base) var(--ease-out);
  }

  .ev-seg__opt {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-width: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: calc(var(--r-lg) - 3px);
    background: transparent;
    color: var(--ink-800);
    font-family: var(--font-sans);
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: color var(--dur-base) var(--ease-out);
  }
  .ev-seg--sm .ev-seg__opt {
    padding: 0 12px;
    font-size: var(--fs-body-sm);
    gap: 8px;
  }
  /* The label keeps the width of its heaviest weight, so choosing a segment
     does not shift its neighbours. */
  .ev-seg__label {
    display: inline-flex;
    flex-direction: column;
  }
  .ev-seg__ghost {
    height: 0;
    overflow: hidden;
    visibility: hidden;
    font-weight: var(--fw-bold);
  }

  /* Before the first measurement the chosen segment carries its own fill. */
  .ev-seg__opt.is-on:not(.is-measured) {
    background: var(--rose-400);
  }
  .ev-seg__opt:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 1px;
  }
  @media (hover: hover) {
    .ev-seg__opt:not(.is-on):hover {
      background: var(--tint-hover-light-seg);
    }
  }
  .ev-seg__opt :global(.ev-seg__icon) {
    color: var(--ink-600);
  }
  .ev-seg__opt.is-on {
    color: var(--seg-on-ink);
    font-weight: var(--fw-bold);
  }
  .ev-seg__opt.is-on :global(.ev-seg__icon) {
    color: var(--seg-on-icon);
  }
  /* Coarse pointers: every segment is at least a 44px target. */
  @media (pointer: coarse) {
    .ev-seg {
      --seg-h: 50px;
    }
  }

  /* glass: an outline track on dark glass (the lesson card's Video / 3D View). */
  .ev-seg--glass {
    background: var(--seg-glass-bg);
    box-shadow: inset 0 0 0 1px var(--seg-glass-border);
    border-radius: var(--r-pill);
    --focus-ring: var(--focus-ring-on-dark);
  }
  .ev-seg--glass .ev-seg__pill,
  .ev-seg--glass .ev-seg__opt {
    border-radius: var(--r-pill);
  }
  .ev-seg--glass .ev-seg__pill,
  .ev-seg--glass .ev-seg__opt.is-on:not(.is-measured) {
    background: var(--seg-glass-on);
  }
  .ev-seg--glass .ev-seg__opt {
    color: var(--text-on-dark);
    font-weight: var(--fw-regular);
  }
  .ev-seg--glass .ev-seg__opt.is-on {
    color: var(--seg-glass-on-ink);
    font-weight: var(--fw-semibold);
  }
  .ev-seg--glass .ev-seg__opt :global(.ev-seg__icon) {
    color: currentColor;
  }
  @media (hover: hover) {
    .ev-seg--glass .ev-seg__opt:not(.is-on):hover {
      background: var(--tint-hover-dark);
    }
  }

  /* holo: the scan's navy track with the rose pill. */
  .ev-seg--holo {
    background: var(--navy-700);
    box-shadow: inset 0 0 0 1px var(--seg-holo-border);
    border-radius: var(--r-pill);
    --focus-ring: var(--holo-ink);
  }
  .ev-seg--holo .ev-seg__pill,
  .ev-seg--holo .ev-seg__opt {
    border-radius: var(--r-pill);
  }
  .ev-seg--holo .ev-seg__pill,
  .ev-seg--holo .ev-seg__opt.is-on:not(.is-measured) {
    background: linear-gradient(180deg, var(--seg-holo-on-from), var(--seg-holo-on-to));
    box-shadow: none;
  }
  .ev-seg--holo .ev-seg__opt {
    color: var(--seg-holo-ink);
  }
  .ev-seg--holo .ev-seg__opt.is-on {
    color: var(--holo-rose-ink);
  }
  .ev-seg--holo .ev-seg__opt :global(.ev-seg__icon) {
    color: currentColor;
  }
  @media (hover: hover) {
    .ev-seg--holo .ev-seg__opt:not(.is-on):hover {
      background: var(--tint-hover-dark);
    }
  }
</style>
