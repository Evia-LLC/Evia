<script lang="ts">
  import AIDisclosure from '@/components/legal/AIDisclosure.svelte';
  /**
   * Progress. Everything here is read from stored scans — there is no
   * illustrative data on this page (brief §18, §33).
   *
   * The rings are the reading; the chart is the history; the atlas is the
   * evidence. Tapping a ring chooses what the chart plots, and asking her about
   * it is one more tap — she stays the interpreter, the page does not explain
   * itself (ARCHITECTURE §8).
   */
  import Page from '@/components/Page.svelte';
  import MetricRing from '@/components/MetricRing.svelte';
  import TrendChart from '@/history/TrendChart.svelte';
  import ScanAtlas from '@/history/ScanAtlas.svelte';
  import CompareFaces from '@/history/CompareFaces.svelte';
  import BodyHistory from '@/history/BodyHistory.svelte';
  import { session } from '@/state/session.svelte.ts';
  import { api } from '@/lib/api.ts';
  import { askElohim, refreshScans } from '@/state/controller.ts';
  import { link } from '@/router/router.svelte.ts';
  import { METRIC_LABELS, SKIN_METRIC_KEYS, type SkinMetricKey } from '@shared/types.ts';

  const summary = $derived(session.summary);
  const latest = $derived(session.latestScan);
  const trends = $derived(new Map(summary?.trends.map((t) => [t.key, t]) ?? []));

  let plotted = $state<SkinMetricKey>('hydration');

  const title = $derived.by(() => {
    if (!latest) return 'Nothing to compare yet.';
    if ((summary?.scanCount ?? 0) < 2) return 'One reading. Now we need a second.';
    return 'What your skin has been doing.';
  });

  const lede = $derived.by(() => {
    if (!summary || summary.scanCount === 0) {
      return 'The first scan becomes your baseline — after that, every reading is a comparison rather than a verdict.';
    }
    const span = `${summary.scanCount} scan${summary.scanCount === 1 ? '' : 's'} across ${summary.windowDays} day${summary.windowDays === 1 ? '' : 's'}.`;
    return summary.headline ? `${span} ${summary.headline}` : span;
  });

  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

  async function remove(id: string) {
    await api.deleteScan(id);
    await refreshScans();
  }

  async function removePhoto(id: string) {
    await api.deleteProgressPhoto(id);
    session.progressPhotos = session.progressPhotos.filter((photo) => photo.id !== id);
  }
</script>

