<!--
  Leader lines and anchor dots (specs/scan.md 2.2): straight 1.5px lines from
  each callout's thumbnail to its region's anchor on the hologram, and a white
  anchor dot with a soft halo. The anchors move with the head; the page feeds
  new endpoints every frame the engine reports a move, so this only draws.

  Two ways a line appears:
  - static  the summary's build-in: each line draws itself out from the anchor
            when it first appears (350 ms), staggered, as in the mockup;
  - the consult tour's one line (specs/consult-tour.md 7.5), driven by the
    tour's clock through `tour`: `line` is how much of it is drawn (0..1, from
    the anchor toward the card: drawing out after the tap, retracting into the
    anchor at the end), `dot` the anchor dot's pop, `port` the port dot's, and
    `gather` (without her) the light that converges on the spot before the tap.
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
    /** The tour's line (absent: the summary's own staggered build-in). */
    tour?: {
      /** Drawn fraction, 0..1. */
      line: number;
      /** The anchor dot and its halo, 0..1 (pop in, fade out with the zone). */
      dot: number;
      /** The port dot, 0..1. */
      port: number;
      /** Without her: the converging light's progress 0..1, or null. */
      gather: number | null;
    };
  }
</script>

<script lang="ts">
  interface Props {
    leaders: Leader[];
  }

  const { leaders }: Props = $props();

  /** A pop with a little overshoot (the summary's dot-pop curve), 0..1 -> scale. */
  function pop(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c1 = 1.56, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
</script>

<svg class="leaders" aria-hidden="true">
  {#each leaders as l, i (l.id)}
    {@const len = Math.hypot(l.px - l.ax, l.py - l.ay)}
    {#if l.tour}
      {@const t = l.tour}
      <g class="leaders__one is-tour">
        {#if t.gather !== null}
          {@const g = t.gather}
          <circle class="leaders__gather" cx={l.ax} cy={l.ay} r={22 - 15 * g} style:opacity={0.9 * g} />
        {/if}
        {#if t.line > 0}
          <line
            class="leaders__line is-live"
            class:is-active={l.active}
            x1={l.ax}
            y1={l.ay}
            x2={l.px}
            y2={l.py}
            style:stroke-dasharray="{len * Math.min(1, t.line)}px 9999px"
          />
        {/if}
        {#if t.dot > 0}
          <circle class="leaders__halo is-live is-active" cx={l.ax} cy={l.ay} r="7" style:opacity={Math.min(1, t.dot)} />
          <circle
            class="leaders__dot is-live"
            cx={l.ax}
            cy={l.ay}
            r={2.8 * Math.max(0, pop(t.dot))}
            style:opacity={Math.min(1, t.dot)}
          />
        {/if}
        {#if t.port > 0}
          <circle class="leaders__port is-live" cx={l.px} cy={l.py} r={1.6 * pop(t.port)} />
        {/if}
      </g>
    {:else}
      <g class="leaders__one">
        <line
          class="leaders__line is-static"
          class:is-active={l.active}
          x1={l.ax}
          y1={l.ay}
          x2={l.px}
          y2={l.py}
          style:--len={len}
          style:--i={i}
        />
        <circle class="leaders__halo is-static" class:is-active={l.active} cx={l.ax} cy={l.ay} r="7" style:--i={i} />
        <circle class="leaders__dot is-static" cx={l.ax} cy={l.ay} r="2.8" style:--i={i} />
        <circle class="leaders__port" cx={l.px} cy={l.py} r="1.6" style:--i={i} />
      </g>
    {/if}
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
    filter: drop-shadow(0 0 2px rgba(144, 189, 245, 0.55));
  }
  .leaders__line.is-static {
    stroke-dasharray: calc(var(--len) * 1px) 9999px;
    animation: leader-draw 350ms var(--ease-out) both;
    animation-delay: calc(560ms + var(--i) * 120ms);
  }
  .leaders__line.is-active {
    stroke: #e8f4ff;
    stroke-opacity: 1;
    stroke-width: 1.8;
  }
  .leaders__halo {
    fill: rgba(220, 230, 255, 0.28);
    filter: blur(2.5px);
    transform-box: fill-box;
    transform-origin: center;
  }
  .leaders__halo.is-static {
    animation: dot-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    animation-delay: calc(420ms + var(--i) * 120ms);
  }
  .leaders__halo.is-active {
    fill: rgba(200, 235, 255, 0.55);
  }
  .leaders__dot {
    fill: #ffffff;
    transform-box: fill-box;
    transform-origin: center;
  }
  .leaders__dot.is-static {
    animation: dot-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    animation-delay: calc(420ms + var(--i) * 120ms);
  }
  .leaders__port {
    fill: #dfe9ff;
    opacity: 0.8;
  }
  /* Without her: a soft light converging on the spot before the tap. */
  .leaders__gather {
    fill: rgba(220, 255, 255, 0.28);
    stroke: rgba(134, 221, 248, 0.7);
    stroke-width: 1.2;
    filter: blur(1.5px);
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
    .leaders__line.is-static,
    .leaders__halo.is-static,
    .leaders__dot.is-static {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .leaders__line.is-static,
  :global([data-reduced-motion='true']) .leaders__halo.is-static,
  :global([data-reduced-motion='true']) .leaders__dot.is-static {
    animation: none;
  }
</style>
