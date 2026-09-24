<script lang="ts">
  import AIDisclosure from '@/components/legal/AIDisclosure.svelte';
  /**
   * Body readings over time.
   *
   * A separate block from the skin history, and never merged into it. The two
   * come from different pipelines against different model versions, and a
   * chart that put a shoulder ratio and a hydration score on one axis would be
   * inventing a relationship that does not exist.
   *
   * Three rules from the measurement side carry through to how this reads:
   *
   *  - Proportions are not faults. Shoulder-to-hip and waist have no correct
   *    value, so they are shown as positions with no better/worse colouring.
   *  - The abdominal reading is a proportion too, and is plotted as the
   *    measurement it is — belly depth over chest depth — rather than as a
   *    score out of a hundred, which is a grade wearing a number's clothes.
   *  - A waist traced from an outline and one estimated from joints are
   *    different measurements. No delta is shown across that boundary.
   */
  import { session } from '@/state/session.svelte.ts';
  import { api } from '@/lib/api.ts';
  import { refreshBodyScans } from '@/state/controller.ts';
  import {
    BODY_METRIC_KEYS,
    BODY_READING_LABELS,
    type BodyAnalysisRecord,
    type BodyMetricKey,
  } from '@shared/types.ts';
  import { BODY_NOISE_FLOOR } from '@/body-analysis/metrics.ts';
  import { PROFILE_NOISE_FLOOR } from '@/body-analysis/profile.ts';

  /** Newest first, as the store holds them. */
  const scans = $derived(session.bodyScans as BodyAnalysisRecord[]);
  const latest = $derived(scans[0] ?? null);
  const previous = $derived(scans[1] ?? null);

  /** Build has no correct value, so these are never coloured good or bad. */
  const PROPORTIONS: BodyMetricKey[] = ['shoulderHipRatio', 'waistRatio'];

  const windowDays = $derived.by(() => {
    if (scans.length < 2) return 0;
    const first = new Date(scans[scans.length - 1].capturedAt).getTime();
    const last = new Date(scans[0].capturedAt).getTime();
    return Math.max(1, Math.round((last - first) / 86_400_000));
  });

  /**
   * A scan that actually measured an abdomen.
   *
   * A narrowed type rather than a filter alone, because "has a side view" is
   * the whole precondition for everything plotted below — front-only scans
   * carry no abdominal reading, and the compiler should be the thing that
   * remembers that rather than a comment.
   */
  type ProfileScan = BodyAnalysisRecord & {
    profile: NonNullable<BodyAnalysisRecord['profile']>;
    profileDetail: NonNullable<BodyAnalysisRecord['profileDetail']>;
  };

  const hasProfile = (s: BodyAnalysisRecord): s is ProfileScan =>
    s.profile !== null && s.profileDetail !== null;

  /** Every scan that measured an abdomen, oldest first. */
  const profileRun = $derived(scans.filter(hasProfile).slice().reverse());

  interface Row {
    key: BodyMetricKey;
    label: string;
    value: number;
    delta: number | null;
    /** Set when the two scans measured the waist different ways. */
    incomparable: boolean;
    tone: 'good' | 'bad' | undefined;
  }

  const rows = $derived.by<Row[]>(() => {
    if (!latest) return [];
    return BODY_METRIC_KEYS.map((key) => {
      const value = latest.metrics[key];
      const sourceChanged =
        key === 'waistRatio' && previous !== null && previous.waistSource !== latest.waistSource;
      const raw = previous ? value - previous.metrics[key] : null;
      const moved = raw !== null && Math.abs(raw) >= BODY_NOISE_FLOOR[key];
      const delta = sourceChanged || !moved ? null : raw;
      return {
        key,
        label: BODY_READING_LABELS[key] ?? key,
        value,
        delta,
        incomparable: sourceChanged,
        // Posture has a better end; build does not.
        tone: delta === null || PROPORTIONS.includes(key) ? undefined : delta > 0 ? 'good' : 'bad',
      };
    });
  });

  function deltaLabel(row: Row): string {
    if (row.incomparable) return 'method changed';
    if (!previous) return 'first reading';
    if (row.delta === null) return 'steady since last';
    return `${row.delta > 0 ? '+' : ''}${Math.round(row.delta)}`;
  }

  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

  /*
   * Body readings are deletable one at a time, like skin scans.
   *
   * Not a nicety: "delete everything" already worked, but a person who wants a
   * single side view gone should not have to destroy their whole account to
   * manage it. Both stored frames are shredded with the row.
   */
  async function remove(id: string) {
    await api.deleteBodyScan(id);
    await refreshBodyScans();
  }
</script>
<AIDisclosure result />

