<!--
  The cookie choice (main, Section 5, 7d776c7; LEGAL_PROMISE_TRACKER P-12):
  the Consent Wording Pack's section 9 first layer, verbatim, with "Accept
  all", "Reject all" and "Manage preferences" equally prominent; the second
  layer's categories (necessary on, everything optional off by default, GPC
  honoured, marketing unavailable) with their providers and durations, and
  Save. Until a valid choice exists it opens by itself; afterwards the
  "Cookie settings" control reopens it from any screen: in the app's own
  navigation (the sidebar's foot, the phone's More sheet), in the gate's and
  the legal pages' footers, and as a small floating pill only where there is
  no such place (the consult room; on the phone's scan flow it is reopened
  from anywhere else). Logic unchanged.

  Restyled into the design system: the panel is the gate's rose-brown glass
  (cream ink, 12px floor, 44px targets) rising from the bottom; the settings
  control is a small glass pill in the bottom-left corner, lifted above the
  phone tab bar where there is one.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { COOKIE_COPY } from '@shared/legal-screen-copy.ts';
  import { recordLegalReview } from '@/lib/legal-review.ts';
  import { reviewAccountId } from '@/lib/review-account.ts';
  import { DEFAULT_COOKIES, globalPrivacyControl, readCookies, saveCookies, openCookieSettings } from '@/lib/cookie-preferences.ts';
  import Button from '@/ui/Button.svelte';
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
      await recordLegalReview('cookie-preferences', choice, reviewAccountId(),
        { preferences: { ...result.record.preferences } });
      if (result.persisted) visible = false;
      else message = 'Your choice applies in this tab. Browser storage is unavailable; it will be requested again on your next visit.';
    } catch { message = 'Your browser preferences were applied, but account review logging failed. You can retry Save or close this panel.'; }
    finally { busy = false; }
  }
</script>

