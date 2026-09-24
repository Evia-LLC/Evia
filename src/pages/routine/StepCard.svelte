<!--
  The step card (routine.md C06-C18): "Step 2 of 4", the step's name, its one
  line, its duration, the instructions, the tip on glass, and - when the step
  has a lesson - the Video / 3D View switch, full screen and the player.

  Only the sample has a lesson. Its "video" is the technique drawn in code
  (TechniqueArt) with a timeline the player runs, because there is no person
  to film and no media behind any step (BUILD-PLAN decision 3; data-map
  section 3). 3D View says plainly that no demo model exists yet, and that it
  would never be the user's own face (SRS section 6, RET-02/03).

  A real step is counted as a suggestion ("Suggestion 2 of 3"), never as a
  step in a sequence: the plan does not say what order to use them in, and
  some of its own cautions rule out using two together. It shows what the
  plan gives: the kind of step, why it is there,
  the rationale and its cautions ("Keep in mind"), with a calm picture and no
  media controls at all.
-->
<script lang="ts">
  import Icon from '@/ui/Icon.svelte';
  import IconButton from '@/ui/IconButton.svelte';
  import SegmentedTabs from '@/ui/SegmentedTabs.svelte';
  import Button from '@/ui/Button.svelte';
  import { untrack } from 'svelte';
  import { session } from '@/state/session.svelte.ts';
  import type { RoutineStepView } from '@/view/routine.ts';
  import TechniqueArt from './TechniqueArt.svelte';

  interface Props {
    step: RoutineStepView;
    index: number;
    count: number;
    /** "Step" for the sample's one-session sequence; "Suggestion" for a real plan. */
    noun?: 'Step' | 'Suggestion';
    /** Ask for the lesson to start (the list's play button). */
    playRequest?: number;
  }

  const { step, index, count, noun = 'Step', playRequest = 0 }: Props = $props();
  const uid = $props.id();

  let card: HTMLElement | undefined = $state();
  let view = $state<'video' | '3d'>('video');
  let playing = $state(false);
  let position = $state(0);

  const lesson = $derived(step.lesson);

  const reducedMotion = () =>
    session.user?.preferences.reducedMotion === true ||
    (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* A new step starts its lesson where the sample says it is, playing (as the
     mockup shows it) unless motion is reduced. */
  $effect(() => {
    const l = lesson;
    untrack(() => {
      view = 'video';
      position = l?.positionSec ?? 0;
      playing = Boolean(l) && !reducedMotion();
    });
  });

  $effect(() => {
    if (playRequest > 0 && lesson) {
      untrack(() => {
        view = 'video';
        if (position >= lesson.durationSec) position = 0;
        playing = true;
      });
    }
  });

  /* The timeline: a quarter-second tick while playing, stopping at the end. */
  $effect(() => {
    if (!playing || !lesson || view !== 'video') return;
    const total = lesson.durationSec;
    const timer = setInterval(() => {
      position = Math.min(total, position + 0.25);
      if (position >= total) playing = false;
    }, 250);
    return () => clearInterval(timer);
  });

  function toggle() {
    if (!lesson) return;
    if (!playing && position >= lesson.durationSec) position = 0;
    playing = !playing;
  }

  function seek(event: Event) {
    position = Number((event.currentTarget as HTMLInputElement).value);
  }

  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  async function fullscreen() {
    if (!card) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await card.requestFullscreen?.();
    } catch {
      // Full screen refused (an iframe, an old browser): the card stays as it is.
    }
  }

  const fraction = $derived(lesson ? Math.min(1, position / lesson.durationSec) : 0);
</script>

<section
  bind:this={card}
  class="rt-card on-dark"
  class:has-lesson={Boolean(lesson)}
  data-state={step.state}
  aria-labelledby="{uid}-title"
