<!--
  SKIN MAP (specs/scan.md 2.4 and 5.4): how skin is layered, as a fixed
  educational illustration - the same for everyone, in sample and real mode.

  A camera sees the surface only. Nothing here is a reading of anyone's skin,
  and the panel says so in words under the drawing (SRS section 1: never
  fabricate scientific-looking measurements; counsel item 6). The tabs pick
  which layer the drawing brings forward and the sentence that goes with it;
  they do not change any data, because there is none.

  The tabs are the shared SegmentedTabs (holo tone), re-toned here to the
  mockup's navy pill through the component's own custom properties.
-->
<script lang="ts">
  import SegmentedTabs from '@/ui/SegmentedTabs.svelte';

  interface Props {
    /** Lean the card back in perspective, as the mockup does (desktop only). */
    tilted?: boolean;
    class?: string;
  }

  const { tilted = false, class: className = '' }: Props = $props();

  type Layer = 'surface' | 'mid' | 'deep';
  let layer = $state<string>('surface');

  const tabs = [
    { id: 'surface', label: 'Surface', controls: 'scan-skinmap-body' },
    { id: 'mid', label: 'Mid-Layers', controls: 'scan-skinmap-body' },
    { id: 'deep', label: 'Deep View', controls: 'scan-skinmap-body' },
  ];

  const LAYERS: { id: Layer; name: string; sub: string }[] = [
    { id: 'surface', name: 'Epidermis', sub: 'Texture, tone, clarity' },
    { id: 'mid', name: 'Dermis', sub: 'Collagen, elasticity' },
    { id: 'deep', name: 'Hypodermis', sub: 'Support, structure' },
  ];

  /* One short line each, so switching tabs never changes the card's height. */
  const NOTE: Record<Layer, string> = {
    surface: 'The outer layer: the only one a camera sees.',
    mid: 'Below the surface: a photo cannot see it.',
    deep: 'The deepest layer: no camera can see it.',
  };
</script>

