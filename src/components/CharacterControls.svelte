<script lang="ts">
  import { onDestroy } from 'svelte';
  import { session } from '@/state/session.svelte.ts';
  import { gestureEvia, sampleEvia, stopEviaSample } from '@/state/controller.ts';
  import { POKE_LINES } from '@/lib/lines.ts';

  let message = $state('Choose an expression, or hear a short voice sample.');
  let sampled = $state(false);
  const busy = $derived(session.thinking || session.listening || session.introPlaying || session.scanActive);

  function gesture(action: 'wink' | 'wave' | 'explain') {
    message = gestureEvia(action)
      ? action === 'wink' ? 'Evia winks.' : action === 'wave' ? 'Evia waves hello.' : 'Evia gestures with open hands.'
      : 'That expression needs the 3D character, which is not available right now.';
  }

  function hear() {
    sampled = true;
    message = '';
    sampleEvia();
  }

  onDestroy(stopEviaSample);
</script>

<section class="character-controls" aria-label="Evia's voice and expressions">
  <div class="character-controls__voice">
    <button class="hear" onclick={hear} disabled={busy || !session.canSpeak}>Hear Evia</button>
    <button onclick={stopEviaSample} disabled={!sampled}>Stop voice</button>
  </div>
  <div class="character-controls__gestures" role="group" aria-label="Expressions">
    <button onclick={() => gesture('wink')} disabled={busy}>Wink</button>
    <button onclick={() => gesture('wave')} disabled={busy}>Wave</button>
    <button onclick={() => gesture('explain')} disabled={busy}>Open hands</button>
  </div>
  {#if sampled}<p class="sample-line">“{POKE_LINES.body[0]}”</p>{/if}
  <p class="status" role="status">{message}{#if sampled}<span>{session.voiceStatus}</span>{/if}</p>
</section>

<style>
  .character-controls {
    position: fixed;
    z-index: var(--z-page);
    right: max(24px, env(safe-area-inset-right));
    bottom: max(28px, env(safe-area-inset-bottom));
    width: min(340px, 29vw);
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: rgba(15, 17, 21, 0.9);
    backdrop-filter: blur(16px);
    color: var(--ink);
  }
  .character-controls__voice, .character-controls__gestures { display: flex; gap: 8px; }
  .character-controls__gestures { margin-top: 10px; }
  .character-controls__gestures button { padding-inline: 8px; }
  button {
    flex: 1;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid rgba(224, 204, 174, 0.35);
    border-radius: 8px;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button:hover:enabled { background: rgba(224, 204, 174, 0.13); }
  button:focus-visible { outline: 2px solid #e5c9a0; outline-offset: 3px; }
  button:disabled { opacity: 0.45; cursor: default; }
  .hear { background: #d6bd99; color: #171717; }
  .hear:hover:enabled { background: #e9d2b2; }
  .sample-line { margin: 16px 0 0; font-size: 15px; line-height: 1.5; }
  .status { margin: 12px 0 0; min-height: 2.8em; font-size: 12px; color: var(--ink-soft); line-height: 1.4; }
  .status span { display: block; }
  @media (max-width: 850px) {
    .character-controls {
      right: 16px;
      left: 16px;
      bottom: calc(var(--tabbar-h) + var(--safe-b) + 12px);
      width: auto;
      padding: 14px;
    }
    .status { min-height: 1.4em; }
  }
</style>
