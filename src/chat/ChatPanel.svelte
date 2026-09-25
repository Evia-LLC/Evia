<!--
  The conversation: her words and yours, and the box you answer in.

  It is the body of the chat drawer (ChatDrawer.svelte), drawn on its dark
  rose-brown glass: her lines on a faint cream tint, yours on the CTA's coral,
  both in the one type scale. The drawer owns the frame (title, voice switch,
  disclosure, closing); this owns what happens inside it:

  - the transcript, with her newest line landing at her pace (lib/reveal.ts:
    following her voice when one speaks it, a reading-pace timer otherwise).
    Only a line that arrives while this is open animates; history, including
    a greeting she gave while the drawer was shut, renders whole;
  - following new lines only when you were already at the bottom, and a
    "New from Evia" pill when you were reading back;
  - her thinking, a scan offer, and errors, in the same bubbles and cards;
  - the composer: typing, the microphone (its live transcript shows in the
    box while it listens), send, and stopping her mid-line.

  With nothing said yet it offers three general questions to start from.

  The lines come from `shownMessages()` (drawer.svelte.ts), not straight from
  the session: in sample mode an account's stored transcript is kept out of
  the designed sample (transcript.ts).
-->
<script lang="ts">
  import { AI_COPY } from '@shared/legal-screen-copy.ts';
  import AIDisclosure from '@/components/legal/AIDisclosure.svelte';
  import { onDestroy } from 'svelte';
  import { session } from '@/state/session.svelte.ts';
  import { notifyTyping, sendMessage, startScanFlow, stopSpeaking, toggleListening } from '@/state/controller.ts';
  import { revealLine, type RevealTicker } from '@/lib/reveal.ts';
  import Button from '@/ui/Button.svelte';
  import Icon from '@/ui/Icon.svelte';
  import ChatGlyph from './ChatGlyph.svelte';
  import { shownMessages } from './drawer.svelte.ts';

  interface Props {
    /** The message box, for the drawer to focus when it opens. */
    composer?: HTMLTextAreaElement | null;
  }

  let { composer = $bindable(null) }: Props = $props();

  /** Starting points when the transcript is empty: general questions, no claims. */
  const STARTERS = [
    'What should my evening routine look like?',
    'How do I choose a sunscreen?',
    'Can you take a look at my skin?',
  ];

  const messages = $derived(shownMessages());

  let draft = $state('');
  let transcript = $state<HTMLDivElement | null>(null);

  // Sending while she thinks is allowed - the message queues for its turn
  // (see sendMessage) - so the button is never dead during her greeting.
  const canSend = $derived(draft.trim().length > 0 && !session.listening);

  /*
   * While the mic is open the box mirrors the live transcript, so you can see
   * what she is hearing before it is sent. Not a binding: the field has two
   * sources and only one of them is the user.
   */
  const shown = $derived(session.listening ? session.voiceDraft : draft);

  function onInput(event: Event) {
    if (session.listening) return;
    draft = (event.currentTarget as HTMLTextAreaElement).value;
    notifyTyping();
    autosize();
  }

  /*
   * Her newest line arrives at her pace - but only a line that arrives while
   * the conversation is open. Whatever was there when it opened is history.
   */
  let revealId = $state<string | null>(shownMessages().at(-1)?.id ?? null);
  // Whole until a new line starts its reveal.
  let revealChars = $state(Number.POSITIVE_INFINITY);
  let ticker: RevealTicker | null = null;

  $effect(() => {
    const m = messages[messages.length - 1];
    if (!m || m.role !== 'elohim' || m.id === revealId) return;
    ticker?.stop();
    revealId = m.id;
    revealChars = 0;
    ticker = revealLine(m.content, (n) => (revealChars = n));
  });
  onDestroy(() => ticker?.stop());

  function revealAll() {
    ticker?.finish();
  }

  /*
   * Follow new content only when the reader was at the bottom before the DOM
   * grew; otherwise raise the pill.
   */
  let nearBottom = true;
  let seenCount = shownMessages().length;
  let unseen = $state(false);

  function onTranscriptScroll() {
    const el = transcript;
    if (!el) return;
    nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) unseen = false;
  }

  $effect(() => {
    const count = messages.length;
    void session.thinking;
    void revealChars;
    void session.pendingOffer;
    void session.chatError;
    const el = transcript;
    if (!el) return;
    const fromHer = count > seenCount && messages[count - 1]?.role === 'elohim';
    seenCount = count;
    queueMicrotask(() => {
      if (nearBottom) el.scrollTop = el.scrollHeight;
      else if (fromHer) unseen = true;
    });
  });

  function jumpToNew() {
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
    unseen = false;
  }

  function autosize() {
    if (!composer) return;
    composer.style.height = 'auto';
    // The ceiling lives in the stylesheet; read it rather than keep a copy.
    const ceiling = Number.parseFloat(getComputedStyle(composer).maxHeight);
    composer.style.height = `${Math.min(composer.scrollHeight, ceiling || 140)}px`;
  }

  function scrollToEnd() {
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }

  /*
   * Focusing the box is the start of a turn. On a phone the keyboard then
   * shrinks the sheet, so the transcript is nudged back to its end once the
   * keyboard has settled.
   */
  function onComposerFocus() {
    notifyTyping();
    queueMicrotask(scrollToEnd);
    setTimeout(scrollToEnd, 320);
  }

  async function submit() {
    if (!canSend) return;
    const text = draft;
    draft = '';
    queueMicrotask(autosize);
    await sendMessage(text);
  }

  function ask(text: string) {
    void sendMessage(text);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  }
