<!--
  A room: the rendered environment behind a page (BUILD-PLAN section 3.4).

  <Room room="lounge" layout="viewport">
    <RoomSurface name="niche_text" width={150} height={90}>REAL INSIGHTS ...</RoomSurface>
  </Room>

  It loads `/env/<room>/anchors.json` when there is one and stacks the plates it
  lists (base, then glow layers breathing in CSS, then the foreground), each
  with object-fit: cover at the same focus. Children are drawn in an overlay
  layer on top, and `RoomSurface` (or `useRoom()` from room-anchors.ts) pins
  them to the picture's own coordinates, so wall text stays on its wall at
  any window shape.

  Until the renders land - or if a plate fails to load - it shows a stand-in
  built from CSS gradients and soft glows in the room's palette (the specs'
  environment colours), with the same anchors, so a page looks intentional
  either way.

  layout   viewport  fixed behind the whole shell, sidebar glass included
                     (Home, Routine). Sits at z-index -1 inside the shell's
                     isolated stack.
           fill      fills its positioned parent (the sidebar, the Products
                     hero).
  focus    which part of the picture to keep when cropping, as fractions
           (0.5, 0.5 is the centre). Defaults to the render's own focus.
  blurred  use the pre-blurred plate (or blur the base) for glass backdrops.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import {
    FALLBACK_ANCHORS,
    coverFit,
    loadAnchors,
    objectPosition,
    setRoomContext,
    toPx,
    type Point,
    type RoomAnchors,
    type RoomId,
    type RoomPlate,
  } from './room-anchors.ts';

  interface Props {
    room: RoomId;
    layout?: 'viewport' | 'fill';
    focus?: Point;
    blurred?: boolean;
    /** Show the fallback room even when a render exists (for review). */
    forceFallback?: boolean;
    class?: string;
    children?: Snippet;
  }

  const {
    room,
    layout = 'fill',
    focus,
    blurred = false,
    forceFallback = false,
    class: className = '',
    children,
  }: Props = $props();

  let loaded = $state<RoomAnchors | null>(null);
  let broken = $state(false);
  let width = $state(0);
  let height = $state(0);

  $effect(() => {
    const id = room;
    let live = true;
    loaded = null;
    broken = false;
    void loadAnchors(id).then((anchors) => {
      if (live) loaded = anchors;
    });
    return () => {
      live = false;
    };
  });

  const fallback = $derived(forceFallback || broken || loaded === null);
  const anchors = $derived<RoomAnchors>(fallback ? FALLBACK_ANCHORS[room] : (loaded ?? FALLBACK_ANCHORS[room]));
  const at = $derived<Point>(focus ?? anchors.frame.focus ?? [0.5, 0.5]);
  const fit = $derived(coverFit(anchors.frame.w, anchors.frame.h, width, height, at));

  const plates = $derived.by((): RoomPlate[] => {
    if (fallback || !loaded) return [];
    const list = loaded.plates?.length ? loaded.plates : [{ src: 'room.webp', kind: 'base' as const }];
    if (blurred && list.some((p) => p.kind === 'blur')) return list.filter((p) => p.kind === 'blur');
    return list.filter((p) => p.kind !== 'blur');
  });

  const base = (src: string) => (/^(https?:)?\//.test(src) ? src : `/env/${room}/${src}`);

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
    toPx: (point: Point) => toPx(fit, point),
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
  data-fallback={fallback ? 'true' : null}
  class:is-blurred={blurred}
  bind:clientWidth={width}
  bind:clientHeight={height}
>
  {#if fallback}
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
  {:else}
    {#each plates as plate, i (plate.src + i)}
      <img
        class="ev-room__plate ev-room__plate--{plate.kind ?? 'base'}"
        class:is-breathing={plate.animate === 'breathe'}
        src={base(plate.src)}
        alt=""
        aria-hidden="true"
        decoding="async"
        fetchpriority={i === 0 ? 'high' : 'low'}
        draggable="false"
        style:object-position={objectPosition(at)}
        style:mix-blend-mode={plate.blend ?? null}
        style:opacity={plate.opacity ?? null}
        onerror={() => {
          if ((plate.kind ?? 'base') === 'base' || plate.kind === 'blur') broken = true;
        }}
      />
    {/each}
  {/if}

  {#if children}
    <div class="ev-room__overlay">{@render children()}</div>
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

  .ev-room__plate {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
    pointer-events: none;
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

  @keyframes ev-room-breathe {
    from {
      opacity: 0.6;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ev-room__plate.is-breathing,
    .ev-room__glow {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .ev-room__plate.is-breathing,
  :global([data-reduced-motion='true']) .ev-room__glow {
    animation: none;
  }
</style>
