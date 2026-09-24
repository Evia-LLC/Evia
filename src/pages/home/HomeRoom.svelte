<!--
  The lounge behind Home: the room plate, the decor text pinned onto it, and
  the scrims that keep Home's type readable over it.

  Fixed to the window, behind everything in the shell (the sidebar glass
  frosts it), clipped at `right` - the edge of what Home can show, which is
  the window's edge, or the Routine panel's when Home sits under it. The plate
  is placed by stage.ts (the mockup's scale on wide screens, the seating area
  on a phone) inside a box of the render's own shape, so Room's cover fit is
  exact and the wall text lands on its wall.

  No character (BUILD-PLAN decision 3): the armchair stays empty.

  The decor copy is the mockup's (wall niche, acrylic sign), the same in both
  modes and listed for counsel; it is decoration, so it is hidden from
  assistive technology. It waits for the wall it is printed on: it fades in
  once the render has decoded, or once the stand-in is known to be what stays
  (no render published, or the render failed) - never over the bare ground
  colour while a slow plate is still loading.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Room from '@/stage/Room.svelte';
  import RoomSurface from '@/stage/RoomSurface.svelte';
  import { loadAnchors } from '@/stage/room-anchors.ts';
  import type { HomeView } from '@/view/home.ts';
  import { LOUNGE_FALLBACK_FRAME, frameFromAnchors, plateRect, type PlateFrame } from './stage.ts';
  import RoomProbe from './RoomProbe.svelte';

  interface Props {
    /** The right edge of what Home can show, in window px. */
    right: number;
    compact: boolean;
    wall: HomeView['wall'];
  }

  const { right, compact, wall }: Props = $props();

  let height = $state(0);
  let frame = $state<PlateFrame>(LOUNGE_FALLBACK_FRAME);
  /* Whether Room is showing its stand-in: before the render loads, or if it fails. */
  let standIn = $state(true);

  /* Whether the anchors question has been answered (they exist or they do not). */
  let settled = $state(false);

  $effect(() => {
    let live = true;
    void loadAnchors('lounge').then((anchors) => {
      if (!live) return;
      frame = frameFromAnchors(anchors);
      settled = true;
    });
    return () => {
      live = false;
    };
  });

  /* The render's base plate has loaded and decoded. */
  let plateBox = $state<HTMLElement | null>(null);
  let plateReady = $state(false);

  $effect(() => {
    const el = plateBox;
    if (standIn || !el) {
      plateReady = false;
      return;
    }
    let live = true;
    const ready = () => {
      if (live) plateReady = true;
    };
    void tick().then(() => {
      const img = el.querySelector<HTMLImageElement>('img.ev-room__plate--base') ?? el.querySelector('img');
      if (!live || !img) return;
      const decode = () => void img.decode().then(ready, ready);
      if (img.complete && img.naturalWidth > 0) decode();
      else img.addEventListener('load', decode, { once: true });
    });
    return () => {
      live = false;
    };
  });

  const showWall = $derived(plateReady || (standIn && settled));

  const active = $derived(standIn ? LOUNGE_FALLBACK_FRAME : frame);
  const rect = $derived(height > 0 && right > 0 ? plateRect(active, { right, height, compact }) : null);
</script>

<div class="home-room" class:is-compact={compact} style:width={right > 0 ? `${right}px` : null} bind:clientHeight={height} aria-hidden="true">
  {#if rect}
    <div
      class="home-room__plate"
      bind:this={plateBox}
      style:left="{rect.left}px"
      style:top="{rect.top}px"
      style:width="{rect.width}px"
      style:height="{rect.height}px"
    >
      <Room room="lounge">
        <RoomProbe onchange={(fallback) => (standIn = fallback)} />
        {#if showWall}
          <RoomSurface name="niche_text" width={156} height={89} decorative>
            <div class="home-room__niche">
              {#each wall.niche as line (line)}<span>{line}</span>{/each}
            </div>
          </RoomSurface>
          <RoomSurface name="niche_rule" width={30} height={2} decorative>
            <span class="home-room__rule home-room__rule--niche"></span>
          </RoomSurface>
          <RoomSurface name="sign_text" width={128} height={83} decorative>
            <div class="home-room__sign">
              {#each wall.sign as line (line)}<span>{line}</span>{/each}
            </div>
          </RoomSurface>
          <RoomSurface name="sign_rule" width={24} height={2} decorative>
            <span class="home-room__rule home-room__rule--sign"></span>
          </RoomSurface>
        {/if}
      </Room>
    </div>
  {/if}
  <div class="home-room__scrim"></div>
</div>

<style>
  .home-room {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: var(--z-backdrop);
    width: 100%;
    overflow: hidden;
    background: var(--choc-600);
    pointer-events: none;
  }
  .home-room__plate {
    position: absolute;
  }

  /*
   * Readability, not mood: the plate's dusk window, its LED lines and the lit
   * floor are brighter than cream type allows, so the type sits in shade.
   * One darkening from the top-left (greeting, question, CTA) and one from the
   * bottom (tip card, tagline), both dark rose-brown, both fading out long
   * before the armchair and the niche. The top-right corner gets a little for
   * the bell, which sits under the ceiling's cove light.
   */
  .home-room__scrim {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(60% 55% at 12% 38%, rgba(40, 18, 10, 0.5) 0%, rgba(40, 18, 10, 0.32) 45%, transparent 100%),
      linear-gradient(0deg, rgba(40, 18, 10, 0.62) 0%, rgba(40, 18, 10, 0.34) 16%, transparent 34%),
      radial-gradient(30% 16% at 100% 0%, rgba(40, 18, 10, 0.45), transparent 100%);
  }
  /* The phone: the greeting runs across the top, the tip card along the bottom. */
  .is-compact .home-room__scrim {
    background:
      linear-gradient(
        180deg,
        rgba(40, 18, 10, 0.62) 0%,
        rgba(40, 18, 10, 0.5) 30%,
        rgba(40, 18, 10, 0.12) 52%,
        rgba(40, 18, 10, 0.18) 66%,
        rgba(40, 18, 10, 0.6) 100%
      );
  }

  .home-room__niche,
  .home-room__sign,
  .home-room__rule {
    animation: home-wall-in 0.45s var(--ease-out) both;
  }
  @keyframes home-wall-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .home-room__niche,
    .home-room__sign,
    .home-room__rule {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .home-room__niche,
  :global([data-reduced-motion='true']) .home-room__sign,
  :global([data-reduced-motion='true']) .home-room__rule {
    animation: none;
  }

  /* The niche's backlit plaster: dark ink, as if printed on it. */
  .home-room__niche {
    display: grid;
    align-content: start;
    height: 100%;
    margin-top: -10px;
    font-family: var(--font-sans);
    font-size: 18px;
    font-weight: var(--fw-semibold);
    line-height: 35px;
    letter-spacing: 0.04em;
    color: var(--choc-500);
    white-space: nowrap;
  }
  /* The acrylic block: etched, lit from below. */
  .home-room__sign {
    display: grid;
    align-content: start;
    height: 100%;
    margin-top: -8px;
    font-family: var(--font-sans);
    font-size: 18px;
    font-weight: var(--fw-light);
    line-height: 31px;
    letter-spacing: 0.04em;
    color: var(--rose-gold-300);
    text-shadow: 0 0 4px rgba(255, 190, 160, 0.45);
    white-space: nowrap;
  }
  .home-room__rule {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 1px;
    background: var(--rose-gold-400);
    box-shadow: 0 0 4px rgba(255, 180, 150, 0.6);
  }
  .home-room__rule--sign {
    background: var(--rose-gold-300);
  }
</style>
