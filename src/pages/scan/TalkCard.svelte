<!--
  The consult tour's talk card (specs/consult-tour.md 7.4, 10, 11): her words for the place being
  explained, and the tour's controls. One fixed place for the caption, the way subtitles work:

  desk    on the pedestal glass, centred under the face;
  tablet  under the hologram, in place of the tray and panels until the summary;
  phone   the bottom sheet itself, with the region card's lines and thumbnail
          (the `card` snippet) between the eyebrow and her sentence.

  Row 1 the eyebrow ("FOREHEAD · 1 OF 5", "WALKTHROUGH" on the clean face, "FOREHEAD · AGAIN"
  for a re-explained place) and, only while the character prototype is drawn, "Prototype
  stand-in"; row 2 her sentence (never truncated); row 3 Pause / Resume, Previous, Next and Show all
  results (a re-explained place: Pause and Show all results only).

  Screen readers get `view.announce` (the place, its card lines and her sentence) through one polite,
  atomic live region; the visible sentence is not announced twice. Every control is a native
  button; Previous and Next are `aria-disabled` (never `disabled`), so focus is never lost.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from '@/ui/Button.svelte';
  import type { TourView } from '@/stage/tour-machine.ts';
  import { tour } from '@/stage/tour.svelte.ts';

  interface Props {
    view: TourView;
    layout: 'desk' | 'tablet' | 'phone';
    /** The character prototype is drawn beside the pedestal. */
    figure?: boolean;
    /** Phone: the region card's lines and thumbnail. */
    card?: Snippet;
    /** "Show all results" was used: the page moves focus to Replay. */
    onshowall?: () => void;
    class?: string;
  }

  const { view, layout, figure = false, card, onshowall, class: className = '' }: Props = $props();

  const step = $derived(view.phase === 'step' ? (view.steps[view.index] ?? null) : null);
  const eyebrow = $derived.by(() => {
    if (!step) return 'WALKTHROUGH';
    const title = step.title.toUpperCase();
    return view.single ? `${title} · AGAIN` : `${title} · ${view.index + 1} OF ${view.steps.length}`;
  });
  const paused = $derived(view.paused && view.pausedBy === 'user');
  const touch = $derived(layout !== 'desk');

  function showAll() {
    tour.showAll();
    onshowall?.();
  }
</script>

<section class="talk talk--{layout} {className}" class:is-touch={touch} aria-label="Walkthrough">
  <div class="talk__top">
    <p class="talk__eyebrow">{eyebrow}</p>
    {#if figure}<p class="talk__tag">Prototype stand-in</p>{/if}
  </div>
  {#if card}{@render card()}{/if}
  {#key view.caption}
    <p class="talk__line" aria-hidden="true">{view.caption}</p>
  {/key}
  <p class="visually-hidden" aria-live="polite" aria-atomic="true">{view.announce}</p>
  <div class="talk__controls">
    <Button
      variant="secondary"
      tone="dark"
      size="sm"
      iconStart={paused ? 'play' : 'pause'}
      label={paused ? 'Resume the walkthrough' : 'Pause the walkthrough'}
      onclick={() => tour.togglePause()}
      class="talk__btn"
    >
      {paused ? 'Resume' : 'Pause'}
    </Button>
    {#if !view.single}
      {#if layout === 'phone'}
        <!-- The phone's row is narrow: Previous and Next are their chevrons (named for screen readers). -->
        <Button
          variant="secondary"
          tone="dark"
          size="sm"
          iconStart="chevron-left"
          label="Previous area"
          unavailable={view.phase !== 'step'}
          onclick={() => tour.prev()}
          class="talk__btn talk__icon"
        />
        <Button variant="secondary" tone="dark" size="sm" iconStart="chevron-right" label="Next area" onclick={() => tour.next()} class="talk__btn talk__icon" />
      {:else}
        <Button
          variant="secondary"
          tone="dark"
          size="sm"
          iconStart="chevron-left"
          label="Previous area"
          unavailable={view.phase !== 'step'}
          onclick={() => tour.prev()}
          class="talk__btn"
        >
          Previous
        </Button>
        <Button variant="secondary" tone="dark" size="sm" iconEnd="chevron-right" label="Next area" onclick={() => tour.next()} class="talk__btn">
          Next
        </Button>
      {/if}
    {/if}
    <Button variant="secondary" tone="dark" size="sm" iconStart="grid" onclick={showAll} class="talk__btn talk__all">
      Show all results
    </Button>
  </div>
</section>

<style>
  .talk {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 16px;
    background: var(--glass-holo);
    box-shadow: inset 0 0 0 1px var(--glass-holo-rim);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    color: var(--holo-ink);
  }
  .talk__top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .talk__eyebrow,
  .talk__tag {
    margin: 0;
    font-size: 11px;
    font-weight: var(--fw-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--holo-ink-muted);
  }
  .talk__eyebrow {
    white-space: nowrap;
  }
  .talk__tag {
    letter-spacing: 0.06em;
  }
  .talk__line {
    margin: 0;
    min-height: 1.4em;
    font-size: 16px;
    line-height: 1.4;
    color: var(--holo-ink);
    animation: talk-line 180ms var(--ease-out) both;
  }
  .talk__controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .talk :global(.talk__btn) {
    --btn-h: 36px;
    --btn-px: 14px;
  }
  .talk.is-touch :global(.talk__btn) {
    --btn-h: 44px;
  }
  .talk--phone .talk__controls {
    gap: 6px;
  }
  .talk--phone .talk__controls :global(.talk__btn) {
    --btn-px: 12px;
    gap: 6px;
  }
  .talk .talk__controls :global(.talk__icon) {
    --btn-px: 0px;
    width: 44px;
  }
  .talk :global(.talk__all) {
    margin-left: auto;
  }
  @keyframes talk-line {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .talk__line {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .talk__line {
    animation: none;
  }
</style>
