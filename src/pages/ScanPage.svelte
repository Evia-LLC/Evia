<script lang="ts" module>
  /*
   * Which of her lines the dock has already typed out.
   *
   * Module-scoped on purpose: the page remounts on every visit, and with the
   * guard held in component state the dock re-typed the stale pre-scan line
   * each time the reading view appeared. A line is animated once, on the
   * visit where it was said; after that it renders whole.
   */
  let lastRevealedId: string | null = null;
</script>

<script lang="ts">
  /**
   * The clinic, as a page.
   *
   * Arriving here is what walks her into the clinical room (the shell asks the
   * controller on route change); leaving is what walks her out.
   *
   * Two compositions, because the page has two jobs:
   *
   *  - While the capture is open, a column on the right holds the camera and
   *    she stands on the left, where the director blocks her.
   *  - Once a reading exists the column goes away. The holograms *are* the
   *    readout — the contour of the face that was measured, the cards, the
   *    ring field — and a page that covered them with the same numbers in DOM
   *    would be a television on the wall (ARCHITECTURE §8). What stays is a
   *    caption dock at the bottom: her words, and the ways forward.
   *
   * Nothing on this page is a diagnosis, and the line saying so does not go
   * away (ARCHITECTURE §11).
   */
  import { onDestroy } from 'svelte';
  import Page from '@/components/Page.svelte';
  import ScanCapture from '@/scan/ScanCapture.svelte';
  import Picks from '@/products/Picks.svelte';
  import { session } from '@/state/session.svelte.ts';
  import { sendMessage, startScanFlow, togglePanelView } from '@/state/controller.ts';
  import { averageGoodness } from '@/holograms/presented.ts';
  import { link, router } from '@/router/router.svelte.ts';
  import { arrive, depart } from '@/lib/motion.ts';
  import { revealLine, type RevealTicker } from '@/lib/reveal.ts';

  const scan = $derived(session.latestScan);
  /**
   * One number for the whole reading.
   *
   * The same average the rig prints on an all-clear card. Higher-is-better
   * metrics count up, the rest count down, so it is a goodness, and it is
   * shown with the word rather than only the figure.
   */
  const score = $derived(scan && session.scanKind === 'face' ? Math.round(averageGoodness(scan)) : null);
  const scoreWord = $derived(
    score === null ? '' : score >= 75 ? 'Good' : score >= 55 ? 'Fair' : 'Needs care',
  );
  const R = 17;
  const C = 2 * Math.PI * R;

  /**
   * How much to trust the number next to it.
   *
   * Capture quality times how sure the face finder was, from the pipeline.
   * Shown as its own ring rather than folded into the score, because a
   * confident 60 and a doubtful 80 are different situations and the honest
   * thing is to let both be seen.
   */
  const confidence = $derived(scan ? Math.round(scan.confidence * 100) : null);
  const confidenceWord = $derived(
    confidence === null ? '' : confidence >= 75 ? 'Solid' : confidence >= 55 ? 'Fair' : 'Loose',
  );

  /** Her most recent line, which after a scan is the reading. */
  const lastWord = $derived.by(() => {
    const last = session.messages[session.messages.length - 1];
    return last?.role === 'elohim' ? last : null;
  });

  /**
   * Her words arrive as she says them.
   *
   * The same mechanism the chat uses (lib/reveal.ts): paced by her voice
   * when one will speak the line, a reading-speed timer otherwise, whole
   * under reduced motion. A line the dock already typed on an earlier visit
   * renders whole - see the module-scoped guard above.
   */
  let shownChars = $state(0);
  let ticker: RevealTicker | null = null;
  $effect(() => {
    const id = lastWord?.id;
    const text = lastWord?.content ?? '';
    if (!id) return;
    if (id === lastRevealedId) {
      shownChars = text.length;
      return;
    }
    lastRevealedId = id;
    ticker?.stop();
    shownChars = 0;
    ticker = revealLine(text, (n) => (shownChars = n));
  });
  onDestroy(() => ticker?.stop());
  const shownWords = $derived(lastWord ? lastWord.content.slice(0, shownChars) : '');
  const stillTyping = $derived(lastWord ? shownChars < lastWord.content.length : false);

  /**
   * What she would use, kept out of the dock.
   *
   * The dock is her words and the ways forward; the picks are a list, and a
   * list inside the caption squeezed her words on a phone. They open beside
   * the dock on request and stay closed otherwise.
   */
  let showPicks = $state(false);

  const capturing = $derived(session.scanActive);
  const hasReading = $derived(!capturing && scan !== null && session.sceneMode !== 'lounge');

  const title = $derived(
    capturing && session.scanProgress > 0 ? 'Hold still.' : 'Let me take a proper look.',
  );
  const lede = $derived(
    capturing
      ? 'Your face is measured here, in this browser. I get nine numbers and, unless you have said otherwise, nothing else.'
      : 'Nine readings, all from your own camera, all compared with the last time I looked.',
  );
