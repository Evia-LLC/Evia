<!--
  The detail panel as a sheet, for screens too narrow to dock it beside the
  grid (BUILD-PLAN section 1): full screen on a phone, a drawer from the right
  on a tablet.

  A modal dialog: focus moves to its close button when it opens, Tab stays
  inside it, Escape or the scrim closes it, and focus goes back to the card
  that opened it. It sits above the tab bar; the Sample data badge stays
  above it.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import IconButton from '@/ui/IconButton.svelte';

  interface Props {
    /** The heading inside the sheet that names it. */
    labelledby: string;
    /** Where focus goes back to on close (the card that opened it). */
    returnFocus?: HTMLElement | null;
    onclose: () => void;
    children: Snippet;
  }

  const { labelledby, returnFocus = null, onclose, children }: Props = $props();

  let panel: HTMLDivElement | undefined = $state();

  /* The system setting, or the user's own (App.svelte marks its root). */
  const reduced =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      document.querySelector('[data-reduced-motion="true"]') !== null);

  $effect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel?.querySelector<HTMLElement>('.sheet__close')?.focus();
    return () => {
      const back = returnFocus && document.contains(returnFocus) ? returnFocus : previous;
      if (back && document.contains(back)) back.focus();
    };
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
      return;
    }
    if (event.key !== 'Tab' || !panel) return;
    const focusable = [
      ...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ].filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<div class="sheet" role="presentation">
  <button
    type="button"
    class="sheet__scrim"
    tabindex="-1"
    aria-hidden="true"
    onclick={onclose}
    transition:fade={{ duration: reduced ? 0 : 180 }}
  ></button>
  <div
    class="sheet__panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby={labelledby}
    tabindex="-1"
    bind:this={panel}
    {onkeydown}
    transition:fly={{ x: 40, duration: reduced ? 0 : 240 }}
  >
    <div class="sheet__bar">
      <IconButton icon="x" label="Close product details" variant="soft" class="sheet__close" onclick={onclose} />
    </div>
    <div class="sheet__body">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .sheet {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet);
  }
  .sheet__scrim {
    position: absolute;
    inset: 0;
    padding: 0;
    border: 0;
    background: var(--scrim);
    cursor: pointer;
  }
  .sheet__panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    width: min(440px, 100%);
    background: var(--surface-card);
    box-shadow: var(--shadow-lg);
    outline: none;
  }
  .sheet__bar {
    display: flex;
    justify-content: flex-end;
    padding: calc(8px + var(--safe-t) + var(--sample-space, 0px)) 12px 0;
  }
  .sheet__body {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 20px calc(24px + var(--safe-b));
  }
  @media (max-width: 599px) {
    .sheet__panel {
      width: 100%;
    }
    .sheet__body {
      padding-inline: 16px;
    }
  }
</style>
