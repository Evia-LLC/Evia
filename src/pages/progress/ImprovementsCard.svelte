<!--
  Key improvements (progress.md 2.12).

  Real mode: up to four readings that improved past their noise floor between
  the first scan in the range and the latest (or the scan chosen under Recent
  scans, when the meta then names both dates), in points (not percent),
  biggest first. For a lower-is-better reading the good news is a falling number, so
  "-6 pts" under Redness is green and says "lower is better" beneath it.
  Nothing that stayed inside measurement noise is called an improvement.
-->
<script lang="ts">
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import type { ImprovementsView } from '@/view/progress.ts';

  interface Props {
    view: ImprovementsView;
    class?: string;
  }

  const { view, class: className = '' }: Props = $props();
  const id = $props.id();
</script>

<Card as="section" padding="none" class="pg-card pg-ki {className}" aria-labelledby="{id}-title">
  <div class="pg-ki__inner">
    <SectionHeader title="Key improvements" icon="arrow-up-right" iconStyle="rose" id="{id}-title" size="lg">
      {#snippet action()}
        {#if view.meta}<span class="pg-ki__meta">{view.meta}</span>{/if}
      {/snippet}
    </SectionHeader>
    <div class="pg-ki__rule" aria-hidden="true"></div>
    {#if view.items.length}
      <ul class="pg-ki__list">
        {#each view.items as item (item.key)}
          <li class="pg-ki__item">
            <span class="pg-ki__value t-num" aria-hidden="true">{item.value}</span>
            <span class="pg-ki__label" aria-hidden="true">{item.label}</span>
            {#if item.hint}<span class="pg-ki__hint" aria-hidden="true">{item.hint}</span>{/if}
            <span class="visually-hidden">{item.spoken}</span>
          </li>
        {/each}
      </ul>
    {:else if view.empty}
      <div class="pg-ki__empty">
        <p class="pg-ki__empty-title">{view.empty.title}</p>
        <p class="pg-ki__empty-body">{view.empty.body}</p>
      </div>
    {/if}
  </div>
</Card>

<style>
  .pg-ki__inner {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 8px 18px 14px 17px;
  }
  .pg-ki__inner :global(.ev-sechead__title) {
    white-space: nowrap;
  }
  .pg-ki__meta {
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
    text-align: right;
  }
  .pg-ki__rule {
    height: 1px;
    margin: 8px 1px 0;
    background: var(--divider);
  }
  .pg-ki__list {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    align-items: center;
    margin: 0;
    padding: 12px 0 0;
    list-style: none;
  }
  .pg-ki__item {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 4px;
    min-height: 62px;
    padding: 0 6px;
    text-align: center;
  }
  .pg-ki__item + .pg-ki__item {
    border-left: 1px solid var(--divider);
  }
  .pg-ki__value {
    font-size: 23px;
    font-weight: var(--fw-semibold);
    line-height: 1.1;
    color: var(--text-success);
    white-space: nowrap;
  }
  .pg-ki__label {
    font-size: var(--fs-body-sm);
    line-height: 1.25;
    color: var(--text-secondary);
  }
  .pg-ki__hint {
    margin-top: -2px;
    font-size: var(--fs-body-sm);
    line-height: 1.2;
    color: var(--text-secondary);
  }
  .pg-ki__empty {
    flex: 1;
    display: grid;
    align-content: center;
    gap: 4px;
    padding: 12px 4px 4px;
  }
  .pg-ki__empty-title {
    margin: 0;
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .pg-ki__empty-body {
    margin: 0;
    max-width: 60ch;
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-secondary);
  }

  @container card (max-width: 520px) {
    .pg-ki__inner :global(.ev-sechead) {
      flex-wrap: wrap;
      row-gap: 0;
    }
    .pg-ki__inner :global(.ev-sechead__action) {
      width: 100%;
      margin-top: -6px;
      padding-left: 54px;
    }
  }
  @container card (max-width: 460px) {
    .pg-ki__list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      row-gap: 12px;
    }
    .pg-ki__item:nth-child(3) {
      border-left: 0;
    }
  }
</style>
