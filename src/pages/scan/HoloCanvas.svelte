<!--
  The hologram's canvas: loads the three.js engine lazily (it must stay out
  of the first page load) and keeps it in step with what the page hands it.

  mesh      'sample' loads the sample mesh (sample mode only; the badge is up),
            a ScanMesh is the live session mesh, null draws the rings alone -
            never a stock head (SRS section 6).
  box/fit/align   which part of the ref4 frame the canvas shows, and how.
  onanchors       every anchor move, in CSS px of this canvas, with the projected
                  face oval's bounding box (the consult tour's card placement).
  onformed        once per face, when it has fully formed (the tour starts).
  pulse           the tour's tap: a ripple from that region's anchor, once per `at`.
  zoneFade        how long zones take to fade out when the highlights empty (ms).

  extend          (character prototype) the canvas grows past this box to
                  cover a larger part of the frame; the hologram keeps the
                  box's eye, so it is drawn exactly as without it.
  character       (character prototype, off unless switched on) the stand-in
                  figure's inputs; while set, the figure is loaded lazily and
                  drawn under the hologram in this same canvas and context.

  Nothing is kept: the engine holds the mesh in GPU buffers until it is
  replaced or this component goes, and is disposed with it (RET-01..03).
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { FaceRegionKey } from '@shared/types.ts';
  import type { ScanMesh } from '@/scan/mesh.ts';
  import type { HologramAnchors, HologramController, RefBox, RegionHighlight } from '@/hologram/index.ts';
  import { HOLOGRAM_BOX } from '@/hologram/layout.ts';
  import type { CharacterInputs, CharacterPass } from '@/character3d/index.ts';
  import { director } from '@/stage/director.ts';
  import { tour, tourNow } from '@/stage/tour.svelte.ts';
  import { session } from '@/state/session.svelte.ts';

  interface Props {
    mesh: 'sample' | ScanMesh | null;
    highlights: RegionHighlight[];
    active: FaceRegionKey | null;
    box?: RefBox;
    fit?: 'contain' | 'cover';
    align?: { x: number; y: number };
    onanchors?: (anchors: HologramAnchors, face: { x: number; y: number; w: number; h: number } | null) => void;
    /** Told once whether WebGL started, so the page can explain a missing head. */
    onsupport?: (supported: boolean) => void;
    /** Once per face: it has fully formed. */
    onformed?: () => void;
    /** The consult tour's tap: a ripple from this region's anchor, once per `at`. */
    pulse?: { region: FaceRegionKey; at: number } | null;
    /** How long the zones take to fade out when the highlights empty, ms (0: at once). */
    zoneFade?: number;
    /** Character prototype: the canvas covers this part of the frame (the box keeps its place). */
    extend?: RefBox;
    /** Character prototype: the figure's inputs (null or absent: no figure, nothing loaded). */
    character?: CharacterInputs | null;
    /** Character prototype: she is loaded and drawing (true), or gone (false). */
    onfigure?: (present: boolean) => void;
    class?: string;
  }

  const {
    mesh,
    highlights,
    active,
    box,
    fit = 'contain',
    align,
    onanchors,
    onsupport,
    onformed,
    pulse = null,
    zoneFade = 550,
    extend,
    character = null,
    onfigure,
    class: className = '',
  }: Props = $props();

  /* The canvas's place in its host when it covers `extend`: percentages of the host's box. */
  const host = $derived(box ?? HOLOGRAM_BOX);
  const canvasStyle = $derived(
    extend
      ? `position:absolute;left:${((extend.x - host.x) / host.w) * 100}%;top:${((extend.y - host.y) / host.h) * 100}%;` +
          `width:${(extend.w / host.w) * 100}%;height:${(extend.h / host.h) * 100}%`
      : '',
  );
  let figure = $state.raw<CharacterPass | null>(null);

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
      const hostBox = box ?? lib.HOLOGRAM_BOX;
      // The face bounds ride along with every anchor move (the engine exists by the first frame).
      let made: HologramController | null = null;
      const engine = lib.createHologram(canvas, {
        box: extend ?? box,
        eye: extend ? { x: hostBox.x + hostBox.w / 2, y: hostBox.y + hostBox.h / 2 } : undefined,
        fit,
        align,
        reducedMotion: systemReduced() || reducedPref,
        onAnchors: (a) => onanchors?.(a, made?.faceBounds() ?? null),
        onFormed: () => onformed?.(),
        clock: tourNow,
      });
      made = engine;
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
    if (engine) engine.setRegions(JSON.parse(key) as RegionHighlight[], { fadeOutMs: untrack(() => zoneFade) });
  });

  // The tour's tap: once per contact.
  let pulsed = -1;
  $effect(() => {
    const engine = holo;
    const p = pulse;
    if (!engine || !p || p.at === pulsed) return;
    pulsed = p.at;
    engine.pulse(p.region);
  });

  $effect(() => {
    holo?.setActiveRegion(active);
  });

  $effect(() => {
    holo?.setReducedMotion(systemReduced() || reducedPref);
  });

  /* ---- the character prototype: loaded only while `character` is set ---------- */
  const wantsFigure = $derived(character !== null);
  $effect(() => {
    const engine = holo;
    if (!engine || !wantsFigure) return;
    let live = true;
    let devRelease: (() => void) | null = null;
    void import('@/character3d/index.ts').then(
      (lib) => {
        if (!live || gone) return;
        const pass = lib.createCharacter({
          onReady: () => {
            engine.redraw();
            if (live) onfigure?.(true);
          },
        });
        engine.setPass(pass);
        figure = pass;
        // Development: the figure beside the director on window.__evia (see src/character3d/README.md),
        // dropped with it so the handle never keeps a disposed scene alive.
        const dev = import.meta.env.DEV ? (window as unknown as { __evia?: Record<string, unknown> }).__evia : undefined;
        if (dev) {
          const handle = { pass, stage: lib.STAGE };
          dev.character = handle;
          devRelease = () => {
            if (dev.character === handle) delete dev.character;
          };
        }
      },
      (err) => {
        console.warn('[scan] the character prototype could not load', err);
        onfigure?.(false);
      },
    );
    return () => {
      live = false;
      onfigure?.(false);
      figure = null;
      devRelease?.();
      // The engine disposes the pass it was given.
      engine.setPass(null);
    };
  });

  $effect(() => {
    const pass = figure;
    const inputs = character;
    if (!pass || !inputs) return;
    pass.setInputs(inputs);
    holo?.redraw();
  });

  // The tour's clock moved (every frame while it animates, or a step of the development clock):
  // the ripple and her stage read it, so a frame is due.
  $effect(() => {
    void tour.time;
    holo?.redraw();
  });

  // Under reduced motion frames are drawn only on change: what she is told to do is a change.
  $effect(() => {
    const c = director.character;
    void [c.state, c.gestureSeq, c.attention, c.speaking, c.mouthOpen, director.hologram.activeRegion];
    if (figure) holo?.redraw();
  });

  onDestroy(() => {
    gone = true;
    holo?.dispose();
    holo = null;
  });
</script>

<canvas bind:this={canvas} class="holo-canvas {className}" style={canvasStyle} aria-hidden="true"></canvas>

<style>
  .holo-canvas {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
