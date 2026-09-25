<!--
  Scan: the consult room (ref4), full-bleed, in the shell's immersive frame
  (no sidebar or tab bar; the shell pins the Back control top-left).

  Arriving on /scan walks her into the consult room and opens the capture
  (App.svelte asks the controller); leaving walks her out and drops the
  reading, the mesh and the photo - a privacy boundary as much as a scene
  change. This page only draws what the view model says (src/view/scan.ts):

  sample        the mockup's consultation, word for word, over the sample mesh,
                under the "Sample data" badge. Nothing is captured.
  capture       the camera frame on the pedestal, guidance beside it.
  reading       the same frame while the real pipeline runs; the header tracks
                its stages.
  consultation  the hologram of this session's own face mesh with the findings
                around it (desk, tablet and phone compositions, Consultation).
  body          a body reading: her words and the ways forward.
  empty         the room without a head: "Scan to see your map".

  The AI disclosure is always on screen (SRS section 6), where the mockup has
  free floor: bottom-right on desktop, in the flow on smaller screens.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { FaceRegionKey } from '@shared/types.ts';
  import AiDisclosure from '@/shell/AiDisclosure.svelte';
  import Button from '@/ui/Button.svelte';
  import ScanCapture from '@/scan/ScanCapture.svelte';
  import { director } from '@/stage/director.ts';
  import { startScanFlow } from '@/state/controller.ts';
  import { session } from '@/state/session.svelte.ts';
  import { scanView } from '@/view/scan.ts';
  import ConsultBackdrop from './scan/ConsultBackdrop.svelte';
  import Consultation from './scan/Consultation.svelte';
  import ReadingDock from './scan/ReadingDock.svelte';
  import StatusHeader from './scan/StatusHeader.svelte';
  import { cropRegions, releaseCrops, type CropSet } from './scan/crops.ts';
  import { syncExplainStyle } from './scan/explain.svelte.ts';

  const view = $derived(scanView());

  /* ---- layout: which composition fits this box ------------------------------ */
  let width = $state(0);
  let height = $state(0);

  /** The ref4 frame, 1672 x 941. */
  const REF_W = 1672;
  const REF_H = 941;

  /**
   * The desk stage is the ref4 frame contained in the window. Below about 0.76 of
   * it (narrower than about 1270 px, or shorter than about 715) the readable type
   * no longer fits around the head without panels running into each other, so
   * those windows get the tablet composition, which scrolls.
   */
  const fitU = $derived(Math.min(width / REF_W, height / REF_H));
  const layout = $derived<'desk' | 'tablet' | 'phone'>(
    fitU >= 0.76 && width / Math.max(1, height) >= 1.3 ? 'desk' : width >= 600 ? 'tablet' : 'phone',
  );
  /** CSS px per ref px on the desk stage. */
  const u = $derived(layout === 'desk' ? fitU : 1);
  const stage = $derived(
    layout === 'desk'
      ? { x: (width - REF_W * u) / 2, y: (height - REF_H * u) / 2, w: REF_W * u, h: REF_H * u }
      : null,
  );
  /**
   * Below the mockup's own size the readable type (which does not shrink with the
   * stage) no longer fits the right column's ref4 positions, so the panels tuck
   * against the edge and the right callouts slim down ("compact").
   */
  const compact = $derived(layout === 'desk' && u < 1);

  /**
   * The reading dock (real mode, desk): her words and the ways forward, on the
   * free floor at the stage's lower left, where the character stood in the
   * mockup. It must clear the card tray to its right (which starts at ref x 523)
   * and the lowest left callout above it, whatever the window size and however
   * long her reply is: its width stops short of the tray, its top under the
   * callouts (measured, since their height follows the readable type and the
   * number of lines), and a long reply scrolls inside it.
   */
  let scanEl: HTMLElement | undefined = $state();
  let calloutsBottom = $state(0);
  function measureCallouts() {
    if (!scanEl) return;
    const top = scanEl.getBoundingClientRect().top;
    let bottom = 0;
    for (const el of scanEl.querySelectorAll<HTMLElement>('.scan__stage .col-left .slot')) {
      bottom = Math.max(bottom, el.getBoundingClientRect().bottom - top);
    }
    calloutsBottom = bottom;
  }
  const dock = $derived.by(() => {
    if (!stage) return null;
    const gap = 16;
    const left = Math.max(gap, stage.x + gap);
    const bottom = Math.max(gap, height - (stage.y + stage.h) + gap);
    const width = Math.max(260, Math.min(460, stage.x + 523 * u - gap - left));
    const top = Math.max(stage.y + 0.45 * stage.h, calloutsBottom + 12);
    return { left, bottom, width, maxHeight: Math.max(150, height - bottom - top) };
  });

  const consulting = $derived(view.phase === 'consultation');
  const capturing = $derived(view.mode === 'real' && (view.phase === 'capture' || view.phase === 'reading'));

  /*
   * Where the pedestal's emitter goes in the portrait compositions. A short
   * window on the tablet composition (a phone on its side) scrolls a head
   * taller than the window: the pedestal sits below the fold there, so its
   * ring never cuts across the face at rest.
   */
  const shortTablet = $derived(layout === 'tablet' && height < 520);
  const pinAt = $derived<[number, number]>(
    layout === 'phone'
      ? [0.5, consulting ? 0.5 : 0.62]
      : shortTablet
        ? [0.5, consulting ? 1.25 : 0.95]
        : [0.5, consulting ? 0.62 : 0.7],
  );

  onMount(() => {
    syncExplainStyle();
  });

  $effect(() => {
    void [width, height, view.callouts, layout];
    if (!(layout === 'desk' && consulting && view.mode === 'real')) return;
    // Now, and again once the callouts' build-in has settled and the fonts are in.
    const raf = requestAnimationFrame(measureCallouts);
    const t = setTimeout(measureCallouts, 1900);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  });

  /* ---- session-only thumbnails from this capture ------------------------------ */
  let crops = $state.raw<CropSet>({});
  /** The set on screen, outside the reactive graph so swapping it cannot re-run the effect. */
  let held: CropSet = {};
  function hold(next: CropSet) {
    releaseCrops(held);
    held = next;
    crops = next;
  }
  /* Primitives, so a new view object (every narration step makes one) does not re-cut them. */
  const cropCapture = $derived(view.mode === 'real' && consulting ? director.hologram.capture : null);
  const cropKey = $derived(
    [...new Set(view.callouts.flatMap((c) => (c.thumb.kind === 'capture' ? [c.thumb.region] : [])))].sort().join(','),
  );
  $effect(() => {
    const capture = cropCapture;
    const regions = (cropKey ? cropKey.split(',') : []) as FaceRegionKey[];
    if (!capture || !regions.length) {
      hold({});
      return;
    }
    let live = true;
    void cropRegions(capture, regions).then(
      (set) => {
        if (live) hold(set);
        else releaseCrops(set);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  });
  onDestroy(() => hold({}));
</script>

<div class="scan" data-layout={layout} bind:this={scanEl} bind:clientWidth={width} bind:clientHeight={height}>
  {#if width && height}
    <ConsultBackdrop
      box={{ w: width, h: height }}
      stage={consulting && stage ? stage : null}
      {pinAt}
      withText={consulting && layout === 'desk'}
      engraveLeft={!compact}
      withBooks={view.mode === 'sample'}
    />
  {/if}

  {#if width && height}
    {#if consulting && layout === 'desk' && stage}
      <div
        class="scan__stage"
        style:left="{stage.x}px"
        style:top="{stage.y}px"
        style:width="{stage.w}px"
        style:height="{stage.h}px"
        style:--u={u}
      >
        <StatusHeader status={view.status} class="scan__status scan__status--desk" />
        <Consultation {view} {layout} {u} {compact} liveMesh={director.hologram.mesh} {crops} />
      </div>
      {#if view.mode === 'real' && dock}
        <div
          class="scan__dock"
          style:left="{dock.left}px"
          style:bottom="{dock.bottom}px"
          style:width="{dock.width}px"
          style:max-height="{dock.maxHeight}px"
        >
          <ReadingDock />
        </div>
      {/if}
      <AiDisclosure tone="holo" class="scan__ai" />
    {:else if consulting}
      <div class="scan__scroll" class:is-fixed={layout === 'phone'}>
        <StatusHeader status={view.status} class="scan__status" />
        <Consultation {view} {layout} u={1} compact={false} liveMesh={director.hologram.mesh} {crops} />
      </div>
      {#if layout === 'tablet'}
        <!-- A footer bar with its own scrim: the reading scrolls under it, never text on text. -->
        <div class="scan__aibar"><AiDisclosure tone="holo" /></div>
      {/if}
    {:else}
      <div class="scan__scroll scan__scroll--center" class:is-fixed={layout === 'phone'}>
        <!-- First in the DOM (it is the page's h1); on the phone it floats over the capture by z-index. -->
        <StatusHeader status={view.status} backed class="scan__status {layout === 'phone' ? 'scan__status--over' : ''}" />
        {#if capturing}
          <div class="scan__capture">
            <ScanCapture {layout}>
              <AiDisclosure tone="holo" />
            </ScanCapture>
          </div>
        {:else if view.phase === 'body'}
          <div class="scan__solo">
            <p class="scan__lede">Body readings are told in words: the face map is for skin scans.</p>
            <ReadingDock size={layout === 'desk' ? 'sm' : 'md'} />
          </div>
        {:else}
          <div class="scan__solo scan__empty on-holo">
            <h2 class="scan__empty-title">Nothing to map yet</h2>
            <p class="scan__lede">
              Your face map is drawn from a live scan and is never stored, so there is nothing to show until you
              take one. The photo is read here, in this browser.
            </p>
            {#if session.chatError}
              <p class="scan__lede" role="alert">{session.chatError}</p>
            {/if}
            <div class="scan__empty-actions">
              <Button onclick={() => startScanFlow('face')} iconStart="camera">Start a scan</Button>
            </div>
          </div>
        {/if}
        {#if layout !== 'phone' && !capturing}
          <AiDisclosure tone="holo" class="scan__ai scan__ai--flow" />
        {/if}
      </div>
      {#if layout === 'phone' && !capturing}
        <AiDisclosure tone="holo" class="scan__ai scan__ai--phone" />
      {/if}
    {/if}
  {/if}
</div>

<style>
  .scan {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--navy-900);
    color: var(--holo-ink-body);
  }
  .scan__stage {
    position: absolute;
  }
  .scan :global(.scan__status--desk) {
    position: absolute;
    left: calc(343px * var(--u, 1));
    top: calc(48px * var(--u, 1));
    z-index: 2;
  }

  /* Tablet and phone: the content scrolls over the fixed room. */
  .scan__scroll {
    position: absolute;
    inset: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .scan__scroll.is-fixed {
    overflow: hidden;
  }
  .scan__scroll :global(.scan__status) {
    position: absolute;
    top: calc(76px + var(--safe-t));
    left: max(16px, var(--safe-l));
    right: 16px;
    z-index: 4;
  }
  .scan[data-layout='desk'] .scan__scroll :global(.scan__status) {
    top: 76px;
    left: 32px;
  }
  .scan__scroll :global(.scan__status--over) {
    top: calc(64px + var(--safe-t));
  }
  .scan__scroll--center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 140px 16px 72px;
  }
  .scan[data-layout='phone'] .scan__scroll--center {
    padding: 0;
  }
  .scan__capture {
    width: 100%;
    display: flex;
    justify-content: center;
  }
  .scan[data-layout='desk'] .scan__capture {
    --cap-h: min(64vh, 600px);
    margin-top: 2vh;
  }
  .scan[data-layout='tablet'] .scan__capture {
    --cap-h: min(46vh, 520px);
  }
  .scan[data-layout='phone'] .scan__capture {
    position: absolute;
    inset: 0;
  }
  .scan__solo {
    display: grid;
    gap: 14px;
    width: min(560px, 100%);
  }
  .scan[data-layout='phone'] .scan__solo {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: calc(64px + var(--safe-b));
    width: auto;
  }
  .scan__empty {
    padding: 22px 24px;
    border-radius: 18px;
    background: rgba(8, 13, 24, 0.8);
    box-shadow:
      inset 0 0 0 1px rgba(150, 170, 210, 0.3),
      0 16px 40px rgba(0, 0, 0, 0.35);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }
  .scan__empty-title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 26px;
    font-weight: var(--fw-regular);
    line-height: 1.2;
    color: #f2f8ff;
  }
  .scan__lede {
    margin: 0;
    max-width: 60ch;
    font-size: 15px;
    line-height: 1.55;
    color: #d3dcef;
  }
  .scan__empty-actions {
    display: flex;
    gap: 10px;
  }

  /* The dock and the disclosure, on the desk stage's free floor. */
  /* Anchored by its bottom edge, so a short reply sits on the floor and a long one scrolls. */
  .scan__dock {
    position: absolute;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: 14px;
    z-index: 3;
  }
  .scan :global(.scan__ai) {
    position: absolute;
    right: 16px;
    bottom: 16px;
    z-index: 3;
  }
  .scan__aibar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 3;
    display: flex;
    justify-content: center;
    padding: 30px 16px calc(12px + var(--safe-b));
    /* Solid from just above the disclosure's own line: whatever has scrolled
       under it is hidden, never drawn faintly behind its words. */
    background: linear-gradient(180deg, rgba(8, 13, 24, 0), rgba(8, 13, 24, 0.95) 24px, rgba(8, 13, 24, 0.97));
    pointer-events: none;
  }
  .scan__aibar > :global(*) {
    pointer-events: auto;
  }
  .scan :global(.scan__ai--flow) {
    position: static;
    margin-top: 20px;
  }
  .scan :global(.scan__ai--phone) {
    left: 16px;
    right: 16px;
    bottom: calc(12px + var(--safe-b));
    justify-content: center;
  }
</style>
