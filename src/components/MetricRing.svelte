<script lang="ts">
  /**
   * One reading, as a ring.
   *
   * The arc is the score; the colour is the *direction* rather than the value,
   * because a 40 in hydration and a 40 in redness are not the same news. A
   * metric where higher is better lights up as it rises; one where higher is
   * worse lights up as it falls. Steady inside the noise floor is drawn plain
   * — a change that is really measurement jitter must not be coloured as a
   * change.
   *
   * The arc draws on when it arrives. Reduced motion draws it already there.
   */
  import { countUp } from '@/lib/motion.ts';
  import { METRIC_HIGHER_IS_BETTER, type MetricTrend, type SkinMetricKey } from '@shared/types.ts';

  interface Props {
    metric: SkinMetricKey;
    label: string;
    value: number | null;
    trend?: MetricTrend | null;
    size?: number;
    /** Order in a group, so a row of rings draws on one after another. */
    index?: number;
    active?: boolean;
    onpick?: () => void;
  }

  const {
    metric,
    label,
    value,
    trend = null,
    size = 84,
    index = 0,
    active = false,
    onpick,
  }: Props = $props();

  const R = 40;
  const C = 2 * Math.PI * R;

  const fraction = $derived(value === null ? 0 : Math.max(0, Math.min(1, value / 100)));
  const offset = $derived(C * (1 - fraction));

  const tone = $derived.by((): 'good' | 'bad' | 'flat' => {
    if (!trend || !trend.significant || trend.deltaFromPrevious === null) return 'flat';
    const up = trend.deltaFromPrevious > 0;
    return up === METRIC_HIGHER_IS_BETTER[metric] ? 'good' : 'bad';
  });

  const delta = $derived.by(() => {
    if (!trend || trend.deltaFromPrevious === null) return null;
    if (!trend.significant) return 'steady';
    const d = Math.round(trend.deltaFromPrevious);
    return `${d > 0 ? '+' : ''}${d}`;
  });
</script>

<button
  class="ring"
  data-tone={tone}
  data-active={active ? 'true' : null}
  data-index={index}
  style="--size:{size}px"
  type="button"
  onclick={onpick}
  aria-pressed={onpick ? active : undefined}
  aria-label="{label}: {value === null ? 'not measured' : Math.round(value)}{delta && delta !== 'steady'
    ? `, ${delta} since last`
    : ''}"
>
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <circle class="ring__track" cx="50" cy="50" r={R} />
    <circle
      class="ring__arc"
      cx="50"
      cy="50"
      r={R}
      style="stroke-dasharray:{C};--offset:{offset}"
    />
  </svg>
  <span class="ring__value" use:countUp={value}></span>
  <span class="ring__label">{label}</span>
  {#if delta}
    <span class="ring__delta">{delta}</span>
  {/if}
</button>

<style>
  .ring {
    --arc: var(--ink-soft);
    position: relative;
    display: grid;
    grid-template-rows: var(--size) auto auto;
    justify-items: center;
    gap: var(--s-2);
    width: 100%;
    min-width: var(--size);
    padding: var(--s-2) 0;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--ink);
    text-align: center;
    transition:
      background var(--dur-1) var(--ease),
      box-shadow var(--dur-1) var(--ease);
    animation: ring-in var(--dur-3) var(--ease) both;
  }
  .ring:hover,
  .ring:focus-visible {
    background: var(--surface-raised);
    border-color: transparent;
  }
  .ring[data-active='true'] {
    background: none;
    box-shadow: inset 0 -1px 0 var(--metal);
  }
  .ring[data-active='true'] .ring__arc {
    --arc: var(--metal);
  }
  /* Tone still colours the arc; active overrides to metal. */
  .ring[data-tone='good'] {
    --arc: var(--good);
  }
  .ring[data-tone='bad'] {
    --arc: var(--bad);
  }

  svg {
    grid-row: 1;
    width: var(--size);
    height: var(--size);
    transform: rotate(-90deg);
    overflow: visible;
  }

  .ring__track {
    fill: none;
    stroke: var(--line);
    stroke-width: 3;
  }

  .ring__arc {
    fill: none;
    stroke: var(--arc);
    stroke-width: 3;
    stroke-linecap: butt;
    stroke-dashoffset: var(--offset);
    filter: none;
    animation: ring-draw var(--dur-3) var(--ease) both;
    transition:
      stroke-dashoffset var(--dur-3) var(--ease),
      stroke var(--dur-2) var(--ease);
  }

  @keyframes ring-draw {
    from {
      stroke-dashoffset: 251.3;
    }
  }

  @keyframes ring-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }

  .ring__value {
    position: absolute;
    top: calc(var(--size) / 2 + 8px);
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: var(--font);
    font-size: var(--t-h2);
    font-weight: var(--w-light);
    letter-spacing: var(--trk-figure);
    line-height: 1;
    color: var(--ink);
    font-feature-settings: var(--num);
    font-variant-numeric: tabular-nums;
  }

  .ring__label {
    grid-row: 2;
    font-size: var(--t-sm);
    letter-spacing: 0;
    text-transform: none;
    color: var(--quiet);
    white-space: nowrap;
  }
  .ring[data-active='true'] .ring__label {
    color: var(--ink);
  }

  .ring__delta {
    grid-row: 3;
    padding: 0;
    border-radius: 0;
    background: none;
    font-family: var(--font);
    font-size: var(--t-sm);
    letter-spacing: 0;
    color: var(--quiet);
    font-feature-settings: var(--num);
  }
  .ring[data-tone='good'] .ring__delta {
    color: var(--good);
    background: none;
  }
  .ring[data-tone='bad'] .ring__delta {
    color: var(--bad);
    background: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .ring,
    .ring__arc {
      animation: none;
    }
  }
  :global(.shell[data-reduced-motion='true']) .ring,
  :global(.shell[data-reduced-motion='true']) .ring__arc {
    animation: none;
  }
</style>
