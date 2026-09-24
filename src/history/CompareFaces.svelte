<script lang="ts">
  /**
   * Before and after, as a wipe.
   *
   * This is an intentionally non-aligned wipe. Facial geometry exists only
   * during the active scan presentation, so historical photos may differ in
   * pose, distance, and framing. The UI says that plainly rather than
   * reconstructing or persisting a face mesh.
   *
   * Real photos come only from the encrypted progress-photo store, for an
   * account that opted in to keeping them (CNS-04); their bytes are fetched
   * through the authenticated image route as object URLs, which this
   * component owns and revokes. In sample mode there are no photos at all:
   * each side is a neutral skin-texture tile (BUILD-PLAN decision 3).
   *
   * The handle is a real range input stretched over the frame, so a drag
   * anywhere, a tap, and the arrow keys all move it, and a screen reader hears
   * "Compare before and after, 50%".
   */
  import { onDestroy } from 'svelte';
  import { api } from '@/lib/api.ts';
  import Badge from '@/ui/Badge.svelte';
  import Icon from '@/ui/Icon.svelte';
  import SkinTile from '@/pages/progress/SkinTile.svelte';
  import type { PhotoSide } from '@/view/progress.ts';

  interface Props {
    before: PhotoSide;
    after: PhotoSide;
    /** Sample placeholders instead of stored photos. */
    sample?: boolean;
    class?: string;
  }

  const { before, after, sample = false, class: className = '' }: Props = $props();

  let position = $state(50);
  let beforeUrl = $state<string | null>(null);
  let afterUrl = $state<string | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  const owned = new Set<string>();

  async function load(id: string): Promise<string | null> {
    const url = await api.progressPhotoImage(id);
    if (url) owned.add(url);
    return url;
  }

  $effect(() => {
    const beforeId = before.photoId;
    const afterId = after.photoId;
    if (sample || !beforeId || !afterId) return;
    let cancelled = false;
    loading = true;
    failed = false;
    void Promise.all([load(beforeId), load(afterId)])
      .then(([b, a]) => {
        if (cancelled) return;
        beforeUrl = b;
        afterUrl = a;
        failed = !b || !a;
      })
      .catch(() => {
        if (!cancelled) failed = true;
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  onDestroy(() => {
    for (const url of owned) URL.revokeObjectURL(url);
  });
</script>

<div class="wipe {className}" style:--p="{position}%">
  <div class="wipe__side wipe__side--before">
    {#if sample}
      <SkinTile texture={before.texture ?? 0.8} label="Before" />
    {:else if beforeUrl}
      <img src={beforeUrl} alt="Progress photo from {before.date.long}" />
    {/if}
  </div>
  <div class="wipe__side wipe__side--after" aria-hidden={sample ? 'true' : undefined}>
    {#if sample}
      <SkinTile texture={after.texture ?? 0.2} label="After" labelAt="end" />
    {:else if afterUrl}
      <img src={afterUrl} alt="Progress photo from {after.date.long}, not aligned with the first" />
    {/if}
  </div>

  <div class="wipe__divider" aria-hidden="true"></div>
  <div class="wipe__handle" aria-hidden="true">
    <Icon name="chevron-left" size={14} stroke={2.2} />
    <Icon name="chevron-right" size={14} stroke={2.2} />
  </div>

  <Badge variant="dark" class="wipe__date wipe__date--before">
    <time datetime={before.date.iso}>{before.date.long}</time>
  </Badge>
  <Badge variant="blush" class="wipe__date wipe__date--after">
    <time datetime={after.date.iso}>{after.date.long}</time>
  </Badge>

  {#if loading || failed}
    <p class="wipe__note" role="status">
      {loading ? 'Loading your photos…' : 'One of these photos could not be loaded.'}
    </p>
  {/if}

  <input
    class="wipe__range"
    type="range"
    min="0"
    max="100"
    step="1"
    bind:value={position}
    aria-label="Compare {before.date.long} and {after.date.long}"
    aria-valuetext="{Math.round(position)}% showing {before.date.long}"
  />
</div>

<style>
  .wipe {
    --p: 50%;
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 100%;
    min-height: 200px;
    border-radius: var(--r-lg);
    background: var(--blush-150);
    isolation: isolate;
  }
  .wipe__side {
    position: absolute;
    inset: 0;
  }
  .wipe__side img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  /* The after side is clipped to the right of the handle. */
  .wipe__side--after {
    clip-path: inset(0 0 0 var(--p));
  }

  .wipe__divider {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--p);
    width: 2px;
    margin-left: -1px;
    background: #fffcf8;
    pointer-events: none;
  }
  .wipe__handle {
    position: absolute;
    top: 50%;
    left: var(--p);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    width: 44px;
    height: 44px;
    margin: -22px 0 0 -22px;
    border-radius: 50%;
    background: radial-gradient(circle, #fbb9b9 0%, #fec7c5 100%);
    box-shadow:
      0 0 0 1.5px #ffebe8,
      0 2px 8px rgba(60, 20, 15, 0.25);
    color: #3f201d;
    pointer-events: none;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .wipe :global(.wipe__date) {
    position: absolute;
    top: 14px;
    z-index: 1;
    pointer-events: none;
  }
  .wipe :global(.wipe__date--before) {
    left: 14px;
  }
  .wipe :global(.wipe__date--after) {
    right: 12px;
  }

  .wipe__note {
    position: absolute;
    inset: auto 12px 12px;
    z-index: 1;
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--r-sm);
    background: var(--glass-light-strong);
    color: var(--text);
    font-size: var(--fs-body-sm);
    text-align: center;
  }

  /* The input covers the frame: drag anywhere, tap to jump, arrows to step. */
  .wipe__range {
    position: absolute;
    inset: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: ew-resize;
    touch-action: pan-y;
  }
  .wipe:has(.wipe__range:focus-visible) {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  @media (hover: hover) {
    .wipe:has(.wipe__range:hover) .wipe__handle {
      transform: scale(1.05);
    }
  }
</style>
