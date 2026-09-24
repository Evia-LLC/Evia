<!--
  The score card slot (progress.md 2.11).

  Sample mode draws the mockup: an 82/100 "Skin health score" ring, a grade
  and five bars. None of that exists for real - there is no composite score
  (SRS section 5, BUILD-PLAN decision 2), and "Clarity" and "Firmness" are not
  measured. So real mode puts the latest scan's nine readings here instead,
  each on its 0-100 scale, split by which way is better: for hydration and
  tone evenness higher is better, for the other seven lower is. The two groups
  are told apart three ways - a heading with an up or down chevron, and a
  green bar for "more is better" against a terracotta one for "less is
  better" - so a long Breakout signs bar never reads like a long Hydration one.
-->
<script lang="ts">
  import Card from '@/ui/Card.svelte';
  import Ring from '@/ui/Ring.svelte';
  import Pill from '@/ui/Pill.svelte';
  import ProgressBar from '@/ui/ProgressBar.svelte';
  import EmptyState from '@/ui/EmptyState.svelte';
  import Button from '@/ui/Button.svelte';
  import Icon from '@/ui/Icon.svelte';
  import type { ScoreView } from '@/view/progress.ts';
  import { tapSize } from './tap.svelte.ts';

  interface Props {
    view: ScoreView;
    class?: string;
  }

  const { view, class: className = '' }: Props = $props();
  const id = $props.id();
  let infoOpen = $state(false);

  const info = $derived(
    view.kind === 'sample-score'
      ? 'Sample data: the design’s example score. Evia does not calculate a single skin score.'
      : 'Each reading is an appearance index from 0 to 100, measured from your scan photo. They are not percentages, and not a health score.',
  );
</script>