>
  <div class="rt-card__art">
    <TechniqueArt
      variant={lesson && view === 'video' ? 'lesson' : 'calm'}
      {playing}
      caption={lesson && view === 'video' ? lesson.caption : []}
    />
  </div>
  <div class="rt-card__scrim" aria-hidden="true"></div>

  {#if lesson && view === '3d'}
    <!-- Above the scrim, in the picture's corner under the switch, clear of
         the step's words at every card width. -->
    <div class="rt-card__three" role="status">
      <p class="rt-card__three-title">3D view is not ready yet</p>
      <p class="rt-card__three-body">
        When it is, it will be a labelled demo model showing the technique, never your own face.
      </p>
    </div>
  {/if}

  {#if lesson}
    <div class="rt-card__tools">
      <SegmentedTabs
        tone="glass"
        size="sm"
        label="Lesson view"
        value={view}
        options={[
          { id: 'video', label: 'Video' },
          { id: '3d', label: '3D View' },
        ]}
        onchange={(id) => {
          view = id === '3d' ? '3d' : 'video';
          playing = false;
        }}
      />
      <IconButton icon="expand" label="Full screen" tone="dark" size="sm" iconSize={20} onclick={fullscreen} />
    </div>
  {/if}

  <div class="rt-card__body">
    <p class="rt-card__count t-num">{noun} {index + 1} of {count}</p>
    <h3 class="rt-card__title" id="{uid}-title">{step.title}</h3>
    {#if step.description}<p class="rt-card__sub">{step.description}</p>{/if}

    {#if step.duration}
      <p class="rt-card__meta">
        <!-- lucide clock-3; moves to the shared icon set when it gains one. -->
        <svg class="rt-card__clock" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9.5" /><path d="M12 6.5V12h4.5" />
        </svg>
        <span>{step.duration}</span>
      </p>
    {/if}
    {#if step.reason || step.stepLabel}
      <p class="rt-card__meta rt-card__meta--reason">
        {#if step.stepLabel}<span class="rt-card__kind">{step.stepLabel}</span>{/if}
        {#if step.reason}<span>{step.reason}</span>{/if}
      </p>
    {/if}

    {#if step.instructions}<p class="rt-card__text">{step.instructions}</p>{/if}

    {#if step.coveredBy.length}
      <p class="rt-card__covered">
        <Icon name="circle-check" size={18} />
        <span>Already covered by {step.coveredBy.join(', ')}</span>
      </p>
    {/if}

    {#if step.tip}
      <div class="rt-card__tip">
        <Icon name="lightbulb" size={24} stroke={1.5} class="rt-card__tip-icon" />
        <div>
          <p class="rt-card__tip-title">{step.tip.title}</p>
          {#each step.tip.lines as line, i (i)}<p class="rt-card__tip-body">{line}</p>{/each}
        </div>
      </div>
    {/if}

    {#if step.hasPick}
      <div class="rt-card__more">
        <Button variant="secondary" tone="dark" size="sm" href="/products" iconEnd="chevron-right">
          See products with this
        </Button>
      </div>
    {/if}
  </div>

  {#if lesson}
    <div class="rt-card__player">
      <button
        type="button"
        class="rt-card__play"
        aria-label={playing ? 'Pause lesson' : 'Play lesson'}
        onclick={toggle}
        disabled={view !== 'video'}
      >
        <Icon name={playing ? 'pause' : 'play'} size={playing ? 16 : 15} />
      </button>
      <input
        class="rt-card__scrub"
        type="range"
        min="0"
        max={lesson.durationSec}
        step="1"
        value={position}
        style:--played="{fraction * 100}%"
        aria-label="Lesson position"
        aria-valuetext="{clock(position)} of {clock(lesson.durationSec)}"
        oninput={seek}
        disabled={view !== 'video'}
      />
      <span class="rt-card__time t-num">{clock(position)} / {clock(lesson.durationSec)}</span>
    </div>
  {/if}
</section>

<style>
  /*
   * Geometry from routine.md C06 at the 536px panel: 10px side margins (set by
   * the panel), 20px corners, a 1px light rim, content 23px in. The warm
   * left-hand scrim keeps every line of text on a dark ground whatever the
   * picture does, so the cream text holds 4.5:1 everywhere.
   */
  .rt-card {
    --card-pad-x: 23px;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 250px;
    overflow: hidden;
    border-radius: var(--r-xl);
    background: linear-gradient(90deg, #41323c 0%, #483642 60%, #4b3444 100%);
    box-shadow:
      0 0 0 1px rgba(255, 236, 232, 0.75),
      var(--shadow-md);
    color: var(--text-on-dark);
    isolation: isolate;
  }
  /* The lesson card is the mockup's 366px frame; a step with no lesson is as
     tall as what it says. */
  .rt-card.has-lesson {
    min-height: 366px;
  }
  .rt-card:fullscreen {
    border-radius: 0;
    justify-content: center;
  }

  .rt-card__art {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: -2;
    display: flex;
    justify-content: flex-end;
    width: 64%;
  }
  .rt-card__art :global(.rt-art) {
    flex: none;
  }
  .rt-card__scrim {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: linear-gradient(180deg, #6c4133 0%, #58362d 20%, #5a382d 62%, #452c23 81%, #2f1f1e 100%);
    -webkit-mask-image: linear-gradient(90deg, #000 0 42%, rgba(0, 0, 0, 0.85) 52%, transparent 66%);
    mask-image: linear-gradient(90deg, #000 0 42%, rgba(0, 0, 0, 0.85) 52%, transparent 66%);
  }
  .rt-card:not(.has-lesson) .rt-card__scrim {
    -webkit-mask-image: linear-gradient(90deg, #000 0 48%, rgba(0, 0, 0, 0.85) 60%, transparent 76%);
    mask-image: linear-gradient(90deg, #000 0 48%, rgba(0, 0, 0, 0.85) 60%, transparent 76%);
  }
  /* The player's own shade along the bottom edge (C06). */
  .rt-card.has-lesson::after {
    content: '';
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: -1;
    height: 70px;
    pointer-events: none;
    background: linear-gradient(0deg, rgba(44, 30, 30, 0.9), rgba(44, 30, 30, 0));
  }

  .rt-card__three {
    position: absolute;
    top: 60px;
    right: 14px;
    z-index: 0;
    max-width: 170px;
    padding: 14px;
    border-radius: var(--r-md);
    background: rgba(40, 24, 30, 0.72);
    box-shadow: inset 0 0 0 1px var(--glass-dark-rim);
  }
  .rt-card__three-title {
    margin: 0 0 6px;
    color: var(--text-on-dark-strong);
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
  }
  .rt-card__three-body {
    margin: 0;
    color: var(--text-on-dark);
    font-size: var(--fs-body-sm);
    line-height: 1.4;
  }

  .rt-card__tools {
    position: absolute;
    top: 13px;
    right: 14px;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .rt-card__body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 18px var(--card-pad-x) 0;
    max-width: min(64%, 340px);
  }
  .rt-card:not(.has-lesson) .rt-card__body {
    max-width: min(62%, 360px);
    padding-bottom: 22px;
  }
  .rt-card__count {
    margin: 0;
    color: #f7e1d9;
    font-size: 17px;
    line-height: 22px;
  }
  .rt-card__title {
    margin: 5px 0 0;
    color: #faf1ef;
    font-family: var(--font-sans);
    font-size: 25px;
    font-weight: var(--fw-medium);
    line-height: 30px;
    letter-spacing: var(--tr-title);
    text-wrap: balance;
  }
  .rt-card__sub {
    margin: 4px 0 0;
    color: #f5e5e5;
    font-size: 16.5px;
    line-height: 22px;
  }
  .rt-card__meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 11px;
    margin: 8px 0 0;
    color: #f1deda;
    font-size: var(--fs-body);
    line-height: 20px;
  }
  .rt-card__clock {
    flex: none;
    margin-left: 3px;
    color: #f9e5dd;
  }
  .rt-card__meta--reason {
    font-size: var(--fs-body-sm);
  }
  .rt-card__kind {
    padding: 2px 10px;
    border-radius: var(--r-pill);
    background: rgba(255, 228, 222, 0.14);
    box-shadow: inset 0 0 0 1px var(--glass-dark-rim);
    color: var(--text-on-dark-strong);
    font-size: var(--fs-meta);
    font-weight: var(--fw-semibold);
    letter-spacing: var(--tr-micro);
    text-transform: uppercase;
  }
  .rt-card__text {
    max-width: 232px;
    margin: 15px 0 0;
    color: #ebd8d6;
    font-size: var(--fs-body-sm);
    line-height: 17px;
  }
  .rt-card:not(.has-lesson) .rt-card__text {
    max-width: 34ch;
  }
  .rt-card__covered {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 12px 0 0;
    color: var(--text-on-dark-strong);
    font-size: var(--fs-body-sm);
    line-height: 1.35;
  }

  /* The tip on glass (C12): 12px corners, a rim brighter at the bottom. */
  .rt-card__tip {
    display: grid;
    grid-template-columns: 25px 1fr;
    gap: 12px;
    width: 100%;
    max-width: 304px;
    margin: 12px 0 0 -5px;
    padding: 10px 14px 10px 13px;
    border-radius: var(--r-md);
    background: rgba(255, 228, 222, 0.08);
    box-shadow: inset 0 0 0 1px rgba(255, 225, 218, 0.2);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
  }
  .rt-card__tip :global(.rt-card__tip-icon) {
    color: #f9d9d2;
  }
  .rt-card__tip-title {
    margin: 0 0 3px;
    color: #f8e7e1;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    line-height: 17px;
  }
  .rt-card__tip-body {
    margin: 0;
    color: #e6d0cd;
    font-size: var(--fs-body-sm);
    line-height: 17px;
  }
  .rt-card__tip-body + .rt-card__tip-body {
    margin-top: 4px;
  }
  .rt-card__more {
    margin-top: 14px;
  }

  /* The player (C18): a light disc, a 3px scrubber, the time. */
  .rt-card__player {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-top: auto;
    padding: 1px 19px 11px 18px;
  }
  .rt-card__play {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: linear-gradient(180deg, #fcf3f2, #f3dbda);
    color: #120807;
    cursor: pointer;
  }
  .rt-card__play::before {
    content: '';
    position: absolute;
    inset: -5px;
    border-radius: 50%;
  }
  .rt-card__play:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .rt-card__play:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: 2px;
  }

  .rt-card__scrub {
    --played: 0%;
    flex: 1;
    min-width: 0;
    height: 24px;
    margin: 0;
    background: transparent;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
  }
  /* A thumb-sized strip to grab on a touch screen; the track stays 3px. */
  @media (pointer: coarse) {
    .rt-card__scrub {
      height: 44px;
    }
  }
  .rt-card__scrub:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .rt-card__scrub::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--scrub-played) 0 var(--played), var(--scrub-rest) var(--played) 100%);
  }
  .rt-card__scrub::-moz-range-track {
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--scrub-played) 0 var(--played), var(--scrub-rest) var(--played) 100%);
  }
  .rt-card__scrub::-webkit-slider-thumb {
    width: 12px;
    height: 12px;
    margin-top: -4.5px;
    border: 0;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 30%, #faded7, #fbc3bd 70%);
    box-shadow: 0 0 4px rgba(250, 190, 180, 0.5);
    -webkit-appearance: none;
    appearance: none;
  }
  .rt-card__scrub::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: 0;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 30%, #faded7, #fbc3bd 70%);
    box-shadow: 0 0 4px rgba(250, 190, 180, 0.5);
  }
  .rt-card__scrub:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .rt-card__time {
    flex: none;
    color: #d8c4c4;
    font-size: var(--fs-meta);
  }

  /*
   * Phones, and any card narrower than the text column plus the picture:
   * the picture becomes a band across the top with the switch over it, and
   * the text runs full width below.
   */
  @container routine (max-width: 470px) {
    .rt-card {
      min-height: 0;
    }
    .rt-card__art {
      position: relative;
      inset: auto;
      z-index: 0;
      width: 100%;
      height: 196px;
      overflow: hidden;
      justify-content: center;
      align-items: flex-start;
      background: linear-gradient(90deg, #41323c, #4b3444);
    }
    /* The picture spans the band and is cropped to its middle, where the
       presses, the arrows and the caption are. */
    .rt-card__art :global(.rt-art) {
      width: 100%;
      height: auto;
      margin-top: -27%;
    }
    .rt-card__scrim {
      top: 196px;
      -webkit-mask-image: none;
      mask-image: none;
      background: linear-gradient(180deg, #58362d 0%, #452c23 70%, #2f1f1e 100%);
    }
    /* Without a lesson the picture is only mood: on a phone it gives its
       height back to the words. */
    .rt-card:not(.has-lesson) .rt-card__art {
      display: none;
    }
    .rt-card:not(.has-lesson) .rt-card__scrim {
      top: 0;
      -webkit-mask-image: none;
      mask-image: none;
    }
    .rt-card__tools {
      top: 10px;
      right: 10px;
      gap: 8px;
    }
    /* The 3D note spans the picture band under the switch. */
    .rt-card__three {
      top: 56px;
      left: 16px;
      right: 16px;
      max-width: none;
    }
    .rt-card__body,
    .rt-card:not(.has-lesson) .rt-card__body {
      max-width: none;
      padding: 16px 18px 12px;
    }
    .rt-card__text,
    .rt-card:not(.has-lesson) .rt-card__text {
      max-width: 60ch;
    }
    .rt-card__tip {
      max-width: none;
      margin-left: 0;
    }
    .rt-card__player {
      padding: 4px 16px 14px;
    }
  }
</style>
