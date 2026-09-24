<!--
  The hologram's canvas: loads the three.js engine lazily (it must stay out
  of the first page load) and keeps it in step with what the page hands it.

  mesh      'sample' loads the sample mesh (sample mode only; the badge is up),
            a ScanMesh is the live session mesh, null draws the rings alone -
            never a stock head (SRS section 6).
  box/fit/align   which part of the ref4 frame the canvas shows, and how.
  onanchors       every anchor move, in CSS px of this canvas.

  Nothing is kept: the engine holds the mesh in GPU buffers until it is
  replaced or this component goes, and is disposed with it (RET-01..03).
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { FaceRegionKey } from '@shared/types.ts';
  import type { ScanMesh } from '@/scan/mesh.ts';
  import type { HologramAnchors, HologramController, RefBox, RegionHighlight } from '@/hologram/index.ts';
  import { session } from '@/state/session.svelte.ts';

  interface Props {
    mesh: 'sample' | ScanMesh | null;
    highlights: RegionHighlight[];
    active: FaceRegionKey | null;
    box?: RefBox;
    fit?: 'contain' | 'cover';
    align?: { x: number; y: number };
    onanchors?: (anchors: HologramAnchors) => void;
    /** Told once whether WebGL started, so the page can explain a missing head. */
    onsupport?: (supported: boolean) => void;
    class?: string;
  }

  const { mesh, highlights, active, box, fit = 'contain', align, onanchors, onsupport, class: className = '' }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let holo = $state.raw<HologramController | null>(null);
  let sampleMesh = $state.raw<ScanMesh | null>(null);
  let loadSample: (() => Promise<ScanMesh>) | null = null;
  let gone = false;

  const reducedPref = $derived(session.user?.preferences.reducedMotion ?? false);

  function systemReduced(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  onMount(() => {
    let cancelled = false;
    void (async () => {
      const lib = await import('@/hologram/index.ts');
      if (cancelled || gone || !canvas) return;
      const engine = lib.createHologram(canvas, {
        box,
        fit,
        align,
        reducedMotion: systemReduced() || reducedPref,
        onAnchors: (a) => onanchors?.(a),
      });
      loadSample = lib.loadSampleMesh;
      holo = engine;
      onsupport?.(engine.supported);
    })();
    return () => {
      cancelled = true;
    };
  });

  // The sample face is fetched only when sample mode asks for it.
  $effect(() => {
    if (!holo || mesh !== 'sample' || sampleMesh || !loadSample) return;
    void loadSample().then((m) => {
      if (!gone) sampleMesh = m;
    });
  });

  // The face: the sample mesh, the live one, or none.
  $effect(() => {
    const engine = holo;
    if (!engine) return;
    const next = mesh === 'sample' ? sampleMesh : mesh;
    engine.setMesh(next);
  });

  // Compared by value: the page hands a fresh array whenever its view recomputes.
  const regionKey = $derived(JSON.stringify(highlights));
  $effect(() => {
    const engine = holo;
    const key = regionKey;
    if (engine) engine.setRegions(JSON.parse(key) as RegionHighlight[]);
  });

  $effect(() => {
    holo?.setActiveRegion(active);
  });

  $effect(() => {
    holo?.setReducedMotion(systemReduced() || reducedPref);
  });

  onDestroy(() => {
    gone = true;
    holo?.dispose();
    holo = null;
  });
</script>

<canvas bind:this={canvas} class="holo-canvas {className}" aria-hidden="true"></canvas>

<style>
  .holo-canvas {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