</script>

{#if hasReading}
  <div class="reading" in:arrive={{ direction: router.direction }} out:depart>
    <div class="reading__dock">
      <div class="reading__head">
        <p class="reading__eyebrow">
          {session.panelMode === 'routine' ? 'What I would do about it' : 'What I see'}
          <span class="reading__meta">
            · {session.scanKind === 'body' ? 'body' : 'skin'}
          </span>
        </p>
        <div class="rings">
          {#if score !== null}
            <div class="score" aria-label="Skin health {score}, {scoreWord}">
              <svg viewBox="0 0 44 44" aria-hidden="true">
                <circle class="score__track" cx="22" cy="22" r={R} />
                <circle
                  class="score__arc"
                  cx="22"
                  cy="22"
                  r={R}
                  style="stroke-dasharray:{C};stroke-dashoffset:{C * (1 - score / 100)}"
                />
              </svg>
              <span class="score__n">{score}</span>
              <span class="score__t">Skin health<br /><b>{scoreWord}</b></span>
            </div>
          {/if}
          {#if confidence !== null && session.scanKind === 'face'}
            <div class="score score--confidence" aria-label="Reading confidence {confidence} percent, {confidenceWord}">
              <svg viewBox="0 0 44 44" aria-hidden="true">
                <circle class="score__track" cx="22" cy="22" r={R} />
                <circle
                  class="score__arc score__arc--confidence"
                  cx="22"
                  cy="22"
                  r={R}
                  style="stroke-dasharray:{C};stroke-dashoffset:{C * (1 - confidence / 100)}"
                />
              </svg>
              <span class="score__n">{confidence}</span>
              <span class="score__t">Confidence<br /><b>{confidenceWord}</b></span>
            </div>
          {/if}
        </div>
      </div>

      <div class="reading__words" aria-live="polite">
        {#if session.thinking}
          <span class="thinking" aria-label="Elohim is thinking">Thinking</span>
        {:else if lastWord}
          {shownWords}{#if stillTyping}<span class="caret" aria-hidden="true"></span>{/if}
        {:else}
          Tap any reading in the room and I will tell you about it.
        {/if}
      </div>

      {#if session.chatError}
        <div class="error" role="alert">{session.chatError}</div>
      {/if}

      <div class="reading__actions">
        {#if session.plan?.suggestions.length && session.scanKind === 'face'}
          <button class="cta" type="button" onclick={togglePanelView}>
            {session.panelMode === 'routine' ? 'Back to the reading' : 'What to do about it'}
          </button>
        {/if}
        <button class="cta cta--quiet" type="button" onclick={() => startScanFlow(session.scanKind)}>
          Scan again
        </button>
        <span class="reading__sep" aria-hidden="true">·</span>
        <a class="cta cta--quiet" href="/" use:link>Talk it through</a>
        <span class="reading__sep" aria-hidden="true">·</span>
        <a class="cta cta--quiet" href="/progress" use:link>Against the last one</a>
      </div>

      {#if session.picks.length && session.scanKind === 'face' && !session.thinking}
        <p class="reading__more">
          <button
            class="linkish"
            type="button"
            aria-expanded={showPicks}
            aria-controls="reading-picks"
            onclick={() => (showPicks = !showPicks)}
          >
            {showPicks ? 'Hide what I would use' : 'See what I would use'}
          </button>
        </p>
      {/if}

      {#if lastWord && !session.thinking}
        <div class="reading__again">
          <span>Say it again —</span>
          <button class="linkish" type="button" onclick={() => sendMessage('Give me the detailed version.')}>detailed</button>
          <span class="reading__sep" aria-hidden="true">·</span>
          <button class="linkish" type="button" onclick={() => sendMessage('Give me the Gen-Z version.')}>Gen-Z</button>
          <span class="reading__sep" aria-hidden="true">·</span>
          <button class="linkish" type="button" onclick={() => sendMessage('Keep it simple. What matters most?')}>simple</button>
        </div>
      {/if}

      <p class="legal reading__legal">
        Appearance analysis, not a medical diagnosis. Anything that changes fast, hurts, bleeds
        or spreads is a question for a dermatologist, not for me.
      </p>
    </div>

    {#if session.picks.length && session.scanKind === 'face' && !session.thinking}
      <div class="reading__picks" id="reading-picks" hidden={!showPicks}>
        <Picks picks={session.picks} compact />
      </div>
    {/if}
  </div>
{:else}
  <Page eyebrow="Scan" {title} {lede} wide side="right">
    {#if capturing}
      <section class="sec" aria-label="Capture">
        <ScanCapture />
      </section>
    {:else}
      <section class="sec">
        <div class="card">
          <p class="card__title">Ready when you are.</p>
          <p class="card__text">
            Even light, face in the oval, hold still. The whole thing takes a few seconds and
            the photo never leaves this device unless you have told me to keep it.
          </p>
          <div class="card__actions">
            <button class="cta" type="button" onclick={() => startScanFlow('face')}>Read my skin</button>
          </div>
        </div>
      </section>
    {/if}

    <p class="legal">
      The photo is read here, in this browser, and discarded unless you have asked me to keep
      it. Appearance analysis, not a medical diagnosis: anything that changes fast, hurts,
      bleeds or spreads is a question for a dermatologist, not for me.
    </p>
  </Page>
{/if}

<style>
  .reading__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .rings {
    display: flex;
    gap: var(--s-4);
    flex: none;
  }
  .score {
    position: relative;
    display: grid;
    grid-template-columns: 44px auto;
    align-items: center;
    gap: var(--s-2);
    flex: none;
    margin-top: -4px;
  }
  .score svg {
    width: 44px;
    height: 44px;
    transform: rotate(-90deg);
  }
  .score__track {
    fill: none;
    stroke: var(--line);
    stroke-width: 2;
  }
  .score__arc {
    fill: none;
    stroke: var(--ink-soft);
    stroke-width: 2;
    stroke-linecap: butt;
    filter: none;
    animation: score-draw var(--dur-3) var(--ease) both;
  }
  .score__arc--confidence {
    stroke: var(--metal-soft);
    filter: none;
  }
  @keyframes score-draw {
    from {
      stroke-dashoffset: 106.8;
    }
  }
  .score__n {
    position: absolute;
    left: 22px;
    top: 22px;
    transform: translate(-50%, -50%);
    font-family: var(--font);
    font-size: var(--t-md);
    font-weight: var(--w-light);
    color: var(--ink);
    font-feature-settings: var(--num);
  }
  .score__t {
    font-size: var(--t-xs);
    font-weight: var(--w-medium);
    line-height: 1.3;
    letter-spacing: var(--trk-cap);
    text-transform: uppercase;
    color: var(--quiet);
  }
  .score__t b,
  .score--confidence .score__t b {
    color: var(--ink);
    font-weight: var(--w-medium);
  }

  .reading__more {
    margin: var(--s-3) 0 0;
    font-size: var(--t-md);
  }
  .reading__again {
    margin-top: var(--s-3);
    font-size: var(--t-md);
    color: var(--quiet);
  }
  .reading__sep {
    color: var(--quiet);
  }

  /*
   * The picks, beside the dock rather than in it. Desktop: the right-hand
   * column the camera used, so nothing sits over her. Portrait: the top of the
   * page column, above the dock.
   */
  .reading__picks {
    position: absolute;
    top: max(var(--s-7), var(--safe-t));
    right: max(var(--gutter), var(--safe-r));
    width: min(360px, 30vw);
    max-height: calc(100% - max(var(--s-7), var(--safe-t)) - max(var(--gutter), var(--safe-b)) - var(--s-6));
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--line-strong) transparent;
    padding: var(--s-4) var(--s-5);
    border-radius: var(--radius);
    border: var(--hair) solid var(--line);
    background: var(--surface-strong);
    pointer-events: auto;
    animation: page-in var(--dur-3) var(--ease) both;
  }
  .reading__picks[hidden] {
    display: none;
  }
  @media (max-width: 860px), (orientation: portrait) {
    .reading__picks {
      top: max(var(--s-5), var(--safe-t));
      right: max(var(--s-3), var(--safe-r));
      left: max(var(--s-3), var(--safe-l));
      width: auto;
      max-height: 36dvh;
      padding: var(--s-3) var(--s-4);
    }
  }

  .card__actions {
    margin-top: var(--s-4);
  }

  /* A 1px champagne caret while she is mid-line, blinking in steps - a
     cursor blinks, it does not fade. */
  .caret {
    display: inline-block;
    width: 1px;
    height: 0.95em;
    margin-left: 3px;
    vertical-align: -0.15em;
    background: var(--metal);
    box-shadow: none;
    animation: caret-blink 1.06s steps(1, end) infinite;
  }
  @keyframes caret-blink {
    50% {
      opacity: 0;
    }
  }

  .thinking {
    font-family: var(--font);
    font-style: normal;
    font-size: var(--t-xs);
    font-weight: var(--w-medium);
    letter-spacing: var(--trk-cap);
    text-transform: uppercase;
    color: var(--quiet);
  }

  @media (prefers-reduced-motion: reduce) {
    .score__arc,
    .reading__picks,
    .caret {
      animation: none;
    }
  }
  :global(.shell[data-reduced-motion='true']) .score__arc,
  :global(.shell[data-reduced-motion='true']) .reading__picks,
  :global(.shell[data-reduced-motion='true']) .caret {
    animation: none;
  }
</style>
