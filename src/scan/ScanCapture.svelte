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
  import { onDestroy } from 'svelte';
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

  /**
   * The front capture, frozen.
   *
   * A canvas rather than the video element: a video element is a live view, so
   * by the time the side frame is taken it is showing the side pose. The pixels
   * have to be copied at the moment they are captured.
   */
  let frontFrame = $state<HTMLCanvasElement | null>(null);

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
   * Developer handle, like `__evia` on the scene: `requestAnimationFrame`
   * does not fire in a tab that is not compositing, so the overlay cannot be
   * exercised in a headless check without a way to step it by hand.
   */
  if (import.meta.env.DEV) {
    (window as unknown as { __eviaMesh?: unknown }).__eviaMesh = {
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

<div class="capture">
  <ol class="beats" aria-label="Steps">
    <li class="beat" data-state={step > 0 ? 'done' : 'now'}>
      <span class="beat__n">1</span><span class="beat__t">Frame</span>
    </li>
    <li class="beat" data-state={step > 1 ? 'done' : step === 1 ? 'now' : null}>
      <span class="beat__n">2</span><span class="beat__t">Hold</span>
    </li>
    <li class="beat" data-state={step === 2 ? 'now' : null}>
      <span class="beat__n">3</span><span class="beat__t">Read</span>
    </li>
  </ol>

  <div class="card card--plane capture__card">
    <div
      class="scan__viewport capture__viewport"
      class:scan__viewport--tall={isBody}
      class:capture__viewport--locked={framed && !running}
      class:capture__viewport--reading={running}
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
        class="scan__guide"
        class:scan__guide--body={isBody && !onSideStep}
        class:scan__guide--profile={onSideStep}
        class:scan__guide--hidden={faceFound && !isBody}
      ></div>
      {#if isBody}
        <div class="scan__step">{onSideStep ? 'Frame 2 of 2' : 'Frame 1 of 2'}</div>
      {/if}
      {#if framed && !running}
        <div class="locked" aria-hidden="true">Locked</div>
      {/if}
      {#if countdown > 0}
        {#key countdown}
          <div class="countdown" aria-live="assertive">{countdown}</div>
        {/key}
      {/if}
      {#if verdict && !running && !isBody && faceFound}
        <div class="guide" aria-label="Capture conditions">
          <span class="guide__item" data-ok={verdict.light === 'ok'}>
            <i></i>{verdict.light === 'ok' ? 'Light' : verdict.light === 'dark' ? 'More light' : 'Less light'}
          </span>
          <span class="guide__item" data-ok={verdict.distance === 'ok'}>
            <i></i>{verdict.distance === 'ok' ? 'Distance' : verdict.distance === 'far' ? 'Closer' : 'Further'}
          </span>
          {#if verdict.reference}
            <span class="guide__ref">vs last scan</span>
          {/if}
        </div>
      {/if}

      {#if !uploadUrl && !stream && !running}
        <button class="scan__enable" type="button" onclick={retryCamera} disabled={starting}>
          {starting ? 'Starting the camera…' : cameraError ? 'Try again' : 'Turn on the camera'}
        </button>
      {/if}
    </div>

    <div class="capture__status" aria-live="polite">
      {#if running}
        <div class="bar capture__bar"><i style="width:{session.scanProgress * 100}%"></i></div>
        <div class="capture__stage">{session.scanStage || 'Measuring…'}</div>
      {:else if session.chatError}
        <!-- A rejected capture. The controller put the reason here and she has
             said it out loud; the live region makes it readable too. -->
        <div class="capture__stage capture__stage--rejected">{session.chatError}</div>
      {:else if cameraError && !uploaded}
        <div class="capture__stage">{cameraError}</div>
      {:else if onSideStep}
        <div class="capture__stage">
          Now turn side on, one shoulder toward the camera, and rest both hands on your head.
          An arm hanging down sits right over the part I need to measure.
        </div>
      {:else if isBody}
        <div class="capture__stage">
          Stand back so your head and hips are both in shot, arms clear of your sides.
        </div>
      {:else if framedCopy}
        <div class="capture__stage" class:capture__stage--locked={framed}>{framedCopy}</div>
      {:else}
        <div class="capture__stage">
          Even light, face in the oval, hold still. Everything is measured on your device.
        </div>
      {/if}
    </div>

    {#if !onSideStep}
      <div class="capture__kind" role="radiogroup" aria-label="What to scan">
        <button
          class="kind__tab"
          aria-pressed={session.scanKind === 'face'}
          data-active={session.scanKind === 'face'}
          onclick={() => chooseKind('face')}
          disabled={running}
        >
          My face
        </button>
        <button
          class="kind__tab"
          aria-pressed={session.scanKind === 'body'}
          data-active={session.scanKind === 'body'}
          onclick={() => chooseKind('body')}
          disabled={running}
        >
          My body
        </button>
      </div>
    {/if}

    <div class="capture__actions">
      {#if onSideStep}
        <button class="cta" onclick={() => finishBody(true)} disabled={!ready || running}>
          {running ? 'Reading…' : 'Read the side'}
        </button>
        <button class="cta cta--quiet" onclick={retakeFront} disabled={running}>Retake front</button>
      {:else if isBody}
        <button class="cta" onclick={captureFront} disabled={!ready || running}>
          Read my posture
        </button>
      {:else}
        <button
          class="cta"
          onclick={analyse}
          disabled={!ready || running || countdown > 0}
        >
          {running ? 'Reading…' : countdown > 0 ? 'Hold still…' : 'Read my skin'}
        </button>
      {/if}

      <label class="cta cta--quiet" style="cursor:pointer">
        Upload a photo
        <input type="file" accept="image/*" onchange={onFile} hidden />
      </label>
    </div>

    {#if onSideStep}
      <p class="capture__aside">
        This is the frame your abdominal profile is measured from — a belly projects forward,
        so a front-on photo cannot see one.
        <button class="linkish" onclick={() => finishBody(false)} disabled={running}>
          Skip it
        </button>
        and I will read your posture and proportions only …or
        <button class="linkish" onclick={notNow} disabled={running}>not now</button>.
      </p>
    {:else if isBody}
      <p class="capture__aside">
        Two frames: this one for posture and proportions, then a side view for your abdominal
        profile …or
        <button class="linkish" onclick={notNow} disabled={running}>not now</button>.
      </p>
    {:else}
      <p class="capture__aside">
        One frame, read on your device …or
        <button class="linkish" onclick={notNow} disabled={running}>not now</button>.
      </p>
    {/if}
  </div>
</div>

<style>
  .capture {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  /* One line: '1. Frame  2. Hold  3. Read' on a shared hairline. */
  .beats {
    display: flex;
    gap: var(--s-5);
    margin: 0 0 var(--s-3);
    padding: 0;
    list-style: none;
    border-bottom: var(--hair) solid var(--line);
  }
  .beat {
    position: relative;
    display: flex;
    gap: var(--s-1);
    padding: 0 0 var(--s-2);
    margin-bottom: -1px;
    border: 0;
    border-bottom: var(--hair) solid transparent;
    border-radius: 0;
    background: none;
    font-size: var(--t-sm);
    letter-spacing: 0;
    text-transform: none;
    color: var(--quiet);
    transition: color var(--dur-1) var(--ease), border-color var(--dur-2) var(--ease);
  }
  .beat__n {
    display: inline;
    width: auto;
    height: auto;
    border: 0;
    background: none;
    box-shadow: none;
    font-family: var(--font);
    font-size: inherit;
    color: inherit;
    font-feature-settings: var(--num);
  }
  .beat__n::after {
    content: '.';
  }
  .beat[data-state='now'] {
    color: var(--ink);
    border-bottom-color: var(--metal);
  }
  .beat[data-state='done'] {
    color: var(--ink-soft);
  }

  .capture__card {
    padding: var(--s-3);
  }
  .capture__viewport {
    max-height: 48dvh;
    margin-bottom: var(--s-3);
    border-radius: var(--radius);
    border: var(--hair) solid var(--line-strong);
    box-shadow: none;
    transition: border-color var(--dur-2) var(--ease);
  }
  .capture__viewport--locked {
    border-color: var(--metal);
    box-shadow: none;
  }
  /* The one permitted cyan hairline: it matches the hologram scanning her. */
  .capture__viewport--reading {
    border-color: var(--holo-scene);
    box-shadow: none;
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

  /* Once a face is found, the drawn guide has done its job. */
  .scan__guide--hidden {
    opacity: 0;
    transition: opacity 0.4s ease;
  }

  .guide {
    position: absolute;
    left: var(--s-2);
    bottom: var(--s-2);
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: 4px 8px;
    border: 0;
    border-radius: var(--radius);
    background: var(--chip);
    font-size: var(--t-xs);
    line-height: 1.3;
    letter-spacing: 0.02em;
    text-transform: none;
    color: var(--quiet);
    pointer-events: none;
  }
  .guide__item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--quiet);
    transition: color var(--dur-2) var(--ease);
  }
  .guide__item[data-ok='true'] {
    color: var(--ink);
  }
  .guide__item i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: none;
  }
  .guide__ref {
    color: var(--quiet);
    letter-spacing: 0;
  }

  .countdown {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-family: var(--font-serif);
    font-style: normal;
    font-size: var(--t-count);
    font-weight: var(--w-regular);
    line-height: 1;
    color: var(--ink);
    font-variant-numeric: lining-nums tabular-nums;
    text-shadow: var(--halo);
    pointer-events: none;
    animation: count 0.7s var(--ease) both;
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

  .locked {
    position: absolute;
    top: var(--s-2);
    right: var(--s-2);
    padding: 4px 8px;
    border: 0;
    border-radius: var(--radius);
    background: var(--chip);
    font-size: var(--t-xs);
    font-weight: var(--w-medium);
    letter-spacing: 0.02em;
    text-transform: none;
    color: var(--metal);
    animation: locked-in var(--dur-2) var(--ease) both;
  }
  @keyframes locked-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  .capture__status {
    min-height: 40px;
    text-align: left;
  }
  .capture__bar {
    max-width: 240px;
    margin: 0 0 var(--s-2);
  }
  .capture__stage {
    font-size: var(--t-md);
    line-height: var(--lh-body);
    color: var(--ink-soft);
    letter-spacing: 0;
    transition: color var(--dur-2) var(--ease);
  }
  .capture__stage--locked {
    color: var(--metal);
  }
  /* A rejection reads in her ink, not an alarm red - it is advice, not danger. */
  .capture__stage--rejected {
    color: var(--ink);
  }

  /* 'My face / My body' as text tabs: the gate's underline indicator, reused. */
  .capture__kind {
    display: flex;
    gap: var(--s-5);
    margin: var(--s-4) 0 0;
    border-bottom: var(--hair) solid var(--line);
  }
  .kind__tab {
    position: relative;
    padding: 0 0 var(--s-2);
    margin-bottom: -1px;
    min-height: var(--tap);
    border: 0;
    border-bottom: var(--hair) solid transparent;
    border-radius: 0;
    background: none;
    color: var(--quiet);
    font-size: var(--t-md);
    font-weight: var(--w-medium);
    transition: color var(--dur-2) var(--ease-soft), border-color var(--dur-2) var(--ease);
  }
  .kind__tab[aria-pressed='true'] {
    color: var(--ink);
    border-bottom-color: var(--metal);
  }

  .capture__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-start;
    align-items: center;
    gap: var(--s-3) var(--s-5);
    margin-top: var(--s-4);
  }

  .capture__aside {
    margin: var(--s-3) 0 0;
    max-width: var(--measure);
    font-size: var(--t-md);
    line-height: var(--lh-body);
    text-align: left;
    color: var(--quiet);
  }

  @media (prefers-reduced-motion: reduce) {
    .countdown,
    .locked {
      animation: none;
    }
  }
  :global(.shell[data-reduced-motion='true']) .countdown,
  :global(.shell[data-reduced-motion='true']) .locked {
    animation: none;
  }

  @media (max-width: 380px) {
    .capture__actions .cta {
      flex: 1 1 100%;
    }
  }
</style>
