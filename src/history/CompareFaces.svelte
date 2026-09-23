<script lang="ts">
  /**
   * Before and after, on the same face.
   *
   * This is an intentionally non-aligned wipe. Facial geometry exists only
   * during the active scan presentation, so historical photos may differ in
   * pose, distance, and framing. The UI says that plainly rather than
   * reconstructing or persisting a face mesh.
   *
   * Pixels come from wherever they are: this session's own captures for a
   * guest or for scans taken since the page opened, and the encrypted store for
   * an account that chose to keep photos.
   */
  import { onDestroy } from 'svelte';
  import { api } from '@/lib/api.ts';
  import { session } from '@/state/session.svelte.ts';
  import type { SkinAnalysis } from '@shared/types.ts';

  interface Props {
    scans: SkinAnalysis[];
  }

  let { scans }: Props = $props();

  /** Scans that can take part: pixels we can reach, with no geometry required. */
  const usable = $derived(
    scans.filter(
      (s) => session.localImages[s.capturedAt] !== undefined || (s.hasImage && !session.guest),
    ),
  );

  let afterIndex = $state(0);
  let beforeIndex = $state(1);
  let position = $state(50);
  let beforeUrl = $state<string | null>(null);
  let afterUrl = $state<string | null>(null);
  let displayedAfterUrl = $state<string | null>(null);
  let working = $state(false);
  let failed = $state<string | null>(null);
  const owned: string[] = [];

  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

  async function imageFor(scan: SkinAnalysis): Promise<string | null> {
    const local = session.localImages[scan.capturedAt];
    if (local) return `data:image/jpeg;base64,${local}`;
    if (scan.id && scan.hasImage && !session.guest) {
      const url = await api.scanImage(scan.id);
      if (url) owned.push(url);
      return url;
    }
    return null;
  }

  async function build() {
    const after = usable[afterIndex];
    const before = usable[beforeIndex];
    displayedAfterUrl = null;
    failed = null;
    if (!after || !before || after === before) return;
    working = true;
    try {
      const [beforeSrc, afterSrc] = await Promise.all([imageFor(before), imageFor(after)]);
      if (!beforeSrc || !afterSrc) {
        failed = 'One of these photos is not available to me.';
        return;
      }
      beforeUrl = beforeSrc;
      afterUrl = afterSrc;
      // Deliberately show the original capture. Historical geometry is neither
      // stored nor reconstructed from the pixels.
      displayedAfterUrl = afterSrc;
    } catch (err) {
      failed = err instanceof Error ? err.message : 'I could not load those two photos.';
    } finally {
      working = false;
    }
  }

  $effect(() => {
    // Re-run when the choice changes, or when the set of usable scans does.
    void usable.length;
    void afterIndex;
    void beforeIndex;
    void build();
  });

  onDestroy(() => {
    for (const url of owned) URL.revokeObjectURL(url);
  });
</script>

