<!--
  The sample gallery's pictures (products.md 5 I6-I7, 6C), drawn: the bottle
  on a rose bathroom counter (plaster wall with a panel seam, a folded towel,
  a candle jar, palm leaves), then three close-ups with no people in them - a
  swatch of cream, a cotton pad, a lather. Sample mode only; a real product
  shows the shop's own picture or its drawn package.

  The same still can be on screen twice (the panel's main picture and its
  first thumbnail), so its gradient ids are made unique per copy, as in
  Bottle.svelte.
-->
<script module lang="ts">
  let nextId = 0;
</script>

<script lang="ts">
  import type { BottleKind } from '@/view/products.ts';
  import Bottle from './Bottle.svelte';

  interface Props {
    still: 'counter' | 'cream' | 'pad' | 'foam';
    bottle?: BottleKind;
  }

  const { still, bottle }: Props = $props();

  const uid = `gs${nextId++}`;
</script>

<div class="gstill gstill--{still}" aria-hidden="true">
  {#if still === 'counter'}
    <svg viewBox="0 0 240 240" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <linearGradient id="{uid}-wall" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#d6a898" />
          <stop offset=".6" stop-color="#cd9c8e" />
          <stop offset="1" stop-color="#c08f82" />
        </linearGradient>
        <linearGradient id="{uid}-counter" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#ecdcd5" />
          <stop offset="1" stop-color="#dfc7bf" />
        </linearGradient>
        <radialGradient id="{uid}-light" cx=".15" cy=".3" r=".8">
          <stop offset="0" stop-color="#fff3ec" stop-opacity=".55" />
          <stop offset="1" stop-color="#fff3ec" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="240" height="240" fill="url(#{uid}-wall)" />
      <rect x="58" y="0" width="1.4" height="176" fill="#b98a7c" opacity=".6" />
      <rect x="59.4" y="0" width="1" height="176" fill="#e3b7a9" opacity=".6" />
      <rect width="240" height="240" fill="url(#{uid}-light)" />
      <!-- palm leaves, top right, soft -->
      <g fill="#86694e" opacity=".55">
        <path d="M240 20C214 28 196 46 186 70C204 56 222 46 240 42Z" />
        <path d="M240 50C222 58 208 74 202 96C216 84 230 76 240 74Z" />
        <path d="M232 0C220 16 214 34 214 54C224 36 234 24 240 18V0Z" />
      </g>
      <rect x="0" y="174" width="240" height="66" fill="url(#{uid}-counter)" />
      <rect x="0" y="174" width="240" height="2" fill="#f6ebe6" />
      <!-- folded towel, left foreground -->
      <g>
        <rect x="-6" y="190" width="70" height="20" rx="8" fill="#ac7463" />
        <rect x="-6" y="206" width="74" height="22" rx="9" fill="#b97f6d" />
        <path d="M-6 213H68" stroke="#9c6556" stroke-width="1" opacity=".5" />
      </g>
      <!-- candle jar, right -->
      <g>
        <ellipse cx="206" cy="199" rx="18" ry="3" fill="#b88c80" opacity=".4" />
        <rect x="190" y="168" width="32" height="31" rx="7" fill="#e1bdae" />
        <path d="M197 168C199 160 204 156 206 152C208 156 213 160 215 168Z" fill="#fbf3ef" />
        <rect x="190" y="168" width="32" height="31" rx="7" fill="url(#{uid}-light)" />
      </g>
    </svg>
    {#if bottle}
      <div class="gstill__bottle"><Bottle kind={bottle} /></div>
    {/if}
  {:else if still === 'cream'}
    <svg viewBox="0 0 60 60" preserveAspectRatio="xMidYMid slice" focusable="false">
      <rect width="60" height="60" fill="#efc9c1" />
      <ellipse cx="30" cy="36" rx="17" ry="7" fill="#d9aea5" opacity=".6" />
      <path d="M14 34C14 26 22 22 30 22C40 22 46 27 46 33C46 38 40 40 30 40C21 40 14 39 14 34Z" fill="#fbf7f4" />
      <path d="M20 30C24 26 32 25 38 28" stroke="#e9dfd9" stroke-width="1.6" fill="none" stroke-linecap="round" />
      <path d="M30 22C31 17 34 15 36 14" stroke="#fbf7f4" stroke-width="3" fill="none" stroke-linecap="round" />
    </svg>
  {:else if still === 'pad'}
    <svg viewBox="0 0 60 60" preserveAspectRatio="xMidYMid slice" focusable="false">
      <rect width="60" height="60" fill="#c99a6e" />
      <rect x="0" y="0" width="60" height="22" fill="#b3845b" opacity=".6" />
      <ellipse cx="31" cy="36" rx="17" ry="15" fill="#8a603f" opacity=".25" />
      <circle cx="30" cy="33" r="15" fill="#fbf8f4" />
      <g fill="#e8e1da">
        <circle cx="24" cy="28" r=".9" /><circle cx="33" cy="26" r=".8" /><circle cx="37" cy="33" r=".9" />
        <circle cx="27" cy="37" r=".8" /><circle cx="33" cy="40" r=".9" /><circle cx="22" cy="34" r=".7" />
      </g>
    </svg>
  {:else}
    <svg viewBox="0 0 60 60" preserveAspectRatio="xMidYMid slice" focusable="false">
      <rect width="60" height="60" fill="#e7bfb8" />
      <circle cx="30" cy="31" r="18" fill="#d7aaa2" opacity=".5" />
      <circle cx="30" cy="30" r="16" fill="#faf6f4" />
      <g fill="none" stroke="#e4dcd8" stroke-width=".8">
        <circle cx="24" cy="25" r="3" /><circle cx="34" cy="24" r="2.4" /><circle cx="36" cy="33" r="3.2" />
        <circle cx="26" cy="35" r="2.6" /><circle cx="31" cy="30" r="1.8" />
      </g>
    </svg>
  {/if}
</div>

<style>
  .gstill {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .gstill svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .gstill__bottle {
    position: absolute;
    left: 50%;
    bottom: 22%;
    height: 72%;
    transform: translateX(-50%);
    display: flex;
  }
</style>
