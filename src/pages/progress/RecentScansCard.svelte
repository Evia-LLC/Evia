<!--
  Recent scans (progress.md 2.14; BUILD-PLAN decision 10).

  The latest four scans in the range. A tile is a progress photo only where
  one was kept (with consent); otherwise it is the scan's date, and under it
  one or two real changes since the scan before - never a per-scan "score"
  (there is none, and capture confidence is not one). Choosing a tile puts it
  on the comparison card; the chosen tile is always one of the two scans the
  card shows (the view model decides). A tile that could not change the card -
  the only scan in the range, an older analysis version, or a scan without a
  photo when photos are compared - is not a button at all.
-->
<script lang="ts">
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import SkinTile from './SkinTile.svelte';
  import PhotoThumb from './PhotoThumb.svelte';
  import type { RecentScansView } from '@/view/progress.ts';

  interface Props {
    view: RecentScansView;
    selected: string | null;
    onselect?: (id: string) => void;
    onviewall?: () => void;
    viewAllOpen?: boolean;
    class?: string;
  }

  const { view, selected, onselect, onviewall, viewAllOpen = false, class: className = '' }: Props = $props();
  const id = $props.id();

  const month = (iso: string) => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(iso));
  const day = (iso: string) => new Date(iso).getDate();
  const weekday = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(iso));
</script>

