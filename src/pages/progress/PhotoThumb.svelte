<!--
  One stored progress photo as a thumbnail. Only ever shown for someone who
  opted in to progress photos (CNS-04) and saved this one; the bytes come
  through the authenticated image route as an object URL, revoked on the way
  out. Never a scan frame: those are not kept (RET-01).
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api } from '@/lib/api.ts';

  interface Props {
    photoId: string;
  }

  const { photoId }: Props = $props();
  let url = $state<string | null>(null);
  let owned: string | null = null;

  $effect(() => {
    const id = photoId;
    let cancelled = false;
    void api
      .progressPhotoImage(id)
      .then((next) => {
        if (cancelled) {
          if (next) URL.revokeObjectURL(next);
          return;
        }
        if (owned) URL.revokeObjectURL(owned);
        owned = next;
        url = next;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  onDestroy(() => {
    if (owned) URL.revokeObjectURL(owned);
  });
</script>

<span class="thumb">
  {#if url}<img src={url} alt="" />{/if}
</span>

<style>
  .thumb {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--blush-150);
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
