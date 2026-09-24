<!--
  Every scan ("View all"), and every kept progress photo, each deletable on
  its own - a person who wants one reading or one photo gone should not have
  to delete their account to manage it. Deleting asks once more first, then
  goes through the API and the controller's refresh, as before.

  Guests' scans live in the tab's memory and sample scans are not anyone's,
  so neither offers a delete.
-->
<script lang="ts">
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import Button from '@/ui/Button.svelte';
  import { api } from '@/lib/api.ts';
  import { refreshScans } from '@/state/controller.ts';
  import { session } from '@/state/session.svelte.ts';
  import type { RecentScan } from '@/view/progress.ts';
  import { tapSize } from './tap.svelte.ts';

  interface Props {
    /** Sample mode: the sample's scans, read-only. */
    sampleItems?: RecentScan[] | null;
    onclose?: () => void;
  }

  const { sampleItems = null, onclose }: Props = $props();
  const id = $props.id();

  let confirming = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  const long = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const canDelete = $derived(!sampleItems && !session.guest);

  async function removeScan(scanId: string) {
    busy = scanId;
    error = null;
    try {
      await api.deleteScan(scanId);
      await refreshScans();
      confirming = null;
    } catch {
      error = 'That scan could not be deleted. Try again in a moment.';
    } finally {
      busy = null;
    }
  }

  async function removePhoto(photoId: string) {
    busy = photoId;
    error = null;
    try {
      await api.deleteProgressPhoto(photoId);
      session.progressPhotos = session.progressPhotos.filter((photo) => photo.id !== photoId);
      confirming = null;
    } catch {
      error = 'That photo could not be deleted. Try again in a moment.';
    } finally {
      busy = null;
    }
  }
</script>

<Card as="section" padding="none" class="pg-card pg-history" aria-labelledby="{id}-title" id="all-scans" tabindex={-1}>
  <div class="pg-history__inner">
    <SectionHeader
      title="All scans"
      subtitle={sampleItems ? 'Sample data' : `${session.scans.length} kept${session.guest ? ' in this tab only' : ''}`}
      icon="calendar"
      iconStyle="coral"
      id="{id}-title"
    >
      {#snippet action()}
        {#if onclose}<Button variant="ghost" size={tapSize()} onclick={onclose}>Close</Button>{/if}
      {/snippet}
    </SectionHeader>

    {#if error}<p class="pg-history__error" role="alert">{error}</p>{/if}

    <ul class="pg-history__list">
      {#if sampleItems}
        {#each sampleItems as item (item.id)}
          <li class="pg-hrow">
            <span class="pg-hrow__main">
              <time class="pg-hrow__date" datetime={item.date.iso}>{item.date.long}</time>
              {#if item.score}<span class="pg-hrow__meta">Score: {item.score.value}</span>{/if}
            </span>
          </li>
        {/each}
      {:else}
        {#each session.scans as scan (scan.id ?? scan.capturedAt)}
          {@const photo = session.progressPhotos.find((p) => p.skinScanId === scan.id)}
          <li class="pg-hrow">
            <span class="pg-hrow__main">
              <time class="pg-hrow__date" datetime={scan.capturedAt}>
                {long.format(new Date(scan.capturedAt))}
                <span class="pg-hrow__time">{time.format(new Date(scan.capturedAt))}</span>
              </time>
              <span class="pg-hrow__meta">
                Capture quality {scan.quality.verdict === 'pass' ? 'good' : scan.quality.verdict === 'warn' ? 'fair' : 'poor'}{#if photo}
                  · progress photo saved{/if}
              </span>
            </span>
            {#if canDelete && scan.id}
              {#if confirming === scan.id}
                <span class="pg-hrow__confirm">
                  <span class="pg-hrow__ask">Delete this scan?</span>
                  <Button variant="secondary" size={tapSize()} disabled={busy === scan.id} onclick={() => removeScan(scan.id!)}>
                    Delete
                  </Button>
                  <Button variant="ghost" size={tapSize()} onclick={() => (confirming = null)}>Keep</Button>
                </span>
              {:else}
                <Button variant="ghost" size={tapSize()} label="Delete the scan from {long.format(new Date(scan.capturedAt))}" onclick={() => (confirming = scan.id!)}>
                  Delete
                </Button>
              {/if}
            {/if}
          </li>
        {:else}
          <li class="pg-hrow"><span class="pg-hrow__meta">No scans yet.</span></li>
        {/each}
      {/if}
    </ul>

    {#if !sampleItems && session.progressPhotos.length}
      <h3 class="pg-history__sub">Progress photos</h3>
      <ul class="pg-history__list">
        {#each session.progressPhotos as photo (photo.id)}
          <li class="pg-hrow">
            <span class="pg-hrow__main">
              <time class="pg-hrow__date" datetime={photo.capturedAt}>{long.format(new Date(photo.capturedAt))}</time>
              <span class="pg-hrow__meta">Kept with your consent</span>
            </span>
            {#if canDelete}
              {#if confirming === photo.id}
                <span class="pg-hrow__confirm">
                  <span class="pg-hrow__ask">Delete this photo?</span>
                  <Button variant="secondary" size={tapSize()} disabled={busy === photo.id} onclick={() => removePhoto(photo.id)}>
                    Delete
                  </Button>
                  <Button variant="ghost" size={tapSize()} onclick={() => (confirming = null)}>Keep</Button>
                </span>
              {:else}
                <Button variant="ghost" size={tapSize()} label="Delete the photo from {long.format(new Date(photo.capturedAt))}" onclick={() => (confirming = photo.id)}>
                  Delete photo
                </Button>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</Card>

<style>
  .pg-history__inner {
    display: grid;
    gap: 12px;
    padding: 16px 20px 18px;
  }
  .pg-history__error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: var(--rose-100);
    color: var(--text-danger);
    font-size: var(--fs-body-sm);
  }
  .pg-history__sub {
    margin: 8px 0 0;
    font-size: var(--fs-lead);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .pg-history__list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pg-hrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 16px;
    min-height: 56px;
    padding: 8px 0;
    border-top: 1px solid var(--divider);
  }
  .pg-hrow__main {
    display: grid;
    gap: 2px;
  }
  .pg-hrow__date {
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .pg-hrow__time {
    margin-left: 6px;
    font-weight: var(--fw-regular);
    color: var(--text-muted);
  }
  .pg-hrow__meta {
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
  }
  .pg-hrow__confirm {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .pg-hrow__ask {
    font-size: var(--fs-body-sm);
    color: var(--text);
  }
</style>
