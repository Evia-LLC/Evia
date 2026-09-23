<script lang="ts">
  /**
   * Your own face, with the zones the numbers came from drawn on it.
   *
   * Every other screen in this app reports the scan as figures. This is the one
   * that shows the evidence: the actual capture, the actual rectangles that
   * were sampled, and — when there is more than one stored — the same face at
   * two dates with a wipe between them.
   *
   * The geometry is not stored anywhere and does not need to be. The saved
   * image is the *canonical crop*, in which the face fills the frame by
   * construction, and `subdivide` derives every region as a fixed fraction of
   * that frame. So running it over the photo's own dimensions reproduces
   * exactly the rectangles that were measured, for any scan, forever.
   *
   * Honesty (§33): photo storage is off by default and additionally needs a
   * server-side blob key, so most people will land on the empty state. It says
   * plainly why there is nothing here and what would change that, rather than
   * rendering a broken frame or pretending the feature is unavailable.
   */
  import { onDestroy } from 'svelte';
  import { api } from '@/lib/api.ts';
  import { session } from '@/state/session.svelte.ts';
  import { subdivide } from '@/skin-analysis/roi.ts';
  import { METRIC_REGIONS } from '@/skin-analysis/metrics.ts';
  import {
    FACE_REGIONS,
    METRIC_LABELS,
    SKIN_METRIC_KEYS,
    type FaceRegionKey,
    type SkinAnalysis,
    type ProgressPhoto,
    type SkinMetricKey,
  } from '@shared/types.ts';

  interface Props {
    scans: SkinAnalysis[];
    photos: ProgressPhoto[];
  }
  const { scans, photos }: Props = $props();

  /** Only scans that actually kept a photo can appear here. */
  const withImages = $derived(
    photos.map((photo) => ({ photo, scan: scans.find((s) => s.id === photo.skinScanId) }))
      .filter((v): v is { photo: ProgressPhoto; scan: SkinAnalysis } => Boolean(v.scan)),
  );

  let metric = $state<SkinMetricKey>('hydration');
  /** 0 = fully the earlier capture, 1 = fully the later one. */
  let wipe = $state(1);
  let loading = $state(false);
  let failed = $state(false);

  let afterUrl = $state<string | null>(null);
  let beforeUrl = $state<string | null>(null);
  let loadedFor = $state<string>('');

  const after = $derived(withImages[0] ?? null);
  const before = $derived(withImages.length > 1 ? withImages[withImages.length - 1] : null);

  const lit = $derived(new Set<FaceRegionKey>(METRIC_REGIONS[metric]));

  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

  /** Region rects as percentages, so the overlay scales with the rendered image. */
  const boxes = $derived.by(() => {
    // A unit face box: `subdivide` works in fractions, so the numbers that come
    // back are already the percentages the overlay needs.
    const rects = subdivide({ x: 0, y: 0, width: 100, height: 100, confidence: 1 });
    return FACE_REGIONS.map((key) => ({ key, rect: rects[key] })).filter(
      (r): r is { key: FaceRegionKey; rect: NonNullable<typeof r.rect> } => Boolean(r.rect),
    );
  });

  function release() {
    if (afterUrl) URL.revokeObjectURL(afterUrl);
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    afterUrl = null;
    beforeUrl = null;
  }

  $effect(() => {
    const key = `${after?.photo.id ?? ''}|${before?.photo.id ?? ''}`;
    if (!after?.photo.id || key === loadedFor) return;
    loadedFor = key;
    loading = true;
    failed = false;
    void (async () => {
      release();
      const [a, b] = await Promise.all([
        api.progressPhotoImage(after.photo.id),
        before?.photo.id ? api.progressPhotoImage(before.photo.id) : Promise.resolve(null),
      ]);
      afterUrl = a;
      beforeUrl = b;
      // `hasImage` said there was one and the fetch disagreed — say so rather
      // than showing an empty frame.
      failed = a === null;
      loading = false;
    })();
  });

  onDestroy(release);
</script>