<Card as="section" padding="none" class="pg-card pg-score {className}" aria-labelledby="{id}-title">
  <div class="pg-score__inner" data-kind={view.kind}>
    <div class="pg-score__head">
      <h2 class="pg-score__title" id="{id}-title">{view.title}</h2>
      <button
        type="button"
        class="pg-score__info"
        aria-label="About these numbers"
        aria-expanded={infoOpen}
        aria-controls="{id}-info"
        onclick={() => (infoOpen = !infoOpen)}
      >
        <Icon name="info" size={18} stroke={1.4} />
      </button>
      {#if view.kind === 'sample-score'}
        <p class="pg-score__delta"><strong class="t-num">{view.delta}</strong> {view.since}</p>
      {:else if view.kind === 'readings'}
        <p class="pg-score__delta pg-score__delta--muted">Each out of 100</p>
      {/if}
    </div>
    {#if infoOpen}
      <p class="pg-score__infotext" id="{id}-info">{info}</p>
    {/if}

    {#if view.kind === 'sample-score'}
      <div class="pg-score__body">
        <div class="pg-score__ring">
          <Ring value={view.value} max={view.max} size={186} thickness={18} label="{view.value} out of {view.max}, sample">
            <span class="pg-score__value t-num">{view.value}</span>
            <span class="pg-score__of">out of {view.max}</span>
          </Ring>
          <Pill tone="sage" dot shape="soft" class="pg-score__grade">{view.grade}</Pill>
        </div>
        <ul class="pg-score__bars">
          {#each view.bars as bar (bar.label)}
            <li class="pg-bar">
              <span class="pg-bar__label">{bar.label}</span>
              <ProgressBar value={bar.fill * 100} label="{bar.label} {bar.value}" hideLabel />
              <span class="pg-bar__value t-num" aria-hidden="true">{bar.value}</span>
            </li>
          {/each}
        </ul>
      </div>
    {:else if view.kind === 'readings'}
      <div class="pg-score__body pg-score__body--readings">
        <div class="pg-latest">
          <span class="pg-latest__eyebrow t-eyebrow">Latest scan</span>
          <time class="pg-latest__date" datetime={view.at.iso}>{view.at.short}</time>
          <span class="pg-latest__count">
            {view.scanCount} scan{view.scanCount === 1 ? '' : 's'} in your history
          </span>
          <Button href="/scan" variant="soft" size={tapSize()} iconStart="camera" class="pg-latest__cta">Scan again</Button>
        </div>
        <div class="pg-groups">
          {#each view.groups as group (group.id)}
            <div class="pg-group" data-dir={group.id}>
              <h3 class="pg-group__heading">
                <Icon name={group.id === 'higher' ? 'chevron-up' : 'chevron-down'} size={16} stroke={2.2} />
                {group.heading}
              </h3>
              <ul class="pg-group__rows">
                {#each group.rows as row (row.key)}
                  <li class="pg-row">
                    <span class="pg-row__label">{row.label}</span>
                    <ProgressBar
                      value={row.value}
                      label="{row.label}, {row.value} out of 100, {group.id === 'higher' ? 'higher' : 'lower'} is better"
                      hideLabel
                      size="sm"
                      tone={group.id === 'higher' ? 'sage' : 'rose'}
                      class="pg-row__bar"
                    />
                    <span class="pg-row__value t-num" aria-hidden="true">{row.value}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <EmptyState title={view.emptyTitle} body={view.body} icon="bar-chart" compact>
        {#snippet action()}
          <Button href="/scan" size={tapSize()} iconStart="camera">Take a scan</Button>
        {/snippet}
      </EmptyState>
    {/if}
  </div>
</Card>

<style>
  .pg-score__inner {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 20px 24px 14px 28px;
  }
  .pg-score__head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 8px;
  }
  .pg-score__title {
    margin: 0;
    font-size: var(--fs-title-sm);
    font-weight: var(--fw-medium);
    line-height: var(--lh-snug);
    letter-spacing: var(--tr-title);
    color: var(--text-strong);
  }
  .pg-score__info {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin: -6px 0 -6px -4px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  /* A 44px target around the 32px disc. */
  .pg-score__info::before {
    content: '';
    position: absolute;
    inset: -6px;
    border-radius: 50%;
  }
  .pg-score__info:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 0;
  }
  @media (hover: hover) {
    .pg-score__info:hover {
      background: var(--tint-hover);
    }
  }
  .pg-score__delta {
    margin: 0 0 0 auto;
    align-self: flex-end;
    transform: translateY(18px);
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .pg-score__delta strong {
    margin-right: 8px;
    font-size: var(--fs-lead);
    font-weight: var(--fw-semibold);
    color: var(--text-success);
  }
  .pg-score__delta--muted {
    transform: none;
    align-self: center;
    font-size: var(--fs-body-sm);
  }
  .pg-score__infotext {
    margin: 10px 0 0;
    max-width: 52ch;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: var(--blush-100);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text);
  }

  .pg-score__body {
    flex: 1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    column-gap: 30px;
    margin-top: 12px;
  }
  .pg-score__ring {
    position: relative;
    padding: 6px 0 18px 2px;
    display: grid;
    justify-items: center;
  }
  .pg-score__value {
    font-size: 50px;
    font-weight: var(--fw-semibold);
    line-height: 1;
    letter-spacing: -0.01em;
    color: var(--text-strong);
  }
  .pg-score__of {
    margin-top: 8px;
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .pg-score__ring :global(.pg-score__grade) {
    position: absolute;
    bottom: 1px;
    left: 50%;
    transform: translateX(-50%);
    min-height: 41px;
    padding: 0 22px;
    font-size: var(--fs-lead);
  }

  .pg-score__bars {
    display: grid;
    gap: 7px;
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
  }
  .pg-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 36px;
    align-items: center;
    column-gap: 16px;
    row-gap: 4px;
  }
  .pg-bar__label {
    grid-column: 1 / -1;
    font-size: var(--fs-body-sm);
    line-height: 16px;
    color: var(--text);
  }
  .pg-bar__value {
    line-height: 14px;
    text-align: right;
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }

  /* Real: the latest scan's nine readings. */
  .pg-score__body--readings {
    grid-template-columns: 150px minmax(0, 1fr);
    column-gap: 24px;
    margin-top: 14px;
  }
  .pg-latest {
    display: grid;
    justify-items: start;
    align-content: start;
    gap: 4px;
    padding: 16px;
    border-radius: var(--r-lg);
    background: var(--blush-100);
    border: 1px solid var(--card-rim);
  }
  .pg-latest__eyebrow {
    color: var(--text-secondary);
  }
  .pg-latest__date {
    font-family: var(--font-serif);
    font-size: var(--fs-h2);
    line-height: 1.1;
    letter-spacing: var(--tr-display);
    color: var(--text-strong);
  }
  .pg-latest__count {
    font-size: var(--fs-body-sm);
    line-height: 1.35;
    color: var(--text-secondary);
  }
  .pg-latest :global(.pg-latest__cta) {
    margin-top: 10px;
  }
  .pg-groups {
    display: grid;
    gap: 12px;
  }
  .pg-group__heading {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0 0 6px;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-semibold);
    line-height: 1.3;
    color: var(--text-strong);
  }
  .pg-group[data-dir='higher'] .pg-group__heading :global(svg) {
    color: var(--sage-700);
  }
  .pg-group[data-dir='lower'] .pg-group__heading :global(svg) {
    color: var(--terracotta-500);
  }
  /* Less is better: a warm terracotta bar instead of the brand pink. */
  .pg-group[data-dir='lower'] :global(.pg-row__bar .ev-bar__fill) {
    background: linear-gradient(90deg, var(--terracotta-400), var(--terracotta-500));
  }
  .pg-group__rows {
    display: grid;
    gap: 7px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pg-row {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr) 28px;
    align-items: center;
    column-gap: 12px;
  }
  .pg-row__label {
    font-size: var(--fs-body-sm);
    line-height: 1.25;
    color: var(--text);
  }
  .pg-row__value {
    text-align: right;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-semibold);
    color: var(--text-strong);
  }

  /* Narrow cards (the phone, or a crowded two-column tablet) stack. */
  @container card (max-width: 540px) {
    .pg-score__body--readings {
      grid-template-columns: minmax(0, 1fr);
      row-gap: 16px;
    }
    .pg-latest {
      grid-template-columns: auto 1fr;
      align-items: baseline;
      column-gap: 12px;
    }
    .pg-latest__eyebrow {
      grid-column: 1 / -1;
    }
    .pg-latest :global(.pg-latest__cta) {
      grid-column: 1 / -1;
    }
  }
  @container card (max-width: 440px) {
    .pg-score__inner {
      padding: 18px;
    }
    .pg-score__body {
      grid-template-columns: minmax(0, 1fr);
      justify-items: stretch;
    }
    .pg-score__ring {
      justify-self: center;
    }
    .pg-score__delta {
      transform: none;
      align-self: center;
    }
    .pg-row {
      grid-template-columns: 104px minmax(0, 1fr) 28px;
    }
  }
</style>
