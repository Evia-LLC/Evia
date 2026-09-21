<script lang="ts">
  /**
   * The way around.
   *
   * A rail down the left on a desktop, a bar across the bottom on a phone —
   * the same five places either way, in the same order, so the product has
   * one map rather than two. Scan is drawn as the accent because it is the
   * one item that *does* something rather than shows something.
   *
   * Every item is a real link with a real address. The active one is marked
   * with `aria-current`, which is both the accessible truth and the styling
   * hook, so the two cannot drift apart.
   */
  import { ROUTES, link, router } from '@/router/router.svelte.ts';
  import { session } from '@/state/session.svelte.ts';
  import { setGuestVoice, setVoiceEnabled, stopSpeaking } from '@/state/controller.ts';
  import { setSoundEnabled, soundEnabled } from '@/lib/sound.ts';

  const items = ROUTES.filter((r) => r.nav);

  /**
   * Two switches that are not pages: her voice, and the room's sound.
   *
   * Her voice is a preference on an account and a session flag for a guest;
   * either way the switch shows what is actually true right now, and turning
   * it off stops her mid-sentence rather than after it.
   */
  const voiceOn = $derived(Boolean(session.user?.preferences.voiceEnabled) && session.canSpeak &&
    (session.guest || session.user?.consents.cloud_reasoning === true));
  let sound = $state(soundEnabled());

  function toggleVoice() {
    const next = !voiceOn;
    if (next && session.guest) {
      router.go('/profile');
      return;
    }
    if (next && !session.user?.consents.cloud_reasoning) {
      router.go('/privacy');
      return;
    }
    if (session.guest) setGuestVoice(next);
    else void setVoiceEnabled(next);
    if (!next) stopSpeaking();
  }

  function toggleSound() {
    sound = !sound;
    setSoundEnabled(sound);
  }

  const ICONS: Record<string, string> = {
    home: 'M4 12.5c0-4 3.6-7 8-7s8 3 8 7-3.6 7-8 7c-1 0-2-.2-2.9-.5L5 20l.9-3.4A6.4 6.4 0 0 1 4 12.5z',
    scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M12 8.5a3.5 4.2 0 1 0 0 8.4 3.5 4.2 0 0 0 0-8.4z',
    progress: 'M4 18.5 9 12l4 3.5 7-8.5M4 21h16',
    routine: 'M9 3h6M10 3v4.2L6.4 15a3 3 0 0 0 2.7 4.4h5.8A3 3 0 0 0 17.6 15L14 7.2V3M8 14h8',
    profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20.5c.6-3.4 3.5-5.5 7-5.5s6.4 2.1 7 5.5',
  };
</script>

<nav class="nav" aria-label="Ese">
  <a class="nav__brand" href="/lounge" use:link aria-label="Ese, lounge">
    <span class="nav__mark">Ese</span>
    {#if session.guest}
      <span class="nav__note">Nothing saved</span>
    {:else if session.demoMode || !session.modelAvailable}
      <span class="nav__note" title="Demo: answering from the local engine, not the cloud model">Demo</span>
    {/if}
  </a>

  <ul class="nav__list" role="list">
    {#each items as item (item.id)}
      <li>
        <a
          class="nav__item"
          href={item.path}
          use:link
          aria-current={router.is(item.id) ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d={ICONS[item.id]} />
          </svg>
          <span>{item.label}</span>
        </a>
      </li>
    {/each}
  </ul>

  <div class="nav__tools" role="group" aria-label="Voice and sound">
    <button
      type="button"
      class="nav__tool"
      aria-pressed={voiceOn}
      title={voiceOn ? 'Mute the AI-generated voice' : session.guest ? 'Choose OpenAI voice in Profile' : 'Enable AI-generated voice'}
      onclick={toggleVoice}
      disabled={!session.canSpeak}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {#if voiceOn}
          <path d="M4 10v4h3l4 3.5v-11L7 10H4zM15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" />
        {:else}
          <path d="M4 10v4h3l4 3.5v-11L7 10H4zM16 9l5 6M21 9l-5 6" />
        {/if}
      </svg>
      <span>{voiceOn ? 'Voice on' : 'Voice off'}</span>
    </button>
    <button
      type="button"
      class="nav__tool"
      aria-pressed={sound}
      title={sound ? 'Room sound is on' : 'Room sound is off'}
      onclick={toggleSound}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {#if sound}
          <path d="M5 12h2l2-5 3 10 3-8 2 3h2" />
        {:else}
          <path d="M5 12h14" />
        {/if}
      </svg>
      <span>{sound ? 'Sound on' : 'Sound off'}</span>
    </button>
  </div>

  <a class="nav__foot" href="/privacy" use:link aria-current={router.is('privacy') ? 'page' : undefined}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6l-7-3z" />
    </svg>
    <span>Privacy</span>
  </a>
</nav>
