<!--
  The conversation's frame: one drawer for the whole app, mounted once by the
  Shell and opened from Home's "Talk to Evia", the sidebar's Talk card
  (through shell/talk.svelte.ts) or anything else that calls `openChat`.

  >= 820px  a glass panel floating at the right edge, over a light scrim; the
            room and the greeting stay in view to its left.
  < 820px   a full-screen sheet, sized to what the keyboard leaves visible.

  It is a modal dialog: Esc, the close button and the scrim close it, Tab
  stays inside it, and focus goes back to whatever opened it. The AI
  disclosure (SRS section 6) sits under its title for as long as it is open.
  It closes when the address changes - a scan offer taken from inside it
  walks to /scan - and closing it stops the microphone.

  The close button is the shared IconButton. The voice switch is drawn here to
  the same 44px plain-disc geometry only because its glyphs (ChatGlyph) are
  not in the shared icon set yet; once they are, it becomes an IconButton too.

  The dialog sits under the "Sample data" badge (--z-sheet < --z-badge), so
  the badge stays visible and reachable while it is open.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { MediaQuery } from 'svelte/reactivity';
  import { router } from '@/router/router.svelte.ts';
  import { session } from '@/state/session.svelte.ts';
  import { setGuestVoice, setVoiceEnabled, toggleListening } from '@/state/controller.ts';
  import { talk, takeTalkRequest } from '@/shell/talk.svelte.ts';
  import AiDisclosure from '@/shell/AiDisclosure.svelte';
  import { stillness } from '@/lib/motion.ts';
  import Icon from '@/ui/Icon.svelte';
  import IconButton from '@/ui/IconButton.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import ChatGlyph from './ChatGlyph.svelte';
  import { chat, closeChat, markSeen, openChat } from './drawer.svelte.ts';

  const compact = new MediaQuery('max-width: 819px', false);
  const coarse = new MediaQuery('pointer: coarse', false);
  const id = $props.id();

  let panel = $state<HTMLElement | null>(null);
  let heading = $state<HTMLElement | null>(null);
  let composer = $state<HTMLTextAreaElement | null>(null);

  /* "Talk to Evia" from elsewhere: requestTalk walks home and leaves a request. */
  $effect(() => {
    if (talk.pending && takeTalkRequest()) openChat();
  });

  /* Everything she says while it is open has been seen. */
  $effect(() => {
    void session.messages.length;
    if (chat.open) markSeen();
  });

  function close() {
    if (session.listening) toggleListening();
    closeChat();
  }

  /* A new address closes it (the page it was opened over has gone). */
  let openedPath: string | null = null;
  $effect(() => {
    const path = router.path;
    if (!chat.open) {
      openedPath = null;
      return;
    }
    if (openedPath === null) openedPath = path;
    else if (path !== openedPath) close();
  });

  /* Signing out closes it too. */
  $effect(() => {
    if (chat.open && !session.signedIn) close();
  });

  /*
   * Where focus lands on opening: the message box with a keyboard and a
   * pointer; the title on a touch screen, where focusing the box would throw
   * the on-screen keyboard up before anyone asked for it.
   */
  $effect(() => {
    if (!chat.open) return;
    void tick().then(() => {
      if (!coarse.current && composer) composer.focus({ preventScroll: true });
      else heading?.focus({ preventScroll: true });
    });
  });

  function focusables(): HTMLElement[] {
    if (!panel) return [];
    return [
      ...panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const list = focusables();
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === heading || !panel?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  /* Her voice, on or off: the account's preference, or the guest's switch. */
  const voiceOn = $derived(!!session.user?.preferences.voiceEnabled);
  function toggleVoice() {
    if (session.guest) setGuestVoice(!voiceOn);
    else void setVoiceEnabled(!voiceOn);
  }

  const motion = $derived(stillness() ? 0 : 1);
</script>

<svelte:window
  onkeydown={(event) => {
    if (chat.open && event.key === 'Escape' && !panel?.contains(event.target as Node)) close();
  }}
/>

{#if chat.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="ev-chatdrawer__scrim" onclick={close} transition:fade={{ duration: 200 * motion }}></div>
  <div
    class="ev-chatdrawer on-dark"
    class:is-sheet={compact.current}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="{id}-title"
    bind:this={panel}
    onkeydown={onKeydown}
    transition:fly={compact.current
      ? { y: 48, duration: 280 * motion, opacity: 0 }
      : { x: 36, duration: 260 * motion, opacity: 0 }}
  >
    <header class="ev-chatdrawer__head">
      <span class="ev-chatdrawer__tile" aria-hidden="true"><Icon name="messages" size={22} filled /></span>
      <h2 class="ev-chatdrawer__title" id="{id}-title" tabindex="-1" bind:this={heading}>Talk to Evia</h2>
      <div class="ev-chatdrawer__tools">
        {#if session.canSpeak || voiceOn}
          <button
            type="button"
            class="ev-chatdrawer__tool"
            aria-pressed={voiceOn}
            aria-label="Evia's voice"
            title={voiceOn ? 'Voice on: she reads her replies aloud' : 'Voice off'}
            onclick={toggleVoice}
          >
            <ChatGlyph name={voiceOn ? 'voice-on' : 'voice-off'} size={22} />
          </button>
        {/if}
        <IconButton icon={compact.current ? 'chevron-down' : 'x'} label="Close the conversation" tone="dark" onclick={close} />
      </div>
    </header>

    <div class="ev-chatdrawer__ai">
      <AiDisclosure tone="dark" backed={false} />
    </div>

    <ChatPanel bind:composer />
  </div>
{/if}

<style>
  .ev-chatdrawer:focus {
    outline: none;
  }
  .ev-chatdrawer__scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet);
    background: var(--scrim);
  }

  .ev-chatdrawer {
    position: fixed;
    top: 12px;
    right: 12px;
    bottom: 12px;
    z-index: var(--z-sheet);
    display: flex;
    flex-direction: column;
    width: min(440px, calc(100vw - var(--shell-nav-w, 0px) - 48px));
    border-radius: var(--r-2xl);
    background:
      linear-gradient(160deg, var(--glass-dark-sheen) 0%, transparent 40%),
      var(--glass-dark-strong);
    box-shadow:
      inset 0 0 0 1px var(--glass-dark-rim),
      var(--shadow-lg);
    color: var(--text-on-dark);
    overflow: hidden;
    -webkit-backdrop-filter: blur(24px) saturate(1.08);
    backdrop-filter: blur(24px) saturate(1.08);
  }
  @media (max-width: 1199px) {
    .ev-chatdrawer {
      width: min(400px, calc(100vw - var(--shell-nav-w, 0px) - 40px));
    }
  }
  /* The phone: the whole screen, down to what the keyboard leaves visible. */
  .ev-chatdrawer.is-sheet {
    inset: 0 0 auto 0;
    width: 100%;
    height: var(--vvh, 100dvh);
    border-radius: 0;
    background: var(--sheet-glass);
    box-shadow: none;
  }

  .ev-chatdrawer__head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 12px 10px 20px;
  }
  .is-sheet .ev-chatdrawer__head {
    /* Clear the notch, and the Sample data badge when it is up. */
    padding-top: max(12px, var(--safe-t), calc(var(--sample-space, 0px) + 4px));
    padding-left: max(16px, var(--safe-l));
    padding-right: max(8px, var(--safe-r));
  }
  .ev-chatdrawer__tile {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: linear-gradient(160deg, var(--portrait-pink-hi), var(--portrait-pink));
    box-shadow: inset 0 0 0 1px var(--portrait-rim);
    color: var(--cta-icon);
  }
  .ev-chatdrawer__title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--fs-title);
    font-weight: var(--fw-regular);
    line-height: 1.2;
    letter-spacing: var(--tr-title);
    color: var(--text-on-dark-strong);
  }
  /* Only a programmatic landing spot (tabindex -1), never tabbed to. */
  .ev-chatdrawer__title:focus {
    outline: none;
  }
  .ev-chatdrawer__tools {
    display: flex;
    gap: 4px;
  }
  .ev-chatdrawer__tool {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-on-dark-strong);
    cursor: pointer;
    transition: background-color var(--dur-base) var(--ease-out);
  }
  .ev-chatdrawer__tool[aria-pressed='false'] {
    color: var(--text-on-dark);
  }
  .ev-chatdrawer__tool[aria-pressed='true'] {
    background: var(--tint-press-dark);
  }
  .ev-chatdrawer__tool:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: 1px;
  }
  @media (hover: hover) {
    .ev-chatdrawer__tool:hover {
      background: var(--tint-hover-dark);
    }
  }

  .ev-chatdrawer__ai {
    padding: 0 20px 10px;
    border-bottom: 1px solid var(--glass-dark-rim);
  }
  .is-sheet .ev-chatdrawer__ai {
    padding-left: max(16px, var(--safe-l));
  }
</style>