<footer class="cookie-footer"><button type="button" onclick={openCookieSettings}>Cookie settings</button></footer>
{#if visible}
  <section class="cookie-panel on-dark" aria-label="Cookie preferences">
    <p class="cookie-panel__body">{COOKIE_COPY.body}</p>
    <div class="actions">
      <Button variant="secondary" tone="dark" full disabled={busy} onclick={() => save('accepted')}>Accept all</Button>
      <Button variant="secondary" tone="dark" full disabled={busy} onclick={() => save('declined')}>Reject all</Button>
      <Button variant="secondary" tone="dark" full disabled={busy} onclick={() => { manage = true; }}>Manage preferences</Button>
    </div>
    {#if manage}
      <div class="manage">
        <p class="note">Only necessary storage is active by default. No analytics or marketing provider is configured; accepting these categories does not activate tracking. Google Fonts requests have been removed.</p>
        <label class="cat"><input type="checkbox" checked disabled /><span>Strictly necessary — Evia: sign-in cookie (browser session); this preference record (12 months).</span></label>
        <label class="cat"><input type="checkbox" bind:checked={functional} disabled={busy} /><span>Functional — Evia: room-sound and introduction preferences, until browser data is cleared or consent expires/withdraws (at most 12 months).</span></label>
        <label class="cat"><input type="checkbox" bind:checked={analytics} disabled={busy || gpc} /><span>Analytics — no provider configured; no cookies placed.</span></label>
        <label class="cat"><input type="checkbox" disabled /><span>Marketing — unavailable in this demo; no provider, cookies or marketing audiences.</span></label>
        {#if gpc}<p class="note">Global Privacy Control is enabled. Analytics and marketing remain off.</p>{/if}
        {#if savedAt}<p class="note">Last choice: {savedAt}</p>{/if}
        <div class="actions actions--end"><Button tone="dark" disabled={busy} onclick={() => save('saved')}>Save</Button></div>
      </div>
    {/if}
    {#if message}<p class="status" role="status">{message}</p>{/if}
    {#if readCookies()}<div class="actions actions--end"><Button variant="ghost" tone="dark" disabled={busy} onclick={() => { visible = false; }}>Close</Button></div>{/if}
  </section>
{/if}

<style>
  /* The way back to the choice: a small glass pill, bottom-left. */
  .cookie-footer {
    position: fixed;
    left: max(10px, env(safe-area-inset-left, 0px));
    bottom: max(10px, env(safe-area-inset-bottom, 0px));
    z-index: calc(var(--z-badge) - 1);
  }
  .cookie-footer button {
    position: relative;
    min-height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--sample-bg);
    box-shadow:
      inset 0 0 0 1px var(--sample-rim),
      var(--shadow-md);
    color: var(--sample-ink);
    font-family: var(--font-sans);
    font-size: var(--fs-meta);
    font-weight: var(--fw-medium);
    cursor: pointer;
    opacity: 0.86;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  /* A 44px target around the 32px pill. */
  .cookie-footer button::before {
    content: '';
    position: absolute;
    inset: -6px;
  }
  .cookie-footer button:hover,
  .cookie-footer button:focus-visible {
    opacity: 1;
  }
  .cookie-footer button:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: 2px;
  }
  /* The app's framed pages carry the control in their navigation (the
     sidebar's foot, the phone's More sheet), where it covers nothing. */
  :global(body:has(.evia-shell[data-frame='framed'])) .cookie-footer {
    display: none;
  }
  /*
   * The consult room (/scan) fills every corner with the reading, so the pill
   * goes where that composition leaves room: the desk stage's lower right
   * (its disclosure and her words stand on the lower-left floor), the tablet
   * composition's top right, beside the Back control's row. The phone's
   * sequential scan has no free corner - its sheet and Back/Sample controls
   * take them - so there the choice is reopened from Settings, Privacy or any
   * other screen.
   */
  :global(body:has(.scan[data-layout='desk'])) .cookie-footer {
    left: auto;
    right: max(10px, env(safe-area-inset-right, 0px));
  }
  :global(body:has(.scan[data-layout='tablet'])) .cookie-footer {
    left: auto;
    right: max(12px, env(safe-area-inset-right, 0px));
    top: calc(var(--safe-t, env(safe-area-inset-top, 0px)) + 16px);
    bottom: auto;
  }
  :global(body:has(.scan[data-layout='phone'])) .cookie-footer {
    display: none;
  }
  /* The sign-in gate and the legal pages carry the control in their own
     footers (AuthGate, LegalShell), so it does not float over their text. */
  :global(body:has(.ev-gate, .ev-legal)) .cookie-footer {
    display: none;
  }

  .cookie-panel {
    position: fixed;
    z-index: calc(var(--z-badge) + 2);
    left: 50%;
    bottom: max(16px, env(safe-area-inset-bottom, 0px));
    box-sizing: border-box;
    display: grid;
    gap: 16px;
    width: min(46rem, calc(100vw - 32px));
    max-height: min(85dvh, calc(100dvh - 32px));
    padding: 22px 24px 20px;
    overflow: auto;
    transform: translateX(-50%);
    border-radius: var(--r-2xl);
    background: linear-gradient(135deg, var(--glass-dark-sheen) 0%, transparent 55%), var(--glass-dark-strong);
    box-shadow:
      inset 0 0 0 1px var(--glass-dark-rim),
      var(--shadow-lg);
    -webkit-backdrop-filter: blur(22px) saturate(1.1);
    backdrop-filter: blur(22px) saturate(1.1);
    color: var(--text-on-dark);
    font-family: var(--font-sans);
    font-size: var(--fs-body);
    line-height: var(--lh-normal);
  }
  p {
    margin: 0;
  }
  .cookie-panel__body {
    max-width: 40em;
    color: var(--text-on-dark-strong);
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .actions--end {
    display: flex;
    justify-content: flex-end;
  }
  @media (max-width: 559px) {
    .actions:not(.actions--end) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .manage {
    display: grid;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid var(--glass-dark-rim);
  }
  .note,
  .status {
    font-size: var(--fs-body-sm);
    color: var(--text-on-dark-muted);
  }
  .status {
    padding: 10px 14px;
    border-radius: var(--r-md);
    background: var(--tint-press-dark);
    color: var(--text-on-dark-strong);
  }
  .cat {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: rgba(31, 17, 12, 0.3);
    box-shadow: inset 0 0 0 1px var(--glass-dark-rim);
    color: var(--text-on-dark-strong);
    font-size: var(--fs-body-sm);
    cursor: pointer;
  }
  .cat:has(input:disabled) {
    cursor: default;
  }
  .cat input {
    flex: none;
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--rose-gold-300);
  }
  .cat input:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: var(--focus-offset);
  }
  @media (max-width: 559px) {
    .cookie-panel {
      padding: 18px 16px 16px;
    }
  }
</style>
