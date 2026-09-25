<!--
  Home (ref1, left panel): the lounge, a greeting, and the way into the
  conversation.

  The room plate fills the whole window behind everything, the sidebar glass
  included (home/HomeRoom.svelte); the armchair in it stays empty (no
  character, BUILD-PLAN decision 3). Over it: the time-of-day greeting and
  the name in the display serif, "How's your skin feeling today?", the Talk to
  Evia button (which opens the chat drawer), the AI disclosure, the bell and
  the profile pill top right, the tip card bottom left and the tagline.

  Everything shown comes from `homeView()` (src/view/home.ts): the mockup's
  own text in sample mode, the account's own name and nothing invented in real
  mode.

  >= 820px  the mockup's layout: greeting column beside the sidebar or rail,
            tip card and tagline at the foot, the room's right side (chair,
            niche, sign) in view.
  < 820px   a top bar (wordmark, bell, avatar), then the greeting, the button
            and the tip card stacked, over the plate cropped to the seating
            area. The tagline is left out there.

  `underPanel`: the Routine page draws Home behind its docked panel (ref1's
  composition). Then Home is scenery: inert and hidden from assistive
  technology, nothing takes focus, and the chat is not offered. Its room is
  clipped at its own right edge, so render it in a box that ends where the
  panel begins.
