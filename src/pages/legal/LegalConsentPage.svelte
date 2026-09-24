<script lang="ts">
  import { LEGAL_CONTENT } from '@shared/legal-content.ts';
  import { HEALTH_REGIONS, healthConsentApplies, type ReviewChoice } from '@shared/legal-review.ts';
  import { session } from '@/state/session.svelte.ts';
  import { recordLegalReview } from '@/lib/legal-review.ts';
  import { router } from '@/router/router.svelte.ts';
  import LegalDocument from '@/components/legal/LegalDocument.svelte';
  let { contentId }: { contentId: 'health-consent' | 'safety-lifestyle-consent' | 'progress-photo-consent' } = $props();
  const content = $derived(LEGAL_CONTENT[contentId]);
  let checked = $state(false);
  let jurisdiction = $state('Unknown');
  let busy = $state(false);
  let message = $state('');
  const applies = $derived(contentId !== 'health-consent' || healthConsentApplies(jurisdiction));
  async function decide(choice: ReviewChoice) {
    if (busy || (choice === 'accepted' && !checked)) return;
    busy = true; message = '';
    try {
      await recordLegalReview(contentId, choice, session.guest ? undefined : session.user?.id,
        contentId === 'health-consent' ? { jurisdiction } : {});
      checked = false;
      if (choice === 'skipped' || choice === 'declined') { router.go('/'); return; }
      message = 'Sample review choice recorded. This does not approve production processing or enable photo storage.';
    } catch (error) { message = error instanceof Error ? error.message : 'Could not record the choice.'; }
    finally { busy = false; }
  }
</script>
<main class="legal-page">
  <LegalDocument {content} />
  <div class="decision">
    <p>Sample-data review only. Full policy publication and production enforcement remain pending. Use sample information only.</p>
    {#if contentId === 'health-consent'}
      <label>Jurisdiction scenario
        <select bind:value={jurisdiction} disabled={busy} onchange={() => { checked = false; message = ''; }}>
          {#each HEALTH_REGIONS as region}<option value={region}>{region}</option>{/each}
        </select>
      </label>
      <p>WA, NV and CT require this separate choice. Unknown location is treated conservatively. This selector does not verify residence.</p>
    {/if}
    {#if applies}
      <label class="consent"><input type="checkbox" bind:checked={checked} disabled={busy} />{content.checkbox}</label>
      <div class="actions">
        <button disabled={busy || !checked} onclick={() => decide('accepted')}>{content.acceptLabel}</button>
        <button disabled={busy} onclick={() => decide('declined')}>{content.declineLabel}</button>
        {#if contentId === 'safety-lifestyle-consent'}<button disabled={busy} onclick={() => decide('skipped')}>{content.skipLabel}</button>{/if}
      </div>
    {:else}
      <p>This jurisdiction scenario does not require the WA/NV/CT consent screen.</p>
      <button disabled={busy} onclick={() => decide('skipped')}>Continue without this consent</button>
    {/if}
    {#if content.footer}<p>{content.footer}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    <a href="/privacy">Account controls</a> · <a href="/">Back to Evia</a>
  </div>
</main>
<style>
  .legal-page{position:absolute;inset:0;overflow:auto;z-index:20;background:#12100f;color:#f6f0e9}
  .decision{max-width:46rem;margin:-3rem auto 6rem;padding:0 max(1.25rem,5vw)}
  .consent{display:flex;align-items:flex-start;gap:.8rem;margin:1.2rem 0}.actions{display:flex;flex-wrap:wrap;gap:.75rem}
  button,select{min-height:44px;padding:.6rem 1rem;border:1px solid currentColor;border-radius:8px}a{color:inherit}
</style>
