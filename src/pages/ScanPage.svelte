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
                around it (desk, tablet and phone compositions, Consultation),
                told one place at a time by the consult tour first (prepared
                here, specs/consult-tour.md; sample every visit, a real reading
                once while its face is live), then all of it at once, where
                any place can be explained again and the tour replayed.
  body          a body reading: her words and the ways forward.
  empty         the room without a head: "Scan to see your map".

  The AI disclosure is always on screen (SRS section 6). It is the Consent
  Wording Pack's section 8 notice (main, Section 5): the consultation label,
  the result disclaimer and the escalation line, verbatim - three sentences,
  too tall for the bottom-right corner beside the tray at the smaller desk
  sizes. So on the desk consultation it sits on the free floor at the lower
  left, under the left callouts and clear of the tray (where her words, the
  reading dock, stand above it in real mode); in the flow elsewhere on larger
  screens, in a footer bar on the tablet composition, in the sheet on a phone;
  under the facial scan consent while it is unanswered, and in the capture
  panel's foot once the camera is on.

  From main (Section 1): the camera is not mounted until the facial scan
  consent has been answered on this visit (FacialScanConsent, the pack's
  section 1 screen, verbatim); "Not now" goes back Home. A signed-in account
  outside sample mode may then have its capture analysed by Perfect Corp
  through Evia's server, with the local reading as the visible backup; the
  reading dock says which analysis the reading came from.
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { FaceRegionKey } from '@shared/types.ts';
  import AIDisclosure from '@/components/legal/AIDisclosure.svelte';
  import FacialScanConsent from '@/components/legal/FacialScanConsent.svelte';
  import { router } from '@/router/router.svelte.ts';
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
  import { explain, syncExplainStyle } from './scan/explain.svelte.ts';
  import type { PlateRect } from './scan/consult-plate.ts';
  import ReplayRow from './scan/ReplayRow.svelte';
  import { characterProto } from '@/character3d/switch.svelte.ts';
  import { tour } from '@/stage/tour.svelte.ts';
  import { realTourSteps, sampleTourSteps, tourIntro } from '@/scan/tour-steps.ts';

  const view = $derived(scanView());

  /* ---- layout: which composition fits this box ------------------------------ */
  let width = $state(0);
  let height = $state(0);

  /** The ref4 frame, 1672 x 941. */
  const REF_W = 1672;
  const REF_H = 941;

  /**
   * The desk stage is the ref4 frame contained in the window. Below 0.8 of it
   * (narrower than about 1340 px, or shorter than about 755) the readable type
   * no longer fits around the head without the right callouts running into the
   * OBSERVED CONCERNS panel, so those windows get the tablet composition, which
   * scrolls. Above it, Consultation still measures the right column and reports
   * a misfit, should a font or a longer reading need more room than that.
   */
  const fitU = $derived(Math.min(width / REF_W, height / REF_H));
  /*
   * A window the desk stage was measured not to fit (Consultation's
   * `onmisfit`: its right column would run into the panels or the tray). That
   * size and anything no larger in both directions gets the tablet
   * composition; a larger window tries the desk again.
   */
  let misfit = $state<{ w: number; h: number } | null>(null);
  const deskFits = $derived(!misfit || width > misfit.w || height > misfit.h);
  const layout = $derived<'desk' | 'tablet' | 'phone'>(
    fitU >= 0.8 && width / Math.max(1, height) >= 1.3 && deskFits ? 'desk' : width >= 600 ? 'tablet' : 'phone',
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
   * The floor (desk): the free floor at the stage's lower left, where the
   * character stood in the mockup. It holds the AI disclosure and, in real
   * mode, the reading dock above it (her words and the ways forward). It must
   * clear the card tray to its right (which starts at ref x 523) and the lowest
   * left callout above it, whatever the window size and however long her reply
   * is: its width stops short of the tray, its top under the callouts
   * (measured, since their height follows the readable type and the number of
   * lines), and a long reply scrolls inside the dock while the disclosure stays.
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

  /*
   * Character prototype (off by default, src/character3d): where the room plate is placed,
   * so the stand-in shares its camera, relative to the desk stage.
   */
  let plateRect = $state.raw<PlateRect | null>(null);
  const stagePlate = $derived(plateRect && stage ? { x: plateRect.x - stage.x, y: plateRect.y - stage.y, w: plateRect.w, h: plateRect.h } : null);
  const figureOn = $derived(characterProto.on && layout === 'desk');
  /* While the scan gets ready she gestures toward the capture (or the consent that stands in for it). */
  let captureEl: HTMLElement | undefined = $state();
  let consentEl: HTMLElement | undefined = $state();

  /** The tablet composition's disclosure bar, measured so the reading can scroll clear of it. */
  let aibarH = $state(0);

  /** The facial scan consent, answered on this visit (main, Section 1). */
  let facialAccepted = $state(false);

  /**
   * main's lede for the capture phase (its Page header while capturing), word
   * for word: above the consent while it is unanswered, then in the capture
   * panel's foot beside the section 8 notice.
   */
  const CAPTURE_LEDE =
    'After your consent, Perfect Corp can analyse your capture through Evia. Local analysis is available as a backup.';

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

  /* ---- the consult tour (specs/consult-tour.md): prepared here, played by the runner ---------- */
  /** The tour's key: 'sample', or the reading's capturedAt. */
  const tourKey = $derived(consulting ? (view.mode === 'sample' ? 'sample' : view.capturedAt) : null);

  let systemReduced = $state(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  onMount(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => (systemReduced = q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  });
  const reducedMotion = $derived(systemReduced || (session.user?.preferences.reducedMotion ?? false));
  $effect(() => {
    tour.setReducedMotion(reducedMotion);
  });

  /*
   * A consultation on screen gets its tour: sample every time it mounts, a real reading once
   * (while its face is still live); afterwards the summary with re-explain. A new key (the sample
   * switch, a new reading) ends the old run.
   */
  $effect(() => {
    const key = tourKey;
    if (!key) return;
    untrack(() => {
      const t = tour.view;
      if (t.key === key && t.phase !== 'off') return;
      const analysis = view.mode === 'real' ? director.hologram.analysis : null;
      const steps = view.mode === 'sample' ? sampleTourSteps() : analysis ? realTourSteps(view, analysis, explain.style) : [];
      tour.prepare({
        key,
        mode: view.mode,
        steps,
        intro: tourIntro(view),
        autoplay: view.mode === 'sample' || (view.mesh === 'live' && !tour.hasPlayed(key)),
        face: view.mesh === 'sample' || view.mesh === 'live',
        reducedMotion,
      });
    });
  });
  // The Detailed / Gen-Z register changed in the summary: re-explain and replay say it that way.
  $effect(() => {
    const style = explain.style;
    untrack(() => {
      const analysis = director.hologram.analysis;
      if (view.mode === 'real' && analysis && tour.view.key === tourKey) tour.updateSteps(realTourSteps(view, analysis, style));
    });
  });
  onDestroy(() => tour.end('left'));

  const tourSummary = $derived(tour.view.key === tourKey && tour.view.phase === 'summary' && tour.view.beat === null);
  /** Her reply to a real reading is still to come while its face is live: re-explaining now would talk over it. */
  const replyPending = $derived(view.mode === 'real' && view.mesh === 'live');
  const canAgain = $derived(!replyPending && tour.view.steps.length > 0);
  const canReplay = $derived(!replyPending && tour.view.face && tour.view.steps.length > 0);

  $effect(() => {
    void [width, height, view.callouts, layout];
    if (!(layout === 'desk' && consulting)) return;
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
      onrect={(r) => (plateRect = r)}
    />
  {/if}

  {#if figureOn && capturing}
    <!-- Loaded only with the prototype on: nothing of it is fetched otherwise. -->
    {#await import('@/character3d/CharacterStage.svelte') then Stage}
      <Stage.default plate={plateRect} frame={captureEl ?? consentEl ?? null} />
    {/await}
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
        <Consultation
          {view}
          {layout}
          {u}
          {compact}
          liveMesh={director.hologram.mesh}
          {crops}
          {tourKey}
          {canAgain}
          {canReplay}
          onmisfit={() => (misfit = { w: width, h: height })}
          characterOn={figureOn}
          plateRect={stagePlate}
        />
      </div>
      {#if dock}
        <div
          class="scan__floor"
          style:left="{dock.left}px"
          style:bottom="{dock.bottom}px"
          style:width="{dock.width}px"
          style:max-height="{dock.maxHeight}px"
        >
          {#if tourSummary}
            <ReplayRow replay={canReplay} again={canAgain} class="scan__replay" />
          {/if}
          {#if view.mode === 'real'}
            <div class="scan__dock"><ReadingDock quiet={!tourSummary} /></div>
          {/if}
          <AIDisclosure consultation result tone="holo" class="scan__ai scan__ai--floor" />
        </div>
      {/if}
    {:else if consulting}
      <div class="scan__scroll" class:is-fixed={layout === 'phone'} style:--aibar-h="{layout === 'tablet' ? aibarH : 0}px">
        <StatusHeader status={view.status} class="scan__status" />
        <Consultation
          {view}
          {layout}
          u={1}
          compact={false}
          liveMesh={director.hologram.mesh}
          {crops}
          {tourKey}
          {canAgain}
          {canReplay}
        />
      </div>
      {#if layout === 'tablet'}
        <!-- A footer bar with its own scrim: the reading scrolls under it, never text on text,
             and the reading's own foot is padded by the bar's height so its end can scroll clear. -->
        <div class="scan__aibar" bind:clientHeight={aibarH}><AIDisclosure consultation result tone="holo" /></div>
      {/if}
    {:else}
      <div class="scan__scroll scan__scroll--center" class:is-fixed={layout === 'phone'}>
        <!-- First in the DOM (it is the page's h1); on the phone it floats over the capture by z-index. -->
        <StatusHeader status={view.status} backed class="scan__status {layout === 'phone' ? 'scan__status--over' : ''}" />
        {#if capturing}
          {#if facialAccepted}
            <div class="scan__capture" bind:this={captureEl}>
              <ScanCapture {layout}>
                <!-- Not in the phone's fixed sheet: every line there shrinks the face oval
                     above it (this one by about a third at 390x844), and the phone showed it
                     on the consent step just before. The sheet keeps main's two capture lines. -->
                {#if layout !== 'phone'}<p class="scan__caplede">{CAPTURE_LEDE}</p>{/if}
                <AIDisclosure consultation result tone="holo" />
              </ScanCapture>
            </div>
          {:else}
            <!-- The consent stands in for the camera: main's capture lede above it and the
                 section 8 notice under it, in its own column (on a phone, its own scroller). -->
            <div class="scan__consent">
              <div class="scan__consent-col" bind:this={consentEl}>
                <p class="scan__lede scan__lede--consent">{CAPTURE_LEDE}</p>
                <FacialScanConsent tone="holo" onAccepted={() => { facialAccepted = true; }} onDeclined={() => router.go('/')} />
                <AIDisclosure consultation result tone="holo" class="scan__ai scan__ai--consent" />
              </div>
            </div>
          {/if}
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
              take one.
            </p>
            <!-- main's ready card, word for word. -->
            <p class="scan__lede">
              Even light, face in the oval, hold still. Your capture is sent to Perfect Corp only after your consent. Local backup analysis is available.
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
          <AIDisclosure consultation result tone="holo" class="scan__ai scan__ai--flow" />
        {/if}
      </div>
      {#if layout === 'phone' && !capturing}
        <AIDisclosure consultation result tone="holo" class="scan__ai scan__ai--phone" />
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
    justify-content: flex-start;
    /* Clear of the floating status header (76px down, about 67px tall, plus
       the top inset, which includes a sample-only deployment's notice strip). */
    padding: calc(156px + var(--safe-t)) 16px 72px;
  }
  /* Centred when it fits, and scrolled from its top when it does not: two
     growing spacers rather than flex centring, which pushes the top of a
     taller column (the capture with its guidance, the consent) out of reach
     under the header. */
  .scan__scroll--center::before,
  .scan__scroll--center::after {
    content: '';
    flex: 1 1 0;
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
  /* The facial scan consent (main, Section 1) before the camera: a long,
     verbatim screen. On the desk and tablet compositions it is centred when it
     fits and scrolls from its top when it does not (the spacers above); on a
     phone it is its
     own scroller under the floating header, so no line of it runs beneath the
     Back control or the status. */
  .scan__consent {
    display: flex;
    justify-content: center;
    width: 100%;
  }
  .scan[data-layout='phone'] .scan__consent {
    position: absolute;
    top: calc(var(--safe-t) + 144px);
    right: 0;
    bottom: 0;
    left: 0;
    display: block;
    width: auto;
    margin: 0;
    padding: 4px max(16px, var(--safe-r)) calc(24px + var(--safe-b)) max(16px, var(--safe-l));
    overflow-y: auto;
    overscroll-behavior: contain;
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

  /* The dock and the disclosure, on the desk stage's free floor. Anchored by its
     bottom edge, so a short reply sits on the floor and a long one scrolls inside
     the dock; the disclosure under it never scrolls away. */
  .scan__floor {
    position: absolute;
    z-index: 3;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 10px;
  }
  .scan__dock {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: 14px;
  }
  .scan .scan__floor > :global(.scan__ai--floor),
  .scan .scan__floor > :global(.scan__replay) {
    position: static;
    flex: none;
  }
  .scan .scan__floor > :global(.scan__replay) {
    align-self: flex-start;
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

  /* The facial scan consent's column: main's capture lede, the consent, then
     the section 8 notice in the flow under it (never pinned over the room). */
  .scan__consent-col {
    display: grid;
    gap: 14px;
    width: 100%;
    max-width: 46rem;
    min-width: 0;
  }
  /* On the room's picture, so on navy glass like every other line there. */
  .scan__consent-col > .scan__lede--consent {
    max-width: none;
    padding: 10px 14px;
    border-radius: var(--r-md);
    background: var(--glass-holo);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    color: #e6edf9;
  }
  .scan .scan__consent-col > :global(.scan__ai--consent) {
    position: static;
  }
  /* The capture panel's foot: main's lede, then the section 8 notice. */
  .scan__caplede {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: #d3dcef;
  }
</style>
