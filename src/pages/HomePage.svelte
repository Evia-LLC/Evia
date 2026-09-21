<script lang="ts">
  /**
   * Home is the conversation. Not a dashboard with a chat in the corner — her,
   * in the room, and the thing you say to her.
   *
   * The welcome is one line from her and the two ways forward. It sits where a
   * page's hero would, so moving between pages never moves the eye.
   */
  import ChatPanel from '@/chat/ChatPanel.svelte';
  import { onMount } from 'svelte';
  import { openConversation } from '@/state/controller.ts';
  import { session } from '@/state/session.svelte.ts';
  import { link, router } from '@/router/router.svelte.ts';
  import { arrive, depart } from '@/lib/motion.ts';

  const hour = new Date().getHours();
  onMount(() => { void openConversation(); });
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

<div class="welcome" in:arrive={{ direction: router.direction }} out:depart>
  <p class="welcome__eyebrow">{today}</p>
  <h1 class="welcome__title">{greeting}{session.guest ? '.' : `, ${session.displayName}.`}</h1>
  <p class="welcome__sub">{sub}</p>
  <div class="welcome__actions">
    <a class="cta" href="/scan" use:link>Let me look</a>
    {#if session.latestScan}
      <a class="cta cta--quiet" href="/progress" use:link>What changed</a>
    {/if}
  </div>
</div>

<ChatPanel />
