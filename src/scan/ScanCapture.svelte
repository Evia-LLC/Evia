<script lang="ts">
  /**
   * Capture. Camera or file, then the real pipeline.
   *
   * Deliberately explicit about where the pixels go: the analysis is local, and
   * the frame is only uploaded if the user turned that on themselves.
   *
   * A face scan is one frame. A body scan is two, and the second one is the
   * point: a belly projects forward, and a camera in front of you measures
   * width, so abdominal protrusion is close to invisible head on. The side view
   * is the only frame it is actually in. The front frame still does the work it
   * always did — posture, proportions, the hologram — and the side view is
   * skippable, with the cost of skipping it stated rather than hidden.
   *
   * On a face scan the viewport is not a mirror any more: a live mesh is found
   * on the face and drawn as light, locks when the framing is good, and sweeps
   * while the measurement runs. See `face-mesh.ts` for what it is and is not.
   */
  import { onDestroy, type Snippet } from 'svelte';
  import { session } from '@/state/session.svelte.ts';
  import { runAnalysis } from '@/state/controller.ts';
  import { router } from '@/router/router.svelte.ts';
  import { stillness } from '@/lib/motion.ts';
  import * as sound from '@/lib/sound.ts';
  import {
    LiveFaceMesh,
    coverMap,
    drawMesh,
    wellFramed,
    type MeshFrame,
  } from './face-mesh.ts';
  import { CaptureGuide, type GuideVerdict } from './capture-guide.ts';
  import { captureStatus } from './capture-status.svelte.ts';
  import Button from '@/ui/Button.svelte';
  import ProgressBar from '@/ui/ProgressBar.svelte';
  import SegmentedTabs from '@/ui/SegmentedTabs.svelte';

  interface Props {
    /**
     * How the Scan page is composed: 'desk' and 'tablet' put the camera frame
     * on the pedestal with the guidance beside or under it; 'phone' is the
     * sequential flow's full-screen capture (BUILD-PLAN decision 7).
     */
    layout?: 'desk' | 'tablet' | 'phone';
    /** Shown at the foot of the guidance panel (the page's AI disclosure). */
    children?: Snippet;
  }

  const { layout = 'desk', children }: Props = $props();

  let video = $state<HTMLVideoElement | null>(null);
  let stream = $state<MediaStream | null>(null);
  let cameraError = $state<string | null>(null);
  let uploaded = $state<HTMLImageElement | null>(null);
  let uploadUrl = $state<string | null>(null);
  let running = $state(false);
  /** Guards against two overlapping getUserMedia calls from tap plus effect. */
  let starting = $state(false);
  /** Secure contexts only — every browser refuses the camera otherwise. */
  const isSecure = typeof window !== 'undefined' && window.isSecureContext;
  /** No camera API at all (an insecure page, an old or locked-down browser): asking again cannot help. */
  const hasCameraApi = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  /** The phone sheet's height, so the face guide is drawn in the space above it. */
  let panelH = $state(0);

  /**
   * The front capture, frozen.
   *
   * A canvas rather than the video element: a video element is a live view, so
   * by the time the side frame is taken it is showing the side pose. The pixels
   * have to be copied at the moment they are captured.
   */
  let frontFrame = $state<HTMLCanvasElement | null>(null);

  // The page's header reads what the camera is doing (capture-status.svelte.ts).
  $effect(() => {
    captureStatus.camera = uploaded
      ? 'photo'
      : cameraError
        ? 'blocked'
        : starting
          ? 'starting'
          : stream
            ? 'live'
            : 'idle';
  });

  const isBody = $derived(session.scanKind === 'body');
  const onSideStep = $derived(isBody && session.bodyScanStep === 'side');
  const ready = $derived(Boolean(stream) || Boolean(uploaded));

  // --- the mesh -----------------------------------------------------------

  let meshCanvas = $state<HTMLCanvasElement | null>(null);
  let viewport = $state<HTMLDivElement | null>(null);
  const mesh = new LiveFaceMesh();
  let meshAvailable = $state<boolean | null>(null);
  /** Whether a face is currently found, and whether it is framed well. */
  let faceFound = $state(false);
  let framed = $state(false);
  /** Smoothed 0..1 lock, for the drawing. */
  let lock = 0;
  let framedFrames = 0;
  let lastFrame: MeshFrame | null = null;
  let raf = 0;
  let lastDetect = 0;

  /*
   * Same light, same distance.
   *
   * Lighting is the biggest source of noise in a skin reading, and distance
   * is the second. The guide measures both off the live frame and compares
   * them with the scan she is about to be compared against, so the advice is
   * "a touch closer than last time" rather than a generic oval.
   */
  const guide = new CaptureGuide();
  let verdict = $state<GuideVerdict | null>(null);
  let lastGuideAt = 0;

  const framedCopy = $derived.by(() => {
    if (running) return null;
    if (meshAvailable === false || isBody) return null;
    if (framed) return verdict?.hint ?? 'Got you. Hold still, and read whenever you are ready.';
    if (faceFound) return verdict?.hint ?? 'I can see you — a little closer, and centre your face in the oval.';
    return null;
  });

  /** The lock is heard the moment it lands, once. */
  let wasFramed = false;
  $effect(() => {
    if (framed && !wasFramed) sound.lock();
    wasFramed = framed;
  });

  function stopMeshLoop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  /**
   * One frame of the overlay.
   *
   * Detection is throttled to ~24 per second; drawing follows the display.
   * While the measurement runs the last mesh is kept and swept, so the face
   * being read is the face that was captured, not a frame from a moment later.
   */
  function meshLoop(now: number) {
    raf = requestAnimationFrame(meshLoop);
    const canvas = meshCanvas;
    const box = viewport;
    if (!canvas || !box || !mesh.ready || !mesh.geometry || isBody) return;

    const rect = box.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let sourceW = 0;
    let sourceH = 0;
    if (!running) {
      if (uploaded) {
        sourceW = uploaded.naturalWidth;
        sourceH = uploaded.naturalHeight;
        if (!lastFrame) lastFrame = mesh.detectImage(uploaded);
      } else if (video && stream) {
        sourceW = video.videoWidth;
        sourceH = video.videoHeight;
        if (now - lastDetect > 40) {
          lastDetect = now;
          lastFrame = mesh.detectVideo(video, now);
        }
      }
      const found = lastFrame !== null;
      if (found !== faceFound) faceFound = found;
      const good = lastFrame ? wellFramed(lastFrame) : false;
      framedFrames = good ? Math.min(60, framedFrames + 1) : 0;
      const nowFramed = framedFrames >= 6;
      if (nowFramed !== framed) framed = nowFramed;

      // Light and distance, a few times a second - enough to steer by.
      if (lastFrame && now - lastGuideAt > 350) {
        lastGuideAt = now;
        const source = uploaded ?? video;
        if (source) verdict = guide.assess(source, lastFrame, session.scans[0] ?? null);
      }
    } else {
      sourceW = uploaded ? uploaded.naturalWidth : (video?.videoWidth ?? 0);
      sourceH = uploaded ? uploaded.naturalHeight : (video?.videoHeight ?? 0);
    }

    const target = framed || running ? 1 : 0;
    lock += (target - lock) * 0.12;

    if (!lastFrame || !sourceW || !sourceH) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    const map = coverMap(sourceW, sourceH, w, h);
    const reduced = stillness();
    drawMesh(ctx, lastFrame, mesh.geometry, map, w, h, {
      t: now / 1000,
      lock,
      sweep: running ? session.scanProgress : null,
      progress: running ? session.scanProgress : 0,
      reduced,
    });
  }

  async function startMesh() {
    if (isBody) return;
    if (meshAvailable === null) meshAvailable = await mesh.load();
    if (!meshAvailable) return;
    if (!raf) raf = requestAnimationFrame(meshLoop);
  }

  /*
   * Developer handle, like `__elohim` on the scene: `requestAnimationFrame`
   * does not fire in a tab that is not compositing, so the overlay cannot be
   * exercised in a headless check without a way to step it by hand.
   */
  if (import.meta.env.DEV) {
    (window as unknown as { __elohimMesh?: unknown }).__elohimMesh = {
      step: (now: number) => {
        cancelAnimationFrame(raf);
        raf = 0;
        meshLoop(now);
        cancelAnimationFrame(raf);
        raf = 0;
      },
      ready: () => mesh.ready,
    };
  }

  /** What went wrong, in words that suggest what to do about it. */
  function describeCameraError(err: unknown): string {
    const name = err instanceof DOMException ? err.name : '';
    switch (name) {
      case 'NotAllowedError':
        return isSecure
          ? 'Camera access was blocked. You can allow it in your browser settings for this ' +
            'site — on iPhone and iPad that is the "aA" menu in the address bar — or upload ' +
            'a photo instead.'
          : 'Browsers only allow the camera on a secure connection, and this page is not on ' +
            'one. Upload a photo instead.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'I could not find a front camera on this device. Upload a photo instead.';
      case 'NotReadableError':
      case 'AbortError':
        return 'Something else is using the camera — another tab or app usually. Close it and ' +
          'try again, or upload a photo.';
      case 'SecurityError':
        return 'This browser is blocking camera access on this page. Upload a photo instead.';
      default:
        return 'The camera would not start here. Try again, or upload a photo instead.';
    }
  }

  /**
   * Opens the camera. Must be reachable from a real tap: iOS Safari is strict
   * about capture beginning inside the gesture that asked for it.
   */
  async function startCamera() {
    if (starting) return;
    starting = true;
    cameraError = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      cameraError = 'This browser does not offer camera access. Upload a photo instead.';
      starting = false;
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      cameraError = describeCameraError(err);
      starting = false;
      return;
    }

    if (!video) {
      starting = false;
      return;
    }

    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      cameraError = 'The camera opened but the preview would not start. Try again.';
    }
    starting = false;
    lastFrame = null;
    void startMesh();
  }

  function retryCamera() {
    stopCamera();
    cameraError = null;
    void startCamera();
  }

  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    faceFound = false;
    framed = false;
    framedFrames = 0;
  }

  function clearUpload() {
    if (uploadUrl) URL.revokeObjectURL(uploadUrl);
    uploadUrl = null;
    uploaded = null;
    lastFrame = null;
  }

  function onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    stopCamera();
    clearUpload();
    uploadUrl = URL.createObjectURL(file);

    const img = new Image();
    img.onload = () => {
      uploaded = img;
      lastFrame = null;
      void startMesh();
    };
    img.src = uploadUrl;
  }

  /** Copies whatever is on screen right now into a still frame of its own. */
  function snapshot(): HTMLCanvasElement | null {
    const source = uploaded ?? video;
    if (!source) return null;
    const width = uploaded ? uploaded.naturalWidth : (video?.videoWidth ?? 0);
    const height = uploaded ? uploaded.naturalHeight : (video?.videoHeight ?? 0);
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
  }

  /**
   * Three, two, one.
   *
   * A live capture gets a countdown: three ticks a beat apart, so there is
   * time to hold still and the shutter is expected rather than sprung. An
   * uploaded photo is already still and skips it.
   */
  let countdown = $state(0);
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** Face scans: one frame, straight into the pipeline. */
  async function analyse() {
    const source = uploaded ?? video;
    if (!source) return;
    // A fresh attempt retires the last rejection; the new verdict replaces it.
    session.chatError = null;
    if (!uploaded && !stillness()) {
      for (let n = 3; n >= 1; n--) {
        countdown = n;
        sound.tick(n === 1 ? 1.25 : 1);
        await wait(700);
      }
      countdown = 0;
    }
    // The mesh as it stood at the moment of capture, for the hologram.
    const sourceW = uploaded ? uploaded.naturalWidth : (video?.videoWidth ?? 0);
    const sourceH = uploaded ? uploaded.naturalHeight : (video?.videoHeight ?? 0);
    session.lastMesh =
      lastFrame && mesh.geometry && sourceW && sourceH
        ? {
            points: lastFrame.points,
            count: lastFrame.count,
            aspect: sourceW / sourceH,
            tessellation: mesh.geometry.tessellation,
            contours: mesh.geometry.contours,
            oval: mesh.geometry.oval,
          }
        : null;
    running = true;
    sound.shutter();
    try {
      await runAnalysis(source, session.scanKind);
      stopCamera();
    } catch {
      // The controller has already put a human-readable reason on the store.
    } finally {
      running = false;
    }
  }

  /** Body scans, step one: freeze the front view and ask them to turn. */
  async function captureFront() {
    const frame = snapshot();
    if (!frame) return;
    frontFrame = frame;
    clearUpload();
    session.chatError = null;
    session.bodyScanStep = 'side';
    if (!stream) await startCamera();
  }

  function retakeFront() {
    frontFrame = null;
    clearUpload();
    session.chatError = null;
    session.bodyScanStep = 'front';
    if (!stream) void startCamera();
  }

  /**
   * Body scans, step two. `withSide: false` is the skip, and it produces a scan
   * with no abdominal reading at all — which is what the front frame can
   * honestly support.
   */
  async function finishBody(withSide: boolean) {
    if (!frontFrame) return;
    const side = withSide ? snapshot() : null;
    if (withSide && !side) return;

    session.chatError = null;
    running = true;
    try {
      await runAnalysis(frontFrame, 'body', side);
      if (!session.scanActive) {
        frontFrame = null;
        stopCamera();
      }
    } catch {
      // The controller has already put a human-readable reason on the store.
    } finally {
      running = false;
    }
  }

  function notNow() {
    stopCamera();
    frontFrame = null;
    // Leaving the page is what ends the scan; the shell exits the clinic.
    router.go('/');
  }

  function chooseKind(kind: 'face' | 'body') {
    session.scanKind = kind;
    session.bodyScanStep = 'front';
    frontFrame = null;
    session.chatError = null;
    lastFrame = null;
    framed = false;
    faceFound = false;
  }

  onDestroy(() => {
    captureStatus.camera = 'idle';
    stopMeshLoop();
    mesh.dispose();
    stopCamera();
    if (uploadUrl) URL.revokeObjectURL(uploadUrl);
  });

  /* An opportunistic first attempt; the button is the reliable route. */
  let attempted = false;
  $effect(() => {
    if (!session.scanActive) {
      attempted = false;
      return;
    }
    if (attempted) return;
    attempted = true;
    void startCamera();
  });

  /** Where in the three beats this capture is. */
  const step = $derived(running ? 2 : framed || (ready && (isBody || meshAvailable === false)) ? 1 : 0);
