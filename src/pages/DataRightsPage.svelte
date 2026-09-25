<!--
  Your data: download a structured copy of what is attached to the account,
  or permanently delete the account (SRS section 11, SET-01).

  The two flows are unchanged, only restyled into the dashboard's cards.
  Deletion takes two separate confirmations: typing DELETE, then a final
  "cannot be undone" step, and it cannot be submitted twice. The notice text
  is the centralised placeholder legal copy, marked as such in development.
  A guest has no account, so both actions are off and the page says why.
  With sample data on, a signed-in account is set aside (BUILD-PLAN 3.1):
  both actions are off too, and the note offers the way back to it.

  From main (Section 5, 7d776c7): the headings are the Consent Wording Pack's
  section 10 lines (verbatim), the deletion card discloses the retention gap,
  and export/deletion attempts are logged as review events - a logging failure
  never blocks either right.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { ACCOUNT_COPY } from '@shared/legal-screen-copy.ts';
  import { recordLegalReview } from '@/lib/legal-review.ts';
  import { session } from '@/state/session.svelte.ts';
  import { sample } from '@/sample/mode.svelte.ts';
  import { deleteAccount, downloadDataExport } from '@/state/controller.ts';
  import { ACCOUNT_DELETION_NOTICE_PLACEHOLDER, DATA_EXPORT_NOTICE_PLACEHOLDER } from '@/legal/content.ts';
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import Button from '@/ui/Button.svelte';
  import Pill from '@/ui/Pill.svelte';
  import PageFrame from './frame/PageFrame.svelte';
  import TextField from './frame/TextField.svelte';
  import SampleAccountNote from './frame/SampleAccountNote.svelte';

  let typed = $state('');
  let secondConfirmation = $state(false);
  let deleting = $state(false);
  let deletionError = $state<string | null>(null);
  const phrase = 'DELETE';
  const typedCorrectly = $derived(typed.trim() === phrase);
  /** No account to act on: a guest, or an account set aside for sample data. */
  const unavailable = $derived(session.guest || sample.on);
  // Sample data turned on mid-way: the half-finished deletion is dropped.
  $effect(() => {
    if (!unavailable) return;
    typed = '';
    secondConfirmation = false;
  });

  async function exportData() {
    try { await recordLegalReview('account-controls', 'attempted', session.guest ? undefined : session.user?.id, { action: 'export' }); }
    catch { deletionError = 'The review event could not be recorded. Export is still available.'; }
    await downloadDataExport();
  }

  /*
   * Each step removes the button that was just pressed, so focus is placed
   * rather than left to fall to the page: on "Go back" when the final step
   * opens (the safe choice, and inside the alert a screen reader announces),
   * and on "Continue" when it closes again.
   */
  let finalStep = $state<HTMLElement | null>(null);
  let continueButton = $state<HTMLButtonElement | null>(null);

  async function continueDeletion() {
    if (!typedCorrectly || deleting || unavailable) return;
    secondConfirmation = true;
    await tick();
    finalStep?.querySelector<HTMLElement>('.go-back')?.focus();
  }

  async function stepBack() {
    secondConfirmation = false;
    await tick();
    continueButton?.focus();
  }

  async function removeAccount() {
    if (!typedCorrectly || !secondConfirmation || deleting || unavailable) return;
    deleting = true;
    deletionError = null;
    try {
      // Audit availability must not prevent the existing account deletion right.
      try { await recordLegalReview('account-controls', 'attempted', session.user?.id, { action: 'delete_account' }); } catch { /* Account deletion still proceeds; retention gap is disclosed below. */ }
      await deleteAccount();
    } catch (err) {
      deletionError = err instanceof Error ? err.message : 'Your account could not be deleted.';
      deleting = false;
      await stepBack();
    }
  }
</script>

<PageFrame
  title="Your data"
  subtitle="Download a structured copy of what is attached to your account, or permanently delete the account."
  back={{ href: '/settings', label: 'Settings' }}
