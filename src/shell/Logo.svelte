<!--
  The wordmark: "evia" in the display serif, with the tagline under it.

  One block for the sidebar (`full`), a smaller mark for the icon rail and
  phone top bars (`compact`, no tagline). It links home.
-->
<script lang="ts">
  import { link } from '@/router/router.svelte.ts';

  interface Props {
    variant?: 'full' | 'compact';
    tone?: 'dark' | 'light';
    class?: string;
  }

  const { variant = 'full', tone = 'dark', class: className = '' }: Props = $props();
</script>

<a class="ev-logo ev-logo--{variant} ev-logo--{tone} {className}" href="/" use:link aria-label="Evia, home">
  <span class="ev-logo__mark" aria-hidden="true">evia</span>
  {#if variant === 'full'}
    <span class="ev-logo__tag" aria-hidden="true">Your skin. A brighter you.</span>
  {/if}
</a>

<style>
  .ev-logo {
    display: inline-grid;
    justify-items: start;
    gap: 10px;
    color: var(--logo-ink);
    text-decoration: none;
    border-radius: var(--r-sm);
  }
  .ev-logo:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 4px;
  }
  .ev-logo__mark {
    font-family: var(--font-serif);
    font-size: 70px;
    font-weight: 380;
    font-variation-settings: 'opsz' 72;
    line-height: 0.8;
    letter-spacing: -0.03em;
    margin-left: -3px;
  }
  .ev-logo__tag {
    font-family: var(--font-sans);
    font-size: var(--fs-micro);
    font-weight: var(--fw-medium);
    letter-spacing: var(--tr-micro);
    line-height: 1.2;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--logo-tag);
  }
  .ev-logo--compact .ev-logo__mark {
    font-size: 30px;
    margin-left: 0;
    letter-spacing: -0.02em;
  }
  .ev-logo--light {
    color: var(--text-strong);
  }
  .ev-logo--light .ev-logo__tag {
    color: var(--text-secondary);
  }
</style>
