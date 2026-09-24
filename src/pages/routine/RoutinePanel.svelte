<!--
  The Routine panel (ref1, right-hand side; routine.md): the header, the
  Morning / Evening / Weekly tabs, the step card, the list of steps with
  Reorder, "Why this routine?", then the general-guidance note and - with real
  data - the user's own products.

  It renders only from a RoutineView (src/view/routine.ts). On a wide screen
  it is docked beside Home; on a tablet or a phone it is the whole page. Its
  own width decides the card's layout (a container query named `routine`),
  not the window's.
-->
<script lang="ts">
  import AiDisclosure from '@/shell/AiDisclosure.svelte';
  import Button from '@/ui/Button.svelte';
  import EmptyState from '@/ui/EmptyState.svelte';
  import Icon from '@/ui/Icon.svelte';
  import IconButton from '@/ui/IconButton.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import SegmentedTabs from '@/ui/SegmentedTabs.svelte';
  import type { RoutineSlotId, RoutineStepView, RoutineView } from '@/view/routine.ts';
  import StepCard from './StepCard.svelte';
  import StepRow from './StepRow.svelte';
  import WhyCard from './WhyCard.svelte';
  import YourProducts from './YourProducts.svelte';
  import type { RoutineData } from './routine-data.svelte.ts';

  interface Props {
    view: RoutineView;
    /** Real mode's data (for Your products); absent in sample mode. */
    data?: RoutineData | null;
    /** Docked beside Home: shows the back chevron. */
    docked?: boolean;
    onretry?: () => void;
  }

  const { view, data = null, docked = false, onretry }: Props = $props();
  const uid = $props.id();

  let slotId = $state<RoutineSlotId>('morning');
  /** The step in the card, per tab. */
  let shown = $state<Partial<Record<RoutineSlotId, number>>>({});
  /** A local order per tab (sample Reorder; never saved). */
  let order = $state<Partial<Record<RoutineSlotId, string[]>>>({});
  let reordering = $state(false);
  let playRequest = $state(0);

  /* A different view (sample switched, a plan arrived) starts from its own
     first tab and focus. */
  let lastView: RoutineView | null = null;
  $effect.pre(() => {
    if (view === lastView) return;
    const sameShape = lastView?.mode === view.mode && lastView?.status === view.status;
    lastView = view;
    if (!sameShape || !view.slots.some((s) => s.id === slotId)) slotId = view.initialSlot;
    if (!sameShape) {
      shown = {};
      order = {};
      reordering = false;
    }
  });

  const slot = $derived(view.slots.find((s) => s.id === slotId) ?? view.slots[0]);

  const steps = $derived.by((): RoutineStepView[] => {
    if (!slot) return [];
    const keys = order[slot.id];
    if (!keys) return slot.steps;
    const byKey = new Map(slot.steps.map((s) => [s.key, s]));
    const listed = keys.map((k) => byKey.get(k)).filter((s): s is RoutineStepView => Boolean(s));
    return [...listed, ...slot.steps.filter((s) => !keys.includes(s.key))];
  });

  const shownKey = $derived.by(() => {
    if (!slot) return null;
    const i = shown[slot.id] ?? slot.focus;
    return slot.steps[Math.min(i, slot.steps.length - 1)]?.key ?? null;
  });
  const shownIndex = $derived(Math.max(0, steps.findIndex((s) => s.key === shownKey)));
  const shownStep = $derived(steps[shownIndex] ?? null);

  function show(step: RoutineStepView) {
    if (!slot) return;
    shown = { ...shown, [slot.id]: slot.steps.findIndex((s) => s.key === step.key) };
  }

  function play(step: RoutineStepView) {
    show(step);
    playRequest += 1;
  }

  function move(index: number, by: -1 | 1) {
    if (!slot) return;
    const keys = steps.map((s) => s.key);
    const to = index + by;
    if (to < 0 || to >= keys.length) return;
    [keys[index], keys[to]] = [keys[to], keys[index]];
    order = { ...order, [slot.id]: keys };
  }

  /* The sample is one session in order ("Step 2 of 4"); a real plan is a set
     of suggestions, counted as such and grouped by kind (view/routine.ts). */
  const noun = $derived(view.sequence ? 'Step' : 'Suggestion');

  /* Real mode lists what a logged product already covers as its own group,
     after the rest (never reordered: Reorder is sample-only). */
  const coveredFrom = $derived(slot?.coveredFrom ?? null);
  const mainSteps = $derived(coveredFrom === null ? steps : steps.slice(0, coveredFrom));
  const coveredSteps = $derived(coveredFrom === null ? [] : steps.slice(coveredFrom));

  const tabOptions = $derived(
    view.slots.map((s) => ({ id: s.id, label: s.label, icon: s.icon, controls: `${uid}-panel` })),
  );
</script>

