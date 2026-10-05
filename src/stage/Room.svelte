<!--
  A room: the rendered environment behind a page (BUILD-PLAN section 3.4).

  <Room room="lounge" layout="viewport">
    <RoomSurface name="niche_text" width={150} height={90}>REAL INSIGHTS ...</RoomSurface>
  </Room>

  Every room loads one way: `loadAnchors(room, variant)` (room-anchors.ts)
  reads `/env/<room>/anchors.json` - or `anchors-mobile.json` for the
  phone-portrait render - in either of the formats the Blender jobs write, and
  this stacks the plates it lists (base, then glow layers breathing in CSS,
  then the foreground), each at the size its srcset calls for. Children are
  drawn in an overlay layer on top, and `RoomSurface` (or `useRoom()`) pins
  them to the picture's own coordinates, so wall text stays on its wall at any
  window shape.

  The CSS stand-in - gradients and soft glows in the room's palette (the specs'
  environment colours), with the same anchors - is always what shows first,
  and stays until the render has loaded *and decoded*; the render then fades
  in over it. So a slow plate never leaves a bare colour behind the page, and
  a missing or broken one leaves the stand-in, which looks intentional.

  layout   viewport  fixed behind the whole shell, sidebar glass included
                     (Routine). Sits at z-index -1 inside the shell's isolated
                     stack.
           fill      fills its positioned parent (the sidebar, the Products
                     hero, the gate, Home's plate box, the Scan backdrop).
  variant  desk (anchors.json) or mobile (anchors-mobile.json, the
           phone-portrait render, where one is published).
  fit      cover  object-fit: cover of the whole render, cropped at `focus`.
           ref    the render's `ref` (the mockup's framing inside an
                  over-scanned plate) covers the box, so the room reads at the
                  mockup's scale; the plate's margin fills the rest.
  rect     the caller places the render itself (box px); overrides `fit`.
           For pages whose composition is not the box (Home's plate slid to
           the Routine panel's edge, Scan's ref4 stage).
  focus    which part of the picture to keep when cropping, as fractions
           (0.5, 0.5 is the centre). Defaults to the render's own focus.
  blurred  use the pre-blurred plate (or blur the base) for glass backdrops.
  living   bring the plate to life (default on): once the plate is on screen,
           the living renderer (./living, loaded lazily) lays a WebGL2 canvas
           over it that redraws it with its small motions - lamps flickering,
           LEDs breathing, plants swaying, city windows switching, a slow sky,
           a touch of parallax - from the masks the render publishes
           (anchors `masks`). Still under reduced motion (the system's or the
           app's), paused while hidden or off screen. Without WebGL2 the CSS
           fallback breathes the glow layer and pulses the lamps instead.
           A blurred room without a pre-blurred plate (Routine) stays still.
  onstatus told 'loading' | 'plate' | 'stand-in' as that changes.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import {
    FALLBACK_ANCHORS,
    coverFit,
    loadAnchors,
    objectPosition,
    plateSrcset,
    rectFit,
    refFit,
    setRoomContext,
    toPx,
    type Fit,
    type Point,
    type RoomAnchors,
    type RoomId,
    type RoomPlate,
    type RoomStatus,
    type RoomVariant,
  } from './room-anchors.ts';
  import type { LivingHandle, LivingState } from './living/controller.ts';

  interface Props {
    room: RoomId;
    layout?: 'viewport' | 'fill';
    variant?: RoomVariant;
    fit?: 'cover' | 'ref';
    rect?: { x: number; y: number; w: number; h: number } | null;
    focus?: Point;
    blurred?: boolean;
    /** Animate the plate from its masks (lamps, LEDs, plants, city, sky, parallax). */
    living?: boolean;
    /** Show the fallback room even when a render exists (for review). */
    forceFallback?: boolean;
    onstatus?: (status: RoomStatus) => void;
    class?: string;
    children?: Snippet;
  }

  const {
    room,
    layout = 'fill',
    variant = 'desk',
    fit: fitMode = 'cover',
    rect = null,
    focus,
    blurred = false,
    living: livingProp = true,
    forceFallback = false,
    onstatus,
    class: className = '',
    children,
  }: Props = $props();

  /* The render's anchors (null: none published, or not answered yet). */
  let loaded = $state.raw<RoomAnchors | null>(null);
  /* Whether the anchors question has been answered. */
  let settled = $state(false);
  /* The render's first plate has loaded and decoded. */
  let ready = $state(false);
  /* The stand-in has been faded over and can go. */
  let covered = $state(false);
  let broken = $state(false);
  /* The box's size in fractional px (the <img> is drawn at that size; whole-px clientWidth would put
     a large plate's anchors, and the living canvas, up to a pixel off the picture). */
  let box = $state.raw<DOMRectReadOnly | null>(null);
  const width = $derived(box?.width ?? 0);
  const height = $derived(box?.height ?? 0);

  $effect(() => {
    const id = room;
    const want = variant;
    let live = true;
    loaded = null;
    settled = false;
    ready = false;
    covered = false;
    broken = false;
    void loadAnchors(id, want).then((anchors) => {
      if (!live) return;
      loaded = anchors;
      settled = true;
    });
    return () => {
      live = false;
    };
  });

  /* Once the render is on screen, the stand-in under it goes after the fade. */
  $effect(() => {
    if (!ready) return;
    const timer = setTimeout(() => (covered = true), 700);
    return () => clearTimeout(timer);
  });

  /** A render to show (it may still be on its way). */
  const live = $derived(!forceFallback && !broken && loaded !== null);
  const status = $derived<RoomStatus>(live ? (ready ? 'plate' : 'loading') : settled || forceFallback || broken ? 'stand-in' : 'loading');
  const fallback = $derived(status !== 'plate');

  $effect(() => {
    onstatus?.(status);
  });

  function place(a: RoomAnchors, at: Point): Fit {
    if (rect) return rectFit(a.frame.w, rect);
    if (fitMode === 'ref' && a.ref) return refFit(a.frame.w, a.frame.h, a.ref, width, height, at);
    return coverFit(a.frame.w, a.frame.h, width, height, at);
  }

  /* The render's own geometry, used to lay out its plates while they load. */
  const plateAt = $derived<Point>(focus ?? loaded?.frame.focus ?? [0.5, 0.5]);
  const plateFit = $derived(loaded ? place(loaded, plateAt) : null);
  /* Placed (explicit rect or ref framing) rather than object-fit: cover. */
  const placed = $derived(!!rect || (fitMode === 'ref' && !!loaded?.ref));

  /* What the page sees: the render's geometry once it shows, the stand-in's before. */
  const anchors = $derived<RoomAnchors>(!fallback && loaded ? loaded : FALLBACK_ANCHORS[room]);
  const at = $derived<Point>(focus ?? anchors.frame.focus ?? [0.5, 0.5]);
  const fit = $derived(!fallback && plateFit ? plateFit : place(anchors, at));

  const plates = $derived.by((): RoomPlate[] => {
    if (!live || !loaded) return [];
    const list = loaded.plates?.length ? loaded.plates : [{ src: 'room.webp', kind: 'base' as const }];
    if (blurred && list.some((p) => p.kind === 'blur')) return list.filter((p) => p.kind === 'blur');
    const shown = list.filter((p) => p.kind !== 'blur');
    // The CSS fallback's breathing: the LEDs' own light (the glow layer) swelling a little over the plate.
    const glow = cssLiving && !blurred ? loaded.living?.masks.glow : undefined;
    if (glow && !shown.some((p) => p.kind === 'glow')) {
      shown.push({ src: glow.src, kind: 'glow', blend: 'plus-lighter', animate: 'boost', widths: glow.widths });
    }
    return shown;
  });

  const resolve = (src: string) => (/^(https?:)?\//.test(src) ? src : `/env/${room}/${src}`);
  /* The width the plates are drawn at, for srcset (unknown until measured). */
  const sizes = $derived(plateFit && plateFit.w > 0 ? `${Math.ceil(plateFit.w)}px` : '100vw');

  /* The plate <img> on screen (the living canvas draws from the same file). */
  let plateImg = $state.raw<HTMLImageElement | null>(null);

  function markReady(img: HTMLImageElement) {
    const done = () => {
      if (!img.isConnected) return;
      plateImg = img;
      ready = true;
    };
    void img.decode().then(done, done);
  }

  /* ---- the living plate ---------------------------------------------------- */

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let overlayEl = $state<HTMLDivElement | null>(null);
  let livingHandle = $state.raw<LivingHandle | null>(null);
  let livingState = $state<LivingState | 'off'>('off');
  /* How far a point of the plate moves with the parallax (for HTML pinned to it). */
  let parallaxAt = $state.raw<((point: Point) => number) | null>(null);

  /** A blurred room animates only from a pre-blurred plate (the sidebar strip); Routine's CSS blur stays still. */
  const livingWanted = $derived(
    livingProp &&
      live &&
      !!loaded?.living &&
      (!blurred || !!loaded.plates?.some((p) => p.kind === 'blur')),
  );

  $effect(() => {
    const canvas = canvasEl;
    const img = plateImg;
    const anchors = loaded;
    if (!livingWanted || !ready || !canvas || !img || !anchors) return;
    let handle: LivingHandle | null = null;
    let gone = false;
    // The geometry follows through setGeometry below; a resize must not remount the renderer.
    const geometry = untrack(() => (plateFit ? { fit: plateFit, boxW: width, boxH: height } : null));
    if (!geometry) return;
    // After the page has painted: the room is already on screen as a picture.
    const w = window as Window & { requestIdleCallback?: Window['requestIdleCallback'] };
    const idle = (cb: () => void): (() => void) => {
      if (w.requestIdleCallback) {
        const id = w.requestIdleCallback(cb, { timeout: 1200 });
        return () => w.cancelIdleCallback(id);
      }
      const id = setTimeout(cb, 300);
      return () => clearTimeout(id);
    };
    const cancelIdle = idle(() => {
      void import('./living/controller.ts').then(({ mountLiving }) => {
        if (gone) return;
        handle = mountLiving({
          host: canvas.parentElement as HTMLElement,
          canvas,
          overlay: overlayEl,
          room: untrack(() => room),
          anchors,
          plateUrl: img.currentSrc || img.src,
          resolve,
          blurred: untrack(() => blurred),
          geometry,
          onstate: (next) => (livingState = next),
          onparallax: (fn) => (parallaxAt = fn),
        });
        livingHandle = handle;
      });
    });
    return () => {
      gone = true;
      cancelIdle();
      handle?.destroy();
      livingHandle = null;
      livingState = 'off';
      parallaxAt = null;
    };
  });

  $effect(() => {
    if (livingHandle && plateFit) livingHandle.setGeometry({ fit: plateFit, boxW: width, boxH: height });
  });

  /* Without WebGL2 (or after a lost context): the CSS fallback's breathing glow and lamp halos. */
  const cssLiving = $derived(livingState === 'unsupported' && !!loaded?.living);
  const halos = $derived.by(() => {
    if (!cssLiving || !loaded?.living || !plateFit) return [];
    return loaded.living.lights
      .filter((l) => (l.motion === 'flicker' || l.motion === 'breathe') && (l.visible ?? 1) > 0.05)
      .map((l) => {
        const [x, y] = toPx(plateFit, [l.cx, l.cy]);
        const r = Math.max(6, Math.max(l.rx, 0.004) * plateFit.w * 7);
        return { id: l.id, motion: l.motion, x, y, r };
      });
  });

  setRoomContext({
    get room() {
      return room;
    },
    get anchors() {
      return anchors;
    },
    get fit() {
      return fit;
    },
    get fallback() {
      return fallback;
    },
    get status() {
      return status;
    },
    toPx: (point: Point) => toPx(fit, point),
    parallaxAt: (point: Point) => (parallaxAt && !fallback ? parallaxAt(point) : 0),
  });

  /* The fallback's wall panels sit on the same quads as the text, so a page's
     wall copy has something to sit on before the render exists. */
  const panels = $derived(
    fallback
      ? Object.entries(anchors.surfaces ?? {}).map(([name, s]) => {
          const pts = s.quad.map((p) => toPx(fit, p));
          const xs = pts.map((p) => p[0]);
          const ys = pts.map((p) => p[1]);
          const padX = (Math.max(...xs) - Math.min(...xs)) * 0.22;
          const padY = (Math.max(...ys) - Math.min(...ys)) * 0.3;
          return {
            name,
            left: Math.min(...xs) - padX,
            top: Math.min(...ys) - padY,
            w: Math.max(...xs) - Math.min(...xs) + padX * 2,
            h: Math.max(...ys) - Math.min(...ys) + padY * 2.4,
          };
        })
      : [],
  );
</script>

<div
  class="ev-room ev-room--{layout} {className}"
  data-room={room}
  data-variant={variant}
  data-status={status}
  data-fallback={fallback ? 'true' : null}
  data-living={livingWanted ? livingState : null}
  class:is-blurred={blurred}
  class:is-living={livingState === 'live'}
  bind:contentRect={box}
>
  {#if !covered}
    <div class="ev-room__fallback" aria-hidden="true">
      <span class="ev-room__glow ev-room__glow--a"></span>
      <span class="ev-room__glow ev-room__glow--b"></span>
      <span class="ev-room__glow ev-room__glow--c"></span>
      {#each panels as panel (panel.name)}
        <span
          class="ev-room__panel ev-room__panel--{panel.name}"
          style:left="{panel.left}px"
          style:top="{panel.top}px"
          style:width="{panel.w}px"
          style:height="{panel.h}px"
        ></span>
      {/each}
    </div>
  {/if}
  {#if plates.length && plateFit}
    <div
      class="ev-room__stack"
      class:is-placed={placed}
      class:is-ready={ready}
      style:left={placed ? `${plateFit.x}px` : null}
      style:top={placed ? `${plateFit.y}px` : null}
      style:width={placed ? `${plateFit.w}px` : null}
      style:height={placed ? `${plateFit.h}px` : null}
    >
      {#each plates as plate, i (plate.src + i)}
        <img
          class="ev-room__plate ev-room__plate--{plate.kind ?? 'base'}"
          class:is-breathing={plate.animate === 'breathe'}
          class:is-boost={plate.animate === 'boost'}
          src={resolve(plate.src)}
          srcset={plateSrcset(plate, resolve)}
          sizes={plate.widths?.length ? sizes : null}
          alt=""
          aria-hidden="true"
          decoding="async"
          fetchpriority={i === 0 ? 'high' : 'low'}
          draggable="false"
          style:object-position={placed ? null : objectPosition(plateAt)}
          style:mix-blend-mode={plate.blend ?? null}
          style:opacity={plate.opacity ?? null}
          onload={(event) => {
            if (i === 0) markReady(event.currentTarget as HTMLImageElement);
          }}
          onerror={() => {
            if (i === 0 || (plate.kind ?? 'base') === 'base' || plate.kind === 'blur') broken = true;
          }}
        />
      {/each}
    </div>
  {/if}

  {#if livingWanted && plates.length && plateFit}
    <canvas class="ev-room__living" class:is-live={livingState === 'live'} bind:this={canvasEl} aria-hidden="true"></canvas>
  {/if}
  {#if halos.length}
    <div class="ev-room__halos" aria-hidden="true">
      {#each halos as h (h.id)}
        <span
          class="ev-room__halo ev-room__halo--{h.motion}"
          style:left="{h.x - h.r}px"
          style:top="{h.y - h.r}px"
          style:width="{h.r * 2}px"
          style:height="{h.r * 2}px"
          style:animation-delay="{-h.id * 1.7}s"
        ></span>
      {/each}
    </div>
  {/if}

  {#if children}
    <div class="ev-room__overlay" bind:this={overlayEl}>{@render children()}</div>
  {/if}
</div>

<style>
  /*
   * The stand-in palettes live in tokens.css (ENVIRONMENT STAND-INS), taken
   * from the specs' environment tables; this file only arranges them.
   */
  .ev-room {
    position: relative;
    overflow: hidden;
    background-color: var(--env-floor-2);
    contain: paint;
  }
  .ev-room--viewport {
    position: fixed;
    inset: 0;
    z-index: var(--z-backdrop);
  }
  .ev-room--fill {
    position: absolute;
    inset: 0;
  }

  /* The render's plates, faded in over the stand-in once decoded. */
  .ev-room__stack {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 450ms var(--ease-out);
    pointer-events: none;
  }
  .ev-room__stack.is-placed {
    inset: auto;
  }
  .ev-room__stack.is-ready {
    opacity: 1;
  }
  .ev-room__plate {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
    pointer-events: none;
  }
  /* A placed stack has the render's own shape: nothing to crop. */
  .is-placed > .ev-room__plate {
    object-fit: fill;
  }
  .ev-room__plate--glow {
    mix-blend-mode: plus-lighter;
  }
  @supports not (mix-blend-mode: plus-lighter) {
    .ev-room__plate--glow {
      mix-blend-mode: screen;
    }
  }
  .is-blurred .ev-room__plate--base {
    filter: blur(16px) saturate(1.05);
    transform: scale(1.06);
  }
  .ev-room__plate.is-breathing,
  .ev-room__glow {
    animation: ev-room-breathe var(--dur-ambient) var(--ease-in-out) infinite alternate;
  }
  /* An extra on top of the plate as rendered (the consult room's LEDs, the
     lounge's glow layer in the CSS fallback): from nothing to a little and
     back over 8 s, about a tenth of the LEDs' light (scan.md and home.md
     section 9: +-5 %, 0.9 <-> 1.0). */
  .ev-room__plate.is-boost {
    opacity: 0;
    animation: ev-room-boost 4s var(--ease-in-out) infinite alternate;
  }

  /* The living plate: over the picture, under the overlays. Its first frame is
     the plate exactly, so it fades in without a seam. */
  .ev-room__living {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity 600ms var(--ease-out);
  }
  .ev-room__living.is-live {
    opacity: 1;
  }
  /* While it draws, the plates' own CSS breathing under it has nothing to do. */
  .is-living .ev-room__plate.is-breathing,
  .is-living .ev-room__plate.is-boost {
    animation: none;
  }

  /* The CSS fallback's lamps: a warm halo breathing (globes) or shivering (candles). */
  .ev-room__halos {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .ev-room__halo {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgba(255, 186, 120, 0.3), rgba(255, 170, 110, 0.1) 55%, transparent);
    mix-blend-mode: plus-lighter;
    opacity: 0.46;
    animation: ev-room-lamp 3.5s var(--ease-in-out) infinite alternate;
  }
  .ev-room__halo--flicker {
    animation: ev-room-candle 13s var(--ease-in-out) infinite;
  }
  @supports not (mix-blend-mode: plus-lighter) {
    .ev-room__halo {
      mix-blend-mode: screen;
    }
  }

  .ev-room__overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .ev-room__overlay > :global(*) {
    pointer-events: auto;
  }

  /* ---- the fallback room ---- */
  .ev-room__fallback {
    position: absolute;
    inset: 0;
  }
  .ev-room__glow {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
    filter: blur(2px);
  }
  .ev-room__panel {
    position: absolute;
    border-radius: 18px 18px 10px 10px;
  }

  /* Lounge at dusk: a coral-to-violet sky in a tall window on the left, warm
     plaster to the right, an amber ceiling cove, lamp glows, a darker floor. */
  .ev-room[data-room='lounge'] .ev-room__fallback {
    background:
      radial-gradient(60% 18% at 50% -2%, rgba(var(--env-cove-rgb), 0.75), transparent 70%),
      radial-gradient(38% 55% at 28% 42%, rgba(var(--env-dusk-rgb), 0.55), transparent 70%),
      linear-gradient(
        180deg,
        var(--env-sky-1) 0%,
        var(--env-sky-2) 22%,
        var(--env-sky-3) 34%,
        var(--env-sky-4) 42%,
        var(--env-wall-4) 52%,
        var(--env-floor-1) 74%,
        var(--env-floor-2) 100%
      );
  }
  .ev-room[data-room='lounge'] .ev-room__fallback::before {
    /* the warm right-hand wall */
    content: '';
    position: absolute;
    inset: 0 0 0 48%;
    background:
      radial-gradient(70% 50% at 70% 30%, rgba(var(--env-ember-rgb), 0.45), transparent 70%),
      linear-gradient(
        180deg,
        var(--env-wall-1) 0%,
        var(--env-wall-2) 30%,
        var(--env-wall-3) 55%,
        var(--env-floor-1) 80%,
        var(--env-floor-2) 100%
      );
    -webkit-mask: linear-gradient(90deg, transparent, #000 18%);
    mask: linear-gradient(90deg, transparent, #000 18%);
  }
  .ev-room[data-room='lounge'] .ev-room__fallback::after {
    /* the ceiling cove, a long amber arc */
    content: '';
    position: absolute;
    left: 6%;
    right: -10%;
    top: -14%;
    height: 26%;
    border-radius: 0 0 50% 50%;
    box-shadow:
      0 6px 0 -2px rgba(var(--env-cove-rgb), 0.85),
      0 12px 38px rgba(var(--env-ember-rgb), 0.55);
  }
  .ev-room[data-room='lounge'] .ev-room__glow--a {
    left: 57%;
    top: 58%;
    width: 9vmax;
    height: 9vmax;
    background: radial-gradient(circle, rgba(var(--env-lamp-rgb), 0.8), transparent 65%);
  }
  .ev-room[data-room='lounge'] .ev-room__glow--b {
    left: 88%;
    top: 50%;
    width: 7vmax;
    height: 7vmax;
    background: radial-gradient(circle, rgba(var(--env-lamp-rgb), 0.75), transparent 65%);
    animation-delay: -3s;
  }
  .ev-room[data-room='lounge'] .ev-room__glow--c {
    left: 18%;
    top: 36%;
    width: 30vmax;
    height: 14vmax;
    background: radial-gradient(closest-side, rgba(var(--env-ember-rgb), 0.3), transparent);
    animation-delay: -5s;
  }
  .ev-room[data-room='lounge'] .ev-room__panel {
    background:
      radial-gradient(90% 70% at 50% 45%, rgba(var(--env-panel-rgb), 0.9), transparent 70%),
      var(--env-wall-3);
    box-shadow:
      0 0 0 2px rgba(var(--env-lamp-rgb), 0.55),
      0 0 28px 6px rgba(var(--env-cove-rgb), 0.35);
  }
  .ev-room[data-room='lounge'] .ev-room__panel--sign_text {
    border-radius: 6px;
    background: linear-gradient(160deg, rgba(var(--env-panel-rgb), 0.45), rgba(var(--env-shade-rgb), 0.35));
    box-shadow:
      inset 0 0 0 1px rgba(var(--env-etch-rgb), 0.45),
      0 8px 22px rgba(var(--env-shade-rgb), 0.35);
  }

  /* Consult room at night: navy window, rose-gold coves, copper warmth low. */
  .ev-room[data-room='consult'] {
    background-color: var(--navy-900);
  }
  .ev-room[data-room='consult'] .ev-room__fallback {
    background:
      radial-gradient(70% 22% at 50% 0%, rgba(var(--env-rosegold-rgb), 0.35), transparent 70%),
      radial-gradient(30% 60% at 4% 50%, rgba(var(--env-copper-rgb), 0.5), transparent 70%),
      radial-gradient(30% 60% at 96% 50%, rgba(var(--env-copper-rgb), 0.45), transparent 70%),
      radial-gradient(45% 26% at 50% 96%, rgba(var(--env-copper-rgb), 0.55), transparent 75%),
      linear-gradient(
        180deg,
        var(--navy-950) 0%,
        var(--navy-900) 38%,
        var(--env-night-1) 62%,
        var(--env-night-2) 84%,
        var(--env-night-3) 100%
      );
  }
  .ev-room[data-room='consult'] .ev-room__fallback::before {
    /* two vertical LED coves, one on each wall */
    content: '';
    position: absolute;
    inset: 8% 0 18%;
    background:
      linear-gradient(90deg, transparent 0 7%, rgba(var(--env-led-rgb), 0.85) 7.2%, transparent 7.9%),
      linear-gradient(270deg, transparent 0 7%, rgba(var(--env-led-rgb), 0.85) 7.2%, transparent 7.9%);
    filter: blur(1.5px) drop-shadow(0 0 12px rgba(var(--env-rosegold-rgb), 0.8));
    opacity: 0.8;
  }
  .ev-room[data-room='consult'] .ev-room__glow--a {
    left: 20%;
    top: 30%;
    width: 16vmax;
    height: 16vmax;
    background: radial-gradient(circle, rgba(var(--env-rosegold-rgb), 0.16), transparent 65%);
  }
  .ev-room[data-room='consult'] .ev-room__glow--b {
    left: 64%;
    top: 22%;
    width: 18vmax;
    height: 18vmax;
    background: radial-gradient(circle, rgba(var(--holo-cyan-rgb), 0.1), transparent 65%);
    animation-delay: -3s;
  }
  .ev-room[data-room='consult'] .ev-room__glow--c {
    left: 38%;
    top: 78%;
    width: 24vmax;
    height: 8vmax;
    background: radial-gradient(closest-side, rgba(var(--env-rosegold-rgb), 0.45), transparent);
    animation-delay: -5s;
  }

  /* The sidebar strip: dark plaster, a cove at the top, a dusk window, LED
     ledges near the floor. */
  .ev-room[data-room='lounge-strip-window'] .ev-room__fallback {
    background:
      radial-gradient(120% 10% at 60% 0%, rgba(var(--env-ember-rgb), 0.7), transparent 70%),
      radial-gradient(60% 22% at 90% 34%, rgba(var(--env-mauve-rgb), 0.55), transparent 70%),
      radial-gradient(90% 8% at 40% 76%, rgba(var(--env-cove-rgb), 0.55), transparent 70%),
      radial-gradient(90% 6% at 50% 84%, rgba(var(--env-lamp-rgb), 0.35), transparent 70%),
      linear-gradient(
        180deg,
        var(--env-plaster-1) 0%,
        var(--env-plaster-2) 40%,
        var(--env-plaster-3) 70%,
        var(--env-plaster-4) 100%
      );
  }
  .ev-room[data-room='lounge-strip-window'] .ev-room__glow--a {
    left: 60%;
    top: 20%;
    width: 60%;
    height: 30%;
    background: radial-gradient(closest-side, rgba(var(--env-dusk-rgb), 0.35), transparent);
  }
  .ev-room[data-room='lounge-strip-window'] .ev-room__glow--b,
  .ev-room[data-room='lounge-strip-window'] .ev-room__glow--c {
    display: none;
  }

  /* The dim spa corner behind the Products nav: chocolate, candle, cove. */
  .ev-room[data-room='lounge-strip-interior'] .ev-room__fallback {
    background:
      radial-gradient(40% 5% at 30% 56%, rgba(var(--env-lamp-rgb), 0.6), transparent 70%),
      radial-gradient(60% 8% at 80% 45%, rgba(var(--env-ember-rgb), 0.4), transparent 70%),
      radial-gradient(120% 6% at 30% 78%, rgba(var(--env-ember-rgb), 0.6), transparent 70%),
      linear-gradient(
        180deg,
        var(--env-plaster-1) 0%,
        var(--env-plaster-1) 25%,
        var(--env-plaster-3) 45%,
        var(--env-shelf) 50%,
        var(--env-plaster-3) 60%,
        var(--env-plaster-2) 100%
      );
  }
  .ev-room[data-room='lounge-strip-interior'] .ev-room__glow {
    display: none;
  }

  /* The Products campaign set: dusty rose top-left, pale blush below,
     peach toward the window on the right, one lamp. */
  .ev-room[data-room='products-hero'] {
    background-color: var(--env-set-4);
  }
  .ev-room[data-room='products-hero'] .ev-room__fallback {
    background:
      radial-gradient(18% 40% at 79% 28%, rgba(var(--env-blush-rgb), 0.95), transparent 70%),
      radial-gradient(60% 90% at 100% 0%, rgba(var(--env-blush-rgb), 0.7), transparent 70%),
      linear-gradient(
        170deg,
        var(--env-set-1) 0%,
        var(--env-set-2) 35%,
        var(--env-set-3) 55%,
        var(--env-set-4) 80%,
        var(--env-set-5) 100%
      );
  }
  .ev-room[data-room='products-hero'] .ev-room__glow {
    display: none;
  }

  .is-blurred .ev-room__fallback {
    filter: blur(10px);
    transform: scale(1.05);
  }

  @keyframes ev-room-boost {
    from {
      opacity: 0;
    }
    to {
      opacity: 0.12;
    }
  }
  @keyframes ev-room-breathe {
    from {
      opacity: 0.6;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes ev-room-lamp {
    from {
      opacity: 0.42;
    }
    to {
      opacity: 0.5;
    }
  }
  /* Irregular, small and slow (a change every two seconds or so): never a flash. */
  @keyframes ev-room-candle {
    0% {
      opacity: 0.47;
    }
    17% {
      opacity: 0.51;
    }
    33% {
      opacity: 0.45;
    }
    50% {
      opacity: 0.5;
    }
    68% {
      opacity: 0.44;
    }
    84% {
      opacity: 0.49;
    }
    100% {
      opacity: 0.47;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ev-room__plate.is-breathing,
    .ev-room__plate.is-boost,
    .ev-room__glow {
      animation: none;
    }
    .ev-room__stack,
    .ev-room__living {
      transition: none;
    }
    .ev-room__halos {
      display: none;
    }
  }
  :global([data-reduced-motion='true']) .ev-room__plate.is-breathing,
  :global([data-reduced-motion='true']) .ev-room__plate.is-boost,
  :global([data-reduced-motion='true']) .ev-room__glow {
    animation: none;
  }
  :global([data-reduced-motion='true']) .ev-room__stack,
  :global([data-reduced-motion='true']) .ev-room__living {
    transition: none;
  }
  :global([data-reduced-motion='true']) .ev-room__halos {
    display: none;
  }
</style>
