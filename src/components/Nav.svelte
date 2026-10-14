<script lang="ts">
  import { ROUTES, link, router } from '@/router/router.svelte.ts';
  import { session } from '@/state/session.svelte.ts';
  import { setGuestVoice, setVoiceEnabled, stopSpeaking } from '@/state/controller.ts';
  import { setSoundEnabled, soundEnabled } from '@/lib/sound.ts';

  const items = ROUTES.filter((route) => route.nav);
  const descriptions: Record<string, string> = {
    home: 'Conversation',
    scan: 'Face & body reading',
    progress: 'Your trends',
    routine: 'Products & care',
    profile: 'Preferences & memory',
  };
  const icons: Record<string, string> = {
    home: 'M4 12.5c0-4 3.6-7 8-7s8 3 8 7-3.6 7-8 7c-1 0-2-.2-2.9-.5L5 20l.9-3.4A6.4 6.4 0 0 1 4 12.5z',
    scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M12 8.5a3.5 4.2 0 1 0 0 8.4 3.5 4.2 0 0 0 0-8.4z',
    progress: 'M4 18.5 9 12l4 3.5 7-8.5M4 21h16',
    routine: 'M9 3h6M10 3v4.2L6.4 15a3 3 0 0 0 2.7 4.4h5.8A3 3 0 0 0 17.6 15L14 7.2V3M8 14h8',
    profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20.5c.6-3.4 3.5-5.5 7-5.5s6.4 2.1 7 5.5',
  };

  let sound = $state(soundEnabled());
  const voiceOn = $derived(Boolean(session.user?.preferences.voiceEnabled) && session.canSpeak);
  const badge = $derived(
    session.guest ? 'Private preview' : session.demoMode || !session.modelAvailable ? 'Demo experience' : 'Your space'
  );

  function toggleVoice() {
    const next = !session.user?.preferences.voiceEnabled;
    if (session.guest) setGuestVoice(next);
    else void setVoiceEnabled(next);
    if (!next) stopSpeaking();
  }
  function toggleSound() {
    sound = !sound;
    setSoundEnabled(sound);
  }
</script>

<nav class="studio-nav" aria-label="Main navigation">
  <a href="/" use:link class="studio-nav__brand" aria-label="Evia home">
    <span class="studio-nav__symbol" aria-hidden="true">e<span class="studio-nav__symbol-dot">.</span></span>
    <span class="studio-nav__brand-copy">
      <strong>Evia</strong>
      <small>Your personal skin studio</small>
    </span>
  </a>

  <div class="studio-nav__desktop-caption">THE STUDIO</div>

  <ul class="studio-nav__items" role="list">
    {#each items as item (item.id)}
      <li>
        <a href={item.path} use:link class="studio-nav__link"
          class:studio-nav__link--feature={item.id === 'scan'}
          aria-current={router.is(item.id) ? 'page' : undefined}>
          <span class="studio-nav__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d={icons[item.id]} />
            </svg>
          </span>
          <span class="studio-nav__label">
            <strong>{item.label}</strong>
            <small>{descriptions[item.id]}</small>
          </span>
          <span class="studio-nav__chevron" aria-hidden="true">↗</span>
        </a>
      </li>
    {/each}
  </ul>

  <div class="studio-nav__bottom">
    <div class="studio-nav__status">
      <span class="studio-nav__status-dot" aria-hidden="true"></span>
      <span><strong>{badge}</strong><small>{session.guest ? 'Nothing saved to an account' : 'Thoughtful care, at your pace'}</small></span>
    </div>
    <div class="studio-nav__switches" role="group" aria-label="Audio controls">
      <button type="button" aria-pressed={voiceOn} disabled={!session.canSpeak}
        onclick={toggleVoice} title="Toggle Evia's voice">
        <span aria-hidden="true">♫</span><span>Voice {voiceOn ? 'on' : 'off'}</span>
      </button>
      <button type="button" aria-pressed={sound} onclick={toggleSound} title="Toggle room audio">
        <span aria-hidden="true">◌</span><span>Sound {sound ? 'on' : 'off'}</span>
      </button>
    </div>
    <div class="studio-nav__utility">
      <a href="/privacy" use:link aria-current={router.is('privacy') ? 'page' : undefined}>Privacy & consent</a>
      <a href="/settings/data" use:link aria-current={router.is('data') ? 'page' : undefined}>Your data</a>
    </div>
  </div>

  <a class="studio-nav__mobile-brand" href="/" use:link aria-label="Evia home">evia<span aria-hidden="true">.</span></a>
</nav>
