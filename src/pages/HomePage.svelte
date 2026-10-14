<script lang="ts">
  import ChatPanel from '@/chat/ChatPanel.svelte';
  import { session } from '@/state/session.svelte.ts';
  import { link, router } from '@/router/router.svelte.ts';
  import { arrive, depart } from '@/lib/motion.ts';

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const lastScan = $derived(session.latestScan);
  const headline = $derived.by(() => {
    if (session.guest) return 'Explore what Evia can measure, right here on your device. Nothing is saved when you leave.';
    if (!lastScan) return 'A more personal understanding of your skin starts with a conversation — or your first scan.';
    const date = dateFormat.format(new Date(lastScan.capturedAt));
    return session.summary?.headline ? 'Your last reading was ' + date + '. ' + session.summary.headline : 'Your last reading was ' + date + '.';
  });
</script>

<div class="studio-home" in:arrive={{ direction: router.direction }} out:depart>
  <div class="studio-home__micro">
    <span class="studio-home__spark" aria-hidden="true">✦</span>
    <span>YOUR DAILY SKIN STUDIO</span>
    <span class="studio-home__date">{today}</span>
  </div>
  <h1>{greeting}<span class="studio-home__period">.</span>{#if !session.guest}<br /><span class="studio-home__name">{session.displayName}</span>{/if}</h1>
  <p class="studio-home__intro">{headline}</p>

  <div class="studio-home__primary">
    <a href="/scan" use:link class="studio-home__button">
      {lastScan ? 'Take another reading' : 'Explore a skin reading'}
      <span aria-hidden="true">↗</span>
    </a>
    {#if lastScan}<a href="/progress" use:link class="studio-home__text-link">View your progress →</a>{/if}
  </div>

  <div class="studio-home__explore" aria-label="Explore the studio">
    <p>MADE FOR THE WAY YOU CARE</p>
    <a href="/scan" use:link>
      <span class="studio-home__explore-index">01</span>
      <span><strong>Skin reading</strong><small>Face and body measurements, at your pace</small></span>
      <span aria-hidden="true">↗</span>
    </a>
    <a href="/progress" use:link>
      <span class="studio-home__explore-index">02</span>
      <span><strong>Your progress</strong><small>Real trends, not one-off scores</small></span>
      <span aria-hidden="true">↗</span>
    </a>
    <a href="/routine" use:link>
      <span class="studio-home__explore-index">03</span>
      <span><strong>Routine journal</strong><small>Track products and see what helps</small></span>
      <span aria-hidden="true">↗</span>
    </a>
  </div>
</div>

<ChatPanel />
