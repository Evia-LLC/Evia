<!--
  "Sample data", pinned top-centre for as long as sample mode is on
  (BUILD-PLAN section 3.1), so the mockups' numbers are never mistaken for the
  user's own. High contrast, small, and it carries its own off switch. On a
  framed page it sits in a band the shell keeps free above the page (Shell's
  `--sample-band`), so it never covers a top bar or scrolled content.

  It must show on every screen while sample mode is on - the auth gate
  included, where there is no Shell - so it can be mounted in more than one
  place (the Shell and the app root). Only the first mounted copy draws; when
  it goes, the next one takes over.
-->
<script module lang="ts">
  let nextId = 1;
  const owner = $state({ id: 0 });
</script>

<script lang="ts">
  import { sample, setSample } from '@/sample/mode.svelte.ts';
  import Icon from '@/ui/Icon.svelte';

  const id = nextId++;

  $effect(() => {
    if (owner.id === 0) owner.id = id;
  });
  $effect(() => () => {
    if (owner.id === id) owner.id = 0;
  });
</script>

{#if sample.on && owner.id === id}
  <div class="ev-sample" role="status">
    <span class="ev-sample__dot" aria-hidden="true"></span>
    <span class="ev-sample__text">Sample data</span>
    <button type="button" class="ev-sample__off" aria-label="Turn off sample data" title="Turn off sample data" onclick={() => setSample(false)}>
      <Icon name="x" size={14} stroke={2} />
    </button>
  </div>
{/if}

<style>
  /* Centred over the page (beside the sidebar or rail, when there is one),
     in the 40px band the shell keeps free for it above a framed page. */
  .ev-sample {
    position: fixed;
    top: calc(6px + var(--safe-t));
    left: calc(50% + var(--shell-nav-w, 0px) / 2);
    z-index: var(--z-badge);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 4px 0 12px;
    transform: translateX(-50%);
    border-radius: var(--r-pill);
    background: var(--sample-bg);
    box-shadow:
      inset 0 0 0 1px var(--sample-rim),
      var(--shadow-md);
    color: var(--sample-ink);
    font-family: var(--font-sans);
    font-size: var(--fs-meta);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.02em;
    white-space: nowrap;
    pointer-events: auto;
  }
  .ev-sample__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--rose-400);
  }
  .ev-sample__off {
    position: relative;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--tint-press-dark);
    color: var(--sample-ink);
    cursor: pointer;
  }
  .ev-sample__off::before {
    /* a 44px target around a 24px glyph */
    content: '';
    position: absolute;
    inset: -10px;
    border-radius: 50%;
  }
  .ev-sample__off:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: 2px;
  }
  @media (hover: hover) {
    .ev-sample__off:hover {
      background: var(--glass-dark-rim-hi);
    }
  }
</style>
