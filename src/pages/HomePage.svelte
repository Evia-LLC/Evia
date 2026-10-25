<script lang="ts">
  /**
   * Home is the conversation. Not a dashboard with a chat in the corner — her,
   * in the room, and the thing you say to her.
   *
   * The welcome is one line from her and the two ways forward. It sits where a
   * page's hero would, so moving between pages never moves the eye.
   */
  import ChatPanel from '@/chat/ChatPanel.svelte';
  import CharacterControls from '@/components/CharacterControls.svelte';
  import { session } from '@/state/session.svelte.ts';
  import { link, router } from '@/router/router.svelte.ts';
  import { arrive, depart } from '@/lib/motion.ts';

  let meetingEvia = $state(false);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' });
  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  const sub = $derived.by(() => {
    if (session.guest) {
      return 'You are looking around without an account. Everything I measure is real and stays on this device; nothing is written down when you leave.';
    }
    const latest = session.latestScan;
    if (!latest) return 'I have not seen your skin yet. Ask me anything, or let me take a look when you are ready.';
    const when = dateFormat.format(new Date(latest.capturedAt));
    const headline = session.summary?.headline;
    return headline ? `Last look on ${when}. ${headline}` : `Last look on ${when}.`;
  });
</script>

<div class="welcome" class:welcome--meeting={meetingEvia} in:arrive={{ direction: router.direction }} out:depart>
  <p class="welcome__eyebrow">{today}</p>
  <h1 class="welcome__title">{meetingEvia ? 'Meet Evia.' : `${greeting}${session.guest ? '.' : `, ${session.displayName}.`}`}</h1>
  <p class="welcome__sub">{meetingEvia ? 'A voice, a glance, a little expression. Say hello.' : sub}</p>
  <div class="welcome__actions">
    <button class="cta" onclick={() => { meetingEvia = !meetingEvia; }} aria-expanded={meetingEvia}
      disabled={!meetingEvia && (session.thinking || session.speaking || session.listening || session.scanActive)}>
      {meetingEvia ? 'Back to conversation' : 'Meet Evia'}
    </button>
    {#if !meetingEvia}
      <a class="cta cta--quiet" href="/scan" use:link>Let me look</a>
      {#if session.latestScan}
        <a class="cta cta--quiet" href="/progress" use:link>What changed</a>
      {/if}
    {/if}
  </div>
</div>

<div class:chat-hidden={meetingEvia} inert={meetingEvia}><ChatPanel /></div>
{#if meetingEvia}<CharacterControls />{/if}

<style>
  .chat-hidden { visibility: hidden; }
  @media (max-width: 860px), (orientation: portrait) {
    .welcome--meeting {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: max(8px, var(--safe-t)) 16px 8px;
    }
    .welcome--meeting .welcome__eyebrow,
    .welcome--meeting .welcome__sub { display: none; }
    .welcome--meeting .welcome__title { font-size: 22px; white-space: nowrap; }
    .welcome--meeting .welcome__actions { margin-top: 0; }
    .welcome--meeting .cta { padding: 10px; font-size: 10px; min-height: 44px; }
  }
</style>