{#if usable.length >= 2}
  <section class="compare" aria-label="Before and after">
    <div class="compare__head">
      <h2 class="compare__title">Same face, two dates.</h2>
      <p class="compare__lede">
        Original captures, not face-aligned. Changes in pose, distance, or framing may move
        under the handle as well as your skin.
      </p>
    </div>

    <div class="compare__pick">
      <label>
        <span>Before</span>
        <select bind:value={beforeIndex}>
          {#each usable as scan, i (scan.capturedAt)}
            {#if i !== afterIndex}
              <option value={i}>{dateFormat.format(new Date(scan.capturedAt))}</option>
            {/if}
          {/each}
        </select>
      </label>
      <label>
        <span>After</span>
        <select bind:value={afterIndex}>
          {#each usable as scan, i (scan.capturedAt)}
            {#if i !== beforeIndex}
              <option value={i}>{dateFormat.format(new Date(scan.capturedAt))}</option>
            {/if}
          {/each}
        </select>
      </label>
    </div>

    <div class="wipe" style="--p:{position}%">
      {#if beforeUrl}
        <img class="wipe__img wipe__img--before" src={beforeUrl} alt="Before" />
      {/if}
      {#if displayedAfterUrl}
        <img class="wipe__img wipe__img--after" src={displayedAfterUrl} alt="After, not aligned" />
      {:else if afterUrl && !working}
        <img class="wipe__img wipe__img--after" src={afterUrl} alt="After" />
      {/if}
      <div class="wipe__handle" aria-hidden="true"></div>
      <span class="wipe__tag wipe__tag--before">before</span>
      <span class="wipe__tag wipe__tag--after">after</span>
      {#if working}
        <div class="wipe__note">Loading captures…</div>
      {:else if failed}
        <div class="wipe__note">{failed}</div>
      {/if}
      <input
        class="wipe__range"
        type="range"
        min="0"
        max="100"
        bind:value={position}
        aria-label="Wipe between before and after"
      />
    </div>
  </section>
{:else if scans.length >= 2}
  <div class="empty">
    <p class="empty__text">
      Keep photos on in Privacy and your next two scans can appear in an original, non-aligned
      wipe here. Pose and framing differences will remain visible.
    </p>
  </div>
{/if}

<style>
  .compare__head {
    margin-bottom: var(--s-3);
  }
  .compare__title {
    margin: 0;
    font-size: var(--t-lg);
    font-weight: var(--w-medium);
    line-height: var(--lh-snug);
  }
  .compare__lede {
    margin: var(--s-1) 0 0;
    max-width: var(--measure);
    font-size: var(--t-md);
    line-height: var(--lh-body);
    color: var(--quiet);
  }
  .compare__pick {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3);
    margin-bottom: var(--s-3);
  }
  .compare__pick label {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-md);
    letter-spacing: 0;
    text-transform: none;
    color: var(--ink-soft);
  }
  .compare__pick select {
    min-height: 36px;
    padding: 0 var(--s-6) 0 var(--s-3);
    border-radius: var(--radius);
    border: var(--hair) solid var(--line-strong);
    background: var(--surface-raised);
    color: var(--ink);
    font: inherit;
    font-size: var(--t-md);
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238b94a9' stroke-width='1'/></svg>");
    background-repeat: no-repeat;
    background-position: right var(--s-3) center;
  }

  .wipe {
    position: relative;
    width: 100%;
    max-width: 360px;
    aspect-ratio: 3 / 4;
    border-radius: var(--radius);
    overflow: hidden;
    border: var(--hair) solid var(--line-strong);
    background: #05070c;
    box-shadow: none;
  }
  .wipe__img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .wipe__img--after {
    clip-path: inset(0 0 0 var(--p));
  }
  .wipe__handle {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--p);
    width: 1px;
    background: rgba(237, 239, 244, 0.85);
    box-shadow: none;
    transform: none;
    pointer-events: none;
  }
  .wipe__handle::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: var(--hair) solid rgba(237, 239, 244, 0.85);
    background: rgba(var(--ground-rgb), 0.7);
    transform: translate(-50%, -50%);
    box-shadow: none;
  }
  .wipe__tag {
    position: absolute;
    top: var(--s-2);
    padding: 4px 8px;
    border-radius: var(--radius);
    background: var(--chip);
    font-size: var(--t-xs);
    line-height: 1.3;
    letter-spacing: 0.02em;
    text-transform: none;
    color: var(--ink-soft);
    pointer-events: none;
  }
  .wipe__tag--before {
    left: var(--s-2);
  }
  .wipe__tag--after {
    right: var(--s-2);
    color: var(--ink);
  }
  .wipe__note {
    position: absolute;
    left: 50%;
    bottom: 44px;
    transform: translateX(-50%);
    padding: 4px 10px;
    border-radius: var(--radius);
    background: var(--chip);
    font-size: var(--t-xs);
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .wipe__range {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: ew-resize;
  }
</style>
