<script lang="ts">
  /**
   * Photograph an ingredient panel and turn it into a product.
   *
   * The read is always shown for confirmation before anything is saved. OCR on a
   * curved bottle is genuinely hard, and quietly saving a mangled ingredient list
   * would poison every assessment that follows it.
   */
  import { onDestroy } from 'svelte';
  import { session } from '@/state/session.svelte.ts';
  import { pickLabelReader, type LabelRead, type LabelReader } from './label-reader.ts';
  import { api } from '@/lib/api.ts';

  const { onSaved }: { onSaved: () => void } = $props();

  let video = $state<HTMLVideoElement | null>(null);
  let stream = $state<MediaStream | null>(null);
  let previewUrl = $state<string | null>(null);
  let previewImage = $state<HTMLImageElement | null>(null);

  let reader: LabelReader | null = null;
  let busy = $state(false);
  /** True until the OCR recogniser has been fetched once. */
  let firstLocalRead = $state(true);
  let progress = $state(0);
  let result = $state<LabelRead | null>(null);
  let error = $state<string | null>(null);

  let name = $state('');
  let brand = $state('');
  let editable = $state('');

  const usingCloud = $derived(
    (session.user?.consents.cloud_reasoning ?? false) && session.modelAvailable,
  );

  async function startCamera() {
    error = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 } },
        audio: false,
      });
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
    } catch {
      error = 'No camera here — take a photo elsewhere and upload it instead.';
    }
  }

  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function frameToCanvas(): HTMLCanvasElement | null {
    const source = previewImage ?? video;
    if (!source) return null;
    const width = previewImage ? previewImage.naturalWidth : (video?.videoWidth ?? 0);
    const height = previewImage ? previewImage.naturalHeight : (video?.videoHeight ?? 0);
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(source, 0, 0);
    return canvas;
  }

  async function read() {
    const canvas = frameToCanvas();
    if (!canvas) {
      error = 'Nothing to read yet.';
      return;
    }

    busy = true;
    error = null;
    progress = 0;
    try {
      reader ??= pickLabelReader({
        cloudConsent: session.user?.consents.cloud_reasoning ?? false,
        modelAvailable: session.modelAvailable,
      });
      const read = await reader.read(canvas, (p) => (progress = p));
      firstLocalRead = false;
      result = read;
      editable = read.ingredients.join(', ');
      stopCamera();
      if (read.ingredients.length === 0) {
        error = "I couldn't find an ingredient list in that. Try filling the frame with the panel.";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'That read failed.';
    } finally {
      busy = false;
    }
  }

  function onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    stopCamera();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);

    const img = new Image();
    img.onload = () => (previewImage = img);
    img.src = previewUrl;
  }

  async function save() {
    const ingredients = editable
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name.trim() || ingredients.length === 0) return;

    busy = true;
    try {
      await api.addProduct({ name, brand: brand || undefined, ingredients });
      onSaved();
      reset();
    } finally {
      busy = false;
    }
  }

  function reset() {
    result = null;
    editable = '';
    name = '';
    brand = '';
    previewImage = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  onDestroy(() => {
    stopCamera();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    void reader?.dispose();
  });
</script>

<div class="scanner">
  {#if !result}
    <div class="scanner__viewport">
      {#if previewUrl}
        <img src={previewUrl} alt="The ingredient panel you framed" />
      {:else}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={video} playsinline muted></video>
      {/if}
      <div class="scanner__frame"></div>
    </div>

    {#if busy}
      <div class="bar" style="margin:10px 0"><i style="width:{progress * 100}%"></i></div>
      <p class="scanner__hint">
        Reading the panel{usingCloud ? '' : ' on your device'}…
        {#if !usingCloud && firstLocalRead}
          First read fetches the text recogniser, so it takes a moment.
        {/if}
      </p>
    {:else}
      <p class="scanner__hint">
        Fill the frame with the ingredient list and hold steady.
        {#if usingCloud}
          Your photo goes to the model for reading, since you turned cloud reading on.
        {:else}
          The photo is read here and never uploaded. The recogniser itself is downloaded
          once, the first time you use this.
        {/if}
      </p>
    {/if}

    {#if error}<div class="error" style="margin-top:8px">{error}</div>{/if}

    <div class="scan__actions">
      {#if !stream && !previewUrl}
        <button class="btn" onclick={startCamera} disabled={busy}>Use camera</button>
      {/if}
      <button class="btn btn--primary" onclick={read} disabled={busy || (!stream && !previewImage)}>
        {busy ? 'Reading…' : 'Read label'}
      </button>
      <label class="btn" style="cursor:pointer">
        Upload a photo
        <input type="file" accept="image/*" onchange={onFile} hidden />
      </label>
    </div>
  {:else}
    <p class="scanner__hint">
      Read {Math.round(result.confidence * 100)}% confident via {result.provider}.
      {#if !result.markerFound}
        I couldn't find an “Ingredients:” header, so check I started in the right place.
      {/if}
      Fix anything that came out wrong before saving.
    </p>

    <label class="field">
      <span>Product name</span>
      <input bind:value={name} placeholder="Niacinamide 10% + Zinc" />
    </label>
    <label class="field">
      <span>Brand</span>
      <input bind:value={brand} placeholder="The Ordinary" />
    </label>
    <label class="field">
      <span>Ingredients ({editable.split(',').filter((s) => s.trim()).length})</span>
      <textarea bind:value={editable} rows="6"></textarea>
    </label>

    {#if result.discarded.length}
      <p class="scanner__hint">
        Dropped {result.discarded.length} fragment{result.discarded.length === 1 ? '' : 's'} that
        didn't look like ingredients.
      </p>
    {/if}

    <div class="scan__actions">
      <button class="btn btn--primary" onclick={save} disabled={busy || !name.trim()}>Save product</button>
      <button class="btn" onclick={reset} disabled={busy}>Start over</button>
    </div>
  {/if}
</div>

<style>
  .scanner {
    margin-top: var(--s-3);
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
  }

  .scanner__viewport {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius);
    overflow: hidden;
    background: #05070c;
    border: var(--hair) solid var(--line-strong);
  }

  .scanner__viewport video,
  .scanner__viewport img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Guide rectangle matching the shape of a typical ingredient panel. */
  .scanner__frame {
    position: absolute;
    inset: 24% 8%;
    border: var(--hair) solid rgba(237, 239, 244, 0.4);
    border-radius: var(--radius);
    pointer-events: none;
  }

  .scanner__hint {
    margin: var(--s-2) 0 0;
    max-width: var(--measure);
    font-size: var(--t-md);
    line-height: var(--lh-body);
    color: var(--quiet);
  }
</style>
