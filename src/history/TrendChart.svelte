<script lang="ts">
  /**
   * The progress chart.
   *
   * Six scans of history existed from the first day this screen shipped and it
   * drew none of it — nine bars showing today's numbers, with the word "steady"
   * next to each. A bar is a reading; a line is a *history*, and history is the
   * entire reason this screen exists.
   *
   * SVG rather than canvas: it scales to any DPI, needs no resize plumbing, and
   * the points are real elements, so a screen reader and a pointer can both
   * reach them.
   */
  import { METRIC_LABELS, type SkinAnalysis, type SkinMetricKey } from '@shared/types.ts';

  interface Props {
    scans: SkinAnalysis[];
    /** Which metric to plot. Chosen by the caller so the rows can drive it. */
    metric: SkinMetricKey;
  }

  const { scans, metric }: Props = $props();

  /**
   * Oldest first, and only scans the current model produced.
   *
   * Comparing across model versions is the one thing this chart must never do:
   * the formulas changed, so a step in the line would be a change in the
   * measurement rather than in the skin.
   */
  const series = $derived.by(() => {
    const version = scans[0]?.modelVersion;
    return [...scans]
      .filter((s) => s.modelVersion === version)
      .reverse()
      .map((s) => ({ at: new Date(s.capturedAt), value: s.metrics[metric] }));
  });

  const W = 320;
  const H = 116;
  const PAD_L = 26;
  const PAD_R = 8;
  const PAD_T = 10;
  const PAD_B = 20;

  const x = (i: number) =>
    PAD_L + (series.length < 2 ? 0 : (i / (series.length - 1)) * (W - PAD_L - PAD_R));
  const y = (v: number) => PAD_T + (1 - v / 100) * (H - PAD_T - PAD_B);

  const line = $derived(series.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' '));
  const area = $derived(
    series.length
      ? `${line} L${x(series.length - 1)},${H - PAD_B} L${x(0)},${H - PAD_B} Z`
      : '',
  );

  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  /** First, last, and the middle one — enough to read the span without crowding. */
  const ticks = $derived(
    series.length < 2
      ? []
      : [0, Math.floor((series.length - 1) / 2), series.length - 1]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((i) => ({ i, label: dateFormat.format(series[i].at) })),
  );
</script>

{#if series.length >= 2}
  <figure class="chart">
    <figcaption>
      <span>{METRIC_LABELS[metric]}</span>
      <span class="chart__span">{series.length} scans</span>
    </figcaption>

    <svg viewBox="0 0 {W} {H}" role="img" aria-label="{METRIC_LABELS[metric]} over {series.length} scans">
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--ink-soft)" stop-opacity="0.08" />
          <stop offset="100%" stop-color="var(--ink-soft)" stop-opacity="0" />
        </linearGradient>
      </defs>

      {#each [0, 25, 50, 75, 100] as level (level)}
        <line class="chart__grid" x1={PAD_L} x2={W - PAD_R} y1={y(level)} y2={y(level)} />
        <text class="chart__axis" x={PAD_L - 6} y={y(level) + 3} text-anchor="end">{level}</text>
      {/each}

      <path class="chart__area" d={area} />
      <path class="chart__line" d={line} />

      {#each series as point, i (point.at.toISOString())}
        <circle
          class="chart__dot"
          cx={x(i)}
          cy={y(point.value)}
          r={i === series.length - 1 ? 4 : 2.6}
          data-latest={i === series.length - 1 ? 'true' : null}
        >
          <title>{dateFormat.format(point.at)}: {Math.round(point.value)}</title>
        </circle>
      {/each}

      {#each ticks as tick (tick.i)}
        <text
          class="chart__axis"
          x={x(tick.i)}
          y={H - 6}
          text-anchor={tick.i === 0 ? 'start' : tick.i === series.length - 1 ? 'end' : 'middle'}
        >
          {tick.label}
        </text>
      {/each}
    </svg>
  </figure>
{/if}

<style>
  .chart {
    margin: 0 0 16px;
  }

  figcaption {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--s-2);
    font-size: var(--t-xs);
    font-weight: var(--w-medium);
    letter-spacing: var(--trk-cap);
    text-transform: uppercase;
    color: var(--quiet);
  }

  .chart__span {
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    font-feature-settings: var(--num);
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }

  .chart__grid {
    stroke: var(--line);
    stroke-width: 1;
  }

  .chart__axis {
    fill: var(--quiet);
    font-size: 11px;
    font-family: var(--font);
    font-feature-settings: var(--num);
  }

  .chart__area {
    fill: url(#trend-fill);
  }

  .chart__line {
    fill: none;
    stroke: var(--ink-soft);
    stroke-width: 1.25;
    stroke-linecap: round;
    stroke-linejoin: round;
    /* Drawn on rather than appearing, so the history reads as accumulating. */
    stroke-dasharray: 1000;
    stroke-dashoffset: 1000;
    animation: chart-draw var(--dur-3) var(--ease) forwards;
  }

  @keyframes chart-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  .chart__dot {
    fill: var(--ink-soft);
    r: 2;
    opacity: 0;
    animation: chart-dot var(--dur-2) ease forwards;
    /* Behind the line as it draws past each point. */
    animation-delay: 0.2s;
  }

  /* The latest reading is the one metal mark on the chart. */
  .chart__dot[data-latest='true'] {
    fill: var(--metal);
    r: 3;
    animation-delay: 0.3s;
  }

  @keyframes chart-dot {
    to {
      opacity: 1;
    }
  }

  /* The line's draw-on and the dots' fade are decoration; under a reduced
     motion preference the chart simply is, which is the point of the chart. */
  @media (prefers-reduced-motion: reduce) {
    .chart__line {
      stroke-dasharray: none;
      stroke-dashoffset: 0;
      animation: none;
    }
    .chart__dot {
      opacity: 1;
      animation: none;
    }
  }
</style>
