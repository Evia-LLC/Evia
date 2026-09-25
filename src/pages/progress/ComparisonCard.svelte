<!--
  Skin comparison (progress.md 2.10; BUILD-PLAN decision 10).

  Three honest variants in one frame:
   - photos: the wipe between two progress photos (sample: texture tiles).
     Only for someone who opted in to progress photos and saved some.
   - readings: most people never keep photos, so the same slot compares the
     first scan in the range with the latest (or the scan chosen under Recent
     scans, labelled as chosen) metric by metric, with the noise floor
     deciding what counts as a change and each metric marked with which way
     is better. An unobtrusive line invites turning photos on in Privacy.
   - empty: fewer than two scans to compare, said plainly.
-->
<script lang="ts">
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import IconButton from '@/ui/IconButton.svelte';
  import Badge from '@/ui/Badge.svelte';
  import Button from '@/ui/Button.svelte';
  import EmptyState from '@/ui/EmptyState.svelte';
  import Icon from '@/ui/Icon.svelte';
  import CompareFaces from '@/history/CompareFaces.svelte';
  import { link } from '@/router/router.svelte.ts';
  import { tapSize } from './tap.svelte.ts';
  import type { ComparisonView, ReadingChange } from '@/view/progress.ts';

  interface Props {
    view: ComparisonView;
    onwiderange?: () => void;
    class?: string;
  }

  const { view, onwiderange, class: className = '' }: Props = $props();
  const id = $props.id();

  let dialog: HTMLDialogElement | undefined = $state();
  let expanded = $state(false);

  const subtitle = $derived(
    view.kind === 'photos'
      ? view.sample
        ? 'Visible progress from your scans'
        : view.latest
          ? 'Your progress photos, first and latest in this range'
          : 'Your progress photos: the first in this range and the one you chose'
      : view.kind === 'readings'
        ? view.latest
          ? 'Your readings, first and latest scan in this range'
          : 'Your readings: the first scan in this range and the one you chose'
        : 'Your first and latest readings, side by side',
  );

  function open() {
    expanded = true;
    dialog?.showModal();
  }
  function close() {
    dialog?.close();
  }

  function outcomeText(row: ReadingChange): string {
    if (row.outcome === 'improved') return 'Improved';
    if (row.outcome === 'worse') return 'Wrong way';
    return 'Steady';
  }
  function deltaText(row: ReadingChange): string {
    const n = Math.round(Math.abs(row.delta));
    if (row.outcome === 'steady') return `within ±${row.noiseFloor}`;
    return `${row.delta < 0 ? '−' : '+'}${n} pt${n === 1 ? '' : 's'}`;
  }
</script>

