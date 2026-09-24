<script lang="ts">
  /**
   * Settings, as a placeholder.
   *
   * A hub for the pages that used to hang off the old rail: your profile,
   * privacy, your data, and the legal documents. Its owner replaces this file
   * with the designed hub; the links it has to carry are the ones below.
   *
   * It also carries the two switches the old rail had that are not pages:
   * her voice and the room's sound. The designed sidebar has no place for
   * them, and without them a guest had no way to turn her voice off at all -
   * the profile page's switch saves to an account, and a guest has none. The
   * designed hub has to keep both.
   */
  import Page from '@/components/Page.svelte';
  import { ROUTES, isLegalRoute, link } from '@/router/router.svelte.ts';
  import { session } from '@/state/session.svelte.ts';
  import { setGuestVoice, setVoiceEnabled, stopSpeaking } from '@/state/controller.ts';
  import { setSoundEnabled, soundEnabled } from '@/lib/sound.ts';

  const legal = ROUTES.filter((r) => isLegalRoute(r.id));

  // What is actually true right now: on, and able to speak.
  const voiceOn = $derived(Boolean(session.user?.preferences.voiceEnabled) && session.canSpeak);
  let sound = $state(soundEnabled());

  /** A preference on an account, a session flag for a guest; off stops her mid-sentence. */
  function setVoice(on: boolean) {
    if (session.guest) setGuestVoice(on);
    else void setVoiceEnabled(on);
    if (!on) stopSpeaking();
  }

  function setSound(on: boolean) {
    sound = on;
    setSoundEnabled(on);
  }
</script>

<Page eyebrow="Settings" title="Settings">
  <p class="card__text">Your profile, your privacy choices and your data, in one place.</p>
  <ul role="list">
    <li><a href="/profile" use:link>Profile</a></li>
    <li><a href="/privacy" use:link>Privacy</a></li>
    <li><a href="/settings/data" use:link>Your data</a></li>
  </ul>

  <h2 class="sec__title">Voice and sound</h2>
  <div class="card">
    <label class="toggle">
      <input
        type="checkbox"
        checked={voiceOn}
        disabled={!session.canSpeak}
        onchange={(e) => setVoice((e.currentTarget as HTMLInputElement).checked)}
      />
      <div>
        <strong>Her voice</strong>
        <small>
          {#if !session.canSpeak}
            This browser cannot speak and no voice is configured, so she stays quiet here.
          {:else if session.guest}
            For this visit only. Nothing is saved while you are looking around.
          {:else}
            Remembered on your account.
          {/if}
        </small>
      </div>
    </label>
    <label class="toggle">
      <input
        type="checkbox"
        checked={sound}
        onchange={(e) => setSound((e.currentTarget as HTMLInputElement).checked)}
      />
      <div>
        <strong>Room sound</strong>
        <small>The room tone and the small cues. Remembered on this device.</small>
      </div>
    </label>
  </div>

  <h2 class="sec__title">Legal</h2>
  <ul role="list">
    {#each legal as route (route.id)}
      <li><a href={route.path} use:link>{route.label}</a></li>
    {/each}
  </ul>
</Page>
