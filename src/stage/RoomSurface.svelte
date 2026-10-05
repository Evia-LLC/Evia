<!--
  HTML pinned onto a surface of the enclosing Room: the niche's wall text, the
  acrylic sign, a plaque.

  Lay the content out in a `width` x `height` box as if it were facing you;
  the box is then bent onto the surface's four corners (anchors.json, or the
  room's built-in stand-in anchors) with a matrix3d, and softened by the
  surface's depth-of-field blur so it sits in the same focus as the room.
  If the room has no such surface, `fallback` (a quad in the same normalised
  frame) is used; failing that nothing is drawn.

  When the room is alive (Room's living plate) and moves with the pointer,
  the text moves with its wall: the shift for the surface's depth, read from
  the room (`parallaxAt`), times the overlay's --living-dx / --living-dy.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { quadMatrix, useRoom, type Point, type Quad, type RoomSurfaceAnchor } from './room-anchors.ts';

  interface Props {
    name: string;
    width: number;
    height: number;
    fallback?: Quad;
    /** Hide from assistive technology (decorative wall copy). */
    decorative?: boolean;
    class?: string;
    children: Snippet;
  }

  const { name, width, height, fallback, decorative = false, class: className = '', children }: Props = $props();

  const room = useRoom();

  const surface = $derived<RoomSurfaceAnchor | undefined>(
    room?.anchors.surfaces?.[name] ?? (fallback ? { quad: fallback } : undefined),
  );
  const geometry = $derived.by(() => {
    if (!room || !surface || room.fit.w === 0) return null;
    const dst = surface.quad.map((p: Point) => room.toPx(p)) as Quad;
    const span = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const across = (span(dst[0], dst[1]) + span(dst[3], dst[2])) / 2;
    // blurPx is in frame px; carry it to screen px, then undo the warp's own
    // scaling, because the filter is applied before the transform.
    const screenBlur = ((surface.blurPx ?? 0) * room.fit.w) / room.anchors.frame.w;
    const blur = across > 0 ? (screenBlur * width) / across : 0;
    const c = surface.quad.reduce<Point>((acc, p) => [acc[0] + p[0] / 4, acc[1] + p[1] / 4], [0, 0]);
    const k = room.parallaxAt?.(c) ?? 0;
    const shift = Math.abs(k) > 0.01 ? `calc(var(--living-dx, 0px) * ${k.toFixed(3)}) calc(var(--living-dy, 0px) * ${k.toFixed(3)})` : null;
    return { transform: quadMatrix(width, height, dst), blur, shift };
  });
</script>

{#if geometry}
  <div
    class="ev-surface {className}"
    style:width="{width}px"
    style:height="{height}px"
    style:transform={geometry.transform}
    style:translate={geometry.shift}
    style:filter={geometry.blur > 0.05 ? `blur(${geometry.blur.toFixed(2)}px)` : null}
    aria-hidden={decorative ? 'true' : undefined}
    data-surface={name}
  >
    {@render children()}
  </div>
{/if}

<style>
  .ev-surface {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    overflow: visible;
    backface-visibility: hidden;
  }
</style>
