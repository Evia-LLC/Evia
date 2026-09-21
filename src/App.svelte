<script lang="ts">
  import { onMount } from 'svelte';
  import { session } from '@/state/session.svelte.ts';
  import { bootstrap, enterScanPage, initVoice, leaveScanPage, refreshVoice } from '@/state/controller.ts';
  import { router } from '@/router/router.svelte.ts';
  import ElohimStage from '@/components/ElohimStage.svelte';
  import AuthGate from '@/components/AuthGate.svelte';
  import HoloPanel from '@/components/HoloPanel.svelte';
  import Nav from '@/components/Nav.svelte';
  import { primeSound } from '@/lib/sound.ts';
  import { primeSynthesis } from '@/voice/synthesis.ts';
  import HomePage from '@/pages/HomePage.svelte';
  import ScanPage from '@/pages/ScanPage.svelte';
  import ProgressPage from '@/pages/ProgressPage.svelte';
  import RoutinePage from '@/pages/RoutinePage.svelte';
  import ProfilePage from '@/pages/ProfilePage.svelte';
  import PrivacyPage from '@/pages/PrivacyPage.svelte';

  let booting = $state(true);

  /**
   * The introduction plays the first time someone is in - signed in or
   * looking around - and not again on that device. Decided once per arrival
   * rather than derived, so signing out and back in mid-session does not
   * replay it, and so it cannot flicker on while the gate is still up.
   */
  $effect(() => {
    if (!booting && session.signedIn && !session.onboardingActive && !router.is('landing')) {
      session.entryStage = 'app';
    }
  });

  /**
   * Frame counters are a developer tool, not part of the product. Opt in with
   * `#stats`.
   */
  const devStats = import.meta.env.DEV && location.hash.includes('stats');

  onMount(async () => {
    /*
     * Browsers keep audio locked until the page is touched. The first touch,
     * whatever it is for, unlocks it - so the first cue that matters is heard
     * rather than being the one that unlocks the next.
     */
    let reprobed = false;
    const unlock = (event: Event) => {
      primeSound();
      if (event.type === 'pointerdown') return;
      // A touch's pointer-down is not a gesture WebKit honours for speech;
      // the finished touch, the click or the key is. When the synthesiser
      // opens, what she can do is worked out again - and once, on the first
      // real gesture, her own voice is asked for again too, in case the
      // server was still waking when the page first asked.
      const opened = primeSynthesis();
      if (opened || !reprobed) {
        reprobed = true;
        void refreshVoice();
      }
    };
    // iOS counts a finished touch or a click as the gesture, not reliably the
    // pointer-down, so every kind of first contact is listened for.
    for (const type of ['pointerdown', 'touchend', 'click', 'keydown'] as const) {
      window.addEventListener(type, unlock, { passive: true });
    }

    await bootstrap();
    booting = false;
    // Voice capability detection needs the user's locale, so it runs after
    // bootstrap and never blocks first paint.
    void initVoice();
  });

  /** The address names the page. */
  $effect(() => {
    document.title = router.route.title;
  });

  /**
   * The scan page *is* the clinic.
   *
   * Arriving on it walks her into the clinical room and opens the capture;
   * leaving it walks her out. Tied to the address rather than to a button so
   * the back button, a typed URL and a tap on the tab all do the same thing.
   */
  $effect(() => {
    if (booting || !session.signedIn || session.onboardingActive) return;
    if (router.is('scan')) enterScanPage();
    else leaveScanPage();
  });

  /**
   * The visual viewport, published to CSS.
   *
   * On a phone the layout viewport is a lie the moment the keyboard opens: it
   * keeps its full height while a third of it is covered. `--vvh` is what the
   * user can actually see and `--kb` is what the keyboard is covering, so the
   * UI layer can size and lift itself against the truth.
   *
   * The 3D canvas is deliberately left out of this. Resizing a WebGL drawing
   * buffer on every keyboard open would cost a reallocation for a change the
   * user is about to undo.
   */
  $effect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;

    const sync = () => {
      const height = viewport?.height ?? window.innerHeight;
      const covered = Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0));
      root.style.setProperty('--vvh', `${Math.round(height)}px`);
      root.style.setProperty('--kb', `${Math.round(covered)}px`);
      // A collapsing URL bar also shrinks the visual viewport. Only a change
      // this large is a keyboard.
      if (covered > 120) root.dataset.keyboard = 'true';
      else delete root.dataset.keyboard;
    };

    sync();
    viewport?.addEventListener('resize', sync);
    viewport?.addEventListener('scroll', sync);
    window.addEventListener('orientationchange', sync);

    return () => {
      viewport?.removeEventListener('resize', sync);
      viewport?.removeEventListener('scroll', sync);
      window.removeEventListener('orientationchange', sync);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--kb');
      delete root.dataset.keyboard;
    };
  });
</script>

<div
  class="shell"
  data-scene={session.sceneMode}
  data-route={router.id}
  data-reduced-motion={session.user?.preferences.reducedMotion ? 'true' : null}
>
  <!-- The stage mounts once and stays mounted; signing out must not tear down
       the GPU context and rebuild it. Mounted immediately, before bootstrap's
       network round trip resolves: she is the product, and on a cold server
       the old gate held a blank screen for as long as the function took to
       wake. The room needs nothing from the network to exist. -->
  <ElohimStage />

  {#if router.is('landing') || session.onboardingActive || (!booting && !session.signedIn)}
    <AuthGate />
  {:else if booting}
    <div class="auth"><div class="auth__mark">Ese</div></div>
  {:else}
    <Nav />

    <!-- Keyed on the address so a page leaves as the next one arrives. -->
    {#key router.id}
      {#if router.is('home')}
        <HomePage />
      {:else if router.is('scan')}
        <ScanPage />
      {:else if router.is('progress')}
        <ProgressPage />
      {:else if router.is('routine')}
        <RoutinePage />
      {:else if router.is('profile')}
        <ProfilePage />
      {:else if router.is('privacy')}
        <PrivacyPage />
      {/if}
    {/key}

    <!-- The reading, for assistive technology. Only in the clinic, because
         that is the only place there is a reading to describe. -->
    {#if session.sceneMode !== 'lounge' && session.scanResultVisible}
      <HoloPanel />
    {/if}

    {#if devStats && session.devStats}
      <div class="devstats">
        {session.devStats.calls} draws · {session.devStats.triangles} tris ·
        {session.devStats.frameMs} ms · tier {session.qualityTier}
      </div>
    {/if}
  {/if}
</div>
