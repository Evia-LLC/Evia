<!--
  "A quick tip from Evia" (ref1, bottom left).

  The tile that held her portrait keeps its shape and its pink and carries
  the wordmark instead - no face (BUILD-PLAN decision 3). The play button
  speaks the tip in her voice through the voice controller, the same
  text-to-speech every reply uses, never a recording (SRS section 6); pressing
  it again stops her. When her voice is off it says so and offers to turn it
  on, rather than doing nothing. That note takes the title's place (the title
  stays for screen readers), so the card does not grow and push the page's
  foot out of the window. When it is on and still nothing can say the
  line - no speech in this browser, or her own voice is set up but cannot say
  a line it has no recording or server for (voice/controller.ts `willSpeak`
  never hands her lines to a stranger's voice) - it says that instead.
-->
<script lang="ts">
  import { session } from '@/state/session.svelte.ts';
  import { setGuestVoice, setVoiceEnabled, stopSpeaking } from '@/state/controller.ts';
  import { voice } from '@/voice/controller.ts';
  import GlassCard from '@/ui/GlassCard.svelte';
  import IconButton from '@/ui/IconButton.svelte';
  import Button from '@/ui/Button.svelte';
  import type { HomeTip } from '@/view/home.ts';

  interface Props {
    tip: HomeTip;
    class?: string;
  }

  const { tip, class: className = '' }: Props = $props();
  const id = $props.id();

  /** This card asked for the line and it has not finished. */
  let asked = $state(false);
  let heard = false;
  let giveUp = 0;
  let note = $state<'off' | 'unavailable' | null>(null);

  const playing = $derived(asked);

  $effect(() => {
    if (!asked) return;
    if (session.speaking) {
      heard = true;
      window.clearTimeout(giveUp);
    } else if (heard) {
      asked = false;
      heard = false;
    }
  });

  function speak() {
    asked = true;
    heard = false;
    note = null;
    voice.speak(tip.body);
    // A voice that never starts (blocked audio, a dropped utterance) must not
    // leave the button stuck on pause.
    window.clearTimeout(giveUp);
    giveUp = window.setTimeout(() => {
      if (!heard) asked = false;
    }, 4_000);
  }

  function toggle() {
    if (playing) {
      asked = false;
      stopSpeaking();
      return;
    }
    if (voice.willSpeak(tip.body) === 'none') {
      // Switched off, or on and still nothing that can say it.
      note = session.user?.preferences.voiceEnabled ? 'unavailable' : 'off';
      return;
    }
    speak();
  }

  function turnVoiceOn() {
    if (session.guest) setGuestVoice(true);
    else void setVoiceEnabled(true);
    if (voice.willSpeak(tip.body) === 'none') note = 'unavailable';
    else speak();
  }

  $effect(() => () => window.clearTimeout(giveUp));
</script>

<GlassCard as="aside" variant="dark" padding="none" radius="2xl" class="home-tip {className}" aria-labelledby="{id}-title">
  <div class="home-tip__row">
    <span class="home-tip__tile" aria-hidden="true">evia</span>
    <div class="home-tip__text">
      <h2 class="home-tip__title" class:visually-hidden={note !== null} id="{id}-title">{tip.title}</h2>
      <div class="home-tip__note" role="status">
        {#if note === 'off'}
          <span>Voice is off.</span>
          <Button variant="ghost" tone="dark" size="sm" onclick={turnVoiceOn}>Turn it on</Button>
        {:else if note === 'unavailable'}
          <span>Evia can’t read this tip aloud right now.</span>
        {/if}
      </div>
      <p class="home-tip__body">{tip.body}</p>
    </div>
    <IconButton
      icon={playing ? 'pause' : 'play'}
      label={playing ? 'Stop the tip' : 'Hear this tip'}
      variant="ring"
      tone="dark"
      size="lg"
      iconSize={playing ? 18 : 17}
      filled
      pressed={playing}
      class="home-tip__play"
      onclick={toggle}
    />
  </div>
</GlassCard>

<style>
  :global(.home-tip) {
    width: 100%;
  }
  .home-tip__row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 20px;
    padding: 9px 20px 9px 10px;
  }
  /* The portrait tile, without the portrait: pink, with the wordmark. */
  .home-tip__tile {
    display: grid;
    place-items: center;
    width: 105px;
    height: 108px;
    border-radius: 27px;
    background: linear-gradient(160deg, var(--portrait-pink-hi), var(--portrait-pink));
    box-shadow: inset 0 0 0 1px var(--portrait-rim);
    color: var(--cta-icon);
    font-family: var(--font-serif);
    font-size: 34px;
    font-weight: 380;
    font-variation-settings: 'opsz' 72;
    letter-spacing: -0.03em;
    line-height: 1;
    padding-bottom: 6px;
  }
  .home-tip__text {
    display: grid;
    min-width: 0;
  }
  .home-tip__title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--fs-lead);
    font-weight: var(--fw-medium);
    line-height: 1.25;
    color: var(--text-on-dark-strong);
  }
  .home-tip__body {
    margin: 8px 0 0;
    max-width: 30ch;
    font-size: var(--fs-label);
    line-height: 23px;
    color: var(--text-on-dark);
  }
  /* The ring is the mockup's thin peach circle, 3:1 against the card. */
  .home-tip__row :global(.home-tip__play) {
    border-color: rgba(240, 190, 172, 0.8);
    background: transparent;
    color: var(--text-on-dark-strong);
  }
  .home-tip__row :global(.home-tip__play[aria-pressed='true']) {
    color: var(--text-on-dark-strong);
    background: var(--tint-press-dark);
  }

  /* In the title's slot; no height until there is something to say. */
  .home-tip__note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 4px;
    font-size: var(--fs-body-sm);
    line-height: 1.35;
    color: var(--text-on-dark-strong);
  }
  .home-tip__note :global(.ev-btn) {
    margin-left: -6px;
    padding-inline: 10px;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  @media (max-width: 819px) {
    .home-tip__row {
      gap: 14px;
      padding: 8px 12px 8px 8px;
    }
    .home-tip__tile {
      width: 72px;
      height: 76px;
      border-radius: 20px;
      font-size: 24px;
    }
    .home-tip__title {
      font-size: var(--fs-label);
    }
    .home-tip__body {
      font-size: var(--fs-body-sm);
      line-height: 20px;
    }
  }
</style>
