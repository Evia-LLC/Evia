<script lang="ts">
  import CookieBanner from '@/components/legal/CookieBanner.svelte';
  import { onMount } from 'svelte';
  import { session } from '@/state/session.svelte.ts';
  import {
    bootstrap,
    discardPendingCapture,
    enterScanPage,
    initVoice,
    leaveScanPage,
    refreshVoice,
    registerDirector,
    sampleModeChanged,
  } from '@/state/controller.ts';
  import { isLegalRoute, router } from '@/router/router.svelte.ts';
  import { director } from '@/stage/director.ts';
  import { tour, tourNow } from '@/stage/tour.svelte.ts';
  import { sample } from '@/sample/mode.svelte.ts';
  import Shell from '@/shell/Shell.svelte';
  import SampleBadge from '@/shell/SampleBadge.svelte';
  import DemoDeploymentNotice from '@/shell/DemoDeploymentNotice.svelte';
  import AgeAssurancePage from '@/pages/legal/AgeAssurancePage.svelte';
  import AuthGate from '@/components/AuthGate.svelte';
  import Intro from '@/components/Intro.svelte';
  import HoloPanel from '@/components/HoloPanel.svelte';
  import { primeSound } from '@/lib/sound.ts';
  import { primeSynthesis } from '@/voice/synthesis.ts';
  import { voice } from '@/voice/controller.ts';
  import { introSeen } from '@/lib/intro.ts';
  import HomePage from '@/pages/HomePage.svelte';
  import ScanPage from '@/pages/ScanPage.svelte';
  import ProgressPage from '@/pages/ProgressPage.svelte';
  import RoutinePage from '@/pages/RoutinePage.svelte';
  import ProductsPage from '@/pages/ProductsPage.svelte';
  import LearnPage from '@/pages/LearnPage.svelte';
  import SettingsPage from '@/pages/SettingsPage.svelte';
  import ProfilePage from '@/pages/ProfilePage.svelte';
  import PrivacyPage from '@/pages/PrivacyPage.svelte';
  import DataRightsPage from '@/pages/DataRightsPage.svelte';
  import TermsPage from '@/pages/legal/TermsPage.svelte';
  import PrivacyPolicyPage from '@/pages/legal/PrivacyPolicyPage.svelte';
  import FacialScanConsentPage from '@/pages/legal/FacialScanConsentPage.svelte';
  import HealthConsentPage from '@/pages/legal/HealthConsentPage.svelte';
  import SafetyLifestyleConsentPage from '@/pages/legal/SafetyLifestyleConsentPage.svelte';
  import ProgressPhotoConsentPage from '@/pages/legal/ProgressPhotoConsentPage.svelte';
  import SubscriptionDisclosurePage from '@/pages/legal/SubscriptionDisclosurePage.svelte';
  import CancellationPage from '@/pages/legal/CancellationPage.svelte';

  let booting = $state(true);

  /**
   * The introduction plays the first time someone is in - signed in or
   * looking around - and not again on that device. Decided once per arrival
   * rather than derived, so signing out and back in mid-session does not
   * replay it, and so it cannot flicker on while the gate is still up.
   */
  let intro = $state(false);
  let introDecided = false;
  $effect(() => {
    if (booting || !session.signedIn || introDecided) return;
    introDecided = true;
    intro = !introSeen();
  });

  /*
   * The stage director, registered before anything can direct her.
   *
   * It draws nothing - the SVG figure and the scan page read its state - so
   * it needs no element and nothing from the network, and registering it
   * first means the intro, the greeting and the voice all find it there.
   */
  registerDirector(director);
  // The consult tour plays through the director and the voice (src/stage/tour.svelte.ts).
  tour.attach({
    director,
    voice,
    now: tourNow,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  });
  onMount(() => () => {
    tour.detach();
    registerDirector(null);
    director.dispose();
  });

  // A handle for development: the director, the store, the sample switch and the
  // tour (with a hand-driven clock) from the console, where a throttled pane makes
  // timing hard to judge.
  if (import.meta.env.DEV) {
    (window as unknown as { __evia?: unknown }).__evia = { director, session, sample, router, tour: tour.devHandle() };
  }

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
    if (booting || !session.signedIn) return;
    if (router.is('scan')) enterScanPage();
    else leaveScanPage();
  });

  /**
   * Sample mode on or off, after boot. The controller keeps a signed-in
   * account's real conversation off the sample screens and brings it back
   * afterwards. The first run only records the starting state.
   */
  let sampleWas: boolean | null = null;
  $effect(() => {
    const on = sample.on;
    if (booting) return;
    if (sampleWas !== null && sampleWas !== on) void sampleModeChanged(on);
    sampleWas = on;
  });

  onMount(() => {
    const clearCapture = () => discardPendingCapture();
    window.addEventListener('pagehide', clearCapture);
    return () => window.removeEventListener('pagehide', clearCapture);
  });

  /**
   * The visual viewport, published to CSS.
   *
   * On a phone the layout viewport is a lie the moment the keyboard opens: it
   * keeps its full height while a third of it is covered. `--vvh` is what the
   * user can actually see and `--kb` is what the keyboard is covering, so the
   * UI layer can size and lift itself against the truth.
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
  data-sample={sample.on ? 'true' : null}
  data-reduced-motion={session.user?.preferences.reducedMotion ? 'true' : null}
>
  {#if booting}
    <div class="auth"><div class="auth__mark">Evia</div></div>
  {:else if isLegalRoute(router.id)}
    {#key router.id}
      {#if router.is('legal-age-assurance')}<AgeAssurancePage />
      {:else if router.is('legal-terms')}<TermsPage />
      {:else if router.is('legal-privacy')}<PrivacyPolicyPage />
      {:else if router.is('legal-facial-scan')}<FacialScanConsentPage />
      {:else if router.is('legal-health')}<HealthConsentPage />
      {:else if router.is('legal-safety-lifestyle')}<SafetyLifestyleConsentPage />
      {:else if router.is('legal-progress-photo')}<ProgressPhotoConsentPage />
      {:else if router.is('legal-subscription')}<SubscriptionDisclosurePage />
      {:else if router.is('legal-cancellation')}<CancellationPage />
      {/if}
    {/key}
  {:else if !session.signedIn}
    <AuthGate />
  {:else}
    {#if intro}
      <Intro onDone={() => (intro = false)} />
    {/if}

    <Shell route={router.id}>
      <!-- Keyed on the address so a page leaves as the next one arrives. -->
      {#key router.id}
        {#if router.is('home')}
          <HomePage />
        {:else if router.is('scan')}
          <ScanPage />
        {:else if router.is('routine')}
          <RoutinePage />
        {:else if router.is('progress')}
          <ProgressPage />
        {:else if router.is('products')}
          <ProductsPage />
        {:else if router.is('learn')}
          <LearnPage />
        {:else if router.is('settings')}
          <SettingsPage />
        {:else if router.is('profile')}
          <ProfilePage />
        {:else if router.is('privacy')}
          <PrivacyPage />
        {:else if router.is('data')}
          <DataRightsPage />
        {/if}
      {/key}
    </Shell>

    <!-- The reading and the routine plan in words, for assistive technology
         only, while she is out of the lounge. -->
    {#if session.sceneMode !== 'lounge'}
      <HoloPanel />
    {/if}
  {/if}

  <!-- Sample data must be announced wherever it shows, the sign-in gate
       included. The badge is a singleton, so the Shell's own copy defers. -->
  <SampleBadge />
</div>

<!-- The cookie choice (LEGAL_PROMISE_TRACKER P-12): its first layer until a
     choice is made, and the "Cookie settings" control afterwards. -->
<CookieBanner />

<!-- A sample-only deployment (VITE_SAMPLE_DEMO=1, required by the
     `sample_demo` legal release profile) says so on every screen. -->
<DemoDeploymentNotice />