<Page eyebrow="Progress" {title} {lede} wide>
  {#snippet actions()}
    <a class="cta" href="/scan" use:link>{latest ? 'Scan again' : 'Take the first scan'}</a>
  {/snippet}

  {#if summary?.mixedModelVersions}
    <div class="card card--warm sec">
      <p class="card__text">
        Your history spans more than one version of the analysis. I only compare scans from
        the same version — the formulas changed, and the numbers are not interchangeable.
      </p>
    </div>
  {/if}

  {#if session.scans.length}
    <section class="sec" aria-labelledby="now">
      <div class="sec__head">
        <h2 class="sec__title" id="now">Nine readings</h2>
        {#if latest}
          <span class="sec__meta">
            {dateFormat.format(new Date(latest.capturedAt))} · confidence {Math.round(
              latest.confidence * 100,
            )}%
          </span>
        {/if}
      </div>
      {#if session.scans.length >= 2}
        <div class="chart">
          <TrendChart scans={session.scans} metric={plotted} />
        </div>
      {/if}
      <div class="rings">
        {#each SKIN_METRIC_KEYS as key, i (key)}
          <MetricRing
            metric={key}
            label={METRIC_LABELS[key]}
            value={latest ? latest.metrics[key] : null}
            trend={trends.get(key) ?? null}
            index={i}
            active={plotted === key}
            onpick={() => (plotted = key)}
          />
        {/each}
      </div>
      <AIDisclosure result />
      {#if latest}
        <div class="ask">
          <button class="cta cta--quiet" type="button" onclick={() => askElohim(`Tell me about my ${METRIC_LABELS[plotted].toLowerCase()}.`)}>
            Ask me about {METRIC_LABELS[plotted].toLowerCase()}
          </button>
          <span class="ask__note">
            Coloured only when a change clears the noise floor. Steady means steady.
          </span>
        </div>
      {/if}
    </section>

    {#if session.scans.length >= 2}
      <section class="sec" aria-label="Before and after">
        <div class="card card--plane">
          <CompareFaces scans={session.scans} photos={session.progressPhotos} />
        </div>
      </section>
    {/if}

    <section class="sec" aria-label="Scan images">
      <ScanAtlas scans={session.scans} photos={session.progressPhotos} />
    </section>
  {/if}

  <section class="sec" aria-label="Body readings">
    <BodyHistory />
  </section>

  {#if summary?.correlations.length}
    <section class="sec" aria-labelledby="using">
      <div class="sec__head">
        <h2 class="sec__title" id="using">While you were using</h2>
      </div>
      <p class="sec__lede">
        What your skin did during the time these were in your routine. Correlation, not
        proof — I will never tell you a product caused something.
      </p>
      <div class="card">
        {#each summary.correlations as c (c.productId)}
          <div class="line">
            <div class="line__main">
              <span class="line__title">{c.productName}</span>
              <span class="line__sub">
                {c.overlapDays} days, {c.scansDuringUse} scans —
                {#each Object.entries(c.metricDeltasDuringUse) as [key, delta], i}
                  {i > 0 ? ', ' : ''}{METRIC_LABELS[key as SkinMetricKey]}
                  {delta > 0 ? '+' : ''}{delta}
                {:else}
                  nothing moved beyond noise
                {/each}
              </span>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if session.scans.length}
    <section class="sec" aria-labelledby="scans">
      <div class="sec__head">
        <h2 class="sec__title" id="scans">Every scan</h2>
        <span class="sec__meta">{session.scans.length} kept</span>
      </div>
      <div class="card">
        {#each session.scans as scan (scan.id)}
          <div class="line">
            <div class="line__main">
              <span class="line__title">{dateFormat.format(new Date(scan.capturedAt))}</span>
              <span class="line__sub">
                confidence {Math.round(scan.confidence * 100)}%{#if session.progressPhotos.some((p) => p.skinScanId === scan.id)} · progress photo saved{/if}{#if scan.notes} · {scan.notes}{/if}
              </span>
            </div>
            <div class="line__end">
              <button class="btn btn--danger btn--mini" onclick={() => remove(scan.id!)}>Delete</button>
            </div>
          </div>
        {/each}
      </div>
    </section>
    {#if session.progressPhotos.length}
      <section class="sec" aria-labelledby="photos">
        <div class="sec__head"><h2 class="sec__title" id="photos">Progress photos</h2></div>
        <div class="card">
          {#each session.progressPhotos as photo (photo.id)}
            <div class="line">
              <span class="line__title">{dateFormat.format(new Date(photo.capturedAt))}</span>
              <button class="btn btn--danger btn--mini" onclick={() => removePhoto(photo.id)}>Delete photo</button>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  {:else}
    <div class="empty sec">
      <p class="empty__title">I have nothing of yours yet.</p>
      <p class="empty__text">
        Take a scan and this page fills in: nine readings now, a line for each one over time,
        and — if you let me keep the photos — your own face with the measured zones drawn on.
      </p>
    </div>
  {/if}
</Page>

<style>
  .chart {
    margin-bottom: var(--s-5);
  }
  .ask {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s-3) var(--s-5);
    margin-top: var(--s-4);
    padding-top: var(--s-4);
    border-top: var(--hair) solid var(--line);
  }
  .ask__note {
    font-size: var(--t-md);
    line-height: var(--lh-body);
    color: var(--quiet);
    max-width: 34ch;
  }
</style>
