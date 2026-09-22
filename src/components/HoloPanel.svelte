<script lang="ts">
  /**
   * The analysis, for anyone who cannot see it.
   *
   * The readouts themselves are now floating in the room — canvas-textured
   * panels arranged around Evia, drawn by the hologram rig. That is the right
   * answer for the look and the wrong one for accessibility: a texture on a quad
   * is invisible to a screen reader, unreachable by keyboard, and unselectable.
   *
   * So this stays, carrying exactly the same numbers from exactly the same
   * stored scan, and renders only to assistive technology. It is not a fallback
   * or a duplicate source of truth — both views read `session.latestScan`, so
   * they cannot disagree.
   */
  import { session } from '@/state/session.svelte.ts';
  import { selectPresented } from '@/holograms/presented.ts';
  import {
    METRIC_HIGHER_IS_BETTER,
    METRIC_LABELS,
    type MetricTrend,
    type SkinMetricKey,
  } from '@shared/types.ts';

  const scan = $derived(session.latestScan);
  const previous = $derived(session.scans[1] ?? null);
  const keys = $derived(selectPresented(scan, previous));
  const trends = $derived(new Map(session.summary?.trends.map((t) => [t.key, t]) ?? []));

  /**
   * The reading and how it moved.
   *
   * Direction is per-metric — hydration rising is good, redness rising is not —
   * and anything inside the noise floor reports as steady rather than inventing
   * a trend out of measurement jitter.
   */
  function describe(key: SkinMetricKey): string {
    const value = scan ? Math.round(scan.metrics[key]) : null;
    if (value === null) return `${METRIC_LABELS[key]}: not measured yet`;

    const trend: MetricTrend | undefined = trends.get(key);
    const delta = trend?.significant ? trend.deltaFromPrevious : null;
    if (delta === null || delta === undefined || delta === 0) {
      return `${METRIC_LABELS[key]}: ${value}, holding steady`;
    }
    const better = METRIC_HIGHER_IS_BETTER[key] ? delta > 0 : delta < 0;
    return `${METRIC_LABELS[key]}: ${value}, ${Math.abs(Math.round(delta))} points ${
      better ? 'better' : 'worse'
    } than last time`;
  }
</script>

<section class="sr-only" aria-live="polite">
  {#if session.panelMode === 'routine'}
    <h2>Suggested routine</h2>
    <ol>
      {#each session.plan?.suggestions ?? [] as suggestion (suggestion.title)}
        <li>
          {suggestion.step}: {suggestion.title}. {suggestion.actives.join(', ')}.
          {#if suggestion.because}
            Because {suggestion.because.label.toLowerCase()} is {suggestion.because.value}.
          {/if}
        </li>
      {:else}
        <li>
          Nothing needs changing right now — everything reads inside the range where a difference
          would just be measurement noise.
        </li>
      {/each}
    </ol>
  {:else}
    <h2>Skin analysis</h2>
    <ul>
      {#each keys as key (key)}
        <li>{describe(key)}</li>
      {/each}
    </ul>
  {/if}
  <p>Appearance analysis, not a medical diagnosis. Ingredients, not brands.</p>
</section>
