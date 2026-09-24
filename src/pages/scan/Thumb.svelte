<!--
  A callout's zone thumbnail (specs/scan.md 5.2).

  sample   a neutral skin-texture tile drawn in SVG: pink macro tones, pores,
           specular points (BUILD-PLAN decision 3: no faces, not even the
           mockup's eye close-up - the under-eye tile keeps only its white
           lid-arc graphic over plain texture).
  capture  this session's own crop (an object URL from crops.ts), in memory
           only for as long as the reading is on screen.
  none     a quiet glass tile, when there is no capture to cut from.
-->
<script module lang="ts">
  let nextId = 1;
</script>

<script lang="ts">
  import type { CalloutThumb, ThumbArt } from '@/view/scan.ts';

  interface Props {
    thumb: CalloutThumb;
    /** The crop for a capture thumb, when it has been cut. */
    src?: string | null;
    label: string;
    class?: string;
  }

  const { thumb, src = null, label, class: className = '' }: Props = $props();

  /* Per-tile palette and texture, from the mockup's measured means. */
  const ART: Record<ThumbArt, { hi: string; mid: string; lo: string; pores: number; pore: number; seed: number; red?: boolean; arc?: boolean }> = {
    forehead: { hi: '#e7c1ca', mid: '#ab828d', lo: '#8e6571', pores: 16, pore: 1.1, seed: 3 },
    pores: { hi: '#e1b8c4', mid: '#a57988', lo: '#86606d', pores: 34, pore: 1.6, seed: 11 },
    cheeks: { hi: '#e6b3c3', mid: '#b77a93', lo: '#9b5d75', pores: 12, pore: 1, seed: 19, red: true },
    underEyes: { hi: '#c9a8b4', mid: '#896d79', lo: '#6b5360', pores: 8, pore: 0.8, seed: 23, arc: true },
    chin: { hi: '#d8b3bd', mid: '#987782', lo: '#7a5b66', pores: 14, pore: 1.2, seed: 31 },
  };

  function rand(seed: number): () => number {
    let s = seed * 9301 + 49297;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  const art = $derived(thumb.kind === 'sample' ? ART[thumb.art] : null);
  const dots = $derived.by(() => {
    if (!art) return { pores: [], specs: [] };
    const r = rand(art.seed);
    const pores = Array.from({ length: art.pores }, () => ({ x: 4 + r() * 52, y: 4 + r() * 52, s: art.pore * (0.6 + r() * 0.8) }));
    const specs = Array.from({ length: 9 }, () => ({ x: 4 + r() * 52, y: 4 + r() * 52, s: 0.5 + r() * 0.7 }));
    return { pores, specs };
  });
  const gid = `scan-thumb-${nextId++}`;
</script>

<div class="thumb {className}" data-kind={thumb.kind} role="img" aria-label={label}>
  {#if thumb.kind === 'capture' && src}
    <img {src} alt="" draggable="false" />
  {:else if art}
    <svg viewBox="0 0 60 60" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="{gid}-g" cx="40%" cy="35%" r="80%">
          <stop offset="0" stop-color={art.hi} />
          <stop offset="0.55" stop-color={art.mid} />
          <stop offset="1" stop-color={art.lo} />
        </radialGradient>
        <pattern id="{gid}-x" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <path d="M0 3h6" stroke="#fff" stroke-opacity="0.08" stroke-width="0.6" />
        </pattern>
      </defs>
      <rect width="60" height="60" fill="url(#{gid}-g)" />
      <rect width="60" height="60" fill="url(#{gid}-x)" />
      {#if art.red}
        <ellipse cx="30" cy="34" rx="20" ry="14" fill="#c4556f" opacity="0.28" />
      {/if}
      {#each dots.pores as p, i (i)}
        <circle cx={p.x} cy={p.y} r={p.s} fill="#4a2a35" opacity="0.45" />
      {/each}
      {#each dots.specs as p, i (i)}
        <circle cx={p.x} cy={p.y} r={p.s} fill="#fff4f8" opacity="0.8" />
      {/each}
      {#if art.arc}
        <path d="M8 28c7 9 37 9 44 0" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.9" />
        <path d="M12 36c6 5 30 5 36 0" fill="none" stroke="#fff" stroke-width="0.7" stroke-linecap="round" opacity="0.55" />
      {/if}
    </svg>
  {:else}
    <span class="thumb__none" aria-hidden="true"></span>
  {/if}
</div>

<style>
  .thumb {
    position: relative;
    overflow: hidden;
    border-radius: 8px;
    background: var(--navy-800);
    box-shadow:
      0 0 0 1.5px var(--scan-thumb-rim, #e3cfd8),
      0 0 6px rgba(255, 220, 235, 0.25);
  }
  .thumb img,
  .thumb svg {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb[data-kind='none'] {
    box-shadow: inset 0 0 0 1px var(--navy-line);
    background:
      radial-gradient(80% 80% at 35% 30%, rgba(160, 190, 240, 0.16), transparent 70%),
      var(--navy-800);
  }
  .thumb__none {
    position: absolute;
    inset: 30%;
    border-radius: 50%;
    border: 1px dashed rgba(160, 190, 240, 0.35);
  }
</style>
