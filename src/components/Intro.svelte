<script lang="ts">
  /**
   * The introduction, played over the room.
   *
   * A timeline of beats (see `lib/intro.ts`). When Evia has a voice the voice
   * sets the pace: each beat holds until the line is finished. Without one,
   * the beat's own duration does. Either way it is skippable at any moment -
   * Escape, Enter or Space, or the Skip button - and it marks itself seen
   * when it ends.
   *
   * Captions only: no character is drawn (BUILD-PLAN decision 3). The room
   * stays visible behind it, so the layer is a warm grade over the lounge,
   * heaviest where the caption sits, not a black card. The caption block sits
   * low on the left, where Home's greeting lives; the first beat shows the
   * wordmark rather than a title. The beats still send their stage
   * directions, which the director keeps for when a character returns.
   *
   * It is a modal while it plays: focus starts on Skip (Enter and Space on it
   * finish, as they do anywhere), and everything else in the app root is
   * inert until it has gone, so Tab cannot wander into the page underneath.
   * When it ends, focus goes to the page's main landmark rather than being
   * dropped on the body.
   */
  import { onDestroy, onMount } from 'svelte';
  import { INTRO_BEATS, markIntroSeen, markIntroSkipped } from '@/lib/intro.ts';
  import { session } from '@/state/session.svelte.ts';
  import { introDirective } from '@/state/controller.ts';
  import { voice } from '@/voice/controller.ts';
  import * as sound from '@/lib/sound.ts';
  import { stillness } from '@/lib/motion.ts';
  import Button from '@/ui/Button.svelte';

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
    // The page is live again from this moment; the dissolve is only a picture.
    handBack();
    // Let the dissolve run before the layer is removed.
    setTimeout(onDone, stillness() ? 0 : 640);
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') finish();
  }

  let root = $state<HTMLElement | null>(null);
  let foot = $state<HTMLElement | null>(null);
  /** The siblings this layer made inert, so it gives back exactly those. */
  let quieted: HTMLElement[] = [];

  /** Gives the page back: no longer inert, and focus on its main landmark rather than lost with Skip. */
  function handBack() {
    for (const el of quieted) el.inert = false;
    quieted = [];
    const active = document.activeElement;
    if (!active || active === document.body || root?.contains(active)) {
      document.getElementById('main')?.focus({ preventScroll: true });
    }
  }

  onMount(() => {
    const siblings = root?.parentElement ? [...root.parentElement.children] : [];
    quieted = siblings.filter((el): el is HTMLElement => el !== root && el instanceof HTMLElement && !el.inert);
    for (const el of quieted) el.inert = true;
    foot?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    void play();
  });
  onDestroy(() => {
    cancelled = true;
    session.introPlaying = false;
    handBack();
  });
</script>

<svelte:window onkeydown={onKey} />

<div
  class="intro"
  class:intro--leaving={leaving}
  role="dialog"
  aria-modal="true"
  aria-label="Introduction"
  aria-live="polite"
  bind:this={root}
