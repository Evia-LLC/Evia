<!--
  Leader lines and anchor dots (specs/scan.md 2.2): straight 1.5px lines from
  each callout's thumbnail to its region's anchor on the hologram, and a white
  anchor dot with a soft halo. The anchors move with the head; the page feeds
  new endpoints every frame the engine reports a move, so this only draws.

  Each line draws itself out from the anchor when it first appears (350 ms).
-->
<script module lang="ts">
  export interface Leader {
    id: string;
    /** The anchor on the face. */
    ax: number;
    ay: number;
    /** The callout's port. */
    px: number;
    py: number;
    active: boolean;
  }
</script>

<script lang="ts">
  interface Props {
    leaders: Leader[];
  }

  const { leaders }: Props = $props();
</script>

<svg class="leaders" aria-hidden="true">
  <defs>
    <linearGradient id="scan-leader-grad" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#90bdf5" stop-opacity="0.75" />
      <stop offset="1" stop-color="#e8f0ff" stop-opacity="0.9" />
    </linearGradient>
  </defs>
  {#each leaders as l, i (l.id)}
    {@const len = Math.hypot(l.px - l.ax, l.py - l.ay)}
    <line
      class="leaders__line"
      class:is-active={l.active}
      x1={l.ax}
      y1={l.ay}
      x2={l.px}
      y2={l.py}
      style:--len={len}
      style:--i={i}
    />
    <circle class="leaders__halo" class:is-active={l.active} cx={l.ax} cy={l.ay} r="7" style:--i={i} />
    <circle class="leaders__dot" cx={l.ax} cy={l.ay} r="2.8" style:--i={i} />
    <circle class="leaders__port" cx={l.px} cy={l.py} r="1.6" style:--i={i} />
  {/each}
</svg>

<style>
  .leaders {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .leaders__line {
    stroke: #a9cdf7;
    stroke-opacity: 0.78;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-dasharray: calc(var(--len) * 1px) 9999px;
    animation: leader-draw 350ms var(--ease-out) both;
    animation-delay: calc(560ms + var(--i) * 120ms);
    filter: drop-shadow(0 0 2px rgba(144, 189, 245, 0.55));
  }
  .leaders__line.is-active {
    stroke: #e8f4ff;
    stroke-opacity: 1;
    stroke-width: 1.8;
  }
  .leaders__halo {
    fill: rgba(220, 230, 255, 0.28);
    filter: blur(2.5px);
    animation: dot-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    animation-delay: calc(420ms + var(--i) * 120ms);
    transform-box: fill-box;
    transform-origin: center;
  }
  .leaders__halo.is-active {
    fill: rgba(200, 235, 255, 0.55);
  }
  .leaders__dot {
    fill: #ffffff;
    animation: dot-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    animation-delay: calc(420ms + var(--i) * 120ms);
    transform-box: fill-box;
    transform-origin: center;
  }
  .leaders__port {
    fill: #dfe9ff;
    opacity: 0.8;
  }
  @keyframes leader-draw {
    from {
      stroke-dasharray: 0 9999px;
    }
  }
  @keyframes dot-pop {
    from {
      transform: scale(0);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .leaders__line,
    .leaders__halo,
    .leaders__dot {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .leaders__line,
  :global([data-reduced-motion='true']) .leaders__halo,
  :global([data-reduced-motion='true']) .leaders__dot {
    animation: none;
  }
</style>
