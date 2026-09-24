<script lang="ts">
  import { onMount } from 'svelte';
  import { COOKIE_COPY } from '@shared/legal-screen-copy.ts';
  import { session } from '@/state/session.svelte.ts';
  import { recordLegalReview } from '@/lib/legal-review.ts';
  import { DEFAULT_COOKIES, globalPrivacyControl, readCookies, saveCookies, openCookieSettings } from '@/lib/cookie-preferences.ts';
  let visible = $state(false); let manage = $state(false); let busy = $state(false);
  let functional = $state(false); let analytics = $state(false); let message = $state('');
  let gpc = $state(false); let savedAt = $state('');
  function open() {
    const saved = readCookies();
    functional = saved?.preferences.functional ?? false; analytics = !globalPrivacyControl() && (saved?.preferences.analytics ?? false);
    savedAt = saved?.recordedAt ?? ''; gpc = globalPrivacyControl(); visible = true; manage = true; message = '';
  }
  onMount(() => {
    visible = !readCookies(); gpc = globalPrivacyControl();
    window.addEventListener('evia-cookie-settings', open);
    return () => window.removeEventListener('evia-cookie-settings', open);
  });
  async function save(choice: 'accepted' | 'declined' | 'saved') {
    if (busy) return;
    busy = true; message = '';
    const preferences = choice === 'accepted' ? { ...DEFAULT_COOKIES, functional: true, analytics: true }
      : choice === 'declined' ? DEFAULT_COOKIES : { ...DEFAULT_COOKIES, functional, analytics };
    const result = saveCookies(preferences);
    functional = result.record.preferences.functional; analytics = result.record.preferences.analytics;
    savedAt = result.record.recordedAt;
    try {
      await recordLegalReview('cookie-preferences', choice, session.guest ? undefined : session.user?.id,
        { preferences: { ...result.record.preferences } });
      if (result.persisted) visible = false;
      else message = 'Your choice applies in this tab. Browser storage is unavailable; it will be requested again on your next visit.';
    } catch { message = 'Your browser preferences were applied, but account review logging failed. You can retry Save or close this panel.'; }
    finally { busy = false; }
  }
</script>
<footer class="cookie-footer"><button onclick={openCookieSettings}>cookie settings</button></footer>
{#if visible}
  <section class="cookie-panel" aria-label="Cookie preferences">
    <p>{COOKIE_COPY.body}</p>
    <div class="actions">
      <button disabled={busy} onclick={() => save('accepted')}>Accept all</button>
      <button disabled={busy} onclick={() => save('declined')}>Reject all</button>
      <button disabled={busy} onclick={() => { manage = true; }}>Manage preferences</button>
    </div>
    {#if manage}
      <p>Only necessary storage is active by default. No analytics or marketing provider is configured; accepting these categories does not activate tracking. Google Fonts requests have been removed.</p>
      <label><input type="checkbox" checked disabled /> Strictly necessary — Evia: sign-in cookie (browser session); this preference record (12 months).</label>
      <label><input type="checkbox" bind:checked={functional} disabled={busy} /> Functional — Evia: room-sound and introduction preferences, until browser data is cleared or consent expires/withdraws (at most 12 months).</label>
      <label><input type="checkbox" bind:checked={analytics} disabled={busy || gpc} /> Analytics — no provider configured; no cookies placed.</label>
      <label><input type="checkbox" disabled /> Marketing — unavailable in this demo; no provider, cookies or marketing audiences.</label>
      {#if gpc}<p>Global Privacy Control is enabled. Analytics and marketing remain off.</p>{/if}
      {#if savedAt}<p>Last choice: {savedAt}</p>{/if}
      <button disabled={busy} onclick={() => save('saved')}>Save</button>
    {/if}
    {#if message}<p role="status">{message}</p>{/if}
    {#if readCookies()}<button disabled={busy} onclick={() => { visible = false; }}>Close</button>{/if}
  </section>
{/if}
<style>
  .cookie-footer{position:fixed;bottom:.3rem;right:.5rem;z-index:90}.cookie-footer button{background:#151515;color:#fff;font-size:.75rem;padding:.4rem}
  .cookie-panel{position:fixed;z-index:3000;bottom:1rem;left:50%;transform:translateX(-50%);width:min(46rem,94vw);max-height:85dvh;overflow:auto;background:#181615;color:#fff;border:1px solid #aaa;border-radius:12px;padding:1.25rem;box-shadow:0 8px 50px #0009}
  .actions{display:flex;flex-wrap:wrap;gap:.75rem}.actions button{flex:1;min-width:8rem}button{min-height:44px;padding:.6rem 1rem;border:1px solid currentColor;border-radius:6px}label{display:flex;gap:.7rem;margin:1rem 0;align-items:flex-start}
</style>
