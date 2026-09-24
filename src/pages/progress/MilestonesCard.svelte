<!--
  Milestones (progress.md 2.15). Real mode only claims what the scan history
  shows - scans completed, how long they span - and the next scan-count
  milestone at its real fraction. No routine streaks or score claims: there is
  no adherence data and no score. The in-progress arc is static at its true
  fraction (SRS: never a fake timer).
-->
<script lang="ts">
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import Icon from '@/ui/Icon.svelte';
  import type { MilestonesView } from '@/view/progress.ts';

  interface Props {
    view: MilestonesView;
    onmore?: () => void;
    class?: string;
  }

  const { view, onmore, class: className = '' }: Props = $props();
  const id = $props.id();

  const R = 8.5;
  const C = 2 * Math.PI * R;
</script>

<Card as="section" padding="none" class="pg-card pg-miles {className}" aria-labelledby="{id}-title">
  <div class="pg-miles__inner">
    <SectionHeader title="Milestones" icon="star" iconStyle="coral" id="{id}-title">
      {#snippet action()}
        {#if view.subtitle}<span class="pg-miles__sub">{view.subtitle}</span>{/if}
        {#if onmore}
          <button type="button" class="pg-miles__more" aria-label="See all scans" onclick={onmore}>
            <Icon name="chevron-right" size={18} stroke={1.6} />
          </button>
        {/if}
      {/snippet}
    </SectionHeader>
    <ul class="pg-miles__list">
      {#each view.items as item (item.label)}
        <li class="pg-mile" data-state={item.state}>
          {#if item.state === 'done'}
            <span class="pg-mile__done" aria-hidden="true"><Icon name="check" size={13} stroke={2.6} /></span>
          {:else}
            <svg class="pg-mile__arc" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <circle cx="11" cy="11" r={R} class="pg-mile__track" />
              <circle
                cx="11"
                cy="11"
                r={R}
                class="pg-mile__fill"
                stroke-dasharray="{C * (item.fraction ?? 0)} {C}"
                transform="rotate(-90 11 11)"
              />
            </svg>
          {/if}
          <span class="pg-mile__text">{item.label}</span>
          <span class="visually-hidden">{item.state === 'done' ? ', done' : `, ${Math.round((item.fraction ?? 0) * 100)}% of the way`}</span>
        </li>
      {/each}
    </ul>
  </div>
</Card>

<style>
  .pg-miles__inner {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    padding: 9px 20px 22px 19px;
  }
  /* The subtitle sits inline after the title, as in the mockup. */
  .pg-miles__inner :global(.ev-sechead__action) {
    flex: 1;
    justify-content: space-between;
    min-width: 0;
  }
  .pg-miles__inner :global(.ev-sechead__text) {
    flex: 0 1 auto;
  }
  .pg-miles__sub {
    font-size: var(--fs-body);
    color: var(--text-secondary);
    margin-left: 4px;
  }
  .pg-miles__more {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin: -8px -14px -8px auto;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .pg-miles__more:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: -4px;
  }
  @media (hover: hover) {
    .pg-miles__more:hover {
      background: var(--tint-hover);
    }
  }

  .pg-miles__list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 11px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pg-mile {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 41px;
    padding: 5px 14px 5px 16px;
    border: 1px solid rgba(190, 150, 140, 0.3);
    border-radius: var(--r-pill);
    background: var(--cream-50);
  }
  .pg-mile__done {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: none;
    border-radius: 50%;
    background: #3e8a5b;
    color: #fff;
  }
  .pg-mile__arc {
    flex: none;
    margin: -1px;
  }
  .pg-mile__track {
    fill: none;
    stroke: var(--rose-100);
    stroke-width: 2.5;
  }
  .pg-mile__fill {
    fill: none;
    stroke: var(--rose-700);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  .pg-mile__text {
    font-size: var(--fs-body-sm);
    line-height: 1.3;
    color: var(--text);
  }

  @container card (max-width: 420px) {
    .pg-miles__list {
      grid-template-columns: minmax(0, 1fr);
    }
    .pg-miles__inner :global(.ev-sechead) {
      flex-wrap: wrap;
      row-gap: 0;
    }
    .pg-miles__inner :global(.ev-sechead__action) {
      flex: 1 0 100%;
      margin-top: -10px;
      padding-left: 50px;
    }
  }
</style>
