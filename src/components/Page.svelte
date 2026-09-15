<script lang="ts">
  /**
   * The frame every page sits in.
   *
   * A page is a column of content with a graded ground under it, laid over the
   * live room — the same construction the entry screen uses, for the same
   * reason: she is the product, and a page that covered her would be a page in
   * a different app. On a desktop the column takes the left of the frame and
   * she keeps the right; on a phone she keeps the top and the column rises
   * under her.
   *
   * The hero is hers. The eyebrow says which page this is; the title and the
   * lede are Elohim talking about what is on it, in the first person.
   */
  import type { Snippet } from 'svelte';
  import { router } from '@/router/router.svelte.ts';
  import { arrive, depart } from '@/lib/motion.ts';

  interface Props {
    eyebrow: string;
    title: string;
    lede?: string;
    /** Wider column for pages that carry a chart or a camera. */
    wide?: boolean;
    /**
     * Which side of the frame the column takes. She stands centre-right in
     * the lounge and stage-left in the clinic, so the scan page mirrors.
     */
    side?: 'left' | 'right';
    children: Snippet;
    /** Rendered in the hero, under the lede — a primary action. */
    actions?: Snippet;
  }

  const { eyebrow, title, lede, wide = false, side = 'left', children, actions }: Props = $props();

  let scroller = $state<HTMLDivElement | null>(null);
  let scrolled = $state(false);

  function onScroll() {
    scrolled = (scroller?.scrollTop ?? 0) > 24;
  }
</script>

<section
  class="page"
  class:page--wide={wide}
  class:page--right={side === 'right'}
  data-scrolled={scrolled ? 'true' : null}
  in:arrive={{ direction: router.direction }}
  out:depart
>
  <div class="page__ground" aria-hidden="true"></div>
  <div class="page__scroll" bind:this={scroller} onscroll={onScroll}>
    <div class="page__air" aria-hidden="true"></div>
    <header class="hero">
      <p class="hero__eyebrow">{eyebrow}</p>
      <h1 class="hero__title">{title}</h1>
      {#if lede}
        <p class="hero__lede">{lede}</p>
      {/if}
      {#if actions}
        <div class="hero__actions">{@render actions()}</div>
      {/if}
    </header>
    <div class="page__body">
      {@render children()}
    </div>
  </div>
</section>