</script>

<div class="ev-chat">
  <!-- The Consent Wording Pack's section 8 notice (main, Section 5): the
       consultation label and the escalation line, above the conversation. -->
  <AIDisclosure consultation tone="dark" class="ev-chat__ai" />

  <div
    class="ev-chat__log"
    bind:this={transcript}
    role="log"
    aria-label="Conversation with Evia"
    tabindex="-1"
    onscroll={onTranscriptScroll}
  >
    {#if messages.length === 0 && !session.thinking}
      <div class="ev-chat__empty">
        <p class="ev-chat__empty-lead">Ask me anything about your skin or your routine.</p>
        <ul class="ev-chat__starters" role="list">
          {#each STARTERS as starter (starter)}
            <li>
              <Button
                variant="secondary"
                tone="dark"
                shape="rounded"
                iconEnd="arrow-right"
                spread
                full
                class="ev-chat__starter"
                onclick={() => ask(starter)}>{starter}</Button
              >
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#each messages as message (message.id)}
      {@const hers = message.role === 'elohim'}
      {#if hers && message.id === revealId && revealChars < message.content.length}
        <!-- Still being said: the words land at her pace; a tap shows the rest. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="ev-chat__bubble ev-chat__bubble--her" onclick={revealAll}>
          <span class="visually-hidden">Evia: </span>{message.content.slice(0, revealChars)}
        </div>
      {:else}
        <div class="ev-chat__bubble ev-chat__bubble--{hers ? 'her' : 'you'}">
          <span class="visually-hidden">{hers ? 'Evia: ' : 'You: '}</span>{message.content}
        </div>
      {/if}
      {#if message.role === 'elohim'}<p class="ev-chat__legal">{AI_COPY.result}</p>{/if}
    {/each}

    {#if session.thinking}
      <div class="ev-chat__bubble ev-chat__bubble--her ev-chat__thinking" role="status">
        <span class="visually-hidden">Evia is thinking</span>
        <i aria-hidden="true"></i><i aria-hidden="true"></i><i aria-hidden="true"></i>
      </div>
    {/if}

    {#if session.pendingOffer?.type === 'offer_scan'}
      <div class="ev-chat__offer">
        <span>Want me to take a proper look?</span>
        <Button variant="soft" tone="dark" size="sm" iconStart="camera" onclick={() => startScanFlow()}>Start a scan</Button>
      </div>
    {/if}

    {#if session.chatError}
      <div class="ev-chat__error" role="alert">
        <Icon name="info" size={18} stroke={1.8} />
        <span>{session.chatError}</span>
      </div>
    {/if}
  </div>

  {#if unseen}
    <div class="ev-chat__newpill">
      <Button variant="soft" size="sm" iconEnd="chevron-down" onclick={jumpToNew}>New from Evia</Button>
    </div>
  {/if}

  {#if session.speaking}
    <div class="ev-chat__speaking">
      <span class="ev-chat__wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span>Evia is speaking</span>
      <Button variant="secondary" tone="dark" size="sm" class="ev-chat__stop" onclick={() => stopSpeaking()}>
        <ChatGlyph name="stop" size={16} filled />Stop
      </Button>
    </div>
  {/if}

  <div class="ev-chat__composer" class:is-listening={session.listening}>
    <textarea
      bind:this={composer}
      value={shown}
      oninput={onInput}
      onkeydown={onKeydown}
      onfocus={onComposerFocus}
      rows="1"
      readonly={session.listening}
      placeholder={session.listening ? 'Listening…' : 'Message Evia…'}
      aria-label="Message Evia"
      maxlength="4000"
    ></textarea>

    {#if session.canListen}
      <button
        type="button"
        class="ev-chat__mic"
        class:is-on={session.listening}
        onclick={() => toggleListening()}
        aria-label={session.listening ? 'Stop listening' : 'Speak to Evia'}
        aria-pressed={session.listening}
        title={session.listening ? 'Stop listening' : 'Speak to Evia'}
      >
        <ChatGlyph name="mic" size={22} />
      </button>
    {/if}

    <button type="button" class="ev-chat__send" onclick={submit} disabled={!canSend} aria-label="Send message" title="Send">
      <Icon name="arrow-right" size={22} stroke={2} />
    </button>
  </div>
</div>

<style>
  .ev-chat {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1 1 auto;
  }

  .ev-chat__log {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 20px 20px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--border-on-dark-strong) transparent;
  }
  .ev-chat__log:focus {
    outline: none;
  }
  /* The first line sits at the bottom of a short conversation, as in any chat. */
  .ev-chat__log > :first-child {
    margin-top: auto;
  }

  .ev-chat__bubble {
    max-width: min(86%, 34em);
    padding: 11px 15px;
    font-size: var(--fs-body);
    line-height: var(--lh-normal);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .ev-chat__bubble--her {
    align-self: flex-start;
    border-radius: 18px 18px 18px 6px;
    background: var(--tint-press-dark);
    box-shadow: inset 0 0 0 1px var(--glass-dark-rim);
    color: var(--text-on-dark-strong);
  }
  .ev-chat__bubble--you {
    align-self: flex-end;
    border-radius: 18px 18px 6px 18px;
    background: linear-gradient(120deg, var(--cta-from), var(--cta-to));
    box-shadow: inset 0 0 0 1px var(--cta-rim);
    color: var(--cta-ink);
  }
  /* Under each of her lines, the section 8 result disclaimer (main): meta
     size, the muted cream, tucked up against the bubble it qualifies. */
  .ev-chat__legal {
    align-self: flex-start;
    max-width: min(86%, 34em);
    margin: -4px 0 2px 4px;
    font-size: var(--fs-meta);
    line-height: 1.4;
    color: var(--text-on-dark-muted);
  }
  /* The notice above the log: its own strip, divided from the conversation. */
  .ev-chat :global(.ev-chat__ai) {
    flex: none;
    padding: 10px 20px 12px;
    border-bottom: 1px solid var(--glass-dark-rim);
  }

  /* Consecutive lines from the same side read as one turn. */
  .ev-chat__bubble--her + .ev-chat__bubble--her,
  .ev-chat__bubble--you + .ev-chat__bubble--you {
    margin-top: -4px;
  }

  .ev-chat__thinking {
    display: inline-flex;
    gap: 5px;
    align-items: center;
    padding: 15px 16px;
  }
  .ev-chat__thinking i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-on-dark);
    animation: ev-chat-dot 1.2s var(--ease-in-out) infinite;
  }
  .ev-chat__thinking i:nth-of-type(2) {
    animation-delay: 0.15s;
  }
  .ev-chat__thinking i:nth-of-type(3) {
    animation-delay: 0.3s;
  }
  @keyframes ev-chat-dot {
    0%,
    80%,
    100% {
      opacity: 0.35;
      transform: translateY(0);
    }
    40% {
      opacity: 1;
      transform: translateY(-3px);
    }
  }

  .ev-chat__empty {
    display: grid;
    gap: 14px;
    padding: 4px 0 8px;
  }
  .ev-chat__empty-lead {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--fs-title-sm);
    line-height: var(--lh-snug);
    color: var(--text-on-dark-strong);
  }
  .ev-chat__starters {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /*
   * The shared outline button, allowed to wrap: a starter is a sentence, and
   * a narrow phone must show all of it rather than an ellipsis.
   */
  .ev-chat__starters :global(.ev-chat__starter) {
    --btn-h: 48px;
    --btn-px: 16px;
    --btn-fs: var(--fs-body-sm);
    padding-block: 10px;
    padding-right: 14px;
    font-weight: var(--fw-regular);
    line-height: 1.35;
    text-align: left;
    white-space: normal;
  }
  .ev-chat__starters :global(.ev-chat__starter .ev-btn__label) {
    overflow: visible;
  }

  .ev-chat__offer {
    align-self: flex-start;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    padding: 12px 12px 12px 16px;
    border-radius: var(--r-lg);
    background: var(--tint-hover-dark);
    box-shadow: inset 0 0 0 1px var(--border-on-dark-strong);
    color: var(--text-on-dark-strong);
    font-size: var(--fs-body-sm);
  }

  .ev-chat__error {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--r-lg);
    background: rgba(154, 47, 63, 0.35);
    box-shadow: inset 0 0 0 1px rgba(255, 190, 190, 0.45);
    color: var(--text-on-dark-strong);
    font-size: var(--fs-body-sm);
    line-height: 1.4;
  }
  .ev-chat__error :global(.icon) {
    margin-top: 1px;
  }

  /* Floats over the end of the transcript; the button is the shared one. */
  .ev-chat__newpill {
    position: absolute;
    left: 50%;
    bottom: 88px;
    transform: translateX(-50%);
    border-radius: var(--r-pill);
    box-shadow: var(--shadow-md);
  }

  .ev-chat__speaking {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 20px 8px;
    padding: 4px 4px 4px 14px;
    border-radius: var(--r-pill);
    background: var(--tint-hover-dark);
    color: var(--text-on-dark);
    font-size: var(--fs-small);
  }
  .ev-chat__wave {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 14px;
  }
  .ev-chat__wave i {
    width: 3px;
    height: 100%;
    border-radius: 2px;
    background: var(--cta-from);
    animation: ev-chat-wave 0.9s var(--ease-in-out) infinite alternate;
  }
  .ev-chat__wave i:nth-child(2) {
    animation-delay: -0.3s;
  }
  .ev-chat__wave i:nth-child(3) {
    animation-delay: -0.6s;
  }
  .ev-chat__wave i:nth-child(4) {
    animation-delay: -0.15s;
  }
  @keyframes ev-chat-wave {
    from {
      transform: scaleY(0.3);
    }
    to {
      transform: scaleY(1);
    }
  }
  .ev-chat__speaking :global(.ev-chat__stop) {
    margin-left: auto;
    padding-left: 10px;
    padding-right: 14px;
  }
  .ev-chat__speaking :global(.ev-chat__stop .ev-btn__label) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .ev-chat__composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin: 0 16px max(16px, var(--safe-b));
    padding: 6px 6px 6px 18px;
    border-radius: 26px;
    background: var(--cream-0);
    box-shadow:
      inset 0 0 0 1px var(--blush-200),
      var(--shadow-md);
  }
  .ev-chat__composer:focus-within {
    box-shadow:
      0 0 0 2px var(--focus-ring-on-dark),
      var(--shadow-md);
  }
  .ev-chat__composer.is-listening {
    box-shadow:
      0 0 0 2px var(--cta-from),
      var(--shadow-md);
  }
  .ev-chat__composer textarea {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 44px;
    max-height: 140px;
    padding: 11px 0;
    border: 0;
    background: transparent;
    color: var(--text-strong);
    font-family: var(--font-sans);
    /* 16px, so iOS does not zoom the page on focus. */
    font-size: var(--fs-label);
    line-height: 1.4;
    resize: none;
    outline: none;
  }
  .ev-chat__composer textarea::placeholder {
    color: var(--text-muted);
    opacity: 1;
  }

  .ev-chat__mic,
  .ev-chat__send {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
    transition:
      background-color var(--dur-base) var(--ease-out),
      opacity var(--dur-base) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }
  .ev-chat__mic:focus-visible,
  .ev-chat__send:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 1px;
  }
  .ev-chat__mic {
    background: transparent;
    color: var(--text-secondary);
  }
  .ev-chat__mic.is-on {
    background: var(--rose-300);
    color: var(--chip-selected-icon);
  }
  @media (hover: hover) {
    .ev-chat__mic:hover:not(.is-on) {
      background: var(--tint-hover);
      color: var(--text-strong);
    }
  }
  .ev-chat__send {
    background: linear-gradient(135deg, var(--cta-from), var(--cta-to));
    box-shadow: inset 0 0 0 1px var(--cta-rim);
    color: var(--cta-ink);
  }
  .ev-chat__send:disabled {
    background: var(--surface-sunken);
    box-shadow: none;
    color: var(--text-muted);
    cursor: default;
  }
  .ev-chat__send:active:not(:disabled),
  .ev-chat__mic:active {
    transform: scale(0.95);
  }

  @media (prefers-reduced-motion: reduce) {
    .ev-chat__thinking i,
    .ev-chat__wave i {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .ev-chat__thinking i,
  :global([data-reduced-motion='true']) .ev-chat__wave i {
    animation: none;
  }
</style>
