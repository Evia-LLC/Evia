<!--
  Routine (ref1): the plan, step by step.

  >= 1200px  the mockup's composition: Home stays in the room behind, inert,
             and the Routine panel is docked on the right at 536/1536 of the
             window (never under 480px). The back chevron closes it (to /).
  < 1200px   Routine is its own full-width page on the light wash: one column
             on a phone, the card beside the list when there is room. On the
             icon-rail width the lounge still sits behind the rail's glass,
             as it does on Home.

  What is shown comes from the view model alone (src/view/routine.ts): the
  mockup's sample when sample mode is on, otherwise the real plan. The server
  is only asked for an account's own data - never for a guest's (there is no
  account to answer for) and never in sample mode (which writes and reads
  nothing).
-->
<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { untrack } from 'svelte';
  import HomePage from '@/pages/HomePage.svelte';
  import Room from '@/stage/Room.svelte';
  import { sample } from '@/sample/mode.svelte.ts';
  import { SAMPLE_ROUTINE } from '@/sample/fixtures/routine.ts';
  import { session } from '@/state/session.svelte.ts';
  import { routineView } from '@/view/routine.ts';
  import RoutinePanel from './routine/RoutinePanel.svelte';
  import { RoutineData } from './routine/routine-data.svelte.ts';

  /* The same breakpoints as the shell: sidebar at 1200, icon rail from 820. */
  const docked = new MediaQuery('min-width: 1200px', true);
  const railed = new MediaQuery('min-width: 820px', true);

  const data = new RoutineData();

  /* Load for the visit that is here now: again when the account changes,
     never in sample mode. */
  $effect(() => {
    if (sample.on) return;
    void session.user?.id;
    void session.guest;
    untrack(() => void data.load());
  });

  const view = $derived(
    routineView(sample.on, SAMPLE_ROUTINE, {
      plan: data.account ? data.plan : session.plan,
      status: !data.account || data.planStatus === 'ready' ? 'ready' : data.planStatus === 'error' ? 'error' : 'loading',
      picks: session.picks,
      profile: session.user?.profile ?? null,
      guest: session.guest,
    }),
  );
</script>

<div class="rt-root">
{#if docked.current}
  <!-- Home, as the room behind the panel: seen, not used. -->
  <div class="rt-behind" inert aria-hidden="true">
    <HomePage underPanel />
  </div>
{:else if railed.current}
  <Room room="lounge" layout="viewport" blurred />
{/if}

<div class="rt-page" class:is-docked={docked.current}>
  <div class="rt-scroll">
    <RoutinePanel {view} data={sample.on ? null : data} docked={docked.current} onretry={() => void data.loadPlan()} />
  </div>
</div>
</div>

<style>
  /* Static, so Home's room and the docked panel both place themselves against
     the shell's content area; it only carries the panel width to both. */
  .rt-root {
    --rt-panel-w: max(480px, calc(100vw * 536 / 1536));
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }
  .rt-behind {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    right: var(--rt-panel-w);
    overflow: hidden;
  }

  .rt-page {
    position: relative;
    flex: 1;
    background: var(--surface-page-flat) var(--surface-page);
  }
  .rt-scroll {
    container: routine / inline-size;
    max-width: 760px;
    margin: 0 auto;
    padding-top: var(--sample-space, 0px);
  }

  /* Docked beside Home: a fixed column with its own scroll, and the thin light
     seam the mockup draws between the two screens. */
  .rt-page.is-docked {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: var(--rt-panel-w);
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: linear-gradient(180deg, #f5dad8 0%, #f2dcd8 55%, #eed8d4 100%);
    box-shadow: -5px 0 0 rgba(254, 250, 248, 0.96);
    /* Above anything Home layers inside its own box. */
    z-index: calc(var(--z-page) + 1);
    animation: rt-dock var(--dur-slow) var(--ease-out);
  }
  .rt-page.is-docked .rt-scroll {
    max-width: none;
    padding-top: 0;
  }
  /* Wide but not docked (the icon rail): room for the card beside the list. */
  @media (min-width: 820px) and (max-width: 1199px) {
    .rt-scroll {
      max-width: 1080px;
      /* Keeps the room the Sample data badge needs above the title. */
      padding: calc(8px + var(--sample-space, 0px)) 24px 0;
    }
  }

  @keyframes rt-dock {
    from {
      opacity: 0;
      transform: translateX(24px);
    }
  }
</style>