<Card as="section" padding="none" class="pg-card pg-recent {className}" aria-labelledby="{id}-title">
  <div class="pg-recent__inner">
    <SectionHeader title="Recent scans" icon="heart" iconStyle="coral" id="{id}-title">
      {#snippet action()}
        {#if view.total > 0 && onviewall}
          <button type="button" class="pg-link" aria-expanded={viewAllOpen} onclick={onviewall}>
            View all<span class="visually-hidden"> scans</span>
          </button>
        {/if}
      {/snippet}
    </SectionHeader>

    {#if view.items.length}
      <ul class="pg-recent__list">
        {#each view.items as item (item.id)}
          {@const on = item.selectable && item.id === selected}
          {#snippet tile()}
            <span class="pg-scan__tile" aria-hidden="true">
              {#if item.thumb?.kind === 'sample'}
                <SkinTile texture={item.thumb.texture} />
              {:else if item.thumb?.kind === 'photo'}
                <PhotoThumb photoId={item.thumb.photoId} />
              {:else}
                <span class="pg-scan__cal">
                  <span class="pg-scan__month">{month(item.date.iso)}</span>
                  <span class="pg-scan__day t-num">{day(item.date.iso)}</span>
                  <span class="pg-scan__wk">{weekday(item.date.iso)}</span>
                </span>
              {/if}
            </span>
          {/snippet}
          <li class="pg-scan" class:is-on={on} class:pg-scan--cal={!item.thumb}>
            {#if item.selectable && onselect}
              <button
                type="button"
                class="pg-scan__btn"
                aria-pressed={on}
                aria-label="Scan from {item.date.long}{on ? ', shown in the comparison' : ', show in the comparison'}"
                onclick={() => onselect?.(item.id)}
              >
                {@render tile()}
              </button>
            {:else}
              <span class="pg-scan__btn pg-scan__btn--static">
                {@render tile()}
                {#if !item.thumb}<span class="visually-hidden">Scan from {item.date.long}</span>{/if}
              </span>
            {/if}
            {#if item.thumb}
              <time class="pg-scan__date" datetime={item.date.iso}>{item.date.short}</time>
            {/if}
            {#if item.score}
              <p class="pg-scan__score" data-tone={item.score.tone}>
                <span class="pg-scan__dot" aria-hidden="true"></span>
                Score: <span class="pg-scan__num t-num">{item.score.value}</span>
              </p>
            {/if}
            {#if item.chips.length}
              <ul class="pg-scan__chips">
                {#each item.chips as chip (chip.label)}
                  <li class="pg-chip" data-tone={chip.tone}>
                    <span class="pg-chip__dot" aria-hidden="true"></span>
                    <span aria-hidden="true">{chip.label}</span>
                    <span class="visually-hidden">{chip.spoken}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if view.empty}
      <div class="pg-recent__empty">
        <p class="pg-recent__empty-title">{view.empty.title}</p>
        <p class="pg-recent__empty-body">{view.empty.body}</p>
      </div>
    {/if}
  </div>
</Card>

<style>
  .pg-recent__inner {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    padding: 8px 14px 10px 18px;
  }
  .pg-link {
    min-height: 44px;
    margin: -6px -8px -6px 0;
    padding: 0 8px;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    cursor: pointer;
  }
  .pg-link:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 0;
  }
  @media (hover: hover) {
    .pg-link:hover {
      color: var(--text-strong);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  }

  .pg-recent__list {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pg-scan {
    min-width: 0;
  }
  .pg-scan__btn {
    display: block;
    width: 100%;
    padding: 2px;
    border: 2px solid transparent;
    border-radius: 12px;
    background: transparent;
    cursor: pointer;
    transition:
      border-color var(--dur-base) var(--ease-out),
      transform var(--dur-base) var(--ease-out);
  }
  .pg-scan.is-on .pg-scan__btn {
    border-color: #c76f7a;
  }
  .pg-scan__btn:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 2px;
  }
  .pg-scan__btn--static {
    cursor: default;
  }
  @media (hover: hover) {
    button.pg-scan__btn:hover {
      transform: translateY(-2px);
    }
  }
  .pg-scan__tile {
    display: block;
    width: 100%;
    overflow: hidden;
    aspect-ratio: 126 / 114;
    max-height: 120px;
    border-radius: 9px;
  }

  .pg-scan__cal {
    display: grid;
    place-content: center;
    justify-items: center;
    height: 100%;
    background: linear-gradient(160deg, var(--rose-100), var(--blush-100));
    box-shadow: inset 0 0 0 1px var(--card-rim);
    border-radius: 9px;
    color: var(--text-strong);
  }
  .pg-scan__month {
    font-size: var(--fs-micro);
    font-weight: var(--fw-semibold);
    letter-spacing: var(--tr-micro);
    text-transform: uppercase;
    color: var(--terracotta-600);
  }
  .pg-scan__day {
    font-family: var(--font-serif);
    font-size: 34px;
    line-height: 1.05;
  }
  .pg-scan__wk {
    font-size: var(--fs-meta);
    color: var(--text-secondary);
  }

  .pg-scan__date {
    display: block;
    margin: 4px 0 0 4px;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .pg-scan__score {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0 0 4px;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
  .pg-scan__dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--sage-400);
    flex: none;
  }
  .pg-scan__score[data-tone='fair'] .pg-scan__dot {
    background: var(--amber-500);
  }
  .pg-scan__score[data-tone='good'] .pg-scan__num {
    color: var(--text-success);
  }

  .pg-scan__chips {
    display: grid;
    gap: 4px;
    margin: 6px 0 0 3px;
    padding: 0;
    list-style: none;
  }
  .pg-chip {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: var(--fs-meta);
    line-height: 1.3;
    color: var(--text-secondary);
  }
  .pg-chip__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
    transform: translateY(-1px);
    background: var(--bar-track);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .pg-chip[data-tone='good'] {
    color: var(--text-success);
  }
  .pg-chip[data-tone='good'] .pg-chip__dot {
    background: var(--sage-600);
    box-shadow: none;
  }
  .pg-chip[data-tone='worse'] {
    color: var(--text-danger);
  }
  .pg-chip[data-tone='worse'] .pg-chip__dot {
    background: var(--rose-700);
    box-shadow: none;
  }

  .pg-recent__empty {
    flex: 1;
    display: grid;
    align-content: center;
    gap: 4px;
    padding: 8px 4px;
  }
  .pg-recent__empty-title {
    margin: 0;
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .pg-recent__empty-body {
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
  }

  @container card (max-width: 400px) {
    .pg-recent__list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    /* Two across on a phone: a date needs far less height than a photo. */
    .pg-scan--cal .pg-scan__tile {
      aspect-ratio: auto;
      height: 84px;
    }
    .pg-scan--cal .pg-scan__day {
      font-size: 30px;
    }
  }
</style>