<section class="skinmap {className}" class:is-tilted={tilted} aria-labelledby="scan-skinmap-title">
  <h2 class="skinmap__title" id="scan-skinmap-title"><span class="skinmap__dot" aria-hidden="true"></span>Skin map</h2>
  <div class="skinmap__card">
    <div class="skinmap__tabs">
      <SegmentedTabs options={tabs} bind:value={layer} label="Skin layer" kind="tabs" tone="holo" size="sm" full />
    </div>
    <div class="skinmap__body" id="scan-skinmap-body" role="tabpanel" aria-label="How skin is layered">
      <svg class="skinmap__art" viewBox="0 0 170 176" aria-hidden="true">
        <defs>
          <linearGradient id="sm-epi-front" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#98d0fd" stop-opacity="0.95" />
            <stop offset="0.45" stop-color="#657eb7" />
            <stop offset="1" stop-color="#1c3564" />
          </linearGradient>
          <linearGradient id="sm-epi-top" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#b4f8ff" stop-opacity="0.85" />
            <stop offset="1" stop-color="#7fa6e6" stop-opacity="0.8" />
          </linearGradient>
          <linearGradient id="sm-derm" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#d9c2dd" />
            <stop offset="0.5" stop-color="#b28aa3" />
            <stop offset="1" stop-color="#8a647c" />
          </linearGradient>
          <linearGradient id="sm-hypo" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#d3b9dc" />
            <stop offset="0.5" stop-color="#9f7a97" />
            <stop offset="1" stop-color="#7b5a78" />
          </linearGradient>
          <pattern id="sm-fibres" width="14" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 4c3.5-3 7-3 10.5 0s7 3 10.5 0" fill="none" stroke="#f3e2f2" stroke-opacity="0.5" stroke-width="0.8" />
          </pattern>
          <pattern id="sm-lobes" width="11" height="10" patternUnits="userSpaceOnUse">
            <circle cx="5.5" cy="5" r="4.2" fill="#e8d4ec" fill-opacity="0.18" stroke="#f1e2f4" stroke-opacity="0.55" stroke-width="0.7" />
          </pattern>
        </defs>

        <!-- Hypodermis -->
        <g class="skinmap__slab" class:is-on={layer === 'deep'}>
          <path d="M8 128h100l44-16v44l-44 16H8z" fill="url(#sm-hypo)" />
          <path d="M8 128h100l44-16v44l-44 16H8z" fill="url(#sm-lobes)" />
          <path d="M108 128l44-16v44l-44 16z" fill="#6f4f6d" fill-opacity="0.55" />
          <path d="M8 128l44-16h100l-44 16z" fill="#e2cfe6" fill-opacity="0.75" />
          <path d="M8 128h100l44-16M108 128v44" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="0.8" />
        </g>
        <!-- Dermis -->
        <g class="skinmap__slab" class:is-on={layer === 'mid'}>
          <path d="M8 76h100l44-16v40l-44 16H8z" fill="url(#sm-derm)" />
          <path d="M8 76h100l44-16v40l-44 16H8z" fill="url(#sm-fibres)" />
          <path d="M108 76l44-16v40l-44 16z" fill="#7a566e" fill-opacity="0.55" />
          <path d="M8 76l44-16h100l-44 16z" fill="#ecd9ec" fill-opacity="0.8" />
          <path d="M8 76h100l44-16M108 76v40" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="0.8" />
        </g>
        <!-- Epidermis: blue glass with a wavy top -->
        <g class="skinmap__slab" class:is-on={layer === 'surface'}>
          <path d="M8 30c8-4 16 3 24-1s16-4 24 0 16 3 24-1 18-3 28 1l44-16v40l-44 16H8z" fill="url(#sm-epi-front)" />
          <path d="M8 44c12 4 24-4 36 0s24 4 36 0 20-4 28 0" fill="none" stroke="#f0b8d2" stroke-opacity="0.55" stroke-width="2.2" />
          <path d="M108 30l44-16v40l-44 16z" fill="#23407a" fill-opacity="0.6" />
          <path d="M8 30c8-4 16 3 24-1s16-4 24 0 16 3 24-1 18-3 28 1l44-16c-10-4-20 3-28 1s-16-1-24 1-16-3-24 1-16-1-24-1z" fill="url(#sm-epi-top)" />
          <path d="M8 30c8-4 16 3 24-1s16-4 24 0 16 3 24-1 18-3 28 1l44-16M108 30v40" fill="none" stroke="#e9fbff" stroke-opacity="0.85" stroke-width="0.8" />
        </g>
      </svg>
      <ul class="skinmap__labels">
        {#each LAYERS as l (l.id)}
          <li class:is-on={layer === l.id}>
            <span class="skinmap__name">{l.name}</span>
            <span class="skinmap__sub">{l.sub}</span>
          </li>
        {/each}
      </ul>
    </div>
    <p class="skinmap__note">
      <span class="skinmap__note-strong">How skin is layered — illustration, not a reading of your skin.</span>
      {NOTE[layer as Layer]}
    </p>
  </div>
</section>

<style>
  .skinmap {
    position: relative;
    color: var(--holo-ink-body);
    animation: skinmap-in 480ms var(--ease-out) both;
    animation-delay: 1.2s;
  }
  .skinmap.is-tilted {
    transform-origin: 0 50%;
    transform: perspective(1100px) rotateY(-15deg);
  }
  .skinmap__title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 8px 2px;
    font-size: var(--s-panel-lg, 16px);
    font-weight: var(--fw-medium);
    letter-spacing: 0.05em;
    line-height: 1.1;
    text-transform: uppercase;
    color: #e8f2ff;
  }
  .skinmap__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--holo-cyan);
    box-shadow: 0 0 6px 1px rgba(134, 221, 248, 0.45);
  }
  .skinmap__card {
    padding: 10px 12px 12px;
    border-radius: 12px;
    background: rgba(10, 16, 28, 0.62);
    box-shadow: inset 0 0 0 1px rgba(150, 170, 210, 0.3);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  /* The mockup's navy pill: the shared control, re-toned through its own tokens. */
  .skinmap__tabs {
    --navy-700: #0c1520;
    --seg-holo-border: rgba(160, 180, 220, 0.34);
    --seg-holo-on-from: #3a5783;
    --seg-holo-on-to: #2f4568;
    --holo-rose-ink: #eef4ff;
    --seg-holo-ink: #aab4c6;
  }
  .skinmap__body {
    display: grid;
    grid-template-columns: minmax(0, 0.85fr) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  .skinmap__art {
    display: block;
    width: 100%;
    max-width: 112px;
    height: auto;
    margin: 0 auto;
    overflow: visible;
  }
  .skinmap__slab {
    opacity: 0.5;
    transition: opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out);
  }
  .skinmap__slab.is-on {
    opacity: 1;
    transform: translateY(-2px);
  }
  .skinmap__labels {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .skinmap__labels li {
    position: relative;
    display: grid;
    padding-left: 12px;
    opacity: 0.72;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .skinmap__labels li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.55em;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(190, 205, 235, 0.7);
  }
  .skinmap__labels li.is-on {
    opacity: 1;
  }
  .skinmap__name {
    font-size: var(--s-label, 13px);
    font-weight: var(--fw-semibold);
    line-height: 1.25;
    color: #dde8fa;
  }
  .skinmap__sub {
    font-size: var(--s-meta, 12px);
    line-height: 1.3;
    color: #b7b8cb;
  }
  .skinmap__note {
    margin: 8px 0 0;
    padding-top: 7px;
    border-top: 1px solid rgba(160, 180, 220, 0.16);
    font-size: var(--s-meta, 12px);
    line-height: 1.35;
    color: #b9c2d6;
  }
  .skinmap__note-strong {
    display: block;
    color: #dfe7f7;
    font-weight: var(--fw-medium);
  }
  @keyframes skinmap-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .skinmap {
      animation: none;
    }
    .skinmap__slab {
      transition: none;
    }
  }
  :global([data-reduced-motion='true']) .skinmap {
    animation: none;
  }
</style>
