<!--
  The summary's way back into the consult tour (specs/consult-tour.md 9): "Replay walkthrough" and the
  hint that any place can be explained again. Replay is offered only while a face exists to tap;
  the hint only while re-explaining is open (in real mode, not while her reply to the reading is
  still coming: re-explaining then would talk over it).
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Button from '@/ui/Button.svelte';
  import { tour } from '@/stage/tour.svelte.ts';

  interface Props {
    replay: boolean;
    again: boolean;
    touch?: boolean;
    class?: string;
  }

  const { replay, again, touch = false, class: className = '' }: Props = $props();

  async function run() {
    tour.replay();
    // Replay puts the reader on the tour's own controls.
    await tick();
    document.querySelector<HTMLElement>('[aria-label="Pause the walkthrough"], [aria-label="Resume the walkthrough"]')?.focus();
  }
</script>

{#if replay || again}
  <div class="replay {className}" class:is-touch={touch}>
    {#if replay}
      <Button variant="secondary" tone="dark" size="sm" iconStart="play" onclick={run} class="replay__btn" label="Replay walkthrough">
        Replay walkthrough
      </Button>
    {/if}
    {#if again}<p class="replay__hint">Or select any area to hear it again.</p>{/if}
  </div>
{/if}

<style>
  .replay {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 14px 8px 8px;
    border-radius: 16px;
    background: var(--glass-holo);
    box-shadow: inset 0 0 0 1px var(--glass-holo-rim);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  .replay :global(.replay__btn) {
    --btn-h: 36px;
    --btn-px: 14px;
  }
  .replay.is-touch :global(.replay__btn) {
    --btn-h: 44px;
  }
  .replay__hint {
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
    color: var(--holo-ink-body);
  }
</style>
