<!--
  Progress timeline (progress.md 2.13): one reading over time, picked from the
  dropdown. Real mode offers the nine real readings (never a composite), says
  which way is better for the one shown, and plots only scans from the current
  analysis version.
-->
<script lang="ts">
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import Icon from '@/ui/Icon.svelte';
  import TrendChart from '@/history/TrendChart.svelte';
  import type { TimelineView } from '@/view/progress.ts';

  interface Props {
    view: TimelineView;
    onmetric?: (metric: string) => void;
    class?: string;
  }

  const { view, onmetric, class: className = '' }: Props = $props();
  const id = $props.id();
</script>

<Card as="section" padding="none" class="pg-card pg-time {className}" aria-labelledby="{id}-title">
  <div class="pg-time__inner">
    <SectionHeader title="Progress timeline" subtitle={view.subtitle} icon="calendar" iconStyle="coral" id="{id}-title">
      {#snippet action()}
        <label class="pg-select">
          <span class="visually-hidden">Reading to plot</span>
          <select
            value={view.metric}
            disabled={view.options.length < 2}
            onchange={(event) => onmetric?.((event.currentTarget as HTMLSelectElement).value)}
          >
            {#each view.options as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
          <Icon name="chevron-down" size={16} stroke={1.6} class="pg-select__chev" />
        </label>
      {/snippet}
    </SectionHeader>

    {#if view.direction}
      <p class="pg-time__dir" data-dir={view.direction.startsWith('Higher') ? 'higher' : 'lower'}>
        <Icon name={view.direction.startsWith('Higher') ? 'chevron-up' : 'chevron-down'} size={16} stroke={2.2} />
        <span><strong>{view.metricLabel}: {view.direction.toLowerCase()}</strong>, on a 0 to 100 scale</span>
      </p>
    {/if}

    {#if view.empty}
      <p class="pg-time__empty">{view.empty}</p>
    {:else}
      <TrendChart
        points={view.points}
        domain={view.domain}
        label={view.metricLabel}
        ticks={view.ticks}
        lead={view.lead}
        tail={view.tail}
        tooltip={view.tooltip}
      />
      {#if view.points.length === 1}
        <p class="pg-time__note">One scan in this range. The line starts with the next one.</p>
      {/if}
    {/if}
    {#if view.note}<p class="pg-time__note">{view.note}</p>{/if}
  </div>
</Card>

<style>
  .pg-time__inner {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    padding: 12px 20px 10px 19px;
  }
  .pg-time__inner :global(.ev-sechead__sub) {
    margin-top: 2px;
  }

  .pg-select {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .pg-select select {
    appearance: none;
    -webkit-appearance: none;
    min-width: 162px;
    min-height: 44px;
    padding: 0 36px 0 14px;
    border: 1px solid #e5d9d6;
    border-radius: var(--r-md);
    background: var(--cream-50);
    color: var(--text-strong);
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    cursor: pointer;
  }
  .pg-select select:disabled {
    opacity: 1;
    cursor: default;
  }
  .pg-select select:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .pg-select :global(.pg-select__chev) {
    position: absolute;
    right: 12px;
    color: var(--text-secondary);
    pointer-events: none;
  }

  .pg-time__dir {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 2px 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.35;
    color: var(--text-secondary);
  }
  .pg-time__dir strong {
    font-weight: var(--fw-semibold);
    color: var(--text-strong);
  }
  .pg-time__dir :global(svg) {
    flex: none;
  }
  .pg-time__dir[data-dir='higher'] :global(svg) {
    color: var(--sage-700);
  }
  .pg-time__dir[data-dir='lower'] :global(svg) {
    color: var(--terracotta-500);
  }
  .pg-time__empty {
    flex: 1;
    display: grid;
    place-items: center;
    min-height: 120px;
    margin: 8px 0 0;
    border: 1px dashed var(--border);
    border-radius: var(--r-md);
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
    text-align: center;
    padding: 16px;
  }
  .pg-time__note {
    margin: 0;
    font-size: var(--fs-meta);
    color: var(--text-muted);
  }

  @container card (max-width: 460px) {
    .pg-time__inner :global(.ev-sechead) {
      flex-wrap: wrap;
    }
    .pg-time__inner :global(.ev-sechead__action) {
      width: 100%;
      padding-left: 54px;
    }
  }
</style>
