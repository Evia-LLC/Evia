<!--
  The character prototype while the scan gets ready (capture, desk only):
  there is no hologram on screen, so the figure gets a canvas and a renderer
  of its own (still one WebGL context on the page). She steps in to the
  pedestal and opens her palm toward the camera frame (`frame`, the element
  the capture sits in), glancing back at you now and then.

  Loaded only while this is mounted, which the Scan page does only with the
  prototype switched on. Everything goes when it unmounts.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { session } from '@/state/session.svelte.ts';
  import { director } from '@/stage/director.ts';
  import type { CharacterPass } from './index.ts';
  import type { PlateRect } from './room.ts';

  interface Props {
    /** Where the room plate is drawn, in this box's px (the Scan page's box). */
    plate: PlateRect | null;
    /** The element the camera frame sits in; she gestures toward its middle, her hand clear of it. */
    frame: HTMLElement | null;
  }
  const { plate, frame }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let pass = $state.raw<CharacterPass | null>(null);
  let host: { redraw(): void; dispose(): void } | null = null;
  let gone = false;
  let devRelease: (() => void) | null = null;

  function reduced(): boolean {
    const system = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return system || Boolean(session.user?.preferences.reducedMotion);
  }

  onMount(() => {
    void import('./index.ts').then(
      (lib) => {
        if (gone || !canvas) return;
        const p = lib.createCharacter({ onReady: () => host?.redraw() });
        host = lib.mountStandalone(canvas, p, reduced);
        pass = p;
        const dev = import.meta.env.DEV ? (window as unknown as { __evia?: Record<string, unknown> }).__evia : undefined;
        if (dev) {
          const handle = { pass: p, stage: lib.STAGE };
          dev.character = handle;
          // Development only: drop the handle with the figure, so it does not keep a disposed scene alive.
          devRelease = () => {
            if (dev.character === handle) delete dev.character;
          };
        }
      },
      (err) => console.warn('[scan] the character prototype could not load', err),
    );
  });

  /**
   * Where she gestures, in this canvas's px: the frame's near (left) edge, at a height in its
   * upper half as it is in view - not the middle of a column that may run far below the
   * window - and the part of the frame in view, which her arm keeps clear of (a hand under
   * the frame's panel is a hand nobody sees).
   */
  function measureFrame(): { at: { x: number; y: number } | null; box: { id: string; x: number; y: number; w: number; h: number }[] } {
    if (!frame || !canvas) return { at: null, box: [] };
    const c = canvas.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const top = Math.max(f.top, c.top);
    const bottom = Math.min(f.bottom, c.bottom);
    if (!f.width || bottom <= top) return { at: null, box: [] };
    const h = bottom - top;
    return {
      at: { x: f.left - c.left + 12, y: top - c.top + Math.min(h / 2, Math.max(40, h * 0.45)) },
      box: [{ id: 'frame', x: f.left - c.left, y: top - c.top, w: f.width, h }],
    };
  }

  let tick = $state(0);
  onMount(() => {
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => tick++) : null;
    if (canvas) ro?.observe(canvas);
    if (frame) ro?.observe(frame);
    return () => ro?.disconnect();
  });

  $effect(() => {
    void tick;
    const p = pass;
    if (!p) return;
    const m = measureFrame();
    p.setInputs({ plate, region: null, phase: 'prep', frame: m.at, avoid: m.box });
    host?.redraw();
  });

  // Under reduced motion frames are drawn on change only: what she is told to do is a change.
  $effect(() => {
    const c = director.character;
    void [c.state, c.gestureSeq, c.attention, c.speaking, c.mouthOpen];
    host?.redraw();
  });

  onDestroy(() => {
    gone = true;
    host?.dispose();
    host = null;
    pass = null;
    devRelease?.();
  });
</script>

<canvas bind:this={canvas} class="figure-stage" aria-hidden="true"></canvas>

<style>
  .figure-stage {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
