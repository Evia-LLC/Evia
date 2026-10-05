<!--
  The consult room behind the Scan page, full-bleed.

  The room is a `Room` like every other: it loads the Blender render the one
  way rooms load (loadAnchors, via consult-plate.ts), shows its CSS stand-in
  (navy window, rose-gold coves) from the first frame and until the render has
  decoded, then fades the render in over it with its LED boost layer
  breathing. What this component adds is where the render goes (`rect`),
  because the Scan page composes on a stage rather than on the box:

  desk    the plate's `refFrame` lines up with the ref4 design stage, so the
          pedestal sits under the tray and the wall, book and pedestal text
          (HTML, never baked into the render) land on their surfaces.
  pinned  the portrait layouts pin the pedestal's emitter to a point of the
          screen, under the hologram, at the smallest scale that still covers.
          Narrow portrait windows (phones) use the job's phone-portrait render,
          framed for that shape; wider ones the landscape render.

  Without the plate, the desk layout gets a quiet CSS pedestal so the tray and
  the hologram still stand on something.

  The environment text is decoration (aria-hidden) and on the counsel list for
  its marketing claims (design/counsel/scan.md).
-->
<script lang="ts">
  import Room from '@/stage/Room.svelte';
  import { quadMatrix, type Point, type Quad, type RoomStatus } from '@/stage/room-anchors.ts';
  import {
    loadConsultPlate,
    pinPlate,
    placeOnStage,
    platePoint,
    type ConsultPlate,
    type PlateKind,
    type PlateRect,
  } from './consult-plate.ts';

  interface Props {
    box: { w: number; h: number };
    /** The ref4 stage rect (desk layout), or null for a pinned layout. */
    stage: PlateRect | null;
    /** For pinned layouts: where the emitter goes, as fractions of the box. */
    pinAt?: Point;
    /** Draw the wall, book and pedestal text (desk only). */
    withText?: boolean;
    /**
     * Engrave "Your skin. Understood." on the band. Off on the compact desk,
     * where the cards (readable type, taller than the stage) push the Detailed /
     * Gen-Z toggle down onto that stretch of the band: the control wins.
     */
    engraveLeft?: boolean;
    /** Title the book spines. Off when the reading dock stands over the book stack (real mode). */
    withBooks?: boolean;
    /** Told where the whole plate is placed (box px), or null without a render (character prototype). */
    onrect?: (rect: PlateRect | null) => void;
  }

  const { box, stage, pinAt = [0.5, 0.5], withText = false, engraveLeft = true, withBooks = true, onrect }: Props = $props();

  let plate = $state.raw<ConsultPlate | null>(null);
  /* Which render `plate` is (a missing portrait set falls back to the landscape one). */
  let plateKind = $state<PlateKind>('desk');
  /* Room's own report: the render is on screen once it has decoded. */
  let status = $state<RoomStatus>('loading');

  /** The phone-portrait render for narrow portrait boxes; the landscape one otherwise. */
  const kind = $derived<PlateKind>(!stage && box.w > 0 && box.w / Math.max(1, box.h) < 0.7 ? 'mobile' : 'desk');

  $effect(() => {
    const want = kind;
    let live = true;
    void loadConsultPlate(want).then(async (p) => {
      // A missing or malformed portrait set falls back to the landscape render.
      const next = p ?? (want === 'mobile' ? await loadConsultPlate('desk') : null);
      if (!live) return;
      plate = next;
      plateKind = p ? want : 'desk';
    });
    return () => {
      live = false;
    };
  });

  const rect = $derived.by((): PlateRect | null => {
    if (!plate || !box.w || !box.h) return null;
    if (stage && plate.refFrame) return placeOnStage(plate, box, stage);
    const emitter = plate.points.emitter_centre ?? [0.516, 0.731];
    return pinPlate(plate, box, emitter, pinAt);
  });

  const showPlate = $derived(!!plate && !!rect && status === 'plate');

  $effect(() => {
    onrect?.(rect);
  });

  /* ---- surfaces: text warped onto the plate's quads ------------------------ */

  interface Warp {
    name: string;
    w: number;
    h: number;
    transform: string;
    blur: number;
    /** The quad's top-left and top-right x, in the backdrop's px. */
    x0: number;
    x1: number;
  }

  /** A quad's natural box (its top edge and left edge lengths) and the matrix onto it. */
  function warp(name: string, quad: Quad, r: PlateRect, blurPx = 0): Warp {
    const px = quad.map((p) => platePoint(r, p)) as Quad;
    const w = Math.hypot(px[1][0] - px[0][0], px[1][1] - px[0][1]);
    const h = Math.hypot(px[3][0] - px[0][0], px[3][1] - px[0][1]);
    // blurPx is measured at the render's own width; scale it to what is drawn, gently.
    const blur = plate ? Math.min(1.2, blurPx * (r.w / plate.w) * 0.25) : 0;
    return { name, w, h, transform: quadMatrix(w, h, px), blur, x0: px[0][0], x1: px[1][0] };
  }

  const warps = $derived.by((): Record<string, Warp> => {
    if (!withText || !plate || !rect || !showPlate) return {};
    const out: Record<string, Warp> = {};
    for (const [name, s] of Object.entries(plate.surfaces)) out[name] = warp(name, s.quad, rect, s.blurPx ?? 0);
    return out;
  });

  /**
   * The book spines' quads start off the left edge of the render (the stack runs
   * out of frame); only their last fifth or so is on screen, ending at plate x
   * 0.15. The words are set flush against that visible end, a little in from it,
   * so they stay on the spine at every stage size - a longer title runs out of
   * frame with the book rather than onto the table.
   */
  const BOOK_END_PAD = 0.035;
  /** The spines' letter-spacing, in em (as .surface--book). */
  const BOOK_TRACKING = 0.12;

  let measureCtx: CanvasRenderingContext2D | null = null;
  /** About how wide a spine title sets, in px: the font's own advance plus the tracking. */
  function bookTextWidth(text: string, px: number): number {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (!measureCtx) return text.length * px * 0.8;
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';
    measureCtx.font = `500 ${px}px ${family}`;
    return measureCtx.measureText(text).width + text.length * px * BOOK_TRACKING;
  }

  /**
   * A spine's title, sized to the spine, or null when it would not fit the part
   * of the spine that is on screen (at the smaller desktop sizes, the stack is
   * cut by the window's edge sooner than the type can shrink, and "IGHTER YOU"
   * is worse than a plain spine).
   */
  function bookTitle(name: string, w: Warp): { text: string; px: number } | null {
    const text = plate?.surfaces[name]?.text;
    if (!text) return null;
    const px = Math.max(11, w.h * 0.5);
    const room = w.x1 - Math.max(0, w.x0) - w.w * BOOK_END_PAD - 4;
    return bookTextWidth(text, px) <= room ? { text, px } : null;
  }

  /* ---- pedestal engraving along the band --------------------------------- */

  const band = $derived.by(() => {
    if (!withText || !plate || !rect || !showPlate) return null;
    const pts = plate.curves.pedestal_band_mid;
    if (!pts?.length) return null;
    const P = pts.map(([u, v]) => [u * plate!.w, v * plate!.h] as Point);
    let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
    const lens = [0];
    for (let i = 1; i < P.length; i++) {
      d += `L${P[i][0].toFixed(1)} ${P[i][1].toFixed(1)}`;
      lens.push(lens[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    }
    const total = lens[lens.length - 1] || 1;
    /** Arc-length position (%) where the curve passes a plate x. */
    const at = (u: number) => {
      const x = u * plate!.w;
      for (let i = 1; i < P.length; i++) {
        if (P[i][0] >= x) {
          const t = (x - P[i - 1][0]) / (P[i][0] - P[i - 1][0] || 1);
          return ((lens[i - 1] + t * (lens[i] - lens[i - 1])) / total) * 100;
        }
      }
      return 50;
    };
    const centre = (q?: Quad) => (q ? (q[0][0] + q[1][0]) / 2 : 0.5);
    // Ref px to plate px, for sizes: the ref frame is refFrame.w of the plate's width.
    const k = (plate.w * (plate.refFrame?.w ?? 1)) / 1672;
    /* Centred text runs half its length either side of its offset; a textPath
       drops the glyphs that fall before the path starts (the "Y" of "Your"),
       so the offset is kept at least half the line's length (about 0.5em a
       character, and a little spare) along the band. */
    const halfLine = (('Your skin. Understood.'.length * 0.5 * 21 * k) / 2 / total) * 100 + 1.5;
    return {
      d,
      left: Math.max(halfLine, at(centre(plate.surfaces.pedestal_text_left?.quad))),
      right: at(centre(plate.surfaces.pedestal_text_right?.quad)),
      sans: 21 * k,
      serif: 42 * k,
    };
  });
</script>

<div class="backdrop" aria-hidden="true">
  <Room room="consult" layout="fill" variant={plateKind} {rect} onstatus={(next) => (status = next)} />

  {#if !showPlate && stage}
    <!-- The stand-in's pedestal: glass top and copper band, where the render puts them. -->
    <div
      class="backdrop__pedestal"
      style:left="{stage.x + (285 / 1672) * stage.w}px"
      style:top="{stage.y + (633 / 941) * stage.h}px"
      style:width="{(1167 / 1672) * stage.w}px"
      style:height="{(300 / 941) * stage.h}px"
    ></div>
  {/if}

  {#if plate && rect && showPlate}
    {#if withText}
      {#if warps.wall_left_text}
        {@const w = warps.wall_left_text}
        <div class="surface surface--wall-left" style:width="{w.w}px" style:height="{w.h}px" style:transform={w.transform} style:--blur="{w.blur}px">
          <span class="surface__logo" style:font-size="{w.h * 0.5}px">Evia</span>
          <span class="surface__caps" style:font-size="max(11px, {w.h * 0.068}px)">Higher skin standards</span>
          <span class="surface__caps" style:font-size="max(11px, {w.h * 0.068}px)">A brighter you</span>
        </div>
      {/if}
      {#if warps.wall_right_text}
        {@const w = warps.wall_right_text}
        <div class="surface surface--wall-right" style:width="{w.w}px" style:height="{w.h}px" style:transform={w.transform} style:--blur="{w.blur}px">
          {#each ['More', 'Than', 'Skin'] as word (word)}
            <span class="surface__big" style:font-size="max(12px, {w.w * 0.15}px)">{word}</span>
          {/each}
          <span class="surface__gap"></span>
          {#each ['Analyze', 'Understand', 'Personalize', 'Improve', 'Together'] as word (word)}
            <span class="surface__list" style:font-size="max(11px, {w.w * 0.105}px)">{word}</span>
          {/each}
        </div>
      {/if}
      {#each ['book_spine_science', 'book_spine_beauty', 'book_spine_you'] as name (name)}
        {@const w = warps[name]}
        {@const title = w && withBooks ? bookTitle(name, w) : null}
        {#if w && title}
          <!-- Padding in px of the quad's own width: a percentage would be taken
               from the whole backdrop's width and push the words off the spine. -->
          <div
            class="surface surface--book"
            style:width="{w.w}px"
            style:height="{w.h}px"
            style:padding-right="{w.w * BOOK_END_PAD}px"
            style:transform={w.transform}
            style:--blur="{w.blur}px"
          >
            <span style:font-size="{title.px}px">{title.text}</span>
          </div>
        {/if}
      {/each}
      {#if band}
        <svg
          class="surface-band"
          style:left="{rect.x}px"
          style:top="{rect.y}px"
          style:width="{rect.w}px"
          style:height="{rect.h}px"
          viewBox="0 0 {plate.w} {plate.h}"
          preserveAspectRatio="none"
        >
          <defs><path id="scan-band-path" d={band.d} /></defs>
          {#if engraveLeft}
            <text class="surface-band__sans" font-size={band.sans} dominant-baseline="middle">
              <textPath href="#scan-band-path" startOffset="{band.left}%" text-anchor="middle">Your skin. Understood.</textPath>
            </text>
          {/if}
          <text class="surface-band__serif" font-size={band.serif} dominant-baseline="middle">
            <textPath href="#scan-band-path" startOffset="{band.right}%" text-anchor="middle">Evia</textPath>
          </text>
        </svg>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    background: var(--navy-900);
  }
  .backdrop__pedestal {
    position: absolute;
    border-radius: 50% / 34%;
    background:
      radial-gradient(50% 32% at 50% 33%, rgba(143, 171, 223, 0.35), transparent 70%),
      radial-gradient(50% 33% at 50% 33%, #3e4561 0 96%, #6985be 97.5%, transparent 99%),
      linear-gradient(180deg, transparent 0 33%, #4b2f2c 33%, #b97260 60%, #241713 100%);
    -webkit-mask: radial-gradient(50% 33% at 50% 33%, #000 99%, transparent 100%) top / 100% 100% no-repeat,
      linear-gradient(#000, #000) 0 33% / 100% 67% no-repeat;
    mask: radial-gradient(50% 33% at 50% 33%, #000 99%, transparent 100%) top / 100% 100% no-repeat,
      linear-gradient(#000, #000) 0 33% / 100% 67% no-repeat;
    opacity: 0.85;
  }

  /* ---- environment text ---- */
  .surface {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    flex-direction: column;
    transform-origin: 0 0;
    filter: blur(var(--blur, 0px));
    font-family: var(--font-sans);
    user-select: none;
  }
  /* Lit wall lettering, a step lighter than the plaster (ref4's walls): it is
     decoration, but it should still read as words, not as a stain. */
  .surface--wall-left {
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: #cfa59c;
  }
  .surface__logo {
    font-family: var(--font-serif);
    font-weight: 500;
    line-height: 0.9;
    letter-spacing: -0.01em;
    color: #e0a296;
    text-shadow: 0 0 14px rgba(240, 160, 140, 0.3);
  }
  .surface__caps {
    font-weight: 400;
    line-height: 1.5;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .surface--wall-right {
    justify-content: flex-start;
    padding-top: 4%;
    color: #e3bcb2;
  }
  .surface__big {
    font-weight: 300;
    line-height: 1.55;
    letter-spacing: 0.3em;
    text-transform: uppercase;
  }
  .surface__gap {
    height: 8%;
  }
  .surface__list {
    line-height: 1.95;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #d6aca3;
  }
  .surface--book {
    justify-content: center;
    align-items: flex-end;
    text-align: right;
    color: #6a5a58;
    font-weight: 500;
    letter-spacing: 0.12em; /* BOOK_TRACKING */
    text-transform: uppercase;
    white-space: nowrap;
  }
  .surface-band {
    position: absolute;
    overflow: visible;
  }
  /* Engraved: a pale fill with a thin dark edge, so it reads on the band's
     bright reflection as well as on its shadowed copper. */
  .surface-band__sans {
    font-family: var(--font-sans);
    font-weight: 300;
    letter-spacing: 0.02em;
    fill: #d9b3a8;
    stroke: rgba(72, 38, 30, 0.45);
    stroke-width: 1.4px;
    paint-order: stroke;
  }
  .surface-band__serif {
    font-family: var(--font-serif);
    font-weight: 500;
    fill: #a07268;
  }

</style>