-->
<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { homeView } from '@/view/home.ts';
  import { chat, hasUnseen, openChat, setChatHome } from '@/chat/drawer.svelte.ts';
  import Button from '@/ui/Button.svelte';
  import NotificationBell from '@/shell/NotificationBell.svelte';
  import ProfilePill from '@/shell/ProfilePill.svelte';
  import AiDisclosure from '@/shell/AiDisclosure.svelte';
  import Logo from '@/shell/Logo.svelte';
  import HomeRoom from './home/HomeRoom.svelte';
  import TipCard from './home/TipCard.svelte';

  interface Props {
    /** Drawn behind the Routine page's docked panel: scenery only. */
    underPanel?: boolean;
  }

  const { underPanel = false }: Props = $props();

  const compact = new MediaQuery('max-width: 819px', false);

  /* The salutation follows the clock, so a page left open crosses into the evening. */
  let now = $state(new Date());
  $effect(() => {
    const timer = window.setInterval(() => (now = new Date()), 60_000);
    return () => window.clearInterval(timer);
  });

  const view = $derived(homeView(now));
  const unseen = $derived(!underPanel && !chat.open && hasUnseen());
  const longName = $derived((view.name?.length ?? 0) > 11);

  /* The right edge of what Home shows, for the room plate behind it. */
  let root = $state<HTMLElement | null>(null);
  let right = $state(0);
  $effect(() => {
    const el = root;
    if (!el) return;
    const measure = () => {
      right = Math.round(el.getBoundingClientRect().right);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  /* The button focus returns to when the drawer's opener has gone. */
  let ctaBox = $state<HTMLElement | null>(null);
  $effect(() => {
    if (underPanel || !ctaBox) return;
    setChatHome(ctaBox.querySelector('button'));
    return () => setChatHome(null);
  });

  function talk(event: MouseEvent) {
    openChat(event.currentTarget as HTMLElement);
  }
</script>

<div
  class="home on-dark"
  class:is-under={underPanel}
  class:has-more={view.actions.look || view.actions.changed}
  bind:this={root}
  inert={underPanel}
  aria-hidden={underPanel ? 'true' : undefined}
>
  <HomeRoom {right} compact={compact.current} wall={view.wall} />

  <header class="home__top">
    <Logo variant="compact" class="home__brand" />
    <div class="home__top-tools">
      <NotificationBell tone="dark" count={view.notifications} />
      <ProfilePill tone="dark" name={view.profileName} membership={view.membership} compact={compact.current} />
    </div>
  </header>

  <section class="home__hero" aria-labelledby={underPanel ? undefined : 'home-greeting'}>
    <!-- Behind the Routine panel the page's heading is the panel's "Routine";
         the greeting is scenery there, so it is not a second h1. -->
    <svelte:element this={underPanel ? 'p' : 'h1'} class="home__greeting" id={underPanel ? undefined : 'home-greeting'}>
      {#if view.name}
        <span class="home__salute">{view.salutation}</span>
        <span class="home__name" class:is-long={longName}>{view.name}.</span>
      {:else}
        <span class="home__name">{view.salutation}</span>
      {/if}
    </svelte:element>
    <p class="home__question">
      <span>{view.question[0]}</span>
      <span>{view.question[1]}</span>
    </p>

    <div class="home__cta" bind:this={ctaBox}>
      <Button
        variant="primary"
        size="lg"
        iconStart="messages"
        iconStartSolid
        iconEnd="chevron-right"
        spread
        full
        label={unseen ? 'Talk to Evia, new message' : undefined}
        onclick={talk}
      >
        Talk to Evia
      </Button>
      {#if unseen}<span class="home__cta-dot" aria-hidden="true"></span>{/if}
    </div>

    <AiDisclosure tone="dark" class="home__ai" />

    {#if view.actions.look || view.actions.changed}
      <nav class="home__more" aria-label="More from Evia">
        {#if view.actions.look}
          <Button variant="secondary" tone="dark" size="sm" iconStart="camera" href="/scan">Take a scan</Button>
        {/if}
        {#if view.actions.changed}
          <Button variant="secondary" tone="dark" size="sm" iconStart="bar-chart" href="/progress">See what changed</Button>
        {/if}
      </nav>
    {/if}
  </section>

  <footer class="home__foot">
    <TipCard tip={view.tip} class="home__tip" />
    <p class="home__tagline">
      {#each view.tagline as part, i (part)}
        {#if i > 0}<span class="home__bar" aria-hidden="true">|</span>{/if}<span>{part}</span>
      {/each}
    </p>
  </footer>
</div>

<style>
  /*
   * Positions come from ref1's Home panel (specs/home.md sections 1-2), taken
   * relative to the content edge so they hold beside the 248px sidebar, the
   * 80px rail, or nothing: greeting 29px in from the nav and ~19% down, the
   * CTA ~46% down, the tip card 77px above the bottom, the tagline ~30px.
   */
  .home {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: 0 22px 30px 29px;
    color: var(--text-on-dark-strong);
  }

  /* ---- top bar ---- */
  .home__top {
    position: absolute;
    top: var(--topbar-top);
    right: var(--topbar-right);
    left: 29px;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    pointer-events: none;
  }
  .home__top > :global(*) {
    pointer-events: auto;
  }
  .home__top :global(.home__brand) {
    display: none;
  }
  .home__top-tools {
    display: flex;
    align-items: center;
    gap: var(--topbar-gap);
  }

  /* ---- greeting, question, CTA ---- */
  .home__hero {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: 520px;
    padding-top: clamp(104px, calc(18.6vh + 2px), 214px);
  }
  .home__greeting {
    display: grid;
    margin: 0;
    font-family: var(--font-serif);
    font-weight: var(--fw-regular);
    text-shadow: var(--text-lift);
  }
  .home__salute {
    font-size: 28px;
    line-height: 33px;
    letter-spacing: 0.02em;
    color: var(--text-on-dark-strong);
  }
  .home__name {
    margin-top: 6px;
    font-size: var(--fs-display-xl);
    line-height: 1.05;
    letter-spacing: var(--tr-display);
    color: var(--cream-0);
    overflow-wrap: anywhere;
  }
  .home__name.is-long {
    font-size: clamp(40px, 4.4vw, 54px);
  }
  .home__question {
    display: grid;
    margin: 16px 0 0;
    font-size: var(--fs-h3);
    font-weight: var(--fw-light);
    line-height: 33px;
    letter-spacing: -0.005em;
    color: var(--text-on-dark-strong);
    text-shadow: var(--text-lift);
  }
  .home__cta {
    position: relative;
    width: 312px;
    max-width: 100%;
    margin-top: clamp(28px, calc(9.4vh - 4px), 100px);
  }
  .home__cta :global(.ev-btn--lg) {
    --btn-h: 68px;
    padding-left: 33px;
    padding-right: 30px;
    gap: 26px;
  }
  .home__cta-dot {
    position: absolute;
    top: 8px;
    left: 52px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--rose-700);
    box-shadow: 0 0 0 2px var(--cta-from);
    pointer-events: none;
  }
  .home__hero :global(.home__ai) {
    margin-top: 16px;
  }
  .home__more {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 14px;
  }
  /*
   * Outline pills alone are not enough here: at tablet sizes they land on
   * the plate's lit plaster and the planter's glow (2-3:1). They take the
   * AI disclosure's dark glass backing, hover included, so the cream label
   * keeps 4.5:1 over the brightest part of the room.
   */
  .home__more :global(.ev-btn.ev-btn--secondary.ev-btn--dark) {
    background-color: var(--glass-dark);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }
  @media (hover: hover) {
    .home__more :global(.ev-btn.ev-btn--secondary.ev-btn--dark:hover:not(:disabled)) {
      background: linear-gradient(var(--tint-hover-dark), var(--tint-hover-dark)), var(--glass-dark);
    }
  }
  /* Small to look at, full-size to touch. */
  @media (max-width: 819px), (pointer: coarse) {
    .home__more :global(.ev-btn.ev-btn--sm) {
      --btn-h: 44px;
    }
  }

  /* ---- tip card and tagline ---- */
  .home__foot {
    display: flex;
    flex-direction: column;
    margin-top: auto;
    padding-top: 32px;
  }
  .home__foot :global(.home__tip) {
    width: 448px;
    max-width: 100%;
  }
  .home__tagline {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0 19px;
    margin: 26px 0 0;
    font-size: var(--fs-lead);
    line-height: 20px;
    letter-spacing: 0.01em;
    color: var(--text-on-dark-strong);
    text-shadow: var(--text-lift);
  }
  .home__bar {
    opacity: 0.9;
  }

  /* ---- short windows: tighten the vertical rhythm before anything scrolls ---- */
  /*
   * Real mode's "Take a scan" / "See what changed" row adds 50px the mockup
   * does not have (sample mode never shows it). On windows up to 900px tall
   * that space comes out of the gaps above the greeting and the button, so
   * the tagline stays in the window.
   */
  @media (min-width: 820px) and (max-height: 900px) {
    .home.has-more .home__hero {
      padding-top: max(96px, calc(18.6vh - 8px));
    }
    .home.has-more .home__cta {
      margin-top: max(24px, calc(9.4vh - 30px));
    }
  }
  @media (min-width: 820px) and (max-height: 760px) {
    .home__hero {
      padding-top: max(96px, 14vh);
    }
    .home.has-more .home__hero {
      padding-top: max(88px, 12vh);
    }
    .home__foot {
      padding-top: 24px;
    }
    .home__tagline {
      margin-top: 18px;
    }
  }

  /* ---- the phone ---- */
  @media (max-width: 819px) {
    .home {
      padding: 0 max(16px, var(--safe-r)) 16px max(16px, var(--safe-l));
    }
    .home__top {
      position: relative;
      top: auto;
      left: auto;
      right: auto;
      justify-content: space-between;
      min-height: 56px;
      padding-top: max(10px, var(--safe-t), var(--sample-space, 0px));
    }
    /* A 44px target for the wordmark link, without moving the mark. */
    .home__top :global(.home__brand) {
      display: inline-grid;
      align-content: center;
      min-width: 44px;
      min-height: 44px;
    }
    .home__top-tools {
      gap: 4px;
    }
    .home__top-tools :global(.ev-profile) {
      width: auto;
      min-height: 44px;
    }
    .home__hero {
      max-width: 560px;
      padding-top: clamp(16px, 4vh, 48px);
    }
    .home__salute {
      font-size: 22px;
      line-height: 28px;
    }
    .home__name {
      margin-top: 2px;
    }
    .home__name.is-long {
      font-size: 36px;
    }
    .home__question {
      margin-top: 10px;
      line-height: 28px;
    }
    .home__cta {
      width: 100%;
      max-width: 400px;
      margin-top: clamp(20px, 3.6vh, 40px);
    }
    .home__cta :global(.ev-btn--lg) {
      --btn-h: 60px;
      padding-left: 26px;
      padding-right: 22px;
      gap: 18px;
    }
    .home__cta-dot {
      left: 44px;
    }
    .home__foot {
      padding-top: 24px;
    }
    .home__foot :global(.home__tip) {
      width: 100%;
      max-width: 520px;
    }
    .home__tagline {
      display: none;
    }
  }
</style>