>
  {#if session.guest}
    <p class="guest" role="note">
      You are looking around without an account, so nothing is stored to download or delete. Both actions work once
      you sign in.
    </p>
  {:else if sample.on}
    <SampleAccountNote action="download or delete your account's data" />
  {/if}

  <div class="rights">
    <Card aria-labelledby="export-title">
      <SectionHeader id="export-title" title={ACCOUNT_COPY.download} icon="arrow-up-right" />
      <p class="text">{DATA_EXPORT_NOTICE_PLACEHOLDER.text}</p>
      {#if import.meta.env.DEV && DATA_EXPORT_NOTICE_PLACEHOLDER.placeholder}
        <p class="placeholder">Placeholder legal text · {DATA_EXPORT_NOTICE_PLACEHOLDER.id}</p>
      {/if}
      <div class="actions">
        <Button
          variant="primary"
          iconStart="arrow-up-right"
          onclick={exportData}
          disabled={unavailable || session.dataExport.status === 'exporting'}
        >
          {session.dataExport.status === 'exporting' ? 'Preparing export…' : 'Download JSON export'}
        </Button>
        <div aria-live="polite">
          {#if session.dataExport.status === 'complete'}
            <Pill tone="sage" dot>Downloaded {session.dataExport.filename}</Pill>
          {:else if session.dataExport.status === 'error'}
            <span class="error">{session.dataExport.error}</span>
          {/if}
        </div>
      </div>
    </Card>

    <Card tone="rose" aria-labelledby="delete-title">
      <SectionHeader id="delete-title" title={ACCOUNT_COPY.delete} icon="x" iconStyle="rose" />
      <p class="text">{ACCOUNT_DELETION_NOTICE_PLACEHOLDER.text}</p>
      <p class="text text--gap">Retention gap: the guide requires consent/destruction records for duration of consent +5 years and backup rotation within 35 days. The current demo deletes account-linked consent records; a legal retention exception and provider/backup deletion are not implemented.</p>
      {#if import.meta.env.DEV && ACCOUNT_DELETION_NOTICE_PLACEHOLDER.placeholder}
        <p class="placeholder">Placeholder legal text · {ACCOUNT_DELETION_NOTICE_PLACEHOLDER.id}</p>
      {/if}

      <TextField
        class="confirm"
        label="Type DELETE to continue"
        ariaLabel="Type DELETE to confirm account deletion"
        bind:value={typed}
        autocomplete="off"
        size="short"
        disabled={deleting || secondConfirmation || unavailable}
      />

      {#if secondConfirmation}
        <div class="final" role="alert" bind:this={finalStep}>
          <strong class="final__title">Final confirmation</strong>
          <p class="final__text">This cannot be undone. Delete the account and all attached data now?</p>
          <div class="actions">
            <button class="danger" type="button" onclick={removeAccount} disabled={deleting || !typedCorrectly || unavailable}>
              {deleting ? 'Deleting account…' : 'Permanently delete my account'}
            </button>
            <Button variant="secondary" class="go-back" onclick={stepBack} disabled={deleting}>Go back</Button>
          </div>
        </div>
      {:else}
        <div class="actions">
          <button
            class="danger"
            type="button"
            bind:this={continueButton}
            onclick={continueDeletion}
            disabled={!typedCorrectly || deleting || unavailable}
          >
            Continue
          </button>
        </div>
      {/if}
      {#if deletionError}<p class="error" aria-live="assertive">{deletionError}</p>{/if}
    </Card>
  </div>
</PageFrame>

<style>
  .guest {
    margin: 0;
    padding: 14px 18px;
    border-radius: var(--r-md);
    background: var(--amber-100);
    color: var(--amber-900);
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
  }

  .rights {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 1023px) {
    .rights {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .text {
    margin: 16px 0 0;
    max-width: 34em; /* about 70-75 characters in this font; see LegalDocument */
    font-size: var(--fs-body);
    line-height: var(--lh-relaxed);
    color: var(--text);
  }
  /* The retention gap is a disclosure of what the demo does not do yet: the
     same size, in the secondary ink, under the notice it qualifies. */
  .text--gap {
    margin-top: 10px;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
  }
  .placeholder {
    display: inline-block;
    margin: 12px 0 0;
    padding: 4px 10px;
    border-radius: var(--r-sm);
    background: var(--amber-100);
    color: var(--amber-900);
    font-size: var(--fs-micro);
    font-weight: var(--fw-semibold);
    letter-spacing: var(--tr-micro);
    line-height: 1.4;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 20px;
  }
  .rights :global(.confirm) {
    margin-top: 20px;
  }

  .final {
    margin-top: 20px;
    padding: 16px 18px;
    border: 1px solid var(--chip-selected-border);
    border-radius: var(--r-md);
    background: var(--cream-50);
  }
  .final__title {
    font-size: var(--fs-label);
    color: var(--text-strong);
  }
  .final__text {
    margin: 6px 0 0;
    font-size: var(--fs-body);
    color: var(--text);
  }
  .final .actions {
    margin-top: 14px;
  }

  /* The one destructive button style: solid raspberry, cream ink (7.1:1). */
  .danger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0 22px;
    border: 1px solid transparent;
    border-radius: var(--r-pill);
    background: var(--text-danger);
    color: var(--cream-0);
    font-family: var(--font-sans);
    font-size: var(--fs-label);
    font-weight: var(--fw-medium);
    cursor: pointer;
    transition:
      background-color var(--dur-base) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }
  .danger:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .danger:active:not(:disabled) {
    transform: translateY(1px);
  }
  @media (hover: hover) {
    .danger:hover:not(:disabled) {
      background: var(--rose-700);
    }
  }
  .danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    margin: 12px 0 0;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    color: var(--text-danger);
  }
</style>
