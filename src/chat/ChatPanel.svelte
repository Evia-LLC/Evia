<script lang="ts">
  /**
   * The conversation. Not a sidebar of features — the interface.
   *
   * On a phone this is a sheet rather than a column. It rests at a peek height
   * that shows the tail of what she just said plus the composer, which leaves
   * Elohim roughly 70% of the screen; dragging or tapping the grip expands it to
   * about 68% for reading back through the history. She is the interface, so
   * the transcript is the thing that yields space, not her.
   */
  import { onDestroy } from 'svelte';
  import { session } from '@/state/session.svelte.ts';
  import {
    notifyTyping,
    sendMessage,
    startScanFlow,
    stopSpeaking,
    toggleListening,
  } from '@/state/controller.ts';
  import { revealLine, type RevealTicker } from '@/lib/reveal.ts';

  /** The breakpoint at which the chat stops being a column and becomes a sheet. */
  const SHEET_QUERY = '(max-width: 860px), (orientation: portrait)';

  let draft = $state('');
  let transcript = $state<HTMLDivElement | null>(null);
  let composer = $state<HTMLTextAreaElement | null>(null);
  let chat = $state<HTMLDivElement | null>(null);

  let sheet = $state<'peek' | 'full'>('peek');
  let compact = $state(false);
  let dragging = $state(false);
  /** Live height while a thumb is on the grip; null hands control back to CSS. */
  let dragHeight = $state<number | null>(null);

  // Sending while she thinks is allowed - the message queues for its turn
  // (see sendMessage). Gating the button on `thinking` made it dead at the
  // exact moment a new visitor first types: during her arrival greeting.
  const canSend = $derived(draft.trim().length > 0 && !session.listening);

  /**
   * While the mic is open the composer mirrors the live transcript, so you can
   * see what she is hearing before it is sent. Typing takes over the moment the
   * mic closes. Not a binding: the field has two sources and only one of them
   * is the user.
   */
  const shown = $derived(session.listening ? session.voiceDraft : draft);

  function onInput(event: Event) {
    if (session.listening) return;
    draft = (event.currentTarget as HTMLTextAreaElement).value;
    // Typing is a turn-taking signal: she looks up, and stops mid-line once.
    notifyTyping();
    autosize();
  }

  /*
   * Her newest line arrives at her pace.
   *
   * The reveal follows her voice when one will speak the line, and a plain
   * timer otherwise - one mechanism, shared with the scan dock, in
   * lib/reveal.ts. Only the newest of her messages animates; history renders
   * whole, and tapping the animating bubble reveals the rest at once.
   */
  let revealId = $state<string | null>(null);
  let revealChars = $state(0);
  let ticker: RevealTicker | null = null;

  $effect(() => {
    const m = session.messages[session.messages.length - 1];
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
   * Follow new content only when the reader was already at the bottom before
   * the DOM grew - yanking the view while someone reads back through the
   * history is worse than not following. Away from the bottom, a new line
   * from her raises a small pill instead, and tapping it jumps down.
   */
  let nearBottom = true;
  let seenCount = 0;
  let unseen = $state(false);

  function onTranscriptScroll() {
    const el = transcript;
    if (!el) return;
    nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) unseen = false;
  }

  $effect(() => {
    const count = session.messages.length;
    void session.thinking;
    void revealChars;
    const el = transcript;
    if (!el) return;
    // Judged from where the reader was before this growth, not after.
    const fromHer = count > seenCount && session.messages[count - 1]?.role === 'elohim';
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

  // Which composition is on screen. The same query the stylesheet uses, so the
  // two can never disagree about whether this is a sheet.
  $effect(() => {
    const query = window.matchMedia(SHEET_QUERY);
    const sync = () => {
      compact = query.matches;
      if (!compact) sheet = 'peek';
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  });

  /**
   * Publish the sheet's real height so anything anchored above it — the
   * clinical disclaimer — can sit on top of it without knowing whether it is
   * peeking, expanded, or riding an open keyboard.
   */
  $effect(() => {
    const el = chat;
    if (!el) return;
    const publish = () => {
      const height = Math.round(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--sheet-h', `${height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--sheet-h');
    };
  });

  function autosize() {
    if (!composer) return;
    composer.style.height = 'auto';
    // The ceiling lives in the stylesheet, where it differs between a pointer
    // and a thumb. Read it rather than keeping a second copy of it here.
    const ceiling = Number.parseFloat(getComputedStyle(composer).maxHeight);
    composer.style.height = `${Math.min(composer.scrollHeight, ceiling || 110)}px`;
  }

  function scrollToEnd() {
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }

  /**
   * Opening the keyboard shrinks the visual viewport under the sheet. The
   * layout is already sized against it, but the transcript has to be nudged
   * back to the bottom once the animation settles or the newest message ends up
   * scrolled out of the shorter box.
   */
  function onComposerFocus() {
    // Focusing the composer is the start of a turn, same as the first key.
    notifyTyping();
    queueMicrotask(scrollToEnd);
    setTimeout(scrollToEnd, 320);
  }

  async function submit() {
    if (!canSend) return;
    const text = draft;
    draft = '';
    autosize();
    await sendMessage(text);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && sheet === 'full') sheet = 'peek';
  }

  // --- the grip ------------------------------------------------------------

  let dragPointer: number | null = null;
  let dragStartY = 0;
  let dragStartHeight = 0;
  let dragTravel = 0;

  function onGripDown(event: PointerEvent) {
    if (!compact || !transcript) return;
    dragPointer = event.pointerId;
    dragStartY = event.clientY;
    dragStartHeight = transcript.offsetHeight;
    dragTravel = 0;
    dragging = true;
    // Capture so the drag survives the thumb sliding off the 44px grip band.
    if (event.currentTarget instanceof Element) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function onGripMove(event: PointerEvent) {
    if (!dragging || event.pointerId !== dragPointer) return;
    const dy = event.clientY - dragStartY;
    dragTravel = Math.max(dragTravel, Math.abs(dy));
    // Bounds rather than snap points: the sheet follows the thumb, and where it
    // lands is decided on release.
    const ceiling = Math.round(window.innerHeight * 0.62);
    dragHeight = Math.min(ceiling, Math.max(48, dragStartHeight - dy));
  }

  function onGripUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    dragPointer = null;
    dragHeight = null;
    const dy = event.clientY - dragStartY;
    if (dragTravel < 6) {
      sheet = sheet === 'full' ? 'peek' : 'full';
    } else if (dy < -32) {
      sheet = 'full';
    } else if (dy > 32) {
      sheet = 'peek';
    }
  }

  function onGripClick(event: MouseEvent) {
    // A pointer tap has already been resolved on pointerup. Only keyboard
    // activation reaches here with no click count behind it.
    if (event.detail !== 0) return;
    sheet = sheet === 'full' ? 'peek' : 'full';
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div
  class="chat"
  bind:this={chat}
  data-sheet={sheet}
  data-dragging={dragging ? 'true' : null}
>
  <button
    class="sheet-grip"
    type="button"
    aria-expanded={sheet === 'full'}
    aria-controls="elohim-transcript"
    aria-label={sheet === 'full' ? 'Collapse the conversation' : 'Expand the conversation'}
    onpointerdown={onGripDown}
    onpointermove={onGripMove}
    onpointerup={onGripUp}
    onpointercancel={onGripUp}
    onclick={onGripClick}
  ></button>

  <div
    class="transcript"
    id="elohim-transcript"
    bind:this={transcript}
    role="log"
    aria-label="Conversation with Elohim"
    style:height={dragHeight === null ? null : `${dragHeight}px`}
    onscroll={onTranscriptScroll}
  >
    {#each session.messages as message (message.id)}
      {#if message.role === 'elohim' && message.id === revealId && revealChars < message.content.length}
        <!-- Still being said: the words land at her pace, a tap reads the rest. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="bubble bubble--elohim" onclick={revealAll}>
          {message.content.slice(0, revealChars)}
        </div>
      {:else}
        <div class="bubble bubble--{message.role === 'elohim' ? 'elohim' : 'user'}">
          {message.content}
        </div>
      {/if}
    {/each}

    {#if session.thinking}
      <div class="typing" role="status" aria-label="Elohim is thinking"></div>
    {/if}
  </div>

  {#if unseen}
    <button class="new-pill" type="button" onclick={jumpToNew}>New from Elohim</button>
  {/if}

  {#if session.pendingOffer?.type === 'offer_scan'}
    <div class="offer">
      <span>Want me to take a proper look?</span>
      <button onclick={() => startScanFlow()}>Start scan</button>
    </div>
  {/if}

  {#if session.chatError}
    <div class="error" role="alert">{session.chatError}</div>
  {/if}

  <div class="composer" class:composer--listening={session.listening}>
    <textarea
      bind:this={composer}
      value={shown}
      oninput={onInput}
      onkeydown={onKeydown}
      onfocus={onComposerFocus}
      rows="1"
      readonly={session.listening}
      placeholder={session.listening ? 'Listening…' : 'Talk to Elohim…'}
      aria-label="Message Elohim"
    ></textarea>

    {#if session.canListen}
      <button
        class="mic"
        class:mic--on={session.listening}
        onclick={() => toggleListening()}
        aria-label={session.listening ? 'Stop listening' : 'Speak to Elohim'}
        aria-pressed={session.listening}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <rect x="9" y="2" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
        </svg>
      </button>
    {/if}

    <button class="send" onclick={submit} disabled={!canSend} aria-label="Send message">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M5 12h13M12 5l7 7-7 7" />
      </svg>
    </button>
  </div>

  {#if session.speaking}
    <button class="speaking-stop" onclick={() => stopSpeaking()}>
      <span class="speaking-stop__wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      Tap to stop her
    </button>
  {/if}
</div>