</script>
<!--
  The capture, in the consult room: the camera frame stands on the pedestal
  where the hologram will appear, lit like the room's glass, with the three
  beats, what she can see, and the controls beside it (under it on a tablet;
  over it, full-screen, on a phone). Every behaviour above is unchanged: the
  camera opens only on this page, the mesh is drawn as light and handed over
  at the shutter, nothing is kept.
-->
<div class="cap" data-layout={layout} class:is-body={isBody} style:--panel-h={panelH ? `${panelH}px` : null}>
  <div
    class="cap__frame"
    class:cap__frame--tall={isBody}
    class:is-locked={framed && !running}
    class:is-reading={running}
    bind:this={viewport}
  >
    {#if uploadUrl}
      <img src={uploadUrl} alt="Your selected capture, framed for analysis" />
    {:else}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} playsinline muted></video>
    {/if}
    {#if !isBody}
      <canvas class="mesh" bind:this={meshCanvas} aria-hidden="true"></canvas>
    {/if}
    <div
      class="cap__guide"
      class:cap__guide--body={isBody && !onSideStep}
      class:cap__guide--profile={onSideStep}
      class:cap__guide--hidden={faceFound && !isBody}
    ></div>
    <span class="cap__corner cap__corner--tl" aria-hidden="true"></span>
    <span class="cap__corner cap__corner--tr" aria-hidden="true"></span>
    <span class="cap__corner cap__corner--bl" aria-hidden="true"></span>
    <span class="cap__corner cap__corner--br" aria-hidden="true"></span>
    {#if isBody}
      <div class="cap__chip cap__chip--step">{onSideStep ? 'Frame 2 of 2' : 'Frame 1 of 2'}</div>
    {/if}
    {#if framed && !running}
      <div class="cap__chip cap__chip--locked" aria-hidden="true">Locked</div>
    {/if}
    {#if countdown > 0}
      {#key countdown}
        <div class="cap__count" aria-live="assertive">{countdown}</div>
      {/key}
    {/if}
    {#if verdict && !running && !isBody && faceFound}
      <div class="cap__guidechips" aria-label="Capture conditions">
        <span class="cap__gi" data-ok={verdict.light === 'ok'}>
          <i></i>{verdict.light === 'ok' ? 'Light' : verdict.light === 'dark' ? 'More light' : 'Less light'}
        </span>
        <span class="cap__gi" data-ok={verdict.distance === 'ok'}>
          <i></i>{verdict.distance === 'ok' ? 'Distance' : verdict.distance === 'far' ? 'Closer' : 'Further'}
        </span>
        {#if verdict.reference}
          <span class="cap__gref">vs last scan</span>
        {/if}
      </div>
    {/if}

    {#if !uploadUrl && !stream && !running && hasCameraApi}
      <button class="cap__enable" type="button" onclick={retryCamera} disabled={starting}>
        {starting ? 'Starting the camera…' : cameraError ? 'Try again' : 'Turn on the camera'}
      </button>
    {/if}
  </div>

  <div class="cap__panel on-holo" bind:clientHeight={panelH}>
    <ol class="cap__beats" aria-label="Steps">
      <li data-state={step > 0 ? 'done' : 'now'}><span>1</span>Frame</li>
      <li data-state={step > 1 ? 'done' : step === 1 ? 'now' : null}><span>2</span>Hold</li>
      <li data-state={step === 2 ? 'now' : null}><span>3</span>Read</li>
    </ol>

    <div class="cap__status" aria-live="polite">
      {#if running}
        <ProgressBar value={session.scanProgress * 100} label="Reading progress" hideLabel tone="holo" size="sm" class="cap__bar" />
        <p class="cap__stage">{session.scanStage || 'Measuring…'}</p>
      {:else if session.chatError}
        <!-- A rejected capture. The controller put the reason here and she has
             said it out loud; the live region makes it readable too. -->
        <p class="cap__stage cap__stage--rejected">{session.chatError}</p>
      {:else if cameraError && !uploaded}
        <p class="cap__stage">{cameraError}</p>
      {:else if onSideStep}
        <p class="cap__stage">
          Now turn side on, one shoulder toward the camera, and rest both hands on your head.
          An arm hanging down sits right over the part I need to measure.
        </p>
      {:else if isBody}
        <p class="cap__stage">Stand back so your head and hips are both in shot, arms clear of your sides.</p>
      {:else if framedCopy}
        <p class="cap__stage" class:cap__stage--locked={framed}>{framedCopy}</p>
      {:else}
        <p class="cap__stage">Even light, face in the oval, hold still. Your selected analysis provider will read the capture.</p>
      {/if}
    </div>

    {#if !onSideStep && !running}
      <SegmentedTabs
        options={[
          { id: 'face', label: 'My face' },
          { id: 'body', label: 'My body' },
        ]}
        value={session.scanKind}
        label="What to scan"
        tone="holo"
        size="sm"
        onchange={(id) => chooseKind(id as 'face' | 'body')}
        class="cap__kind"
      />
    {/if}

    <div class="cap__actions">
      {#if onSideStep}
        <Button onclick={() => finishBody(true)} disabled={!ready || running}>
          {running ? 'Reading…' : 'Read the side'}
        </Button>
        <Button variant="ghost" tone="dark" onclick={retakeFront} disabled={running}>Retake front</Button>
      {:else if isBody}
        <Button onclick={captureFront} disabled={!ready || running}>Read my posture</Button>
      {:else}
        <Button onclick={analyse} disabled={!ready || running || countdown > 0}>
          {running ? 'Reading…' : countdown > 0 ? 'Hold still…' : 'Read my skin'}
        </Button>
      {/if}

      <label class="cap__upload" class:is-disabled={running}>
        Upload a photo
        <input type="file" accept="image/*" onchange={onFile} disabled={running} />
      </label>
    </div>

    {#if onSideStep}
      <p class="cap__aside">
        This is the frame your abdominal profile is measured from — a belly projects forward,
        so a front-on photo cannot see one.
        <button class="cap__link" onclick={() => finishBody(false)} disabled={running}>Skip it</button>
        and I will read your posture and proportions only …or
        <button class="cap__link" onclick={notNow} disabled={running}>not now</button>.
      </p>
    {:else if isBody}
      <p class="cap__aside">
        Two frames: this one for posture and proportions, then a side view for your abdominal
        profile …or
        <button class="cap__link" onclick={notNow} disabled={running}>not now</button>.
      </p>
    {:else}
      <p class="cap__aside">
        One frame, analysed after your consent …or
        <button class="cap__link" onclick={notNow} disabled={running}>not now</button>.
      </p>
    {/if}
    {#if children}
      <div class="cap__foot">{@render children()}</div>
    {/if}
  </div>
</div>

<style>
  /* ---- layout ---- */
  .cap {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(20px, 3vw, 44px);
    color: var(--holo-ink-body);
  }
  .cap[data-layout='tablet'] {
    flex-direction: column;
    gap: 18px;
  }
  .cap[data-layout='phone'] {
    position: absolute;
    inset: 0;
    display: block;
  }

  /* ---- the camera frame: holo glass on the pedestal ---- */
  .cap__frame {
    position: relative;
    flex: none;
    height: var(--cap-h, min(60vh, 560px));
    aspect-ratio: 3 / 4;
    border-radius: 22px;
    overflow: hidden;
    background: #05070c;
    box-shadow:
      0 0 0 1px rgba(142, 176, 242, 0.45),
      0 0 26px rgba(142, 176, 242, 0.22),
      0 20px 60px rgba(0, 0, 0, 0.5);
    transition: box-shadow var(--dur-slow) var(--ease-out);
  }
  .cap__frame--tall {
    aspect-ratio: 9 / 16;
  }
  .cap__frame.is-locked {
    box-shadow:
      0 0 0 1.5px rgba(224, 162, 179, 0.85),
      0 0 30px rgba(224, 162, 179, 0.3),
      0 20px 60px rgba(0, 0, 0, 0.5);
  }
  .cap__frame.is-reading {
    box-shadow:
      0 0 0 1.5px rgba(134, 221, 248, 0.9),
      0 0 34px rgba(134, 221, 248, 0.35),
      0 20px 60px rgba(0, 0, 0, 0.5);
  }
  [data-layout='phone'] .cap__frame {
    position: absolute;
    inset: 0;
    height: auto;
    aspect-ratio: auto;
    border-radius: 0;
    box-shadow: none;
  }
  .cap__frame video,
  .cap__frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* Mirrored so framing feels like a mirror, not a photo of someone else. */
    transform: scaleX(-1);
  }
  /* The mesh sits over the picture and is mirrored with it. */
  .mesh {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    transform: scaleX(-1);
    mix-blend-mode: screen;
  }
  .cap__guide {
    position: absolute;
    inset: 12% 20%;
    border: 1.5px dashed rgba(200, 225, 255, 0.55);
    border-radius: 50% / 42%;
    pointer-events: none;
    transition: opacity 0.4s ease;
  }
  /* Phone: the oval sits in the space between the status header and the
     sheet (measured), keeping a face's proportions however short that is. */
  [data-layout='phone'] .cap__frame {
    --guide-top: max(16dvh, calc(var(--safe-t) + 140px));
  }
  [data-layout='phone'] .cap__guide {
    --room: calc(100dvh - var(--guide-top) - var(--panel-h, 30dvh) - 24px);
    inset: auto;
    top: var(--guide-top);
    left: 50%;
    width: min(72%, calc(var(--room) * 0.78));
    height: var(--room);
    transform: translateX(-50%);
  }
  [data-layout='phone'] .cap__enable {
    top: calc((var(--guide-top) + 100% - var(--panel-h, 30%)) / 2);
  }
  .cap__guide--body {
    inset: 4% 18%;
    border-radius: 14px;
  }
  .cap__guide--profile {
    inset: 4% 30%;
    border-radius: 14px;
  }
  .cap__guide--hidden {
    opacity: 0;
  }
  .cap__corner {
    position: absolute;
    width: 22px;
    height: 22px;
    border-color: rgba(166, 208, 240, 0.8);
    border-style: solid;
    border-width: 0;
    pointer-events: none;
  }
  .cap__corner--tl {
    top: 12px;
    left: 12px;
    border-top-width: 2px;
    border-left-width: 2px;
    border-top-left-radius: 8px;
  }
  .cap__corner--tr {
    top: 12px;
    right: 12px;
    border-top-width: 2px;
    border-right-width: 2px;
    border-top-right-radius: 8px;
  }
  .cap__corner--bl {
    bottom: 12px;
    left: 12px;
    border-bottom-width: 2px;
    border-left-width: 2px;
    border-bottom-left-radius: 8px;
  }
  .cap__corner--br {
    bottom: 12px;
    right: 12px;
    border-bottom-width: 2px;
    border-right-width: 2px;
    border-bottom-right-radius: 8px;
  }
  [data-layout='phone'] .cap__corner {
    display: none;
  }
  .cap__chip {
    position: absolute;
    top: 14px;
    padding: 5px 10px;
    border-radius: var(--r-pill);
    background: rgba(8, 13, 24, 0.8);
    box-shadow: inset 0 0 0 1px rgba(150, 170, 210, 0.35);
    font-size: 12px;
    font-weight: var(--fw-medium);
    line-height: 1.3;
    color: #e6f1fc;
  }
  .cap__chip--step {
    left: 14px;
  }
  .cap__chip--locked {
    right: 14px;
    color: #f3c6d2;
    box-shadow: inset 0 0 0 1px rgba(224, 162, 179, 0.6);
    animation: chip-in var(--dur-base) var(--ease-out) both;
  }
  [data-layout='phone'] .cap__chip {
    top: calc(118px + var(--safe-t));
  }
  .cap__count {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-family: var(--font-sans);
    font-size: clamp(72px, 12vw, 112px);
    font-weight: var(--fw-light);
    line-height: 1;
    color: #f2f8ff;
    font-variant-numeric: lining-nums tabular-nums;
    text-shadow:
      0 0 24px rgba(134, 221, 248, 0.55),
      0 2px 12px rgba(0, 0, 0, 0.6);
    pointer-events: none;
    animation: count 0.7s var(--ease-out) both;
  }
  .cap__guidechips {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-radius: var(--r-pill);
    background: rgba(8, 13, 24, 0.8);
    font-size: 12px;
    line-height: 1.3;
    color: #aab3c3;
    pointer-events: none;
  }
  [data-layout='phone'] .cap__guidechips {
    left: 16px;
    bottom: auto;
    top: calc(158px + var(--safe-t));
  }
  .cap__gi {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .cap__gi[data-ok='true'] {
    color: #e6f1fc;
  }
  .cap__gi i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .cap__gi[data-ok='true'] i {
    background: var(--holo-cyan);
  }
  .cap__enable {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    min-height: 44px;
    padding: 0 20px;
    border: 0;
    border-radius: var(--r-pill);
    background: rgba(28, 48, 76, 0.85);
    box-shadow: inset 0 0 0 1.5px rgba(140, 165, 210, 0.6);
    color: #e6f1fc;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: var(--fw-medium);
    white-space: nowrap;
    cursor: pointer;
  }
  .cap__enable:disabled {
    opacity: 0.7;
    cursor: default;
  }
  .cap__enable:focus-visible {
    outline: var(--focus-width) solid var(--holo-ink);
    outline-offset: 3px;
  }

  /* ---- the guidance panel ---- */
  .cap__panel {
    display: grid;
    gap: 14px;
    width: min(360px, 100%);
    padding: 18px 20px 16px;
    border-radius: 16px;
    background: rgba(8, 13, 24, 0.78);
    box-shadow:
      inset 0 0 0 1px rgba(150, 170, 210, 0.28),
      0 16px 40px rgba(0, 0, 0, 0.35);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }
  [data-layout='tablet'] .cap__panel {
    width: min(560px, 100%);
  }
  [data-layout='phone'] .cap__panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    gap: 12px;
    padding: 18px 16px calc(16px + var(--safe-b));
    border-radius: 22px 22px 0 0;
    background: linear-gradient(180deg, rgba(8, 13, 24, 0.82), rgba(8, 13, 24, 0.94));
  }
  .cap__beats {
    display: flex;
    gap: 18px;
    margin: 0;
    padding: 0 0 8px;
    list-style: none;
    border-bottom: 1px solid rgba(160, 180, 220, 0.18);
    font-size: 13px;
    font-weight: var(--fw-medium);
    color: #9ea8ba;
  }
  .cap__beats li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .cap__beats span {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px currentColor;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .cap__beats li[data-state='now'] {
    color: #f2f8ff;
  }
  .cap__beats li[data-state='now'] span {
    background: var(--holo-rose);
    box-shadow: none;
    color: var(--holo-rose-ink);
  }
  .cap__beats li[data-state='done'] {
    color: #c9d3e6;
  }
  .cap__status {
    min-height: 44px;
  }
  .cap__status :global(.cap__bar) {
    margin-bottom: 8px;
  }
  .cap__stage {
    margin: 0;
    font-size: 15px;
    line-height: 1.5;
    color: #dfe7f7;
  }
  .cap__stage--locked {
    color: #f3c6d2;
  }
  .cap__stage--rejected {
    color: #f2f8ff;
  }
  .cap__panel :global(.cap__kind) {
    justify-self: start;
  }
  .cap__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
  }
  .cap__upload {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 6px;
    font-size: 15px;
    font-weight: var(--fw-medium);
    color: #dbe6f7;
    text-decoration: underline;
    text-underline-offset: 4px;
    text-decoration-color: rgba(200, 215, 240, 0.45);
    cursor: pointer;
  }
  .cap__upload input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    cursor: pointer;
  }
  .cap__upload:focus-within {
    outline: var(--focus-width) solid var(--holo-ink);
    outline-offset: 2px;
    border-radius: 6px;
  }
  .cap__upload.is-disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .cap__aside {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    color: #b7c1d6;
  }
  .cap__link {
    display: inline;
    min-height: 0;
    padding: 0;
    border: 0;
    background: none;
    color: #e6f1fc;
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .cap__link:disabled {
    opacity: 0.5;
  }
  .cap__link:focus-visible {
    outline: var(--focus-width) solid var(--holo-ink);
    outline-offset: 2px;
  }

  .cap__foot {
    display: grid;
    justify-items: start;
    gap: 10px;
  }

  @keyframes count {
    from {
      opacity: 0;
      transform: scale(1.35);
    }
    30% {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0.15;
      transform: scale(0.92);
    }
  }
  @keyframes chip-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cap__count,
    .cap__chip--locked {
      animation: none;
    }
  }
</style>
