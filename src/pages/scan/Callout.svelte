<!--
  One zone callout (specs/scan.md 2.2-2.3): a low-contrast glass panel with the
  region's heading, a short hairline under it, up to three lines, and the zone
  thumbnail.

  side="left"   text then thumbnail, inside one panel (FOREHEAD, PORES, CHEEKS)
  side="right"  thumbnail in its own frame, then the text panel (UNDER-EYES, CHIN)

  The thumbnail carries `data-port`: the page measures it to start the leader
  line that runs to the region's anchor on the hologram.
-->
<script lang="ts">
  import { thumbLabel as describeThumb, type ScanCallout } from '@/view/scan.ts';
  import Thumb from './Thumb.svelte';

  interface Props {
    callout: ScanCallout;
    side: 'left' | 'right';
    /** The crop for a capture thumbnail, once cut. */
    crop?: string | null;
    /** Her narration is on this region now. */
    active?: boolean;
    /** Order in the build-in stagger. */
    index?: number;
    compact?: boolean;
  }

  const { callout, side, crop = null, active = false, index = 0, compact = false }: Props = $props();

  const title = $derived(callout.heading.charAt(0) + callout.heading.slice(1).toLowerCase());
  const thumbLabel = $derived(describeThumb(callout));
</script>

<section
  class="callout callout--{side}"
  class:is-active={active}
  class:is-compact={compact}
  data-slot={callout.slot}
  style:--i={index}
  aria-label={title}
>
  {#if side === 'right'}
    <div class="callout__thumbframe" data-port="left">
      <Thumb thumb={callout.thumb} src={crop} label={thumbLabel} class="callout__thumb" />
    </div>
  {/if}
  <div class="callout__panel">
    <div class="callout__text">
      <h3 class="callout__head">{callout.heading}</h3>
      <ul class="callout__lines">
        {#each callout.lines as line (line)}
          <li>{line}</li>
        {/each}
      </ul>
    </div>
    {#if side === 'left'}
      <div class="callout__thumbwrap" data-port="right">
        <Thumb thumb={callout.thumb} src={crop} label={thumbLabel} class="callout__thumb" />
      </div>
    {/if}
  </div>
</section>

<style>
  .callout {
    display: flex;
    align-items: center;
    gap: var(--callout-gap, 8px);
    color: var(--holo-ink-body);
    animation: callout-in 480ms var(--ease-out) both;
    animation-delay: calc(700ms + var(--i) * 120ms);
  }
  .callout__panel {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--callout-gap-in, 12px);
    padding: var(--callout-pad-y, 8px) var(--callout-pad-x, 12px);
    border-radius: 10px;
    background: var(--scan-glass, rgba(6, 12, 24, 0.62));
    box-shadow:
      inset 0 0 0 1px var(--scan-glass-rim, rgba(160, 185, 225, 0.2)),
      inset 1px 0 0 rgba(200, 215, 245, 0.18);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    transition: box-shadow var(--dur-base) var(--ease-out), background-color var(--dur-base) var(--ease-out);
  }
  /* The tiny accent dot in the top-left corner. */
  .callout__panel::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 4px;
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: rgba(174, 191, 224, 0.6);
  }
  .callout__text {
    min-width: 0;
  }
  .callout__head {
    margin: 0;
    font-size: var(--s-head, 12px);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.05em;
    line-height: 1.2;
    text-transform: uppercase;
    color: #e8f2ff;
    white-space: nowrap;
  }
  .callout__head::after {
    content: '';
    display: block;
    width: 3.4em;
    height: 1px;
    margin: 5px 0 5px;
    background: linear-gradient(90deg, rgba(190, 205, 235, 0.55), transparent);
  }
  .callout__lines {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--s-body, 14px);
    line-height: 1.36;
    color: var(--holo-ink-body);
  }
  .callout__lines li {
    white-space: nowrap;
  }
  .callout__thumbwrap,
  .callout__thumbframe {
    flex: none;
  }
  .callout__thumbframe {
    padding: 3px;
    border-radius: 11px;
    background: rgba(6, 12, 24, 0.35);
    box-shadow: inset 0 0 0 1px rgba(160, 185, 225, 0.16);
  }
  .callout :global(.callout__thumb) {
    width: var(--thumb, 60px);
    height: var(--thumb, 60px);
  }
  .callout--right :global(.callout__thumb) {
    width: var(--thumb-r, 66px);
    height: var(--thumb-r, 64px);
  }

  .callout.is-active .callout__panel {
    background: rgba(12, 22, 40, 0.74);
    box-shadow:
      inset 0 0 0 1px rgba(160, 200, 255, 0.55),
      0 0 18px rgba(134, 221, 248, 0.18);
  }

  .is-compact .callout__lines li {
    white-space: normal;
  }

  @keyframes callout-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .callout {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .callout {
    animation: none;
  }
</style>
