<script lang="ts">
  import type { LegalContentRecord } from '../../../shared/legal-content.ts';
  type Decision = 'accepted' | 'declined' | 'skipped';
  let { content, onDecision }: { content: LegalContentRecord; onDecision: (decision: Decision, wordingVersionId: string) => void | Promise<void> } = $props();
  let selected = $state<'accepted' | 'declined' | null>(null);
  let busy = $state(false);
  let error = $state('');
  const productionBlocked = $derived(import.meta.env.PROD && content.status === 'placeholder');
  async function submit(decision: Decision) {
    if (productionBlocked || (decision !== 'skipped' && selected !== decision)) return;
    busy = true; error = '';
    try { await onDecision(decision, content.wordingVersionId); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'The decision could not be saved.'; }
    finally { busy = false; }
  }
</script>

<fieldset disabled={busy || productionBlocked}>
  <legend>Make your decision</legend>
  <label><input type="radio" name={`decision-${content.id}`} value="accepted" bind:group={selected} /> {content.acceptLabel ?? 'Accept'}</label>
  <label><input type="radio" name={`decision-${content.id}`} value="declined" bind:group={selected} /> {content.declineLabel ?? 'Decline'}</label>
  <div class="actions">
    <button type="button" disabled={selected !== 'accepted'} onclick={() => submit('accepted')}>{content.acceptLabel ?? 'Accept'}</button>
    <button type="button" disabled={selected !== 'declined'} onclick={() => submit('declined')}>{content.declineLabel ?? 'Decline'}</button>
    {#if content.applicability.requirement === 'optional'}
      <button type="button" onclick={() => submit('skipped')}>{content.skipLabel ?? 'Skip for now'}</button>
    {/if}
  </div>
  {#if productionBlocked}<p role="alert">This placeholder cannot be submitted in production.</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</fieldset>

<style>
  fieldset { border: 1px solid rgba(255,255,255,.22); border-radius: 12px; padding: 1rem; display: grid; gap: .8rem; }
  label { min-height: 44px; display: flex; align-items: center; gap: .7rem; }
  input { width: 1.2rem; height: 1.2rem; }
  .actions { display: flex; flex-wrap: wrap; gap: .75rem; }
  button { min-height: 44px; padding: .7rem 1rem; border: 1px solid currentColor; border-radius: 999px; }
</style>