<div class="rt-panel" data-mode={view.mode}>
  <header class="rt-head">
    {#if docked}
      <IconButton icon="chevron-left" label="Back to Home" href="/" class="rt-head__back" iconSize={24} />
    {/if}
    <h1 class="rt-head__title">Routine</h1>
    <p class="rt-head__sub">{view.subtitle}</p>
    <p class="rt-head__desc">{view.description}</p>
  </header>

  {#if view.status === 'ready'}
    {#if view.split}
      <SegmentedTabs
        kind="tabs"
        full
        label="Time of day"
        options={tabOptions}
        value={slotId}
        onchange={(id) => {
          slotId = id as RoutineSlotId;
          reordering = false;
        }}
        class="rt-tabs"
      />
    {:else if view.splitNote}
      <p class="rt-note"><Icon name="info" size={18} /><span>{view.splitNote}</span></p>
    {/if}

    <div
      class="rt-body"
      class:has-card={Boolean(slot && steps.length && shownStep)}
      id="{uid}-panel"
      role={view.split ? 'tabpanel' : undefined}
      aria-label={view.split ? slot?.label : undefined}
    >
      {#if slot && steps.length && shownStep}
        {#key `${slot.id}:${shownStep.key}`}
          <StepCard step={shownStep} index={shownIndex} count={steps.length} {noun} {playRequest} />
        {/key}

        <section class="rt-list" aria-labelledby="{uid}-list">
          <SectionHeader id="{uid}-list" title={slot.heading} subtitle={slot.meta} level={2} class="rt-list__head">
            {#snippet action()}
              {#if view.canReorder && steps.length > 1}
                <Button
                  variant={reordering ? 'soft' : 'secondary'}
                  size="sm"
                  iconStart="reorder"
                  pressed={reordering}
                  onclick={() => (reordering = !reordering)}
                  class="rt-reorder"
                >
                  {reordering ? 'Done' : 'Reorder'}
                </Button>
              {/if}
            {/snippet}
          </SectionHeader>
          {#if reordering}
            <p class="rt-list__hint" role="status">Move steps up or down. This sample order is not saved.</p>
          {/if}
          {#snippet row(step: RoutineStepView, i: number)}
            <StepRow
              {step}
              number={i + 1}
              {noun}
              shown={step.key === shownKey}
              {reordering}
              first={i === 0}
              last={i === steps.length - 1}
              onshow={() => show(step)}
              onplay={() => play(step)}
              onmove={(by) => move(i, by)}
            />
          {/snippet}
          <svelte:element this={view.sequence ? 'ol' : 'ul'} class="rt-list__rows" role="list">
            {#each mainSteps as step, i (step.key)}{@render row(step, i)}{/each}
          </svelte:element>
          {#if coveredSteps.length}
            <h3 class="rt-list__group" id="{uid}-covered">Already covered by your products</h3>
            <ul class="rt-list__rows" role="list" aria-labelledby="{uid}-covered">
              {#each coveredSteps as step, i (step.key)}{@render row(step, mainSteps.length + i)}{/each}
            </ul>
          {/if}
        </section>
      {:else if slot?.empty}
        <div class="rt-emptycard">
          <EmptyState icon="calendar" title={slot.empty.title} body={slot.empty.body} compact />
        </div>
      {/if}

      {#if view.why}
        <WhyCard why={view.why} />
      {/if}
    </div>
  {:else if view.status === 'clear'}
    <div class="rt-body">
      <div class="rt-emptycard">
        <EmptyState
          icon="circle-check"
          title="Nothing to change right now"
          body="No reading in your latest scan was far enough past its threshold to suggest a new step."
        >
          {#snippet action()}
            <Button variant="secondary" size="sm" href="/scan" iconEnd="chevron-right">Scan again</Button>
          {/snippet}
        </EmptyState>
      </div>
      {#if view.why}
        <WhyCard why={view.why} />
      {/if}
    </div>
  {:else if view.status === 'loading'}
    <div class="rt-loading" role="status">
      <span class="rt-loading__bar"></span>
      <span class="visually-hidden">Loading your plan</span>
    </div>
  {:else if view.status === 'error'}
    <div class="rt-emptycard">
      <EmptyState icon="info" title="Your plan did not load" body="The server did not answer. Nothing is lost; try again in a moment.">
        {#snippet action()}
          <Button variant="secondary" size="sm" onclick={() => onretry?.()}>Try again</Button>
        {/snippet}
      </EmptyState>
    </div>
  {:else}
    <div class="rt-emptycard">
      <EmptyState
        icon="camera"
        title="No routine yet"
        body="Your routine is built from a skin reading: which steps, what to look for on a label, and why each one is there."
      >
        {#snippet action()}
          <Button variant="primary" href="/scan" iconEnd="chevron-right">Start a scan</Button>
        {/snippet}
      </EmptyState>
    </div>
  {/if}

  <footer class="rt-foot">
    <p class="rt-foot__note">
      Suggestions are general. Read the label, follow its directions and patch test anything new.
    </p>
    <AiDisclosure tone="light" />
  </footer>

  {#if view.mode === 'real' && data}
    <YourProducts {data} />
  {/if}
</div>

<style>
  /*
   * Measured at the 536px panel (routine.md section 1.3): header text centred,
   * tabs 16px in, the card 10px in, the list and the why card 15px in. Wider
   * panels keep the same insets; narrower ones step down to the phone gutter.
   */
  .rt-panel {
    --in-card: 10px;
    --in-list: 15px;
    --in-tabs: 16px;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 24px 0 32px;
    color: var(--text);
  }

  .rt-head {
    position: relative;
    display: grid;
    justify-items: center;
    padding: 0 16px;
    text-align: center;
  }
  .rt-head :global(.rt-head__back) {
    position: absolute;
    top: -9px;
    left: 9px;
    color: #2e1a17;
  }
  .rt-head__title {
    margin: 0;
    color: var(--ink-900);
    font-family: var(--font-serif);
    font-size: var(--fs-h2);
    font-weight: var(--fw-regular);
    line-height: 1.1;
    letter-spacing: -0.005em;
    transform: translateY(-4px);
  }
  .rt-head__sub {
    margin: 3px 0 0;
    color: #201211;
    font-size: 18px;
    font-weight: var(--fw-medium);
    line-height: 22px;
  }
  .rt-head__desc {
    max-width: 75ch;
    margin: 4px 0 0;
    color: #5f4a47;
    font-size: var(--fs-body-sm);
    line-height: 18px;
    text-wrap: balance;
  }

  .rt-panel :global(.rt-tabs) {
    width: auto;
    margin: 13px var(--in-tabs) 0;
  }
  .rt-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 18px var(--in-list) 0;
    padding: 10px 14px;
    border-radius: var(--r-lg);
    background: var(--surface-track);
    color: var(--text);
    font-size: var(--fs-body-sm);
    line-height: 1.4;
  }
  .rt-note :global(.icon) {
    flex: none;
    margin-top: 1px;
    color: var(--terracotta-500);
  }

  .rt-body {
    display: flex;
    flex-direction: column;
  }
  .rt-body > :global(.rt-card) {
    margin: 10px var(--in-card) 0;
  }

  .rt-list {
    margin: 19px var(--in-list) 0;
  }
  .rt-list :global(.rt-list__head) {
    padding-left: 4px;
  }
  /* The mockup's tight pair: a 24px title line over an 18px meta line. */
  .rt-list :global(.ev-sechead__title) {
    line-height: 24px;
  }
  .rt-list :global(.ev-sechead__sub) {
    margin-top: 0;
    line-height: 18px;
  }
  .rt-list__hint {
    margin: 8px 0 0 4px;
    color: var(--text-secondary);
    font-size: var(--fs-body-sm);
  }
  .rt-list__rows {
    display: grid;
    gap: 6px;
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }
  .rt-list__group {
    margin: 16px 0 0 4px;
    color: var(--text-secondary);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    line-height: 1.4;
  }
  .rt-body > :global(.rt-why) {
    margin: 16px var(--in-list) 0;
  }

  .rt-emptycard {
    margin: 16px var(--in-list) 0;
    border-radius: var(--r-lg);
    background: var(--surface-card);
    box-shadow: inset 0 0 0 1px var(--card-rim);
  }

  .rt-loading {
    margin: 20px var(--in-card) 0;
    height: 300px;
    border-radius: var(--r-xl);
    background: linear-gradient(90deg, #5a382d, #483642);
    overflow: hidden;
  }
  .rt-loading__bar {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 228, 222, 0.08), transparent);
    animation: rt-sheen 1.6s var(--ease-in-out) infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .rt-loading__bar {
      animation: none;
    }
  }
  @keyframes rt-sheen {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(100%);
    }
  }

  .rt-foot {
    display: grid;
    justify-items: center;
    gap: 6px;
    margin: 14px var(--in-list) 0;
    text-align: center;
  }
  /* Body copy, so the body floor (decision 8), not the meta size. */
  .rt-foot__note {
    max-width: 75ch;
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
  }

  .rt-panel > :global(.rt-prod) {
    margin: 32px var(--in-list) 0;
    padding-top: 24px;
    border-top: 1px solid var(--border-subtle);
  }

  /* Room for two columns (a landscape tablet): the card stays in view on the
     left while the list and the why card run beside it. */
  @container routine (min-width: 860px) {
    .rt-body.has-card {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      column-gap: 20px;
      align-items: start;
    }
    .rt-body.has-card > :global(.rt-card) {
      position: sticky;
      top: 16px;
      grid-column: 1;
      grid-row: 1 / span 3;
      margin: 16px 0 0 var(--in-card);
    }
    .rt-body.has-card > .rt-list,
    .rt-body.has-card > :global(.rt-why) {
      grid-column: 2;
      margin-left: 0;
    }
    .rt-body.has-card > .rt-list {
      margin-top: 16px;
    }
  }

  /* Phones: the 16px gutter everywhere, the title a step smaller. */
  @container routine (max-width: 470px) {
    .rt-panel {
      --in-card: 16px;
      --in-list: 16px;
      --in-tabs: 16px;
      padding-top: 16px;
    }
    .rt-head {
      padding: 0 16px;
    }
    .rt-head__sub {
      font-size: var(--fs-label);
      line-height: 21px;
    }
    /* Both notes wrap to two lines here; set flush left, the disclosure's
       icon stays beside its words instead of stranded at the edge. */
    .rt-foot {
      justify-items: start;
      text-align: left;
    }
  }
</style>