<Card as="section" padding="none" class="pg-card pg-cmp {className}" aria-labelledby="{id}-title">
  <div class="pg-cmp__inner">
    <SectionHeader title="Skin comparison" {subtitle} icon="sparkle" iconStyle="bare" id="{id}-title" size="md">
      {#snippet action()}
        {#if view.kind === 'photos'}
          <IconButton icon="expand" label="Open the comparison full screen" variant="soft" size={tapSize()} onclick={open} />
        {/if}
      {/snippet}
    </SectionHeader>

    {#if view.kind === 'photos'}
      <div class="pg-cmp__frame">
        <CompareFaces before={view.before} after={view.after} sample={view.sample} />
      </div>
      {#if view.caption}
        <p class="pg-cmp__caption">
          {view.caption}
          {#if view.attribution}<span class="pg-cmp__by">{view.attribution}</span>{/if}
        </p>
      {/if}
      {#if !view.sample}
        <p class="pg-cmp__note">Original photos, not aligned: pose, distance and light can differ between them.</p>
      {/if}
    {:else if view.kind === 'readings'}
      <div class="pg-cmp__frame pg-cmp__frame--readings">
        <div class="pg-cmp__dates">
          <Badge variant="dark"><span>First</span>&nbsp;<time datetime={view.from.iso}>{view.from.long}</time></Badge>
          <span class="pg-cmp__arrow" aria-hidden="true"><Icon name="arrow-right" size={18} /></span>
          <Badge variant="blush">
            <span>{view.latest ? 'Latest' : 'Chosen'}</span>&nbsp;<time datetime={view.to.iso}>{view.to.long}</time>
          </Badge>
        </div>
        <p class="pg-cmp__legend">
          <span class="pg-cmp__key" data-dir="higher">
            <Icon name="chevron-up" size={16} stroke={2} />Higher is better: hydration, tone evenness
          </span>
          <span class="pg-cmp__key" data-dir="lower">
            <Icon name="chevron-down" size={16} stroke={2} />Lower is better: the other seven
          </span>
        </p>
        <ul class="pg-cmp__grid" aria-label="Each reading, first scan to latest">
          {#each view.rows as row (row.key)}
            <li class="pg-read" data-outcome={row.outcome}>
              <span class="pg-read__label">
                {row.label}<span class="pg-read__dir" data-dir={row.higherIsBetter ? 'higher' : 'lower'} aria-hidden="true"
                  ><Icon name={row.higherIsBetter ? 'chevron-up' : 'chevron-down'} size={14} stroke={2.2} /></span
                >
              </span>
              <span class="pg-read__values t-num" aria-hidden="true">
                {Math.round(row.from)}<span class="pg-read__to"> → </span>{Math.round(row.to)}
              </span>
              <span class="pg-read__chip" aria-hidden="true">
                <span class="pg-read__dot"></span>
                {outcomeText(row)} <span class="pg-read__delta t-num">{deltaText(row)}</span>
              </span>
              <span class="visually-hidden">
                from {Math.round(row.from)} to {Math.round(row.to)}, {row.higherIsBetter ? 'higher' : 'lower'} is better:
                {row.outcome === 'improved'
                  ? `improved by ${Math.round(Math.abs(row.delta))} points`
                  : row.outcome === 'worse'
                    ? `moved the wrong way by ${Math.round(Math.abs(row.delta))} points`
                    : `steady, within the ${row.noiseFloor}-point measurement noise`}
              </span>
            </li>
          {/each}
        </ul>
      </div>
      <p class="pg-cmp__caption">{view.caption}</p>
    {:else}
      <div class="pg-cmp__frame pg-cmp__frame--empty">
        <EmptyState title={view.title} body={view.body} icon="sparkle" level={3}>
          {#snippet action()}
            {#if view.cta === 'scan'}
              <Button variant="primary" href="/scan" iconStart="camera">Take a scan</Button>
            {:else if view.cta === 'range' && onwiderange}
              <Button variant="secondary" size={tapSize()} onclick={onwiderange}>Show all time</Button>
            {/if}
          {/snippet}
        </EmptyState>
      </div>
    {/if}

    {#if view.kind !== 'photos' && view.invite}
      <p class="pg-cmp__invite">
        <Icon name="camera" size={18} />
        <span>{view.invite.text} <a href={view.invite.href} use:link>{view.invite.action}</a></span>
      </p>
    {/if}
  </div>
</Card>

{#if view.kind === 'photos'}
  <dialog
    bind:this={dialog}
    class="pg-cmp-dialog"
    aria-label="Skin comparison"
    onclose={() => (expanded = false)}
    onclick={(event) => {
      if (event.target === dialog) close();
    }}
  >
    {#if expanded}
      <div class="pg-cmp-dialog__body">
        <div class="pg-cmp-dialog__bar">
          <h2 class="pg-cmp-dialog__title">Skin comparison</h2>
          <IconButton icon="x" label="Close" variant="soft" onclick={close} />
        </div>
        <div class="pg-cmp-dialog__frame">
          <CompareFaces before={view.before} after={view.after} sample={view.sample} />
        </div>
      </div>
    {/if}
  </dialog>
{/if}

<style>
  .pg-cmp__inner {
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: 100%;
    padding: 18px 14px 16px 15px;
  }
  .pg-cmp__inner :global(.ev-sechead) {
    padding: 0 6px 0 7px;
  }

  .pg-cmp__frame {
    position: relative;
    flex: 1 1 auto;
    min-height: 280px;
    border-radius: var(--r-lg);
  }
  .pg-cmp__frame--readings {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    background: var(--blush-100);
    border: 1px solid var(--card-rim);
  }
  .pg-cmp__frame--empty {
    display: grid;
    place-items: center;
    min-height: 240px;
    background: var(--blush-100);
    border: 1px dashed var(--border);
  }

  .pg-cmp__dates {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pg-cmp__arrow {
    display: inline-flex;
    color: var(--text-muted);
  }

  .pg-cmp__grid {
    display: grid;
    /* Nine readings: three by three, or two across on a narrow card. */
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
    flex: 1;
    align-content: start;
  }
  /* The direction key: the one thing that makes seven of the nine numbers
     read the right way round, so it is body-size text, not a footnote. */
  .pg-cmp__legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin: -2px 0 0;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    line-height: 1.35;
    color: var(--text-strong);
  }
  .pg-cmp__key {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .pg-cmp__key[data-dir='higher'] :global(svg),
  .pg-read__dir[data-dir='higher'] {
    color: var(--sage-700);
  }
  .pg-cmp__key[data-dir='lower'] :global(svg),
  .pg-read__dir[data-dir='lower'] {
    color: var(--terracotta-500);
  }
  .pg-read__dir {
    display: inline-flex;
    vertical-align: -2px;
    margin-left: 3px;
  }
  .pg-read {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 4px 8px;
    padding: 9px 12px 10px;
    border-radius: var(--r-md);
    background: var(--cream-0);
    border: 1px solid var(--card-rim);
  }
  .pg-read__label {
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    line-height: 1.25;
    color: var(--text-strong);
  }
  .pg-read__values {
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-semibold);
    color: var(--text-strong);
    white-space: nowrap;
  }
  .pg-read__to {
    color: var(--text-muted);
    font-weight: var(--fw-regular);
  }
  .pg-read__chip {
    grid-column: 1 / -1;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    font-size: var(--fs-meta);
    font-weight: var(--fw-medium);
    line-height: 1.3;
    color: var(--text-secondary);
  }
  .pg-read__delta {
    font-weight: var(--fw-regular);
  }
  .pg-read__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--bar-track);
    box-shadow: inset 0 0 0 1px var(--border);
    flex: none;
  }
  .pg-read[data-outcome='improved'] .pg-read__chip {
    color: var(--text-success);
  }
  .pg-read[data-outcome='improved'] .pg-read__dot {
    background: var(--sage-600);
    box-shadow: none;
  }
  .pg-read[data-outcome='worse'] .pg-read__chip {
    color: var(--text-danger);
  }
  .pg-read[data-outcome='worse'] .pg-read__dot {
    background: var(--rose-700);
    box-shadow: none;
  }

  .pg-cmp__caption {
    margin: -2px 7px 0;
    max-width: var(--measure);
    font-size: var(--fs-body-sm);
    line-height: 1.4;
    color: var(--text);
  }
  .pg-cmp__by {
    display: block;
    margin-top: 2px;
  }
  .pg-cmp__note {
    margin: -8px 7px 0;
    font-size: var(--fs-meta);
    color: var(--text-muted);
  }

  .pg-cmp__invite {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: start;
    gap: 8px;
    margin: -4px 7px 0;
    font-size: var(--fs-body-sm);
    line-height: 1.4;
    color: var(--text-secondary);
  }
  .pg-cmp__invite :global(svg) {
    margin-top: 1px;
    color: var(--rose-icon);
  }
  /* Inline in the sentence; the padding makes a 44px-tall target without
     moving the text. */
  .pg-cmp__invite a {
    display: inline-block;
    padding: 12px 0;
    margin: -12px 0;
    white-space: nowrap;
    color: var(--text-link);
    font-weight: var(--fw-medium);
    text-underline-offset: 3px;
  }
  .pg-cmp__invite a:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
    border-radius: 4px;
  }

  @container card (max-width: 520px) {
    .pg-cmp__grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .pg-cmp__frame--readings {
      padding: 12px;
    }
    .pg-cmp__dates {
      justify-content: flex-start;
    }
    .pg-cmp__arrow {
      display: none;
    }
    .pg-read {
      padding: 9px 10px 10px;
    }
  }
  /* On a phone a two-across cell is too narrow for a label and its numbers
     side by side ("Under-eye" would break mid-word), so they stack. */
  @container card (max-width: 420px) {
    .pg-read {
      grid-template-columns: minmax(0, 1fr);
      gap: 2px;
    }
    .pg-read__chip {
      margin-top: 2px;
    }
  }

  .pg-cmp-dialog {
    width: min(1100px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    padding: 0;
    border: 0;
    border-radius: var(--r-xl);
    background: var(--surface-card);
    box-shadow: var(--shadow-lg);
  }
  .pg-cmp-dialog::backdrop {
    background: var(--scrim);
  }
  .pg-cmp-dialog__body {
    display: grid;
    gap: 12px;
    padding: 16px;
  }
  .pg-cmp-dialog__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .pg-cmp-dialog__title {
    margin: 0;
    font-size: var(--fs-title-sm);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .pg-cmp-dialog__frame {
    height: min(70dvh, 640px);
  }
</style>
