<script lang="ts">
  /**
   * The introduction, played over the room.
   *
   * A timeline of beats (see `lib/intro.ts`). When she has a voice the voice
   * sets the pace: each beat holds until she has finished its line. Without
   * one, the beat's own duration does. Either way it is skippable at any
   * moment, with a key or a tap, and it marks itself seen when it ends.
   *
   * The room stays visible behind it - she is standing there while she talks
   * - so the layer is a grade over the canvas, not a black card.
   */
  import { onDestroy, onMount } from 'svelte';
  import { INTRO_BEATS, markIntroSeen, markIntroSkipped } from '@/lib/intro.ts';
  import { session } from '@/state/session.svelte.ts';
  import { introDirective } from '@/state/controller.ts';
  import { voice } from '@/voice/controller.ts';
  import * as sound from '@/lib/sound.ts';
  import { stillness } from '@/lib/motion.ts';

  interface Props {
    onDone: () => void;
  }
  let { onDone }: Props = $props();

  let index = $state(0);
  let leaving = $state(false);
  let cancelled = false;
  /** True once the timeline reached its own end, as opposed to being skipped. */
  let ranToEnd = false;
  const beat = $derived(INTRO_BEATS[Math.min(index, INTRO_BEATS.length - 1)]);
  const total = INTRO_BEATS.length;

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function play() {
    session.introPlaying = true;
    /*
     * All five narrations are asked for up front, so the silence between
     * beats is her breathing rather than network jitter. Capped short and
     * never fatal: a slow server loses the head start, not the intro, and
     * the fetches it started keep filling the cache while beat one plays.
     */
    await Promise.race([voice.preload(INTRO_BEATS.map((b) => b.narration)).catch(() => {}), wait(1400)]);
    for (let i = 0; i < INTRO_BEATS.length; i++) {
      if (cancelled) return;
      index = i;
      const b = INTRO_BEATS[i];
      if (i > 0) sound.cue();
      // The beat is performed, not just captioned - she moves with the line.
      if (b.directive) introDirective(b.directive);
      const canNarrate = session.canSpeak && session.user?.preferences.voiceEnabled;
      if (canNarrate) {
        // Her voice paces it; a beat never ends mid-sentence.
        await Promise.all([voice.speakAndWait(b.narration), wait(Math.min(b.seconds, 2.2) * 1000)]);
      } else {
        await wait((stillness() ? Math.max(1.6, b.seconds * 0.7) : b.seconds) * 1000);
      }
      // The breath after the line. Part of the delivery, so it survives
      // reduced motion in shortened form rather than disappearing.
      const hold = b.holdAfter ?? 0;
      if (hold > 0 && !cancelled) await wait((stillness() ? hold * 0.35 : hold) * 1000);
    }
    ranToEnd = true;
    finish();
  }

  function finish() {
    if (leaving) return;
    leaving = true;
    cancelled = true;
    // Cut short before she said who she is: her greeting introduces her instead.
    if (!ranToEnd && index < total - 1) markIntroSkipped();
    voice.stopSpeaking();
    markIntroSeen();
    session.introPlaying = false;
    // Let the dissolve run before the layer is removed.
    setTimeout(onDone, stillness() ? 0 : 640);
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') finish();
  }

  onMount(() => {
    void play();
  });
  onDestroy(() => {
    cancelled = true;
    session.introPlaying = false;
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="intro" class:intro--leaving={leaving} role="dialog" aria-label="Introduction" aria-live="polite">
  <div class="intro__grade" aria-hidden="true"></div>

  <div class="intro__stage">
    {#key index}
      <div class="intro__beat">
        <h1 class="intro__title" class:intro__title--mark={index === 0}>
          {#if index === 0}
            Elohim
          {:else}
            {beat.title}
          {/if}
        </h1>
        {#if beat.sub}
          <p class="intro__sub">{beat.sub}</p>
        {/if}
        {#if beat.list}
          <p class="intro__list" aria-label="What she reads">
            {#each beat.list as item (item)}<span>{item}</span>{/each}
          </p>
        {/if}
      </div>
    {/key}
  </div>

  <div class="intro__foot">
    <ol class="intro__dots" aria-label="Progress">
      {#each INTRO_BEATS as _, i (i)}
        <li class="intro__dot" data-state={i < index ? 'done' : i === index ? 'now' : null}></li>
      {/each}
    </ol>
    <button class="cta cta--quiet intro__skip" type="button" onclick={finish}>
      {index >= total - 1 ? 'Begin' : 'Skip'}
    </button>
  </div>
</div>

<style>
  .intro {
    position: fixed;
    inset: 0;
    z-index: var(--z-intro);
    display: grid;
    grid-template-rows: 1fr auto;
    color: var(--ink);
    animation: intro-in var(--dur-3) var(--ease) both;
  }
  .intro--leaving {
    animation: intro-out var(--dur-3) var(--ease) both;
    pointer-events: none;
  }
  @keyframes intro-in {
    from {
      opacity: 0;
    }
  }
  @keyframes intro-out {
    to {
      opacity: 0;
    }
  }

  /* A grade, not a curtain: the room and her stay readable through it. */
  .intro__grade {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        120% 80% at 50% 100%,
        rgba(var(--ground-rgb), 0.92),
        rgba(var(--ground-rgb), 0.55) 55%,
        rgba(var(--ground-rgb), 0.3)
      ),
      linear-gradient(
        to bottom,
        rgba(var(--ground-rgb), 0.35),
        rgba(var(--ground-rgb), 0.15) 40%,
        rgba(var(--ground-rgb), 0.7)
      );
  }

  .intro__stage {
    position: relative;
    display: grid;
    place-items: end start;
    padding: 0 max(28px, 8vw) 10vh;
  }
  @media (min-width: 900px) {
    .intro__stage {
      place-items: center start;
      padding-bottom: 0;
    }
  }

  /* The beat arrives as one piece: no stagger on the title, sub or list. */
  .intro__beat {
    max-width: 30ch;
    animation: beat-in var(--dur-3) var(--ease) both;
  }
  @keyframes beat-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .intro__title {
    margin: 0;
    font-family: var(--display);
    font-weight: var(--w-light);
    font-size: clamp(34px, 6.2vw, 64px);
    line-height: var(--lh-tight);
    letter-spacing: var(--trk-display);
    color: var(--ink);
    text-shadow: var(--halo);
  }
  /* The one wordmark: lowercase italic 'Elohim'. */
  .intro__title--mark {
    font-family: var(--font-serif);
    font-style: italic;
    font-weight: var(--w-regular);
    font-size: clamp(64px, 12vw, 132px);
    letter-spacing: 0.01em;
  }

  .intro__sub {
    margin: var(--s-4) 0 0;
    max-width: var(--measure);
    font-size: var(--t-lg);
    line-height: var(--lh-body);
    color: var(--ink-soft);
  }

  .intro__list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) var(--s-5);
    margin: var(--s-5) 0 0;
    font-size: var(--t-md);
    letter-spacing: 0;
    text-transform: none;
    color: var(--quiet);
  }

  .intro__foot {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 max(28px, 8vw) max(24px, var(--safe-b, 0px));
  }
  .intro__dots {
    display: flex;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .intro__dot {
    width: 22px;
    height: 1px;
    background: var(--line-strong);
    transition:
      background var(--dur-2) ease,
      width var(--dur-2) var(--ease);
  }
  .intro__dot[data-state='done'] {
    background: var(--ink-soft);
  }
  .intro__dot[data-state='now'] {
    width: 44px;
    background: var(--metal);
  }
  /* A quiet text action; the global .cta--quiet rule carries the rest. */
  .intro__skip {
    color: var(--ink-soft);
  }

  @media (prefers-reduced-motion: reduce) {
    .intro,
    .intro__beat {
      animation-duration: 0.01s;
      animation-delay: 0s;
    }
  }
  :global(.shell[data-reduced-motion='true']) .intro,
  :global(.shell[data-reduced-motion='true']) .intro__beat {
    animation-duration: 0.01s;
    animation-delay: 0s;
  }
</style>