{#if latest}
  <h2 style="margin-top:20px">Your body over time</h2>
  <p class="lede">
    {scans.length} scan{scans.length === 1 ? '' : 's'}{windowDays
      ? ` across ${windowDays} day${windowDays === 1 ? '' : 's'}`
      : ''}. Measured separately from your skin and never compared with it — different
    readings, different scales.
  </p>

  {#if profileRun.length}
    {@const first = profileRun[0]}
    {@const last = profileRun[profileRun.length - 1]}
    {@const move = last.profileDetail.depthRatio - first.profileDetail.depthRatio}
    {@const moved =
      profileRun.length > 1 &&
      Math.abs(last.profile.abdominalProfile - first.profile.abdominalProfile) >=
        PROFILE_NOISE_FLOOR.abdominalProfile}
    <div class="bodyhist">
      <div class="bodyhist__head">
        <span class="bodyhist__label">Abdominal profile</span>
        <span class="bodyhist__count">
          {profileRun.length} side view{profileRun.length === 1 ? '' : 's'}
        </span>
      </div>

      <!--
        Plotted as the measurement, not as a score. Belly depth over chest
        depth is what was actually measured; 1.0 is the line where the abdomen
        is as deep as the chest, so the reference line means something.
      -->
      {#if profileRun.length > 1}
        {@const values = profileRun.map((s) => s.profileDetail.depthRatio)}
        {@const lo = Math.min(...values, 0.85)}
        {@const hi = Math.max(...values, 1.15)}
        {@const span = Math.max(0.001, hi - lo)}
        <svg class="bodyhist__plot" viewBox="0 0 300 74" preserveAspectRatio="none" role="img"
          aria-label={`Abdominal depth ratio across ${profileRun.length} scans`}>
          <line
            x1="0" x2="300"
            y1={70 - ((1 - lo) / span) * 64}
            y2={70 - ((1 - lo) / span) * 64}
            stroke="var(--line-strong)" stroke-dasharray="3 4" stroke-width="1"
          />
          <polyline
            fill="none" stroke="var(--ink-soft)" stroke-width="1.25"
            stroke-linejoin="round" stroke-linecap="round"
            points={values
              .map((v, i) => `${(i / (values.length - 1)) * 296 + 2},${70 - ((v - lo) / span) * 64}`)
              .join(' ')}
          />
          {#each values as v, i}
            <circle
              cx={(i / (values.length - 1)) * 296 + 2}
              cy={70 - ((v - lo) / span) * 64}
              r={i === values.length - 1 ? 3 : 2}
              fill={i === values.length - 1 ? 'var(--metal)' : 'var(--ink-soft)'}
            />
          {/each}
        </svg>
        <div class="bodyhist__axis">
          <span>{dateFormat.format(new Date(first.capturedAt))}</span>
          <span>as deep as the chest = 1.00</span>
          <span>{dateFormat.format(new Date(last.capturedAt))}</span>
        </div>
      {/if}

      <div class="bodyhist__now">
        <strong>{last.profileDetail.depthRatio.toFixed(2)}</strong>
        <span>× chest</span>
        {#if profileRun.length > 1}
          <span class="bodyhist__move" data-tone={moved ? (move < 0 ? 'good' : 'bad') : undefined}>
            {#if moved}
              {move > 0 ? '+' : ''}{move.toFixed(2)} since your first side view
            {:else}
              inside measurement noise since your first side view
            {/if}
          </span>
        {:else}
          <span class="bodyhist__move">your baseline — the next one is the comparison</span>
        {/if}
      </div>
    </div>
  {:else}
    <p class="lede">
      No side view yet, so there is no abdominal reading. A belly projects forward and a
      front-on photo cannot see one.
    </p>
  {/if}

  {#each rows as row (row.key)}
    <div class="row">
      <span class="row__label" style="min-width:112px">{row.label}</span>
      <div class="bar"><i style="width:{row.value}%"></i></div>
      <span class="row__value">{Math.round(row.value)}</span>
      <span class="row__value" data-tone={row.tone} style="min-width:96px;text-align:right">
        {deltaLabel(row)}
      </span>
    </div>
  {/each}

  <p class="lede">
    Shoulder-to-hip and waist describe build, which has no better or worse — they are
    reported as positions, and only their movement carries information.
  </p>

  {#each scans as scan (scan.id)}
    <div class="row">
      <span class="row__label">{dateFormat.format(new Date(scan.capturedAt))}</span>
      <span class="row__note">
        {scan.profile ? 'front and side' : 'front only'} · confidence
        {Math.round(scan.confidence * 100)}%
        {#if scan.hasImage}· photo kept{/if}
      </span>
      <button
        class="btn btn--danger"
        style="padding:4px 10px;font-size:11px"
        onclick={() => remove(scan.id!)}
      >
        Delete
      </button>
    </div>
  {/each}
{/if}

<style>
  .lede {
    margin: var(--s-3) 0 0;
    max-width: var(--measure);
    font-size: var(--t-md);
    line-height: var(--lh-body);
    color: var(--quiet);
  }
</style>
