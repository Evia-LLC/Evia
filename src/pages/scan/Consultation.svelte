<!--
  The consultation: the hologram on the pedestal and the reading around it
  (ref4). Three compositions of the same parts, chosen by the page:

  desk    the mockup's stage, in ref4 pixels scaled by --u (1 at 1672x941):
          callouts on both sides of the head with leader lines to its
          anchors, SKIN MAP and OBSERVED CONCERNS on the right, the card tray
          on the pedestal, the Detailed / Gen-Z toggle and the handwritten
          tagline on the glass. Text never drops below the readability floors
          (BUILD-PLAN decision 8), so at the smaller desktop sizes the panels
          are a little larger than the stage and the right column tucks in
          against the edge ("compact").
  tablet  the head with the callouts either side, then the tray, the toggle,
          and the two panels side by side, scrolling.
  phone   sequential (decision 7): the hologram fills the top half and a
          bottom sheet shows one region at a time, following her narration
          (director.hologram.activeRegion) or the reader's own steps; the rest
          of the reading is further down the sheet.

  No character anywhere (decision 3): her place at the left of the room is
  left to the room.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { FaceRegionKey } from '@shared/types.ts';
  import type { HologramAnchors } from '@/hologram/index.ts';
  import type { ScanMesh } from '@/scan/mesh.ts';
  import { thumbLabel, type CalloutSlot, type ScanView } from '@/view/scan.ts';
  import Icon from '@/ui/Icon.svelte';
  import AIDisclosure from '@/components/legal/AIDisclosure.svelte';
  import HoloCanvas from './HoloCanvas.svelte';
  import Callout from './Callout.svelte';
  import ConcernsPanel from './ConcernsPanel.svelte';
  import SkinMapPanel from './SkinMapPanel.svelte';
  import MetricCard from './MetricCard.svelte';
  import ExplainToggle from './ExplainToggle.svelte';
  import Leaders, { type Leader } from './Leaders.svelte';
  import ReadingDock from './ReadingDock.svelte';
  import Thumb from './Thumb.svelte';
  import { explain } from './explain.svelte.ts';
  import type { CropSet } from './crops.ts';

  interface Props {
    view: ScanView;
    layout: 'desk' | 'tablet' | 'phone';
    /** Desk: ref px to CSS px, and whether the right column tucks in. */
    u: number;
    compact: boolean;
    /** The live session mesh, when the view says there is one. */
    liveMesh: ScanMesh | null;
    crops: CropSet;
    /**
     * Desk: the right column cannot be kept clear of the panels and the tray
     * at this window size (see `fitRight`); the page then uses the tablet
     * composition here.
     */
    onmisfit?: () => void;
  }

  const { view, layout, u, compact, liveMesh, crops, onmisfit }: Props = $props();

  const LEFT: CalloutSlot[] = ['forehead', 'tzone', 'cheeks'];
  const leftCallouts = $derived(view.callouts.filter((c) => LEFT.includes(c.slot)));
  const rightCallouts = $derived(view.callouts.filter((c) => !LEFT.includes(c.slot)));

  const meshSource = $derived<'sample' | ScanMesh | null>(view.mesh === 'sample' ? 'sample' : view.mesh === 'live' ? liveMesh : null);
  const showDock = $derived(view.mode === 'real');

  /* ---- the phone's one-region-at-a-time sheet ----------------------------- */
  let step = $state(0);
  let sheetOpen = $state(false);
  const current = $derived(view.callouts[Math.min(step, Math.max(0, view.callouts.length - 1))] ?? null);
  // Her narration moves the sheet to the region she is on.
  $effect(() => {
    const slot = view.activeSlot;
    if (!slot) return;
    const i = view.callouts.findIndex((c) => c.slot === slot);
    if (i >= 0) step = i;
  });

  /** The region the face lights: the one she is on, or on the phone the one on the sheet. */
  const activeRegion = $derived.by((): FaceRegionKey | null => {
    if (layout === 'phone') return current?.anchor ?? null;
    const slot = view.activeSlot;
    return slot ? (view.callouts.find((c) => c.slot === slot)?.anchor ?? null) : null;
  });
  const activeSlot = $derived(layout === 'phone' ? (current?.slot ?? null) : view.activeSlot);
  const activeMetric = $derived.by(() => {
    const slot = view.activeSlot;
    const callout = slot ? view.callouts.find((c) => c.slot === slot) : null;
    return callout?.metrics[0] ?? null;
  });

  /* ---- leader lines ---------------------------------------------------------- */
  let root: HTMLElement | undefined = $state();
  let holoBox: HTMLElement | undefined = $state();
  let anchors = $state.raw<HologramAnchors | null>(null);
  let ports = $state.raw<Record<string, { x: number; y: number }>>({});
  let holoAt = $state.raw({ x: 0, y: 0 });
  /** Phone: the sheet's top edge, where the leader stops (it never crosses the sheet's text). */
  let sheetTop = $state<number | null>(null);
  let webgl = $state(true);

  function measure() {
    if (!root || !holoBox) return;
    const r = root.getBoundingClientRect();
    const c = holoBox.getBoundingClientRect();
    holoAt = { x: c.left - r.left, y: c.top - r.top };
    const next: Record<string, { x: number; y: number }> = {};
    for (const el of root.querySelectorAll<HTMLElement>('[data-slot]')) {
      const port = el.querySelector<HTMLElement>('[data-port]');
      if (!port || !el.dataset.slot) continue;
      const p = port.getBoundingClientRect();
      if (!p.width) continue;
      const side = port.dataset.port;
      const x = side === 'right' ? p.right : side === 'top' ? p.left + 14 : p.left;
      const y = side === 'top' ? p.top : p.top + p.height / 2;
      next[el.dataset.slot] = { x: x - r.left, y: y - r.top };
    }
    ports = next;
    const sheet = layout === 'phone' ? root.querySelector<HTMLElement>('.sheet') : null;
    sheetTop = sheet ? sheet.getBoundingClientRect().top - r.top : null;
    if (layout === 'desk') fitRight(r);
  }

  /* ---- desk: the right column never runs into the panels ------------------ */
  /*
   * UNDER-EYES and CHIN sit at ref4's x, between the head and the panels, and
   * their width follows the readable type (and the font), not the stage. So
   * after layout the right column is measured against its neighbours, and
   * whatever it would run into moves instead of covering it:
   *  - the SKIN MAP card above: the two callouts step down below it;
   *  - OBSERVED CONCERNS beside them: the panel steps right, into the free
   *    wall under the SKIN MAP, as far as the stage edge allows;
   *  - the card tray below: nothing can move, so that is a misfit.
   * A misfit (no room left at this window size) asks the page for the tablet
   * composition instead. Everything is read from layout boxes that the
   * build-in animations do not move sideways (the slots, the shelf), and a
   * misfit is only reported once the fonts are in, so a first frame drawn in
   * a stand-in font cannot send the reference size to the tablet layout.
   */
  const FIT_GAP = 12;
  const FIT_EDGE = 10;
  const FIT_TRAY_GAP = 4;
  let concernsShift = $state(0);
  let rightDrop = $state(0);

  function fitRight(r: DOMRect) {
    if (!root) return;
    const slots = [...root.querySelectorAll<HTMLElement>('.col-right .slot')];
    const concerns = root.querySelector<HTMLElement>('.panels .concerns');
    if (!slots.length || !concerns) return;
    const boxes = slots.map((el) => el.getBoundingClientRect());
    // Where the column is without this function's own adjustments.
    const top = Math.min(...boxes.map((b) => b.top)) - rightDrop;
    const bottom = Math.max(...boxes.map((b) => b.bottom)) - rightDrop;
    const left = Math.min(...boxes.map((b) => b.left));
    const reach = Math.max(...boxes.map((b) => b.right));

    const map = root.querySelector<HTMLElement>('.panels .skinmap')?.getBoundingClientRect();
    const drop = map && map.left < reach + FIT_GAP ? Math.max(0, map.bottom + FIT_GAP - top) : 0;

    const c = concerns.getBoundingClientRect();
    const baseLeft = c.left - concernsShift;
    const baseRight = c.right - concernsShift;
    const need = Math.max(0, reach + FIT_GAP - baseLeft);
    const room = Math.max(0, r.right - FIT_EDGE - baseRight);
    const shift = Math.min(need, room);

    const shelf = root.querySelector<HTMLElement>('.shelf')?.getBoundingClientRect();
    // The chin callout may sit close above the tray (8 px at 1366 x 768, as designed), never on it.
    const underTray = !!shelf && left < shelf.right && reach > shelf.left && bottom + drop + FIT_TRAY_GAP > shelf.top;

    if (Math.abs(shift - concernsShift) > 0.5) concernsShift = shift;
    if (Math.abs(drop - rightDrop) > 0.5) {
      rightDrop = drop;
      // The leader lines start at the callouts' thumbnails: measure them again where they now are.
      void tick().then(measure);
    }
    const fontsIn = typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded';
    if (fontsIn && (need > room + 0.5 || underTray)) onmisfit?.();
  }

  onMount(() => {
    const ro = new ResizeObserver(() => measure());
    if (root) ro.observe(root);
    // Again once the build-in slides have settled and the web fonts are in.
    const t1 = setTimeout(measure, 100);
    const t2 = setTimeout(measure, 1900);
    void document.fonts?.ready.then(() => measure());
    return () => {
      ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  });

  $effect(() => {
    void layout;
    void compact;
    void view.callouts;
    void step;
    void sheetOpen;
    void tick().then(measure);
    // Again once the sheet has finished sliding.
    const t = setTimeout(measure, 450);
    return () => clearTimeout(t);
  });

  const leaders = $derived.by((): Leader[] => {
    if (!anchors) return [];
    const list = layout === 'phone' ? (current ? [current] : []) : view.callouts;
    const out: Leader[] = [];
    for (const c of list) {
      const a = anchors[c.anchor];
      const p = ports[c.slot];
      if (!a?.visible || !p) continue;
      const ax = holoAt.x + a.x, ay = holoAt.y + a.y;
      if (sheetTop !== null) {
        // Phone: the line runs from the face down to a port on the sheet's rim,
        // above the region's title; not at all while the sheet is pulled up over the face.
        if (sheetOpen || ay > sheetTop - 12) continue;
        out.push({ id: c.slot, ax, ay, px: p.x, py: sheetTop, active: activeSlot === c.slot });
        continue;
      }
      out.push({ id: c.slot, ax, ay, px: p.x, py: p.y, active: activeSlot === c.slot });
    }
    return out;
  });

  const cardActive = (metric: string | null) => metric !== null && metric === activeMetric;
  /**
   * The cards' gauge on the desk stage: 66 px at the mockup's size (its 70 px less
   * a little, so "Below optimal levels" and "BARRIER SUPPORT" stay on one line at
   * the readable type), shrinking with the stage to 0.78 of that.
   */
  const gauge = $derived(layout === 'desk' ? Math.round(66 * Math.min(1, Math.max(0.78, u))) : 70);
</script>

{#snippet hologram(align: { x: number; y: number })}
  <div class="holo" bind:this={holoBox}>
    <HoloCanvas
      mesh={meshSource}
      highlights={view.highlights}
      active={activeRegion}
      {align}
      onanchors={(a) => (anchors = a)}
      onsupport={(ok) => (webgl = ok)}
    />
    {#if view.mesh === 'cleared' || !webgl}
      <div class="holo__note">
        <p>
          {#if !webgl}
            This browser could not draw the 3D map. Your reading is all here in words.
          {:else}
            Your face map is gone: it only exists while I explain the reading, and nothing of it is kept.
          {/if}
        </p>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet tray()}
  <h2 class="visually-hidden">Reading cards</h2>
  <div class="tray">
    {#each view.cards as card, i (card.id)}
      <MetricCard {card} style={explain.style} index={i} active={cardActive(card.metric)} gauge={gauge} />
    {/each}
  </div>
{/snippet}

{#snippet tagline()}
  <p class="tagline" aria-hidden="true"><span>Same skin</span><span>Deeper answers.</span></p>
{/snippet}

<div
  class="consult"
  data-layout={layout}
  class:is-compact={compact}
  style:--u={u}
  style:--concerns-shift="{layout === 'desk' ? concernsShift : 0}px"
  style:--right-drop="{layout === 'desk' ? rightDrop : 0}px"
  bind:this={root}
>
  {#if layout === 'desk'}
    {@render hologram({ x: 0.5, y: 0.5 })}

    <div class="col-left">
      <!-- Headings in reading order: the title (h1), then each part of the reading (h2). -->
      <h2 class="visually-hidden">On the face</h2>
      {#each leftCallouts as callout, i (callout.slot)}
        <div class="slot slot--{callout.slot}">
          <Callout
            {callout}
            side="left"
            crop={callout.thumb.kind === 'capture' ? (crops[callout.thumb.region] ?? null) : null}
            active={activeSlot === callout.slot}
            index={i}
          />
        </div>
      {/each}
    </div>
    <div class="col-right">
      {#each rightCallouts as callout, i (callout.slot)}
        <div class="slot slot--{callout.slot}">
          <Callout
            {callout}
            side="right"
            crop={callout.thumb.kind === 'capture' ? (crops[callout.thumb.region] ?? null) : null}
            active={activeSlot === callout.slot}
            index={i + 3}
            {compact}
          />
        </div>
      {/each}
    </div>

    <div class="panels">
      <SkinMapPanel tilted={!compact} />
      <ConcernsPanel rows={view.concerns.rows} empty={view.concerns.empty} active={activeMetric} />
    </div>

    <!-- The toggle and the tagline hang under the tray, so taller cards (the
         readable type at the smaller desktop sizes) push them down instead of
         running under them. -->
    <div class="shelf">
      {@render tray()}
      <div class="shelf__below">
        <ExplainToggle />
        <div class="tagline-at">{@render tagline()}</div>
      </div>
    </div>

    <Leaders {leaders} />
  {:else if layout === 'tablet'}
    <div class="t-hero">
      <h2 class="visually-hidden">On the face</h2>
      <div class="t-col">
        {#each leftCallouts as callout, i (callout.slot)}
          <Callout
            {callout}
            side="left"
            crop={callout.thumb.kind === 'capture' ? (crops[callout.thumb.region] ?? null) : null}
            active={activeSlot === callout.slot}
            index={i}
            compact
          />
        {/each}
      </div>
      <div class="t-holo">{@render hologram({ x: 0.5, y: 1 })}</div>
      <div class="t-col t-col--right">
        {#each rightCallouts as callout, i (callout.slot)}
          <Callout
            {callout}
            side="right"
            crop={callout.thumb.kind === 'capture' ? (crops[callout.thumb.region] ?? null) : null}
            active={activeSlot === callout.slot}
            index={i + 3}
            compact
          />
        {/each}
      </div>
    </div>
    <div class="t-body">
      {@render tray()}
      <div class="t-toggle">
        <ExplainToggle />
        {@render tagline()}
      </div>
      <div class="t-panels">
        <ConcernsPanel rows={view.concerns.rows} empty={view.concerns.empty} active={activeMetric} />
        <SkinMapPanel />
      </div>
      {#if showDock}<ReadingDock size="md" />{/if}
    </div>
    <Leaders {leaders} />
  {:else}
    <div class="p-holo">{@render hologram({ x: 0.5, y: 1 })}</div>

    <section class="sheet" class:is-open={sheetOpen} aria-label="Your reading, one region at a time">
      <button
        type="button"
        class="sheet__grip"
        aria-expanded={sheetOpen}
        aria-label={sheetOpen ? 'Show less of the reading' : 'Show all of the reading'}
        onclick={() => (sheetOpen = !sheetOpen)}
      >
        <span aria-hidden="true"></span>
      </button>
      <div class="sheet__ai"><AIDisclosure consultation result tone="holo" /></div>
      <div class="sheet__scroll">
        {#if current}
          <div class="region" data-slot={current.slot} aria-live="polite">
            <div class="region__head">
              <h2 class="region__title" data-port="top">{current.heading}</h2>
              <p class="region__count">{Math.min(step, view.callouts.length - 1) + 1} of {view.callouts.length}</p>
            </div>
            <div class="region__body">
              <ul class="region__lines">
                {#each current.lines as line (line)}<li>{line}</li>{/each}
              </ul>
              <Thumb
                thumb={current.thumb}
                src={current.thumb.kind === 'capture' ? (crops[current.thumb.region] ?? null) : null}
                label={thumbLabel(current)}
                class="region__thumb"
              />
            </div>
            <div class="region__nav">
              <button type="button" class="region__btn" disabled={step <= 0} onclick={() => (step = Math.max(0, step - 1))}>
                <Icon name="chevron-left" size={20} /><span>Previous</span>
              </button>
              <button
                type="button"
                class="region__btn"
                disabled={step >= view.callouts.length - 1}
                onclick={() => (step = Math.min(view.callouts.length - 1, step + 1))}
              >
                <span>Next region</span><Icon name="chevron-right" size={20} />
              </button>
            </div>
          </div>
        {:else}
          <div class="region region--none">
            <p>Nothing in this reading is pinned to one place on the face. The full reading is below.</p>
          </div>
        {/if}

        <div class="sheet__more">
          <ExplainToggle full />
          {@render tray()}
          <ConcernsPanel rows={view.concerns.rows} empty={view.concerns.empty} active={activeMetric} />
          <SkinMapPanel />
          {@render tagline()}
          {#if showDock}<ReadingDock size="md" />{/if}
        </div>
      </div>
    </section>
    <Leaders {leaders} />
  {/if}
</div>

<style>
  .consult {
    --s-title: max(20px, calc(21px * var(--u)));
    --s-eyebrow: max(11px, calc(10px * var(--u)));
    --s-head: max(12px, calc(13px * var(--u)));
    --s-body: max(14px, calc(12px * var(--u)));
    --s-list: max(14px, calc(11px * var(--u)));
    --s-meta: max(12px, calc(10.5px * var(--u)));
    --s-label: max(13px, calc(12px * var(--u)));
    --s-panel: max(13px, calc(14px * var(--u)));
    --s-panel-lg: max(15px, calc(17px * var(--u)));
    --s-value: max(22px, calc(23px * var(--u)));
    --s-band: max(19px, calc(20px * var(--u)));
    position: absolute;
    inset: 0;
    color: var(--holo-ink-body);
  }

  /* ================= desk: the ref4 stage ================= */
  [data-layout='desk'] .holo {
    position: absolute;
    left: calc(560px * var(--u));
    top: 0;
    width: calc(550px * var(--u));
    height: calc(620px * var(--u));
  }
  .holo {
    position: relative;
  }
  .holo__note {
    position: absolute;
    left: 50%;
    top: 42%;
    width: min(320px, 80%);
    transform: translate(-50%, -50%);
    padding: 14px 16px;
    border-radius: 12px;
    background: rgba(8, 13, 24, 0.78);
    box-shadow: inset 0 0 0 1px rgba(150, 170, 210, 0.3);
    text-align: center;
  }
  .holo__note p {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
    color: #dfe7f7;
  }

  /* Left callouts hang from their right edges (the mockup's panel ends), so a
     panel that needs more room for the readable type grows into the empty
     space where the character stood. */
  .col-left .slot {
    position: absolute;
    right: calc((1672px - var(--rx) * 1px) * var(--u));
    top: calc(var(--ty) * 1px * var(--u));
  }
  .slot--forehead {
    --rx: 698;
    --ty: 127;
  }
  .slot--tzone {
    --rx: 698;
    --ty: 250;
  }
  .slot--cheeks {
    --rx: 722;
    --ty: 392;
  }
  .col-right .slot {
    position: absolute;
    left: calc(var(--lx) * 1px * var(--u));
    top: calc(var(--ty) * 1px * var(--u) + var(--right-drop, 0px));
  }
  /* Lower than ref4 (305 / 437): the SKIN MAP card above them is taller with the
     readable type and its "illustration" caption. */
  .col-right .slot--underEyes {
    --lx: 1030;
    --ty: 324;
  }
  .col-right .slot--chin {
    --lx: 1030;
    --ty: 450;
  }
  /* Compact: the callouts keep their readable height while the stage shrinks, so
     they spread a little further apart (and still clear the tray). */
  .is-compact .slot--forehead {
    --ty: 119;
  }
  .is-compact .slot--tzone {
    --ty: 256;
  }
  .is-compact .col-right .slot--underEyes {
    --ty: 318;
  }
  .is-compact .col-right .slot--chin {
    --ty: 456;
  }
  [data-layout='desk'] {
    --thumb: calc(60px * max(0.85, var(--u)));
    --thumb-r: calc(56px * max(0.85, var(--u)));
  }
  /* Compact: the right callouts slim down so they clear the SKIN MAP card, which
     keeps its readable width against the window edge. */
  [data-layout='desk'].is-compact {
    --thumb-r: 38px;
  }
  .is-compact .col-right {
    --callout-pad-x: 10px;
    --callout-gap: 6px;
  }

  /* 14px nearer the edge than ref4's column, so the concerns panel (wider than
     the mockup's, below) still clears the right callouts. */
  .panels {
    position: absolute;
    right: calc(146px * var(--u));
    top: calc(40px * var(--u));
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: calc(12px * var(--u));
  }
  .panels :global(.skinmap) {
    width: max(292px, calc(318px * var(--u)));
  }
  /* Wide enough that "Texture Irregularity" and "Redness / Sensitivity" stay
     on one line beside their severity at the readable type (ref4's rows are
     single lines); still narrower than the SKIN MAP card above. */
  .panels :global(.concerns) {
    width: max(288px, calc(270px * var(--u)));
    /* Measured (fitRight): as far right as the callouts beside it need. */
    position: relative;
    left: var(--concerns-shift, 0px);
  }
  .is-compact .panels {
    right: 10px;
    gap: 10px;
  }
  /* On the desk the skin-layer tabs are a mouse control: a slimmer pill. */
  [data-layout='desk'] .panels :global(.skinmap .ev-seg) {
    --seg-h: 30px;
  }

  /* The tray: a glass shelf standing on the pedestal glass, three slabs on it. */
  .shelf {
    position: absolute;
    left: calc(523px * var(--u));
    top: calc(587px * var(--u));
    width: calc(738px * var(--u));
    display: flex;
    flex-direction: column;
  }
  .tray {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: calc(26px * var(--u));
  }
  [data-layout='desk'] .tray {
    padding: calc(11px * var(--u)) calc(10px * var(--u)) calc(10px * var(--u));
    border-radius: 14px calc(26px * var(--u)) 14px 14px;
    /* Glass, not a box: the pedestal's light shows through the tray and the
       cards (ref4), while the two layers together stay dark enough under the
       light card text (about 0.75 of navy over the brightest ring). */
    background: linear-gradient(180deg, rgba(44, 58, 92, 0.32), rgba(24, 32, 54, 0.28));
    box-shadow:
      inset 0 0 0 1px rgba(120, 150, 200, 0.3),
      inset 0 -2px 0 rgba(64, 85, 121, 0.9),
      inset 0 1px 0 rgba(66, 80, 107, 0.9);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    animation: tray-in 520ms var(--ease-out) both;
    animation-delay: 1.6s;
  }
  [data-layout='desk'] .tray :global(.mcard) {
    --scan-card: linear-gradient(180deg, rgba(36, 47, 76, 0.62), rgba(20, 27, 46, 0.68));
    --card-pad: calc(10px * var(--u)) calc(10px * var(--u)) calc(11px * var(--u)) calc(10px * var(--u));
    --card-gap: calc(10px * var(--u));
    /* The mockup's card titles are small caps-height labels: 12 px keeps "BARRIER
       SUPPORT" on one line beside the gauge (the uppercase floor is 11 px). */
    --card-title: 12px;
  }
  /* ref4: the toggle's centre is 17 px left of the tray's, 17 px under it; the
     tagline starts at x 1097 (574 px into the tray), 10 px above the toggle. */
  .shelf__below {
    position: relative;
    display: flex;
    justify-content: center;
    margin-top: calc(17px * var(--u));
    padding-right: calc(34px * var(--u));
  }
  .tagline-at {
    position: absolute;
    left: calc(574px * var(--u));
    top: calc(-10px * var(--u));
  }
  /* Compact: the cards are taller than the stage, so the tagline moves off the
     pedestal's engraving to the glass beside the tray. */
  .is-compact .tagline-at {
    left: calc(100% + 14px);
    top: -64px;
  }
  .tagline {
    display: flex;
    flex-direction: column;
    margin: 0;
    font-family: var(--font-script);
    font-size: max(17px, calc(20px * var(--u)));
    line-height: 1.15;
    color: #e1ecfd;
    text-shadow: 0 0 8px rgba(170, 200, 255, 0.55);
    transform-origin: left bottom;
    transform: rotate(-17deg);
    white-space: nowrap;
    animation: tagline-in 1.4s var(--ease-out) both;
    animation-delay: 2.2s;
  }
  .tagline span + span {
    margin-left: 0.7em;
  }

  /* ================= tablet ================= */
  [data-layout='tablet'] {
    position: relative;
    inset: auto;
    /* The foot clears the page's disclosure bar (its measured height, --aibar-h). */
    padding: 132px 16px max(88px, calc(var(--aibar-h, 0px) + 24px));
  }
  /* Tablet and phone are the touch compositions (BUILD-PLAN decision 7): the
     Detailed / Gen-Z switch and the skin-layer tabs are full 44 px targets
     whatever the pointer, not the desk's slimmer mouse pills. */
  [data-layout='tablet'] :global(.ev-seg),
  [data-layout='phone'] :global(.ev-seg) {
    --seg-h: 50px;
  }
  .t-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 1.15fr) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: min(58vh, 560px);
  }
  .t-col {
    display: grid;
    gap: 22px;
    justify-items: end;
    position: relative;
    z-index: 2;
  }
  .t-col--right {
    justify-items: start;
  }
  [data-layout='tablet'] {
    --thumb: 44px;
    --thumb-r: 44px;
    --callout-pad-x: 10px;
    --callout-gap-in: 8px;
  }
  .t-holo {
    align-self: stretch;
    min-height: 380px;
    margin: -40px -30px 0;
  }
  /* A phone on its side: the window is shorter than the callouts' column, so
     the head gets the column's full height and the page scrolls (the pedestal
     sits below the fold, ScanPage's pinAt). */
  @media (max-height: 519px) {
    .t-hero {
      min-height: 460px;
    }
    .t-holo {
      margin-top: 0;
    }
  }
  .t-holo .holo {
    width: 100%;
    height: 100%;
  }
  .t-body {
    display: grid;
    gap: 18px;
    max-width: 880px;
    margin: 18px auto 0;
  }
  .t-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 28px;
    flex-wrap: wrap;
  }
  .t-toggle .tagline {
    transform: rotate(-8deg);
  }
  .t-panels {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
  }
  .sheet__ai {
    flex: none;
    display: flex;
    justify-content: center;
    margin-top: -6px;
    padding: 0 12px 10px;
  }

  /* ================= phone ================= */
  [data-layout='phone'] {
    --thumb: 64px;
  }
  .p-holo {
    position: absolute;
    left: 0;
    right: 0;
    top: 118px;
    height: calc(52% - 118px + 24px);
    min-height: 260px;
  }
  .p-holo .holo {
    width: 100%;
    height: 100%;
  }
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 48%;
    display: flex;
    flex-direction: column;
    border-radius: 22px 22px 0 0;
    background: rgba(8, 13, 24, 0.9);
    box-shadow:
      inset 0 1px 0 rgba(160, 190, 240, 0.35),
      0 -12px 30px rgba(0, 0, 0, 0.45);
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
    transition: height var(--dur-slow) var(--ease-out);
    z-index: 3;
  }
  /* Open, it stops under the page's status header (which wraps to two lines here). */
  .sheet.is-open {
    height: calc(100% - 150px - var(--safe-t, 0px));
  }
  /* A full 44 px touch target, drawn as the usual small handle. */
  .sheet__grip {
    display: grid;
    place-items: center;
    flex: none;
    height: 44px;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .sheet__grip span {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: rgba(200, 215, 240, 0.5);
  }
  .sheet__grip:focus-visible {
    outline: var(--focus-width) solid var(--holo-ink);
    outline-offset: -4px;
  }
  .sheet__scroll {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 16px calc(24px + var(--safe-b));
  }
  .region {
    padding-bottom: 14px;
  }
  .region__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .region__title {
    margin: 0;
    font-size: 13px;
    font-weight: var(--fw-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #e8f2ff;
  }
  .region__count {
    margin: 0;
    font-size: 12px;
    color: var(--holo-ink-muted);
  }
  .region__body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-top: 10px;
  }
  .region__lines {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 15px;
    line-height: 1.5;
    color: #d3dcef;
  }
  .region :global(.region__thumb) {
    width: 64px;
    height: 64px;
    flex: none;
  }
  .region__nav {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 12px;
  }
  .region__btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--r-pill);
    background: rgba(28, 48, 76, 0.7);
    box-shadow: inset 0 0 0 1px rgba(140, 165, 210, 0.45);
    color: #e6f1fc;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: var(--fw-medium);
    cursor: pointer;
  }
  .region__btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .region__btn:focus-visible {
    outline: var(--focus-width) solid var(--holo-ink);
    outline-offset: 2px;
  }
  .region--none p {
    margin: 0;
    font-size: 15px;
    line-height: 1.5;
    color: #d3dcef;
  }
  .sheet__more {
    display: grid;
    gap: 16px;
    padding-top: 14px;
    border-top: 1px solid rgba(160, 180, 220, 0.16);
  }
  .sheet__more .tray,
  [data-layout='tablet'] .tray {
    gap: 12px;
  }
  .sheet__more .tray {
    grid-template-columns: minmax(0, 1fr);
  }
  .sheet__more .tagline {
    transform: rotate(-6deg);
    margin: 4px 0 0 12px;
  }

  @media (max-width: 719px) {
    [data-layout='tablet'] .tray,
    .t-panels {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @keyframes tray-in {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
  }
  @keyframes tagline-in {
    from {
      opacity: 0;
      clip-path: inset(0 100% 0 0);
    }
    to {
      clip-path: inset(0 0 0 0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-layout='desk'] .tray,
    .tagline {
      animation: none;
    }
    .sheet {
      transition: none;
    }
  }
  :global([data-reduced-motion='true']) .tray,
  :global([data-reduced-motion='true']) .tagline {
    animation: none;
  }
</style>
