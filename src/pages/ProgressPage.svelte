<!--
  Progress (ref2.png, specs/progress.md), inside the shell.

  Rendered only from the view model (`src/view/progress.ts`): the mockup's
  own sample while sample mode is on, and otherwise the stored scans read
  honestly - no composite score, changes in points only past each reading's
  noise floor, and a comparison that works without photos (BUILD-PLAN
  decisions 2 and 10). The page itself only holds the three choices a person
  makes here: the time range, the reading the timeline plots, and which scan
  the comparison compares up to.

  Layout: two columns from a 960px-wide page (the mockup's grid - comparison
  beside the score and key improvements, then timeline and recent scans, then
  milestones and insights), one column below that in the phone order (readings
  first, then what changed, then the comparison, timeline and the rest).

  Under the readings sits the Consent Wording Pack's section 8 result notice
  (main, Section 5): "Cosmetic observations only..." and the escalation line,
  verbatim, on every Progress view, sample or real.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import SegmentedTabs from '@/ui/SegmentedTabs.svelte';
  import Card from '@/ui/Card.svelte';
  import Icon from '@/ui/Icon.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import NotificationBell from '@/shell/NotificationBell.svelte';
  import ProfilePill from '@/shell/ProfilePill.svelte';
  import ComparisonCard from './progress/ComparisonCard.svelte';
  import ScoreCard from './progress/ScoreCard.svelte';
  import ImprovementsCard from './progress/ImprovementsCard.svelte';
  import TimelineCard from './progress/TimelineCard.svelte';
  import RecentScansCard from './progress/RecentScansCard.svelte';
  import MilestonesCard from './progress/MilestonesCard.svelte';
  import InsightsCard from './progress/InsightsCard.svelte';
  import ProgressToast from './progress/ProgressToast.svelte';
  import ScanHistory from './progress/ScanHistory.svelte';
  import BodyHistory from '@/history/BodyHistory.svelte';
  import AIDisclosure from '@/components/legal/AIDisclosure.svelte';
  import { api } from '@/lib/api.ts';
  import { askElohim } from '@/state/controller.ts';
  import { session } from '@/state/session.svelte.ts';
  import { sample } from '@/sample/mode.svelte.ts';
  import { DEFAULT_RANGE, RANGES, progressView, type RangeId } from '@/view/progress.ts';
  import type { RoutineOutcome, SkinMetricKey } from '@shared/types.ts';

  let range = $state<RangeId>(DEFAULT_RANGE);
  let metric = $state<SkinMetricKey | null>(null);
  let selectedScanId = $state<string | null>(null);
  let outcomes = $state<RoutineOutcome[]>([]);
  let showAll = $state(false);
  /* On a phone the profile pill is just the avatar, as in the other top bars. */
  const phone = new MediaQuery('max-width: 559px', false);
  /* Below the sidebar breakpoint the range tabs span the page, evenly. */
  const narrow = new MediaQuery('max-width: 819px', false);

  const view = $derived(progressView({ range, metric, selectedScanId }, outcomes));

  /* Routine outcome statements feed the insights; an account only, and never
     in sample mode. A failure just leaves them out. */
  $effect(() => {
    if (sample.on || session.guest || !session.signedIn) return;
    let cancelled = false;
    api
      .routineOutcomes()
      .then((result) => {
        if (!cancelled) outcomes = result.outcomes;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  function setRange(id: string) {
    range = id as RangeId;
    selectedScanId = null;
  }

  async function openAll() {
    showAll = !showAll;
    if (!showAll) return;
    await tick();
    const target = document.getElementById('all-scans');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target?.focus({ preventScroll: true });
  }
</script>

<div class="pg" data-mode={view.mode}>
  <header class="pg-head">
    <div class="pg-head__titles">
      <h1 class="pg-head__title">{view.title}</h1>
      <p class="pg-head__sub">{view.subtitle}</p>
    </div>
    <SegmentedTabs
      class="pg-head__range"
      options={RANGES.map((r) => ({ id: r.id, label: r.label }))}
      value={range}
      label="Time range"
      full={narrow.current}
      onchange={setRange}
    />
    <div class="pg-head__me">
      <NotificationBell tone="light" />
      <ProfilePill tone="light" compact={phone.current} />
    </div>
    {#if view.rangeNote}
      <p class="pg-head__note" role="status">
        <Icon name="info" size={18} stroke={1.5} />
        <span>{view.rangeNote}</span>
      </p>
    {/if}
    {#if view.toast}
      {#key view.toast.body}
        <ProgressToast toast={view.toast} autoHide={view.mode === 'real' ? 8000 : 0} class="pg-head__toast" />
      {/key}
    {/if}
  </header>

  <div class="pg-grid">
    <ComparisonCard class="pg-a-cmp" view={view.comparison} onwiderange={() => setRange('All')} />
    <ScoreCard class="pg-a-score" view={view.score} />
    <ImprovementsCard class="pg-a-ki" view={view.improvements} />
    <TimelineCard class="pg-a-time" view={view.timeline} onmetric={(m) => (metric = m as SkinMetricKey)} />
    <RecentScansCard
      class="pg-a-recent"
      view={view.recent}
      selected={view.selectedScanId}
      onselect={(id) => (selectedScanId = id)}
      onviewall={openAll}
      viewAllOpen={showAll}
    />
    <MilestonesCard class="pg-a-miles" view={view.milestones} onmore={view.recent.total > 0 ? openAll : undefined} />
    <InsightsCard class="pg-a-ins" view={view.insights} onask={(q) => void askElohim(q)} />
  </div>

  <AIDisclosure result class="pg-ai" />

  {#if showAll}
    <div class="pg-more">
      <ScanHistory sampleItems={view.mode === 'sample' ? view.recent.items : null} onclose={() => (showAll = false)} />
    </div>
  {/if}

  {#if view.mode === 'real' && session.bodyScans.length}
    <div class="pg-more">
      <Card as="section" padding="md" class="pg-card" aria-labelledby="pg-body-title">
        <SectionHeader title="Body readings" icon="user" iconStyle="coral" id="pg-body-title" />
        <BodyHistory />
      </Card>
    </div>
  {/if}
</div>

<style>
  /* The section 8 result notice, under the grid, on the page wash. */
  .pg :global(.pg-ai) {
    margin: 16px 0 0 17px;
  }
  @container pg (max-width: 700px) {
    .pg :global(.pg-ai) {
      margin-left: 0;
    }
  }
  .pg {
    container: pg / inline-size;
    width: 100%;
    max-width: 1560px;
    margin: 0 auto;
    padding: var(--topbar-top) var(--topbar-right) 24px 27px;
  }

  /* ---- header ------------------------------------------------------------ */
  .pg-head {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas:
      'titles range me'
      'note note note';
    align-items: start;
    column-gap: 40px;
    margin-bottom: 19px;
  }
  .pg-head__titles {
    grid-area: titles;
    padding: 0 0 0 17px;
  }
  .pg-head__title {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--fs-h1);
    font-weight: var(--fw-regular);
    line-height: 1.08;
    letter-spacing: var(--tr-title);
    color: var(--text-strong);
  }
  .pg-head__sub {
    margin: 6px 0 0;
    font-family: var(--font-serif);
    font-size: 19px;
    line-height: 1.3;
    color: var(--ink-800);
    text-wrap: balance;
  }
  .pg-head :global(.pg-head__range) {
    grid-area: range;
    margin-top: 22px;
  }
  .pg-head__me {
    grid-area: me;
    display: flex;
    align-items: center;
    gap: var(--topbar-gap);
  }
  .pg-head__note {
    grid-area: note;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    max-width: 72ch;
    margin: 12px 0 0 17px;
    padding: 10px 14px;
    border-radius: var(--r-md);
    background: var(--blush-100);
    border: 1px solid var(--card-rim);
    font-size: var(--fs-body-sm);
    line-height: 1.4;
    color: var(--text);
  }
  .pg-head__note :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--rose-icon);
  }
  .pg-head :global(.pg-head__toast) {
    position: absolute;
    top: 62px;
    right: 0;
    width: 244px;
  }

  /* ---- grid ---------------------------------------------------------------- */
  .pg-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'score' 'ki' 'cmp' 'time' 'recent' 'miles' 'ins';
    gap: 16px;
  }
  .pg-grid :global(.pg-card) {
    container: card / inline-size;
    min-width: 0;
  }
  .pg-grid :global(.pg-a-cmp) {
    grid-area: cmp;
  }
  .pg-grid :global(.pg-a-score) {
    grid-area: score;
  }
  .pg-grid :global(.pg-a-ki) {
    grid-area: ki;
  }
  .pg-grid :global(.pg-a-time) {
    grid-area: time;
  }
  .pg-grid :global(.pg-a-recent) {
    grid-area: recent;
  }
  .pg-grid :global(.pg-a-miles) {
    grid-area: miles;
  }
  .pg-grid :global(.pg-a-ins) {
    grid-area: ins;
  }

  @container pg (min-width: 960px) {
    .pg-grid {
      grid-template-columns: minmax(0, 579fr) minmax(0, 570fr);
      grid-template-areas:
        'cmp score'
        'cmp ki'
        'time recent'
        'miles ins';
      column-gap: 16px;
      row-gap: 15px;
    }
    .pg-grid :global(.pg-a-score) {
      margin-bottom: -2px;
    }
  }

  .pg-more {
    margin-top: 16px;
  }

  /* ---- small desktop, tablet and phone -------------------------------------- */
  /* Below about 1080px of page the title, the range tabs and the profile pill
     no longer fit on one line without squeezing the subtitle onto two, so the
     tabs move to a row of their own under the title. */
  @container pg (max-width: 1079px) {
    .pg-head {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'titles me'
        'range range'
        'note note';
      row-gap: 14px;
      min-height: 0;
    }
    .pg-head :global(.pg-head__range) {
      margin-top: 0;
      justify-self: start;
    }
    .pg-head__note {
      margin-top: 0;
    }
    .pg-head :global(.pg-head__toast) {
      top: 70px;
    }
  }

  @media (max-width: 819px) {
    .pg {
      padding: calc(12px + var(--sample-space)) 16px 24px;
    }
    .pg-head {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'titles me'
        'range range'
        'note note'
        'toast toast';
    }
    .pg-head__titles {
      padding: 0;
    }
    .pg-head__note {
      margin-left: 0;
    }
    .pg-head__sub {
      font-size: var(--fs-body);
    }
    .pg-head__me {
      gap: 4px;
      margin-top: 0;
    }
    .pg-head :global(.pg-head__range) {
      justify-self: stretch;
    }
    .pg-head :global(.pg-head__toast) {
      grid-area: toast;
      position: static;
      width: auto;
    }
  }
</style>
