<!--
  One glyph from the icon set or the Products page's own (glyphs.ts), drawn
  exactly as src/ui/Icon.svelte draws its: decorative unless given a label.
-->
<script lang="ts">
  import { glyphFor, type ProductGlyphName } from './glyphs.ts';

  interface Props {
    name: ProductGlyphName;
    size?: number;
    stroke?: number;
    filled?: boolean;
    label?: string;
    class?: string;
  }

  const { name, size = 24, stroke = 1.6, filled, label, class: className = '' }: Props = $props();

  const glyph = $derived(glyphFor(name));
  const solid = $derived(filled ?? glyph.solid ?? false);
</script>

<svg
  class="icon {className}"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={solid ? 'currentColor' : 'none'}
  stroke={solid ? 'none' : 'currentColor'}
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  {@html glyph.d}
</svg>

<style>
  .icon {
    display: inline-block;
    flex: none;
    vertical-align: middle;
    overflow: visible;
  }
</style>
