<!--
  The Scan page's concern and metric glyphs (specs/scan.md 2.5 and 2.7), in the
  icon set's idiom: a 24 grid, round caps and joins, outline only. They are
  the mockup's own custom marks (a droplet within a droplet, a ring of cells, a
  gabled skin section with pores, a cracked barrier ...), which the shared set
  has no equivalent for; if they are wanted elsewhere they can move into
  src/ui/icons.ts as they are.

  `ring` draws the thin circle the concern rows wear around their glyph.
-->
<script lang="ts">
  import type { ScanGlyph } from '@/view/scan.ts';

  interface Props {
    name: ScanGlyph;
    size?: number;
    stroke?: number;
    ring?: boolean;
  }

  const { name, size = 22, stroke = 1.5, ring = false }: Props = $props();
</script>

<svg
  class="scan-glyph"
  width={size}
  height={size}
  viewBox={ring ? '-3 -3 30 30' : '0 0 24 24'}
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#if ring}<circle cx="12" cy="12" r="14.2" />{/if}
  {#if name === 'droplet'}
    <path d="M12 2.8c3.4 4.2 6.2 7.6 6.2 11.2a6.2 6.2 0 0 1-12.4 0c0-3.6 2.8-7 6.2-11.2z" />
    <path d="M14.6 14.6a2.7 2.7 0 0 1-2.4 2.6" opacity="0.8" />
  {:else if name === 'texture'}
    <circle cx="12" cy="4.6" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="17.2" cy="6.8" r="1.6" />
    <circle cx="19.4" cy="12" r="1.6" />
    <circle cx="17.2" cy="17.2" r="1.6" />
    <circle cx="12" cy="19.4" r="1.6" />
    <circle cx="6.8" cy="17.2" r="1.6" />
    <circle cx="4.6" cy="12" r="1.6" />
    <circle cx="6.8" cy="6.8" r="1.6" />
    <circle cx="12" cy="12" r="2.1" />
  {:else if name === 'redness'}
    <path d="M12 2.8c3.4 4.2 6.2 7.6 6.2 11.2a6.2 6.2 0 0 1-12.4 0c0-3.6 2.8-7 6.2-11.2z" />
    <path d="M12 10.2c1.5 1.6 2.3 2.8 2.3 4a2.3 2.3 0 0 1-4.6 0c0-.8.4-1.5 1-2.1.2.7.6 1.1 1.1 1.2-.1-1.2 0-2.2.2-3.1z" />
  {:else if name === 'pores'}
    <path d="M4 11 12 4.2 20 11v8.6a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 19.6z" />
    <circle cx="9.4" cy="13.4" r="1.3" />
    <circle cx="14.6" cy="13.4" r="1.3" />
    <circle cx="12" cy="17.4" r="1.3" />
  {:else if name === 'barrier'}
    <path d="M12 3.2 20.2 9l-3.1 11.4H6.9L3.8 9z" />
    <path d="m9.4 9.6 2.6 4.6 2.6-4.6" />
    <path d="M12 14.2v3.6" />
  {:else if name === 'shield'}
    <path d="M12 2.8 19.6 6v5.4c0 4.8-3.2 8.3-7.6 9.8-4.4-1.5-7.6-5-7.6-9.8V6z" />
    <path d="M12 9.4v5.2M9.4 12h5.2" />
  {:else if name === 'shine'}
    <path d="M12 3.4c.6 3.6 2.2 5.4 5.6 6-3.4.6-5 2.4-5.6 6-.6-3.6-2.2-5.4-5.6-6 3.4-.6 5-2.4 5.6-6z" />
    <path d="M18.4 15.2c.3 1.6.9 2.3 2.4 2.6-1.5.3-2.1 1-2.4 2.6-.3-1.6-.9-2.3-2.4-2.6 1.5-.3 2.1-1 2.4-2.6z" />
  {:else if name === 'spot'}
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="9.2" cy="10" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="14.6" cy="13.8" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="10.4" cy="15.4" r="0.9" fill="currentColor" stroke="none" />
  {:else if name === 'tone'}
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 3.6a8.4 8.4 0 0 1 0 16.8z" fill="currentColor" fill-opacity="0.35" />
  {:else if name === 'under-eye'}
    <path d="M3.4 11.4c2.4-3 5.3-4.4 8.6-4.4s6.2 1.4 8.6 4.4c-2.4 3-5.3 4.4-8.6 4.4s-6.2-1.4-8.6-4.4z" />
    <circle cx="12" cy="11.4" r="2.3" />
    <path d="M6 18.2c1.9 1.2 3.9 1.8 6 1.8s4.1-.6 6-1.8" />
  {:else if name === 'breakout'}
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="9.4" cy="9.6" r="1.6" />
    <circle cx="14.8" cy="11.4" r="1.2" />
    <circle cx="11" cy="15.2" r="1.4" />
  {/if}
</svg>

<style>
  .scan-glyph {
    display: block;
    flex: none;
  }
</style>
