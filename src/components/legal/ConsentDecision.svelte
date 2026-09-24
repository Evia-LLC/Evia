<script lang="ts">
  /**
   * The decision under a consent document.
   *
   * Native radios with nothing chosen at the start, so the choice has to be
   * made (never pre-ticked), then a separate button for each outcome that
   * only works once its own radio is chosen - accept and decline are equally
   * prominent. An optional consent also offers "skip". A placeholder record
   * cannot be submitted at all: the whole fieldset is disabled and says so.
   */
  import type { LegalContentRecord } from '../../../shared/legal-content.ts';
  import Button from '@/ui/Button.svelte';
  type Decision = 'accepted' | 'declined' | 'skipped';
  let { content, onDecision }: { content: LegalContentRecord; onDecision: (decision: Decision, wordingVersionId: string) => void | Promise<void> } = $props();
  let selected = $state<'accepted' | 'declined' | null>(null);
  let busy = $state(false);
  let error = $state('');
  const placeholderBlocked = $derived(content.status === 'placeholder');
  async function submit(decision: Decision) {
    if (placeholderBlocked || (decision !== 'skipped' && selected !== decision)) return;
    busy = true; error = '';
    try { await onDecision(decision, content.wordingVersionId); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'The decision could not be saved.'; }
    finally { busy = false; }
  }
</script>

<fieldset class="decision" disabled={busy || placeholderBlocked}>
  <legend>Make your decision</legend>
  <div class="decision__choices">
    <label class="choice"><input type="radio" name={`decision-${content.id}`} value="accepted" bind:group={selected} /> <span>{content.acceptLabel ?? 'Accept'}</span></label>
    <label class="choice"><input type="radio" name={`decision-${content.id}`} value="declined" bind:group={selected} /> <span>{content.declineLabel ?? 'Decline'}</span></label>
  </div>
  <div class="actions">
    <Button variant="secondary" disabled={busy || placeholderBlocked || selected !== 'accepted'} onclick={() => submit('accepted')}>{content.acceptLabel ?? 'Accept'}</Button>
    <Button variant="secondary" disabled={busy || placeholderBlocked || selected !== 'declined'} onclick={() => submit('declined')}>{content.declineLabel ?? 'Decline'}</Button>
    {#if content.applicability.requirement === 'optional'}
      <Button variant="ghost" disabled={busy || placeholderBlocked} onclick={() => submit('skipped')}>{content.skipLabel ?? 'Skip for now'}</Button>
    {/if}
  </div>
  {#if placeholderBlocked}<p class="msg msg--hold" role="alert">This placeholder cannot be submitted as consent.</p>{/if}
  {#if error}<p class="msg msg--error" role="alert">{error}</p>{/if}
</fieldset>

<style>
  .decision {
    display: grid;
    gap: 16px;
    min-width: 0;
    margin: 0;
    padding: 24px 28px 26px;
    border: 1px solid var(--card-rim);
    border-radius: var(--r-lg);
    background: var(--surface-card);
    box-shadow: var(--shadow-sm);
  }
  legend {
    float: left;
    width: 100%;
    margin: 0 0 4px;
    padding: 0;
    font-size: var(--fs-title-sm);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .decision__choices {
    display: grid;
    gap: 8px;
    clear: both;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 0 16px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--cream-0);
    color: var(--text-strong);
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    cursor: pointer;
  }
  .choice:has(input:checked) {
    border-color: var(--chip-selected-border);
    background: var(--rose-100);
  }
  .choice input {
    flex: none;
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--accent-strong);
  }
  .choice input:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .decision:disabled .choice {
    cursor: not-allowed;
    color: var(--text-secondary);
    background: var(--surface-sunken);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .msg {
    margin: 0;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
  }
  .msg--hold {
    color: var(--amber-900);
  }
  .msg--error {
    color: var(--text-danger);
  }
  @media (max-width: 819px) {
    .decision {
      padding: 20px 18px 22px;
    }
  }
</style>
