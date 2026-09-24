<!--
  One glyph from the set in icons.ts.

  Decorative by default (hidden from assistive technology, because the control
  around it carries the name). Give it a `label` only when the icon is the
  whole message, and it becomes an image with that name.
-->
<script lang="ts">
  import { GLYPHS, type IconName } from './icons.ts';

  interface Props {
    name: IconName;
    /** Rendered size in CSS px (the glyphs are drawn on a 24-unit grid). */
    size?: number;
    /** Stroke width in grid units; the mockups' is 1.6. */
    stroke?: number;
    /** Fill the shape with the current colour. Defaults to the glyph's own style. */
    filled?: boolean;
    /** Accessible name. Omit for decorative icons. */
    label?: string;
    class?: string;
  }

  const { name, size = 24, stroke = 1.6, filled, label, class: className = '' }: Props = $props();

  const glyph = $derived(GLYPHS[name]);
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
