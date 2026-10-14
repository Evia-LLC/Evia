<script lang="ts">
  import type { Snippet } from 'svelte';
  import { link, router } from '@/router/router.svelte.ts';
  import { arrive, depart } from '@/lib/motion.ts';

  interface Props {
    eyebrow: string;
    title: string;
    lede?: string;
    wide?: boolean;
    side?: 'left' | 'right';
    children: Snippet;
    actions?: Snippet;
  }
  const { eyebrow, title, lede, wide = false, side = 'left', children, actions }: Props = $props();
  let scroller = $state<HTMLDivElement | null>(null);
  let scrolled = $state(false);
  function onScroll() { scrolled = (scroller?.scrollTop ?? 0) > 24; }
</script>

<section
  class="studio-page"
  class:studio-page--wide={wide}
  class:studio-page--right={side === 'right'}
  data-scrolled={scrolled ? 'true' : undefined}
  in:arrive={{ direction: router.direction }}
  out:depart
>
  <div class="studio-page__shade" aria-hidden="true"></div>
  <div class="studio-page__scroll" bind:this={scroller} onscroll={onScroll}>
    <div class="studio-page__air" aria-hidden="true"></div>
    <header class="studio-page__hero">
      <div class="studio-page__overline">
        <span class="studio-page__overline-dot" aria-hidden="true"></span>
        <span>{eyebrow}</span>
        <span class="studio-page__overline-number">EVIA / STUDIO</span>
      </div>
      <h1>{title}</h1>
      {#if lede}<p class="studio-page__lede">{lede}</p>{/if}
      {#if actions}
        <div class="studio-page__actions">
          {@render actions()}
        </div>
      {/if}
    </header>

    <div class="studio-page__body">
      {@render children()}
    </div>
    <footer class="studio-page__footer">
      <span>Good care starts with understanding.</span>
      <a href="/privacy" use:link>Privacy & choices <span aria-hidden="true">↗</span></a>
    </footer>
  </div>
</section>
