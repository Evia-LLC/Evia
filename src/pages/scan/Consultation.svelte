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
          bottom sheet shows one region at a time; the rest of the reading is
          further down the sheet.

  The consult tour (specs/consult-tour.md; src/stage/tour.svelte.ts) plays over
  all three: the face forms with nothing on it, then one place at a time the
  spot is tapped (a light gathers on it and a ripple spreads), a line draws out
  of the tap to that place's card, her words for it show in the talk card, and
  the card and line go away. The full reading above (the "summary") is laid
  out all along but hidden and inert until the tour reaches it; from there any
  place can be explained again (its callout, or its zone on the face) and the
  tour replayed. Without her (the default), on tablets and on phones the card
  is the place's own callout in its own slot; the phone's sheet is the talk
  card and the card at once.

  No character (decision 3) unless the character prototype is switched on
  (src/character3d, off by default): then, on the desk composition only, the
  hologram's canvas grows over both sides of the pedestal and a stand-in
  mannequin stands there, drawn in the same canvas, turning to and reaching for
  the spot being explained; the card then goes where she and her arm are not.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { FaceRegionKey } from '@shared/types.ts';
  import type { HologramAnchors } from '@/hologram/index.ts';
  import type { ScanMesh } from '@/scan/mesh.ts';
  import { thumbLabel, type CalloutSlot, type ScanView } from '@/view/scan.ts';
  import Icon from '@/ui/Icon.svelte';
  import AIDisclosure from '@/components/legal/AIDisclosure.svelte';
  import { director } from '@/stage/director.ts';
  import { tour, tourNow } from '@/stage/tour.svelte.ts';
  import HoloCanvas from './HoloCanvas.svelte';
  import Callout from './Callout.svelte';
  import ConcernsPanel from './ConcernsPanel.svelte';
  import SkinMapPanel from './SkinMapPanel.svelte';
  import MetricCard from './MetricCard.svelte';
  import ExplainToggle from './ExplainToggle.svelte';
  import Leaders, { type Leader } from './Leaders.svelte';
  import ReadingDock from './ReadingDock.svelte';
  import ReplayRow from './ReplayRow.svelte';
  import TalkCard from './TalkCard.svelte';
  import Thumb from './Thumb.svelte';
  import { explain } from './explain.svelte.ts';
  import type { CropSet } from './crops.ts';
  import {
    NO_LOOK,
    faceEllipse,
    grow,
    placeTourCard,
    talkCardFrame,
    tourLook,
    type Box,
    type FigureShape,
    type Placement,
  } from './tour-layout.ts';
  import type { CharacterInputs } from '@/character3d/index.ts';
  import type { ReachBox } from '@/character3d/reach.ts';
  import { figureKeepOut, plateRectForStage, type PlateRect } from '@/character3d/room.ts';

  interface Props {
    view: ScanView;
    layout: 'desk' | 'tablet' | 'phone';
    /** Desk: ref px to CSS px, and whether the right column tucks in. */
    u: number;
    compact: boolean;
    /** The live session mesh, when the view says there is one. */
    liveMesh: ScanMesh | null;
    crops: CropSet;
    /** The consult tour prepared for this view ('sample' or the reading's capturedAt), or null. */
    tourKey: string | null;
    /** A place may be explained again now, and the whole tour replayed (the page decides; spec 9). */
    canAgain?: boolean;
    canReplay?: boolean;
    /**
     * Desk: the right column cannot be kept clear of the panels and the tray
     * at this window size (see `fitRight`); the page then uses the tablet
     * composition here.
     */
    onmisfit?: () => void;
    /** Character prototype switched on (desk only). */
    characterOn?: boolean;
    /** Where the room plate is drawn, relative to this stage (desk), or null for the default framing. */
    plateRect?: PlateRect | null;
  }

  const {
    view,
    layout,
    u,
    compact,
    liveMesh,
    crops,
    tourKey,
    canAgain = false,
    canReplay = false,
    onmisfit,
    characterOn = false,
    plateRect = null,
  }: Props = $props();

  /* ---- the consult tour -------------------------------------------------------- */
  const tv = $derived(tour.view);
  /** The tour is this view's (the page prepared it). */
  const mine = $derived(tourKey !== null && tv.key === tourKey && tv.phase !== 'off');
  /** The full reading is on screen: the tour reached its summary. Before the tour is prepared it is not. */
  const summary = $derived(mine && tv.phase === 'summary' && tv.beat === null);
  /** The talk card is up: from the clean face to the end of the last step (and her walk home). */
  const talking = $derived(mine && (tv.phase === 'clean' || tv.phase === 'step' || (tv.phase === 'summary' && tv.beat !== null)));
  /** The place being explained, and its callout. */
  const tstep = $derived(mine && tv.phase === 'step' ? (tv.steps[tv.index] ?? null) : null);
  const tcallout = $derived(tstep ? (view.callouts.find((c) => c.slot === tstep.slot) ?? null) : null);
  /** What of the step is on screen at this moment of the tour's clock. */
  const look = $derived(mine ? tourLook(tv, tour.time) : NO_LOOK);
  const reduced = $derived(tv.reducedMotion);

  /* ---- character prototype (desk only): the canvas covers both sides of the pedestal --- */
  /**
   * The part of ref4 the canvas covers with her in it: her home (x 130..645), the hologram's box and
   * her place right of the pedestal with room for her far hand (to x 1490). One size for both sides, so
   * a teleport never remounts the canvas (and re-forms the face).
   */
  const FIGURE_BOX = { x: 90, y: 0, w: 1400, h: 941 };
  const withFigure = $derived(characterOn && layout === 'desk');
  const stagePlate = $derived(plateRect ?? plateRectForStage({ x: 0, y: 0, w: 1672 * u, h: 941 * u }));
  /** Her silhouette on the stage for the card's placement, on the side the current step needs her. */
  const figureShape = $derived.by((): FigureShape | null => {
    if (!withFigure || !tv.figure) return null;
    const k = figureKeepOut(tv.targetSide, stagePlate, { x: 0, y: 0, w: 1672 * u, h: 941 * u });
    return { side: tv.targetSide, ...k };
  });
  const figure = $derived.by((): CharacterInputs | null => {
    if (!withFigure) return null;
    const plate = stagePlate;
    // She turns to and reaches for the step's spot until the line goes (not while she teleports).
    const reaching = tstep && tv.beat !== 'teleport-out' && tv.beat !== 'teleport-in' && tv.marks['line-out'] === undefined;
    return {
      plate: { x: plate.x - FIGURE_BOX.x * u, y: plate.y - FIGURE_BOX.y * u, w: plate.w, h: plate.h },
      region: reaching && tstep ? tstep.contact : null,
      phase: 'consult',
      // During the tour only the card and the talk card are on screen, and her arm keeps clear of both.
      avoid: tstep ? figureAvoid : [],
    };
  });

  const LEFT: CalloutSlot[] = ['forehead', 'tzone', 'cheeks'];
  const leftCallouts = $derived(view.callouts.filter((c) => LEFT.includes(c.slot)));
  const rightCallouts = $derived(view.callouts.filter((c) => !LEFT.includes(c.slot)));

  const meshSource = $derived<'sample' | ScanMesh | null>(view.mesh === 'sample' ? 'sample' : view.mesh === 'live' ? liveMesh : null);
  const showDock = $derived(view.mode === 'real');

  /* ---- the phone's one-region-at-a-time sheet ----------------------------- */
  let step = $state(0);
  let sheetOpen = $state(false);
  const current = $derived(view.callouts[Math.min(step, Math.max(0, view.callouts.length - 1))] ?? null);
  // The tour moves the sheet to the place it is on, so the summary opens where it ended.
  $effect(() => {
    const slot = view.activeSlot;
    if (!slot) return;
    const i = view.callouts.findIndex((c) => c.slot === slot);
    if (i >= 0) step = i;
  });
  // The sheet cannot be pulled up over the face while the tour plays.
  $effect(() => {
    if (!summary) sheetOpen = false;
  });

  /** What glows on the face: the step's zones from the tap until its line goes, or the whole reading in the summary. */
  const holoZones = $derived(summary ? view.highlights : look.zones && tstep ? [...tstep.zones] : []);
  /** The region lit brighter: the tapped spot during its step; on the phone's summary, the sheet's place. */
  const holoActive = $derived.by((): FaceRegionKey | null => {
    if (tstep) return look.zones ? tstep.contact : null;
    if (summary && layout === 'phone') return current?.anchor ?? null;
    return null;
  });
  /** The tap's ripple, once per contact (not for a face-less step). */
  const holoPulse = $derived(tstep && tv.face && tv.contactAt !== null && tv.marks.reach !== undefined ? { region: tstep.contact, at: tv.contactAt } : null);
  const activeSlot = $derived(tstep ? tstep.slot : summary && layout === 'phone' ? (current?.slot ?? null) : null);
  const activeMetric = $derived(tstep?.metric ?? null);

  /* ---- measuring ------------------------------------------------------------------ */
  let root: HTMLElement | undefined = $state();
  let holoBox: HTMLElement | undefined = $state();
  let anchors = $state.raw<HologramAnchors | null>(null);
  /** The projected face oval, CSS px of the canvas. */
  let faceBox = $state.raw<Box | null>(null);
  let ports = $state.raw<Record<string, { x: number; y: number }>>({});
  let holoAt = $state.raw({ x: 0, y: 0 });
  /** Phone: the sheet's top edge, where the leader stops (it never crosses the sheet's text). */
  let sheetTop = $state<number | null>(null);
  let webgl = $state(true);
  /** Desk: each slot's summary box, the thumbnail frames' geometry, and what the card must keep clear of (stage px). */
  let homeBoxes = $state.raw<Partial<Record<CalloutSlot, Box>>>({});
  let thumbGeom = $state.raw<{ w: number; h: number; inset: { left: number; right: number } }>({ w: 60, h: 60, inset: { left: 12, right: 0 } });
  let fixedKeepOut = $state.raw<Box[]>([]);
  /** The measured tour card and talk card. */
  let cardW = $state(0);
  let cardH = $state(0);
  let talkW = $state(0);
  let talkH = $state(0);

  function rel(b: DOMRect, r: DOMRect): Box {
    return { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height };
  }

  function measure() {
    if (!root || !holoBox) return;
    const r = root.getBoundingClientRect();
    // The canvas, which may be larger than its box (character prototype): anchors are its px.
    const c = (holoBox.querySelector('canvas') ?? holoBox).getBoundingClientRect();
    holoAt = { x: c.left - r.left, y: c.top - r.top };
    const next: Record<string, { x: number; y: number }> = {};
    for (const el of root.querySelectorAll<HTMLElement>('[data-slot]')) {
      const port = el.querySelector<HTMLElement>('[data-port]');
      if (!port || !el.dataset.slot || el.closest('.tour-card')) continue;
      const p = port.getBoundingClientRect();
      if (!p.width) continue;
      const side = port.dataset.port;
      const x = side === 'right' ? p.right : side === 'top' ? p.left + 14 : p.left;
      const y = side === 'top' ? p.top : p.top + p.height / 2;
      next[el.dataset.slot] = { x: x - r.left, y: y - r.top };
    }
    ports = next;
    if (layout !== 'phone') {
      const homes: Partial<Record<CalloutSlot, Box>> = {};
      let geom = thumbGeom;
      for (const el of root.querySelectorAll<HTMLElement>('.summary .slot, .t-slot')) {
        const slot = el.dataset.box as CalloutSlot | undefined;
        const b = el.getBoundingClientRect();
        if (!slot || !b.width) continue;
        homes[slot] = rel(b, r);
        const port = el.querySelector<HTMLElement>('[data-port]')?.getBoundingClientRect();
        if (port?.width) {
          const right = el.closest('.col-right') !== null;
          geom = {
            w: port.width,
            h: port.height,
            inset: right ? { ...geom.inset, right: port.left - b.left } : { ...geom.inset, left: b.right - port.right },
          };
        }
      }
      homeBoxes = homes;
      thumbGeom = geom;
    }
    if (layout === 'desk') {
      // What the card keeps clear of, besides her and the face: the header, the badge, Back and the floor.
      const keep: Box[] = [];
      const header = root.parentElement?.querySelector<HTMLElement>('.scan__status');
      for (const el of [header, document.querySelector<HTMLElement>('.ev-sample'), document.querySelector<HTMLElement>('.evia-shell__back'), document.querySelector<HTMLElement>('.scan__floor')]) {
        const b = el?.getBoundingClientRect();
        if (b?.width) keep.push(grow(rel(b, r), 8));
      }
      fixedKeepOut = keep;
    }
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
   * a stand-in font cannot send the reference size to the tablet layout. The
   * summary is laid out while the tour hides it, so this holds all along.
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
    // The adjustments actually applied to what was just measured, read from the page rather than
    // from this component's state: a measure can run before a new value has reached the page, and
    // working from the state then chases its own tail.
    const applied = getComputedStyle(root);
    const appliedDrop = parseFloat(applied.getPropertyValue('--right-drop')) || 0;
    const appliedShift = parseFloat(applied.getPropertyValue('--concerns-shift')) || 0;
    // Where the column is without this function's own adjustments.
    const top = Math.min(...boxes.map((b) => b.top)) - appliedDrop;
    const bottom = Math.max(...boxes.map((b) => b.bottom)) - appliedDrop;
    const left = Math.min(...boxes.map((b) => b.left));
    const reach = Math.max(...boxes.map((b) => b.right));

    const map = root.querySelector<HTMLElement>('.panels .skinmap')?.getBoundingClientRect();
    const drop = map && map.left < reach + FIT_GAP ? Math.max(0, map.bottom + FIT_GAP - top) : 0;

    const c = concerns.getBoundingClientRect();
    const baseLeft = c.left - appliedShift;
    const baseRight = c.right - appliedShift;
    const need = Math.max(0, reach + FIT_GAP - baseLeft);
    const room = Math.max(0, r.right - FIT_EDGE - baseRight);
    const shift = Math.min(need, room);

    const shelf = root.querySelector<HTMLElement>('.shelf')?.getBoundingClientRect();
    // The chin callout may sit close above the tray (8 px at 1366 x 768, as designed), never on it.
    const underTray = !!shelf && left < shelf.right && reach > shelf.left && bottom + drop + FIT_TRAY_GAP > shelf.top;

    if (Math.abs(shift - concernsShift) > 0.5) concernsShift = shift;
    if (Math.abs(drop - rightDrop) > 0.5) {
      rightDrop = drop;
      // The leader lines start at the callouts' thumbnails: measure them again where they now are
      // (next frame, once the new place is laid out).
      requestAnimationFrame(() => measure());
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
    // The tour's contact point: where the tapped anchor is in ref4 px at the moment of the tap.
    tour.setAnchorSource((region) => anchors?.[region]?.ref ?? null);
    return () => {
      ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
      tour.setAnchorSource(null);
    };
  });

  $effect(() => {
    void layout;
    void compact;
    void withFigure;
    void view.callouts;
    void step;
    void sheetOpen;
    void tv.summarySeq;
    void tv.seq;
    void talking;
    void tick().then(measure);
    // Again once the sheet has finished sliding.
    const t = setTimeout(measure, 450);
    return () => clearTimeout(t);
  });

  // The face is there to tap (a mesh, and WebGL to draw it).
  $effect(() => {
    tour.setFace(webgl && meshSource !== null);
  });

  // Her stage: the prototype on the desk, or nobody.
  $effect(() => {
    if (!withFigure) director.reportTour({ kind: 'figure', present: false, caps: { contact: false, teleport: false } });
  });

  /* ---- the tour's card: where it goes (desk), fixed for the step ------------------ */
  const talkBox = $derived.by((): Box | null => {
    if (layout !== 'desk' || !talking || !talkW) return null;
    const f = talkCardFrame(u);
    return { x: f.cx - talkW / 2, y: f.bottom - talkH, w: talkW, h: talkH };
  });
  /** The stage box and the face oval (stage px). */
  const stageBox = $derived<Box>({ x: 0, y: 0, w: 1672 * u, h: 941 * u });
  const faceOval = $derived(
    faceBox
      ? faceEllipse({ x: holoAt.x + faceBox.x, y: holoAt.y + faceBox.y, w: faceBox.w, h: faceBox.h })
      : { cx: 868.6 * u, cy: 319.7 * u, rx: 163.5 * u, ry: 172.5 * u },
  );
  /** The anchor of a region on the stage, if it is visible. */
  function anchorAt(region: FaceRegionKey): { x: number; y: number } | null {
    const a = anchors?.[region];
    return a?.visible ? { x: holoAt.x + a.x, y: holoAt.y + a.y } : null;
  }
  /*
   * Placed once per step (and again only if the card, the window or her side changes): the card
   * holds still while the head floats, and the line's face end follows the anchor.
   */
  let placed: { key: string; placement: Placement } | null = null;
  const placement = $derived.by((): Placement | null => {
    if (layout !== 'desk' || !tstep || !tcallout) return null;
    const home = homeBoxes[tstep.slot];
    if (!home) return null;
    const card = cardW ? { w: cardW, h: cardH } : { w: home.w, h: home.h };
    const contact = anchorAt(tstep.contact);
    const key = [tv.seq, u, card.w, card.h, figureShape?.side ?? '-', contact ? 1 : 0, home.x, home.y, talkBox?.h ?? 0].join('|');
    if (placed?.key === key) return placed.placement;
    const result = placeTourCard({
      region: tstep.contact,
      contact,
      card,
      thumb: thumbGeom,
      home,
      homeOrient: LEFT.includes(tstep.slot) ? 'left' : 'right',
      face: faceOval,
      figure: figureShape,
      keepOut: fixedKeepOut,
      talk: talkBox ? grow(talkBox, 12) : null,
      stage: stageBox,
      u,
    });
    placed = { key, placement: result };
    return result;
  });
  /** Her arm keeps clear of the card and the talk card (canvas px). */
  const figureAvoid = $derived.by((): ReachBox[] => {
    const out: ReachBox[] = [];
    if (placement) out.push({ id: 'card', x: placement.box.x - holoAt.x, y: placement.box.y - holoAt.y, w: placement.box.w, h: placement.box.h });
    if (talkBox) out.push({ id: 'talk', x: talkBox.x - holoAt.x, y: talkBox.y - holoAt.y, w: talkBox.w, h: talkBox.h });
    return out;
  });

  /** The card's slide, along the line from the spot (px). */
  function slide(port: { x: number; y: number }, contact: { x: number; y: number } | null, shift: number): { x: number; y: number } {
    if (!contact || !shift) return { x: 0, y: 0 };
    const dx = port.x - contact.x, dy = port.y - contact.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: (dx / l) * shift, y: (dy / l) * shift };
  }
  const tourContact = $derived(tstep ? anchorAt(tstep.contact) : null);
  const cardSlide = $derived.by(() => {
    const shift = look.card?.shift ?? 0;
    if (layout === 'desk') return placement ? slide(placement.port, tourContact, shift) : { x: 0, y: 0 };
    const p = tstep ? ports[tstep.slot] : undefined;
    return p && layout === 'tablet' ? slide(p, tourContact, shift) : { x: 0, y: 0 };
  });

  /* ---- leader lines ---------------------------------------------------------- */
  const leaders = $derived.by((): Leader[] => {
    if (!anchors) return [];
    // The tour's one line: from the tapped spot to its card.
    if (!summary) {
      if (!tstep || !tv.face || !tourContact) return [];
      const { x: ax, y: ay } = tourContact;
      let px: number, py: number;
      if (layout === 'desk') {
        if (!placement) return [];
        px = placement.port.x + cardSlide.x;
        py = placement.port.y + cardSlide.y;
      } else {
        const p = ports[tstep.slot];
        if (!p) return [];
        px = p.x + cardSlide.x;
        py = layout === 'phone' && sheetTop !== null ? sheetTop : p.y + cardSlide.y;
      }
      return [
        { id: 'tour', ax, ay, px, py, active: look.card !== null, tour: { line: look.line, dot: look.dot, port: look.port, gather: look.gather } },
      ];
    }
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

  /* ---- the summary: explain a place again ------------------------------------------ */
  /** The zone hit targets: every region a callout speaks for, at its anchor (stage px). */
  const zoneTargets = $derived.by(() => {
    if (!summary || !canAgain || !anchors) return [];
    const out: { slot: CalloutSlot; region: FaceRegionKey; x: number; y: number }[] = [];
    for (const c of view.callouts) {
      for (const region of new Set([c.anchor, ...c.regions])) {
        const a = anchorAt(region);
        if (a) out.push({ slot: c.slot, region, x: a.x, y: a.y });
      }
    }
    return out;
  });
  function again(slot: CalloutSlot) {
    if (summary && canAgain) tour.explainAgain(slot);
  }
  /** "Show all results" leaves the tour's controls: focus goes to Replay (or the first place) once the summary is up. */
  let focusOnSummary = $state(false);
  function focusSummary() {
    focusOnSummary = true;
  }
  $effect(() => {
    if (!focusOnSummary || !summary) return;
    focusOnSummary = false;
    void tick().then(() => {
      const target = document.querySelector<HTMLElement>('[aria-label="Replay walkthrough"]') ?? root?.querySelector<HTMLElement>('.again');
      target?.focus();
    });
  });

  const cardActive = (metric: string | null) => metric !== null && metric === activeMetric;
  /**
   * The cards' gauge on the desk stage: 66 px at the mockup's size (its 70 px less
   * a little, so "Below optimal levels" and "BARRIER SUPPORT" stay on one line at
   * the readable type), shrinking with the stage to 0.78 of that.
   */
  const gauge = $derived(layout === 'desk' ? Math.round(66 * Math.min(1, Math.max(0.78, u))) : 70);
  /*
   * The talk card fades in (220 ms) when the tour starts talking and out (300 ms) as the summary
   * builds, on the tour's clock (so a hand-driven clock can show any moment of it).
   */
  let talkFrom = 0;
  let talkOutFrom: number | null = null;
  let wasTalking = false;
  const talkLook = $derived.by((): { shown: boolean; opacity: number } => {
    const t = tour.time;
    if (talking) {
      if (!wasTalking) {
        wasTalking = true;
        talkFrom = tourNow();
        talkOutFrom = null;
      }
      return { shown: true, opacity: reduced ? 1 : Math.max(0, Math.min(1, (t - talkFrom) / 220)) };
    }
    if (wasTalking) {
      wasTalking = false;
      talkOutFrom = summary && !reduced ? tourNow() : null;
    }
    if (talkOutFrom !== null) {
      const left = 1 - (t - talkOutFrom) / 300;
      if (left > 0) return { shown: true, opacity: Math.min(1, left) };
      talkOutFrom = null;
    }
    return { shown: false, opacity: 0 };
  });
  /** The tablet's callouts: only the step's is shown while the tour plays, and only once its card is up. */
  function tabletShown(slot: CalloutSlot): boolean {
    if (summary) return true;
    return tstep?.slot === slot && look.card !== null;
  }
</script>

{#snippet hologram(align: { x: number; y: number }, withChar: boolean)}
  <div class="holo" class:has-figure={withChar} bind:this={holoBox}>
    {#key withChar}
      <HoloCanvas
        mesh={meshSource}
        highlights={holoZones}
        active={holoActive}
        pulse={holoPulse}
        zoneFade={look.zoneFadeMs}
        {align}
        extend={withChar ? FIGURE_BOX : undefined}
        character={withChar ? figure : null}
        onanchors={(a, f) => {
          anchors = a;
          faceBox = f;
        }}
        onsupport={(ok) => (webgl = ok)}
        onformed={() => {
          if (tourKey) tour.faceFormed(tourKey);
        }}
        onfigure={(present) => director.reportTour({ kind: 'figure', present, caps: { contact: false, teleport: false } })}
      />
    {/key}
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

{#snippet talk(kind: 'desk' | 'tablet')}
  {#if talkLook.shown}
    <div
      class="talk-at talk-at--{kind}"
      style:opacity={talkLook.opacity}
      inert={!talking}
      bind:offsetWidth={talkW}
      bind:offsetHeight={talkH}
    >
      <TalkCard view={tv} layout={kind} figure={withFigure && tv.figure} onshowall={focusSummary} />
    </div>
  {/if}
{/snippet}

{#snippet againLayer()}
  <!-- Re-explain: one transparent button over each callout, in reading order, and a 44 px target on
       each of its zones on the face (pointer only). Live in the summary; kept (not clickable) while
       a place is explained again, so the button that started it keeps focus. -->
  {#if mine && (summary || tv.single) && canAgain}
    <div class="again-layer" class:is-live={summary}>
      {#each view.callouts as c (c.slot)}
        {@const b = homeBoxes[c.slot]}
        {#if b}
          <button
            type="button"
            class="again"
            style:left="{b.x}px"
            style:top="{b.y}px"
            style:width="{b.w}px"
            style:height="{b.h}px"
            aria-label="Explain {c.heading.charAt(0) + c.heading.slice(1).toLowerCase()} again"
            onclick={() => again(c.slot)}
          ></button>
        {/if}
      {/each}
      {#each zoneTargets as z (z.slot + z.region)}
        <button
          type="button"
          class="again-zone"
          tabindex="-1"
          aria-hidden="true"
          style:left="{z.x - 22}px"
          style:top="{z.y - 22}px"
          onclick={() => again(z.slot)}
        ></button>
      {/each}
    </div>
  {/if}
{/snippet}

<div
  class="consult"
  data-layout={layout}
  class:is-compact={compact}
  class:is-touring={!summary}
  class:is-quick={summary && tv.build === 'quick'}
  style:--u={u}
  style:--concerns-shift="{layout === 'desk' ? concernsShift : 0}px"
  style:--right-drop="{layout === 'desk' ? rightDrop : 0}px"
  bind:this={root}
>
  <p class="visually-hidden" role="status">{mine ? tv.status : ''}</p>

  {#if layout === 'desk'}
    {@render hologram({ x: 0.5, y: 0.5 }, withFigure)}
    {@render againLayer()}

    <!-- The full reading: laid out all along (so it is measured), hidden and inert until the tour's summary. -->
    {#key tv.summarySeq}
      <div class="summary" inert={!summary}>
        <div class="col-left">
          <!-- Headings in reading order: the title (h1), then each part of the reading (h2). -->
          <h2 class="visually-hidden">On the face</h2>
          {#each leftCallouts as callout, i (callout.slot)}
            <div class="slot slot--{callout.slot}" data-box={callout.slot}>
              <Callout
                {callout}
                side="left"
                crop={callout.thumb.kind === 'capture' ? (crops[callout.thumb.region] ?? null) : null}
                active={summary && activeSlot === callout.slot}
                index={i}
              />
            </div>
          {/each}
        </div>
        <div class="col-right">
          {#each rightCallouts as callout, i (callout.slot)}
            <div class="slot slot--{callout.slot}" data-box={callout.slot}>
              <Callout
                {callout}
                side="right"
                crop={callout.thumb.kind === 'capture' ? (crops[callout.thumb.region] ?? null) : null}
                active={summary && activeSlot === callout.slot}
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
      </div>
    {/key}

    <!-- The tour's card: the place's callout, where the placement puts it (its own slot without her). -->
    {#if tstep && tcallout && look.cardMounted}
      {@const orient = placement?.orient ?? (LEFT.includes(tstep.slot) ? 'left' : 'right')}
      <div
        class="tour-card"
        class:is-right={orient === 'right'}
        aria-hidden="true"
        bind:offsetWidth={cardW}
        bind:offsetHeight={cardH}
        style:left="{placement?.box.x ?? 0}px"
        style:top="{placement?.box.y ?? 0}px"
        style:opacity={look.card?.opacity ?? 0}
        style:visibility={look.card && placement ? 'visible' : 'hidden'}
        style:transform="translate({cardSlide.x}px, {cardSlide.y}px)"
      >
        <Callout
          callout={tcallout}
          side={orient}
          crop={tcallout.thumb.kind === 'capture' ? (crops[tcallout.thumb.region] ?? null) : null}
          active={look.card !== null}
          still
          compact={compact && orient === 'right'}
        />
      </div>
    {/if}

    <Leaders {leaders} />
    {@render talk('desk')}
  {:else if layout === 'tablet'}
    <div class="t-hero">
      <h2 class="visually-hidden">On the face</h2>
      <div class="t-col">
        {#key tv.summarySeq}
          {#each leftCallouts as callout, i (callout.slot)}
            <div
              class="t-slot"
              data-box={callout.slot}
              inert={!summary}
              aria-hidden={summary ? undefined : 'true'}
              style:visibility={tabletShown(callout.slot) ? null : 'hidden'}
              style:opacity={summary ? null : (look.card?.opacity ?? 0)}
              style:transform={summary || tstep?.slot !== callout.slot ? null : `translate(${cardSlide.x}px, ${cardSlide.y}px)`}
            >
              <Callout
                {callout}
                side="left"
                crop={callout.thumb.kind === 'capture' ? (crops[callout.thumb.region] ?? null) : null}
                active={activeSlot === callout.slot}
                index={i}
                still={!summary}
                compact
              />
            </div>
          {/each}
        {/key}
      </div>
      <div class="t-holo">{@render hologram({ x: 0.5, y: 1 }, false)}</div>
      <div class="t-col t-col--right">
        {#key tv.summarySeq}
          {#each rightCallouts as callout, i (callout.slot)}
            <div
              class="t-slot"
              data-box={callout.slot}
              inert={!summary}
              aria-hidden={summary ? undefined : 'true'}
              style:visibility={tabletShown(callout.slot) ? null : 'hidden'}
              style:opacity={summary ? null : (look.card?.opacity ?? 0)}
              style:transform={summary || tstep?.slot !== callout.slot ? null : `translate(${cardSlide.x}px, ${cardSlide.y}px)`}
            >
              <Callout
                {callout}
                side="right"
                crop={callout.thumb.kind === 'capture' ? (crops[callout.thumb.region] ?? null) : null}
                active={activeSlot === callout.slot}
                index={i + 3}
                still={!summary}
                compact
              />
            </div>
          {/each}
        {/key}
      </div>
    </div>
    {@render againLayer()}
    <div class="t-body">
      {#if summary}
        <ReplayRow replay={canReplay} again={canAgain} touch class="t-replay" />
        {#key tv.summarySeq}
          <div class="t-summary">
            {@render tray()}
            <div class="t-toggle">
              <ExplainToggle />
              {@render tagline()}
            </div>
            <div class="t-panels">
              <ConcernsPanel rows={view.concerns.rows} empty={view.concerns.empty} active={activeMetric} />
              <SkinMapPanel />
            </div>
          </div>
        {/key}
      {:else}
        {@render talk('tablet')}
      {/if}
      {#if showDock}<ReadingDock size="md" quiet={!summary} />{/if}
    </div>
    <Leaders {leaders} />
  {:else}
    <div class="p-holo">{@render hologram({ x: 0.5, y: 1 }, false)}</div>
    {@render againLayer()}

    <section class="sheet" class:is-open={sheetOpen} class:is-tour={!summary} aria-label="Your reading, one region at a time">
      {#if summary}
        <button
          type="button"
          class="sheet__grip"
          aria-expanded={sheetOpen}
          aria-label={sheetOpen ? 'Show less of the reading' : 'Show all of the reading'}
          onclick={() => (sheetOpen = !sheetOpen)}
        >
          <span aria-hidden="true"></span>
        </button>
      {/if}
      {#if summary}<div class="sheet__ai"><AIDisclosure consultation result tone="holo" /></div>{/if}
      <div class="sheet__scroll">
        {#if !summary}
          <!-- The tour: the sheet is the talk card, with the place's card in it. -->
          {#if talking}
            <div class="sheet__tour" data-slot={tstep?.slot ?? 'clean'} style:opacity={talkLook.opacity}>
              {#snippet phoneCard()}
                {#if tstep && tcallout}
                  <div class="tour-lines" data-port="top" aria-hidden="true" style:opacity={look.card?.opacity ?? 0}>
                    <ul class="region__lines">
                      {#each tcallout.lines as line (line)}<li>{line}</li>{/each}
                    </ul>
                    <Thumb
                      thumb={tcallout.thumb}
                      src={tcallout.thumb.kind === 'capture' ? (crops[tcallout.thumb.region] ?? null) : null}
                      label={thumbLabel(tcallout)}
                      class="region__thumb"
                    />
                  </div>
                {/if}
              {/snippet}
              <TalkCard view={tv} layout="phone" card={phoneCard} onshowall={focusSummary} class="sheet__talk" />
            </div>
          {/if}
          <!-- The section 8 notice stays in the sheet throughout, under the tour. -->
          <div class="sheet__ai sheet__ai--tour"><AIDisclosure consultation result tone="holo" /></div>
          {#if showDock}<ReadingDock size="md" quiet />{/if}
        {:else if current}
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

        {#if summary}
          <div class="sheet__more">
            <ReplayRow replay={canReplay} again={canAgain} touch />
            <ExplainToggle full />
            {@render tray()}
            <ConcernsPanel rows={view.concerns.rows} empty={view.concerns.empty} active={activeMetric} />
            <SkinMapPanel />
            {@render tagline()}
            {#if showDock}<ReadingDock size="md" />{/if}
          </div>
        {/if}
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
  /* The canvas reaches past the box over her place; the box itself still takes no clicks. */
  .holo.has-figure {
    pointer-events: none;
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
  .is-compact .col-right,
  .is-compact .tour-card.is-right {
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

  /* ================= the consult tour ================= */
  /* The full reading while the tour plays: laid out (measured), faded out and hidden, inert. */
  .summary {
    transition:
      opacity 300ms var(--ease-out),
      visibility 0s linear 0s;
  }
  .is-touring .summary {
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 300ms var(--ease-out),
      visibility 0s linear 300ms;
  }
  /* After a place was explained again, the reading comes back in one quick fade, no stagger. */
  .is-quick .summary {
    animation: quick-in 600ms var(--ease-out) both;
  }
  .is-quick .summary :global(*),
  .is-quick :global(.leaders .is-static) {
    animation-delay: 0s !important;
    animation-duration: 1ms !important;
  }
  @keyframes quick-in {
    from {
      opacity: 0;
    }
  }
  /* The place's card during its step (desk): the callout, where the placement puts it. */
  .tour-card {
    position: absolute;
    z-index: 2;
    pointer-events: none;
  }
  .talk-at--desk {
    position: absolute;
    z-index: 4;
    left: calc(868px * var(--u));
    bottom: calc((941px - 836px) * var(--u));
    width: clamp(480px, calc(600px * var(--u)), 720px);
    transform: translateX(-50%);
  }
  .talk-at--tablet {
    width: min(560px, 100%);
    justify-self: center;
  }
  /* Explain a place again: a transparent button over each callout, and a 44 px target on each zone. */
  .again-layer {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }
  .again,
  .again-zone {
    position: absolute;
    padding: 0;
    border: 0;
    border-radius: 12px;
    background: transparent;
    cursor: pointer;
  }
  .again-layer.is-live .again,
  .again-layer.is-live .again-zone {
    pointer-events: auto;
  }
  .again-zone {
    width: 44px;
    height: 44px;
    border-radius: 50%;
  }
  .again:focus-visible {
    outline: var(--focus-width) solid var(--holo-ink);
    outline-offset: 2px;
  }
  .again-layer.is-live .again:hover {
    box-shadow: 0 0 0 1px rgba(160, 200, 255, 0.45);
  }
  .t-slot {
    position: relative;
  }
  .t-summary {
    display: grid;
    gap: 18px;
  }
  .t-body > :global(.t-replay) {
    justify-self: center;
  }
  /* Phone: the sheet is the talk card during the tour (no grip, not expandable). */
  .sheet.is-tour .sheet__scroll {
    padding-top: 16px;
  }
  .sheet__ai--tour {
    margin-top: 14px;
    padding: 0;
  }
  .sheet__tour {
    display: grid;
    gap: 12px;
  }
  .sheet__tour :global(.sheet__talk) {
    padding: 0;
    background: none;
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .tour-lines {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }
  .tour-lines :global(.region__thumb) {
    width: 64px;
    height: 64px;
    flex: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .summary,
    .is-touring .summary {
      transition: none;
    }
    .is-quick .summary {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .summary,
  :global([data-reduced-motion='true']) .is-touring .summary {
    transition: none;
  }
  :global([data-reduced-motion='true']) .is-quick .summary {
    animation: none;
  }
</style>
