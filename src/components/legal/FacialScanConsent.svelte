<script lang="ts">
  import { LEGAL_CONTENT, FACIAL_SCAN_COPY } from '@shared/legal-content.ts';
  import { session } from '@/state/session.svelte.ts';
  import { recordFacialChoice } from '@/lib/facial-consent.ts';
  import { link } from '@/router/router.svelte.ts';
  let { onAccepted = () => {}, onDeclined = () => {}, guardian = false }: {
    onAccepted?: () => void; onDeclined?: () => void; guardian?: boolean;
  } = $props();
  const content = LEGAL_CONTENT['facial-scan-consent'];
  let selected = $state(false);
  let busy = $state(false);
  let error = $state('');
  async function decide(choice: 'accepted' | 'declined') {
    if (busy || guardian || (choice === 'accepted' && !selected)) return;
    busy = true; error = '';
    try {
      await recordFacialChoice(choice, session.guest ? undefined : session.user?.id);
      if (choice === 'accepted') onAccepted(); else onDeclined();
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Your choice could not be saved.'; }
    finally { busy = false; }
  }
</script>
<section class="consent" aria-label={content.title}>
  <p class="demo">Sample-data demo — wording shown for review; not approved for production. Age and guardian verification are not yet enforced.</p>
  <h2>{content.title}</h2>
  <p>{content.body[0]}</p>
  <ul>{#each content.body.slice(1) as bullet}<li>{bullet}</li>{/each}</ul>
  <label><input type="checkbox" bind:checked={selected} disabled={busy || guardian} />{guardian ? FACIAL_SCAN_COPY.guardianCheckbox : FACIAL_SCAN_COPY.checkbox}</label>
  {#if guardian}<p>Guardian wording preview only. Verified guardian approval is not available yet.</p>{/if}
  <div class="actions">
    <button type="button" class="cta" disabled={!selected || busy || guardian} onclick={() => decide('accepted')}>{content.acceptLabel}</button>
    <button type="button" class="cta" disabled={busy || guardian} onclick={() => decide('declined')}>{content.declineLabel}</button>
  </div>
  <nav aria-label="Scan policies"><a href="#biometric-policy-preview">Biometric Data Policy</a> | <a href="/legal/privacy" use:link>Privacy Policy</a> | <a href="#health-policy-preview">Consumer Health Data Privacy Policy</a></nav>
  <p>{FACIAL_SCAN_COPY.footer}</p>
  <details id="biometric-policy-preview"><summary>Biometric Data Policy — preview</summary><p>Full policy publication pending. The scan notice above is the verbatim consent screen, not the complete policy.</p></details>
  <details id="health-policy-preview"><summary>Consumer Health Data Privacy Policy — preview</summary><p>Full policy publication pending. Sample data only; no real users.</p></details>
  {#if session.guest || !session.user}<p>Guest choices are recorded for this tab only. Sign in to record a choice against an account and use Perfect Corp.</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>
<style>
  .consent { padding: var(--s-4); background: var(--surface-strong); border: 1px solid var(--line); border-radius: var(--radius); max-width: 46rem; }
  p, li, label { line-height: 1.55; } li { margin-bottom: .7rem; }
  label { display: flex; gap: .75rem; align-items: flex-start; margin: 1rem 0; }
  input { margin-top: .35rem; flex-shrink: 0; }
  .actions { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; }
  .demo { border-left: 2px solid var(--metal); padding-left: .8rem; }
  nav { line-height: 1.8; } details { margin: .5rem 0; }
</style>