>
  <div class="intro__grade" aria-hidden="true"></div>

  <div class="intro__stage">
    {#key index}
      <div class="intro__beat">
        {#if index === 0}
          <h1 class="intro__mark" aria-label="Evia"><span aria-hidden="true">evia</span></h1>
        {:else}
          <h1 class="intro__title">{beat.title}</h1>
        {/if}
        {#if beat.sub}
          <p class="intro__sub">{beat.sub}</p>
        {/if}
        {#if beat.list}
          <ul class="intro__list" aria-label="What the scan reads">
            {#each beat.list as item (item)}<li>{item}</li>{/each}
          </ul>
        {/if}
      </div>
    {/key}
  </div>

  <div class="intro__foot" bind:this={foot}>
    <ol class="intro__steps" aria-label="Introduction progress, {Math.min(index + 1, total)} of {total}">
      {#each INTRO_BEATS as _, i (i)}
        <li class="intro__step" data-state={i < index ? 'done' : i === index ? 'now' : null}></li>
      {/each}
    </ol>
    <Button variant={index >= total - 1 ? 'primary' : 'secondary'} tone="dark" onclick={finish}>
      {index >= total - 1 ? 'Begin' : 'Skip'}
    </Button>
  </div>
</div>

<style>
  .intro {
    position: fixed;
    inset: 0;
    z-index: var(--z-intro);
    display: grid;
    grid-template-rows: 1fr auto;
    font-family: var(--font-sans);
    color: var(--text-on-dark);
    animation: intro-in var(--dur-slow) var(--ease-out) both;
  }
  .intro--leaving {
    animation: intro-out var(--dur-slow) var(--ease-out) both;
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

  /* A grade, not a curtain: the lounge stays readable through it, and the
     caption corner is dark enough for cream text at 4.5:1 over any plate. */
  .intro__grade {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(120% 90% at 0% 100%, rgba(31, 17, 12, 0.92) 0%, rgba(31, 17, 12, 0.78) 38%, rgba(31, 17, 12, 0.35) 75%),
      linear-gradient(180deg, rgba(31, 17, 12, 0.3) 0%, rgba(31, 17, 12, 0.12) 40%, rgba(31, 17, 12, 0.55) 100%);
    /* A light softening, so a page behind it (the intro can open over any
       address, not only Home) never reads through the caption as text. */
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
  }

  .intro__stage {
    position: relative;
    display: grid;
    align-items: end;
    padding: max(32px, var(--safe-t)) clamp(24px, 8vw, 128px) 48px;
  }

  /* The beat arrives as one piece: no stagger on the title, sub or list. */
  .intro__beat {
    max-width: 34rem;
    animation: beat-in var(--dur-slow) var(--ease-out) both;
  }
  @keyframes beat-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  .intro__mark {
    margin: 0;
    font-family: var(--font-serif);
    font-size: clamp(76px, 11vw, 136px);
    font-weight: 380;
    line-height: 0.95;
    letter-spacing: -0.03em;
    color: var(--logo-ink);
    text-shadow: 0 2px 24px rgba(31, 17, 12, 0.5);
  }
  .intro__title {
    margin: 0;
    font-family: var(--font-serif);
    font-size: clamp(38px, 5.2vw, 64px);
    font-weight: var(--fw-regular);
    line-height: var(--lh-tight);
    letter-spacing: var(--tr-display);
    color: var(--text-on-dark-strong);
    text-shadow: 0 2px 20px rgba(31, 17, 12, 0.5);
  }
  .intro__sub {
    margin: 18px 0 0;
    max-width: 44ch;
    font-size: clamp(17px, 1.4vw, 20px);
    line-height: var(--lh-normal);
    color: var(--text-on-dark);
    text-shadow: var(--text-lift);
  }
  .intro__list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 22px 0 0;
    padding: 0;
    list-style: none;
  }
  .intro__list li {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 0 14px;
    border-radius: var(--r-pill);
    background: var(--glass-dark);
    box-shadow: inset 0 0 0 1px var(--glass-dark-rim);
    color: var(--text-on-dark-strong);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
  }

  .intro__foot {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 clamp(24px, 8vw, 128px) max(28px, var(--safe-b));
  }
  .intro__steps {
    display: flex;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .intro__step {
    width: 28px;
    height: 4px;
    border-radius: 2px;
    background: var(--border-on-dark-strong);
    transition:
      background-color var(--dur-base) var(--ease-out),
      width var(--dur-base) var(--ease-out);
  }
  .intro__step[data-state='done'] {
    background: var(--text-on-dark-strong);
  }
  .intro__step[data-state='now'] {
    width: 52px;
    background: linear-gradient(90deg, var(--navpill-from), var(--cta-to));
  }

  @media (max-width: 819px) {
    .intro__stage {
      padding: max(24px, var(--safe-t)) 24px 32px;
    }
    .intro__foot {
      padding: 0 24px max(24px, var(--safe-b));
    }
    .intro__step {
      width: 20px;
    }
    .intro__step[data-state='now'] {
      width: 36px;
    }
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
