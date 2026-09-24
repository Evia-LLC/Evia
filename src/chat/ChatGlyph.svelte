<!--
  The few glyphs the conversation needs that the shared set (src/ui/icons.ts)
  does not have yet: the microphone, her voice on and off, and stop. Drawn in
  the same idiom and with the same markup as Icon.svelte (24-unit grid, 1.6
  stroke, round caps and joins), so they sit beside it without a seam. They
  belong in icons.ts; until the set takes them they live here.
-->
<script module lang="ts">
  const GLYPHS = {
    mic: '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5v4"/>',
    'voice-on':
      '<path d="M4 9.5h3l4.5-4v13L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.4 6.2a8.2 8.2 0 0 1 0 11.6"/>',
    'voice-off':
      '<path d="M4 9.5h3l4.5-4v13L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/><path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  } as const;

  export type ChatGlyphName = keyof typeof GLYPHS;
</script>

<script lang="ts">
  interface Props {
    name: ChatGlyphName;
    size?: number;
    stroke?: number;
    filled?: boolean;
  }

  const { name, size = 22, stroke = 1.6, filled = false }: Props = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? 'currentColor' : 'none'}
  stroke={filled ? 'none' : 'currentColor'}
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {@html GLYPHS[name]}
</svg>

<style>
  .icon {
    display: inline-block;
    flex: none;
    vertical-align: middle;
    overflow: visible;
  }
</style>
