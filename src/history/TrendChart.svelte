<script lang="ts">
  /**
   * The progress timeline.
   *
   * A bar is a reading; a line is a *history*, and history is the entire
   * reason the Progress page exists. One metric at a time, on a real time
   * axis, 0 to 100 (every reading is a 0-100 appearance index).
   *
   * Drawn in pixels rather than a stretched viewBox, so markers stay round and
   * the axis text stays at its real size at any width: the component measures
   * its own width and lays the chart out for it. The curve is monotone
   * (`chart.ts`), so the smoothing never invents a value between two scans.
   *
   * Pointer and keyboard both move the tooltip: hover or drag near a marker,
   * or focus the chart and use the arrow keys. A visually hidden table carries
   * the same numbers for a screen reader.
   */
  import { monotonePath, timeTicks, type ChartPoint } from './chart.ts';
  import type { TimelinePoint } from '@/view/progress.ts';

  interface Props {
    points: TimelinePoint[];
    domain: { start: number; end: number };
    /** What is plotted, for the accessible name and the table. */
    label: string;
    ticks?: Array<{ t: number; label: string }> | null;
    /** Where the line starts / ends beyond the first / last marker (the sample's drawn line). */
    lead?: number | null;
    tail?: number | null;
    /** A fixed tooltip to show until the pointer or keyboard picks a point. */
    tooltip?: { t: number; y: number; value: string; date: string } | null;
    height?: number;
  }

  const { points, domain, label, ticks = null, lead = null, tail = null, tooltip = null, height = 150 }: Props =
    $props();

  const uid = $props.id();
  let width = $state(0);
  /** The point the pointer or keyboard chose; null shows the fixed tooltip. */
  let active = $state<number | null>(null);

  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 22;
  const PAD_B = 26;
  const plotW = $derived(Math.max(10, width - PAD_L - PAD_R));
  const plotH = $derived(height - PAD_T - PAD_B);

  const span = $derived(Math.max(1, domain.end - domain.start));
  const x = (t: number) => PAD_L + ((t - domain.start) / span) * plotW;
  const y = (v: number) => PAD_T + (1 - Math.max(0, Math.min(100, v)) / 100) * plotH;

  const marks = $derived(points.map<ChartPoint>((p) => ({ x: x(p.t), y: y(p.value) })));
  const linePoints = $derived.by(() => {
    if (marks.length === 0) return [];
    const out = [...marks];
    if (lead !== null) out.unshift({ x: PAD_L, y: y(lead) });
    if (tail !== null) out.push({ x: PAD_L + plotW, y: y(tail) });
    return out;
  });
  const line = $derived(monotonePath(linePoints));
  const area = $derived(
    linePoints.length >= 2
      ? `${line}L${linePoints[linePoints.length - 1].x},${PAD_T + plotH}L${linePoints[0].x},${PAD_T + plotH}Z`
      : '',
  );
  const topY = $derived(linePoints.length ? Math.min(...linePoints.map((p) => p.y)) : PAD_T);

  const xTicks = $derived((ticks ?? timeTicks(domain.start, domain.end)).filter((t) => t.t >= domain.start && t.t <= domain.end));
  const LEVELS = [0, 25, 50, 75, 100];

  const shown = $derived.by(() => {
    if (active !== null && points[active]) {
      const p = points[active];
      return { x: x(p.t), y: y(p.value), value: String(Math.round(p.value)), date: p.date.long };
    }
    if (tooltip && width > 0) return { x: x(tooltip.t), y: y(tooltip.y), value: tooltip.value, date: tooltip.date };
    return null;
  });

  function nearest(clientX: number, rect: DOMRect): number | null {
    if (marks.length === 0) return null;
    const px = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < marks.length; i++) {
      if (Math.abs(marks[i].x - px) < Math.abs(marks[best].x - px)) best = i;
    }
    return best;
  }

  function onpointermove(event: PointerEvent) {
    active = nearest(event.clientX, (event.currentTarget as HTMLElement).getBoundingClientRect());
  }

  function onkeydown(event: KeyboardEvent) {
    if (points.length === 0) return;
    const current = active ?? points.length - 1;
    let next = current;
    if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (event.key === 'ArrowRight') next = Math.min(points.length - 1, current + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = points.length - 1;
    else if (event.key === 'Escape') {
      active = null;
      return;
    } else return;
    event.preventDefault();
    active = next;
  }

  const tipLeft = $derived(shown ? Math.max(44, Math.min(width - 44, shown.x)) : 0);
</script>

<!-- The figure is focusable so the arrow keys can walk the points; the same
     numbers are in the hidden table for anyone not using the chart. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<figure
  class="trend"
  bind:clientWidth={width}
  style:height="{height}px"
  tabindex={points.length ? 0 : -1}
  aria-label="{label} over time. Use the left and right arrow keys to read each scan."
  {onkeydown}
  onpointermove={onpointermove}
  onpointerleave={() => (active = null)}
  onblur={() => (active = null)}
>
  {#if width > 0}
    <svg width={width} {height} aria-hidden="true">
      <defs>
        <linearGradient id="trend-area-{uid}" x1="0" y1={topY} x2="0" y2={PAD_T + plotH} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="rgb(232,120,130)" stop-opacity="0.3" />
          <stop offset="100%" stop-color="rgb(232,120,130)" stop-opacity="0.05" />
        </linearGradient>
      </defs>

      {#each LEVELS as level (level)}
        {#if level > 0}
          <line class="trend__grid" x1={PAD_L + 1} x2={PAD_L + plotW} y1={y(level)} y2={y(level)} />
        {/if}
        <text class="trend__axis" x={PAD_L - 12} y={y(level) + 4} text-anchor="end">{level}</text>
      {/each}
      {#each xTicks as tick (tick.t)}
        <line class="trend__grid trend__grid--v" x1={x(tick.t)} x2={x(tick.t)} y1={PAD_T} y2={PAD_T + plotH} />
        <text class="trend__axis" x={x(tick.t)} y={height - 6} text-anchor="middle">{tick.label}</text>
      {/each}
      <line class="trend__yaxis" x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + plotH} />
      <line class="trend__base" x1={PAD_L} x2={PAD_L + plotW} y1={PAD_T + plotH} y2={PAD_T + plotH} />

      {#if area}<path class="trend__area" d={area} fill="url(#trend-area-{uid})" />{/if}
      {#if linePoints.length >= 2}<path class="trend__line" d={line} pathLength="1" />{/if}

      {#each marks as mark, i (points[i].t)}
        <circle class="trend__mark" class:is-active={active === i} cx={mark.x} cy={mark.y} r={active === i ? 5 : 4} />
      {/each}
    </svg>

    {#if shown}
      <div class="trend__tip" style:left="{tipLeft}px" style:top="{shown.y - 10}px" aria-hidden="true">
        <strong class="t-num">{shown.value}</strong>
        <span>{shown.date}</span>
      </div>
    {/if}
  {/if}

  <table class="visually-hidden">
    <caption>{label}</caption>
    <thead><tr><th scope="col">Date</th><th scope="col">Reading</th></tr></thead>
    <tbody>
      {#each points as p (p.t)}
        <tr><td>{p.date.long}</td><td>{Math.round(p.value)}</td></tr>
      {/each}
    </tbody>
  </table>
  <span class="visually-hidden" aria-live="polite">
    {#if active !== null && points[active]}{points[active].date.long}: {Math.round(points[active].value)}{/if}
  </span>
</figure>

<style>
  .trend {
    position: relative;
    margin: 0;
    width: 100%;
    border-radius: var(--r-sm);
    touch-action: pan-y;
  }
  .trend:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  svg {
    display: block;
    overflow: visible;
  }

  .trend__grid {
    stroke: #f0e4e0;
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
  .trend__grid--v {
    stroke: #f3e8e5;
  }
  .trend__yaxis {
    stroke: #e6ddda;
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
  .trend__base {
    stroke: #e0d4d1;
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
  .trend__axis {
    fill: var(--text-muted);
    font-family: var(--font-sans);
    font-size: var(--fs-meta);
    font-variant-numeric: tabular-nums;
  }

  .trend__area {
    animation: trend-fade var(--dur-slow) var(--ease-out) both;
  }
  .trend__line {
    fill: none;
    stroke: #c9707e;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: trend-draw 900ms var(--ease-out) forwards;
  }
  .trend__mark {
    fill: #fff1f3;
    stroke: #bf4f64;
    stroke-width: 2;
    transition: r var(--dur-fast) var(--ease-out);
  }
  .trend__mark.is-active {
    fill: #bf4f64;
  }

  .trend__tip {
    position: absolute;
    z-index: 1;
    display: grid;
    justify-items: center;
    gap: 1px;
    min-width: 88px;
    padding: 5px 10px 6px;
    border: 1px solid #f2e5e3;
    border-radius: 10px;
    background: #fdf6f4;
    box-shadow: 0 4px 12px rgba(200, 110, 120, 0.14);
    transform: translate(-50%, -100%);
    pointer-events: none;
    white-space: nowrap;
  }
  .trend__tip::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -5px;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    border-right: 1px solid #f2e5e3;
    border-bottom: 1px solid #f2e5e3;
    background: #fdf6f4;
    transform: rotate(45deg);
  }
  .trend__tip strong {
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-semibold);
    line-height: 1.2;
    color: var(--text-strong);
  }
  .trend__tip span {
    font-size: var(--fs-meta);
    line-height: 1.2;
    color: var(--text-secondary);
  }

  @keyframes trend-draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes trend-fade {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .trend__line {
      stroke-dasharray: none;
      stroke-dashoffset: 0;
      animation: none;
    }
    .trend__area {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .trend__line {
    stroke-dasharray: none;
    stroke-dashoffset: 0;
    animation: none;
  }
</style>
