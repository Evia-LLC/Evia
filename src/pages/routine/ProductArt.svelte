<!--
  An unbranded package for a routine step: the cleanser tube, the toner
  bottle, the serum dropper and the moisturiser jar from the mockup
  (routine.md section 5, I-3..I-6), drawn in SVG. The labels carry only
  abstract lines - never a brand, never a wordmark - because these stand for a
  kind of product, not a product anyone sells.

  With `src` (a real catalogue image) it shows that instead.
-->
<script lang="ts">
  import type { ProductArtKind } from '@/view/routine.ts';

  interface Props {
    kind: ProductArtKind;
    /** Drawn height in CSS px; the width follows the package's shape. */
    height?: number;
    src?: string | null;
    class?: string;
  }

  const { kind, height = 58, src = null, class: className = '' }: Props = $props();

  /* Each package's own box, from the mockup's thumbnail boxes. */
  const BOX: Record<ProductArtKind, [number, number]> = {
    tube: [30, 60],
    bottle: [26, 60],
    dropper: [22, 64],
    jar: [50, 46],
  };
  const box = $derived(BOX[kind]);
  const scale = $derived(kind === 'jar' ? (height * 0.78) / box[1] : height / box[1]);
  const id = $props.id();

  let failed = $state(false);
</script>

{#if src && !failed}
  <img class="ev-art ev-art--img {className}" {src} alt="" style:height="{height}px" onerror={() => (failed = true)} />
{:else}
  <svg
    class="ev-art {className}"
    width={box[0] * scale}
    height={box[1] * scale}
    viewBox="0 0 {box[0]} {box[1]}"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="{id}-tube" x1="0" x2="1">
        <stop offset="0" stop-color="#bbbdbd" />
        <stop offset="0.35" stop-color="#f3f3f5" />
        <stop offset="1" stop-color="#cfd1d2" />
      </linearGradient>
      <linearGradient id="{id}-chrome" x1="0" x2="1">
        <stop offset="0" stop-color="#6f6f6f" />
        <stop offset="0.4" stop-color="#d2d2d2" />
        <stop offset="1" stop-color="#8a8a8a" />
      </linearGradient>
      <linearGradient id="{id}-toner" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ebd6d1" />
        <stop offset="1" stop-color="#bb9c91" />
      </linearGradient>
      <linearGradient id="{id}-amber" x1="0" x2="1">
        <stop offset="0" stop-color="#6b3417" />
        <stop offset="0.45" stop-color="#9a5632" />
        <stop offset="1" stop-color="#6b3417" />
      </linearGradient>
      <linearGradient id="{id}-rosegold" x1="0" x2="1">
        <stop offset="0" stop-color="#bc7b64" />
        <stop offset="0.3" stop-color="#f1c3b3" />
        <stop offset="0.6" stop-color="#d9b1a3" />
        <stop offset="1" stop-color="#b8735d" />
      </linearGradient>
      <radialGradient id="{id}-shadow">
        <stop offset="0" stop-color="rgba(80,45,40,0.28)" />
        <stop offset="1" stop-color="rgba(80,45,40,0)" />
      </radialGradient>
    </defs>

    {#if kind === 'tube'}
      <!-- Standing cap-down: the crimped seal at the top, the flip cap below. -->
      <ellipse cx="15" cy="58" rx="11" ry="2" fill="url(#{id}-shadow)" />
      <path d="M3 3.5h24v3.2L22.6 43H7.4L3 6.7z" fill="url(#{id}-tube)" stroke="#a9acad" stroke-width="0.5" />
      <rect x="3" y="2" width="24" height="3" rx="0.8" fill="#d9dadb" stroke="#a9acad" stroke-width="0.5" />
      <path d="M9 12.5h12M10 15.5h10M11 18.5h8" stroke="#b3b6b8" stroke-width="0.9" stroke-linecap="round" />
      <path d="M8.2 43h13.6l-.6 3H8.8z" fill="#9c9c9c" />
      <rect x="8.4" y="46" width="13.2" height="11" rx="1.6" fill="url(#{id}-chrome)" />
      <rect x="8.4" y="55.4" width="13.2" height="1.6" rx="0.6" fill="#454545" />
    {:else if kind === 'bottle'}
      <ellipse cx="13" cy="58" rx="11" ry="2" fill="url(#{id}-shadow)" />
      <rect x="7" y="2" width="12" height="13" rx="1.8" fill="#3a2520" />
      <rect x="8.2" y="3" width="2" height="11" rx="1" fill="#5b4038" />
      <rect x="9" y="15" width="8" height="3" fill="#cdb5ae" />
      <rect x="2" y="18" width="22" height="39" rx="5" fill="url(#{id}-toner)" stroke="rgba(150,110,100,0.5)" stroke-width="0.6" />
      <rect x="3.6" y="20" width="2.2" height="34" rx="1.1" fill="rgba(255,255,255,0.45)" />
      <rect x="6" y="30" width="14" height="16" rx="1" fill="#f7efe9" />
      <path d="M8.5 34.5h9M9.5 38h7M10.5 41.5h5" stroke="#bfaaa2" stroke-width="0.8" stroke-linecap="round" />
    {:else if kind === 'dropper'}
      <ellipse cx="11" cy="62" rx="10" ry="1.8" fill="url(#{id}-shadow)" />
      <path d="M7.5 14c0-6 1.2-11 3.5-11s3.5 5 3.5 11z" fill="#141111" />
      <rect x="5" y="14" width="12" height="8" rx="1" fill="#1e1a19" />
      <rect x="5.8" y="15" width="1.6" height="6" rx="0.8" fill="#565250" />
      <rect x="2" y="22" width="18" height="39" rx="4" fill="url(#{id}-amber)" />
      <rect x="3.4" y="24" width="1.8" height="34" rx="0.9" fill="rgba(255,220,190,0.35)" />
      <rect x="4" y="35" width="14" height="17" rx="0.8" fill="#faf6f2" />
      <path d="M7 40h8" stroke="#2a1d18" stroke-width="1.1" stroke-linecap="round" />
      <path d="M7.5 44h7M8.5 47h5" stroke="#c9bbb3" stroke-width="0.8" stroke-linecap="round" />
    {:else}
      <ellipse cx="25" cy="43.5" rx="23" ry="2.4" fill="url(#{id}-shadow)" />
      <rect x="3" y="16" width="44" height="26" rx="4" fill="url(#{id}-rosegold)" />
      <rect x="5" y="4" width="40" height="13" rx="3.5" fill="#f1d9cc" stroke="rgba(170,120,105,0.45)" stroke-width="0.6" />
      <rect x="7" y="6" width="26" height="2" rx="1" fill="rgba(255,255,255,0.6)" />
      <rect x="15" y="22" width="20" height="13" rx="1" fill="#1a0f0c" />
      <path d="M19 26.5h12M20.5 30.5h9" stroke="#d8c3b8" stroke-width="0.8" stroke-linecap="round" />
    {/if}
  </svg>
{/if}

<style>
  .ev-art {
    display: block;
    flex: none;
  }
  .ev-art--img {
    width: auto;
    max-width: 56px;
    object-fit: contain;
    border-radius: var(--r-xs);
  }
</style>