{#if withImages.length === 0}
  <div class="empty">
    <p class="empty__title">No photos kept</p>
    <p class="empty__text">
      {#if session.user?.consents.progress_photos}
        Progress photos are enabled, but none has been affirmatively saved yet.
      {:else}
        Your scans are analysed on this device and only the numbers are saved. Turn on image
        progress photos in Privacy, then choose save on an individual result — this becomes a
        before-and-after of your own face, with the measured zones drawn on it.
      {/if}
    </p>
  </div>
{:else}
  <figure class="atlas">
    <figcaption>
      <span>Where the numbers came from</span>
      <select bind:value={metric} aria-label="Metric to highlight">
        {#each SKIN_METRIC_KEYS as key (key)}
          <option value={key}>{METRIC_LABELS[key]}</option>
        {/each}
      </select>
    </figcaption>

    <div class="atlas__frame">
      {#if loading}
        <p class="atlas__note">Decrypting…</p>
      {:else if failed}
        <p class="atlas__note">
          That photo could not be read back. It may have been shredded, or the server's storage
          key has changed since it was written.
        </p>
      {:else if afterUrl}
        {#if beforeUrl}
          <img class="atlas__img" src={beforeUrl} alt="Earlier capture" />
          <div class="atlas__reveal" style="clip-path: inset(0 0 0 {wipe * 100}%)">
            <img class="atlas__img" src={afterUrl} alt="Most recent capture" />
          </div>
        {:else}
          <img class="atlas__img" src={afterUrl} alt="Most recent capture" />
        {/if}

        <!-- The measured rectangles, over the top. -->
        <svg class="atlas__zones" viewBox="0 0 100 100" preserveAspectRatio="none">
          {#each boxes as box (box.key)}
            <rect
              class="zone"
              class:zone--lit={lit.has(box.key)}
              x={box.rect.x}
              y={box.rect.y}
              width={box.rect.width}
              height={box.rect.height}
              rx="1.5"
            />
          {/each}
        </svg>
      {/if}
    </div>

    {#if beforeUrl && before && after}
      <label class="atlas__wipe">
        <input type="range" min="0" max="1" step="0.001" bind:value={wipe} />
        <span class="atlas__dates">
          <span>{dateFormat.format(new Date(before.photo.capturedAt))}</span>
          <span>{dateFormat.format(new Date(after.photo.capturedAt))}</span>
        </span>
      </label>
    {/if}

    <p class="atlas__caveat">
      Lit zones are the ones {METRIC_LABELS[metric].toLowerCase()} is measured from. Captures are
      normalised for lighting before measurement, so two photos can look different and still
      compare fairly — and can look similar while the numbers moved.
    </p>
  </figure>
{/if}

<style>
  .atlas {
    margin: 0 0 var(--s-5);
  }

  figcaption {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-2);
    margin-bottom: var(--s-2);
    font-size: var(--t-xs);
    font-weight: var(--w-medium);
    letter-spacing: var(--trk-cap);
    text-transform: uppercase;
    color: var(--quiet);
  }

  figcaption select {
    flex: none;
    min-height: 36px;
    padding: 0 var(--s-6) 0 var(--s-3);
    border-radius: var(--radius);
    border: var(--hair) solid var(--line-strong);
    background: var(--surface-raised);
    color: var(--ink);
    font: inherit;
    font-size: var(--t-md);
    letter-spacing: 0;
    text-transform: none;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238b94a9' stroke-width='1'/></svg>");
    background-repeat: no-repeat;
    background-position: right var(--s-3) center;
  }

  .atlas__frame {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius);
    overflow: hidden;
    background: rgba(0, 0, 0, 0.35);
    border: var(--hair) solid var(--line-strong);
  }

  .atlas__img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .atlas__reveal {
    position: absolute;
    inset: 0;
  }

  .atlas__zones {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .zone {
    fill: none;
    stroke: rgba(255, 255, 255, 0.16);
    stroke-width: 0.4;
  }

  /* The lit zones carry a fill as well as a brighter edge. An outline alone
     disappears against a face; the point is to be able to see at a glance which
     parts of you a number is about. This is the one DOM element that must match
     a hologram, so it is one of only two chrome rules that read --holo-scene. */
  .zone--lit {
    fill: rgba(var(--holo-scene-rgb), 0.14);
    stroke: var(--holo-scene);
    stroke-width: 0.7;
  }

  .atlas__note {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    padding: var(--s-4);
    text-align: center;
    font-size: var(--t-md);
    line-height: var(--lh-body);
    color: var(--quiet);
  }

  .atlas__wipe {
    display: block;
    margin-top: var(--s-2);
  }

  .atlas__wipe input {
    width: 100%;
  }

  .atlas__dates {
    display: flex;
    justify-content: space-between;
    font-family: var(--font);
    font-size: var(--t-sm);
    color: var(--quiet);
    font-feature-settings: var(--num);
  }

  .atlas__caveat {
    margin: var(--s-2) 0 0;
    max-width: var(--measure);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--quiet);
  }
</style>
