<script lang="ts">
  import type { DeleteResult } from '@shared/delete-result.ts';
  import { ACCOUNT_COPY } from '@shared/legal-screen-copy.ts';
  import { recordLegalReview } from '@/lib/legal-review.ts';
  import Page from '@/components/Page.svelte';
  import { session } from '@/state/session.svelte.ts';
  import { deleteAccount, downloadDataExport } from '@/state/controller.ts';
  import {
    ACCOUNT_DELETION_NOTICE_PLACEHOLDER,
    DATA_EXPORT_NOTICE_PLACEHOLDER,
  } from '@/legal/content.ts';

  let typed = $state('');
  let secondConfirmation = $state(false);
  let deleting = $state(false);
  let deletionError = $state<string | null>(null);
  /**
   * P1-T10 — the durable outcome of the last deletion attempt. `completed`
   * renders the signed-out success receipt, `pending` the status screen with
   * the session and export intact, and a failure lands in `deletionError`
   * with the account untouched.
   */
  let deletionOutcome = $state<DeleteResult | null>(null);
  const completedReceipt = $derived(
    deletionOutcome !== null && deletionOutcome.status === 'completed' ? deletionOutcome : null,
  );
  const pendingReceipt = $derived(
    deletionOutcome !== null && deletionOutcome.status === 'pending' ? deletionOutcome : null,
  );
  const phrase = 'DELETE';
  const typedCorrectly = $derived(typed.trim() === phrase);

  async function exportData() {
    try { await recordLegalReview('account-controls', 'attempted', session.guest ? undefined : session.user?.id, { action: 'export' }); }
    catch { deletionError = 'The review event could not be recorded. Export is still available.'; }
    await downloadDataExport();
  }

  function continueDeletion() {
    if (!typedCorrectly || deleting) return;
    secondConfirmation = true;
  }

  async function removeAccount() {
    if (!typedCorrectly || !secondConfirmation || deleting) return;
    deleting = true;
    deletionError = null;
    try {
      // Audit availability must not prevent the existing account deletion right.
      try { await recordLegalReview('account-controls', 'attempted', session.user?.id, { action: 'delete_account' }); } catch { /* Account deletion still proceeds; retention gap is disclosed below. */ }
      deletionOutcome = await deleteAccount();
      // `completed`: the controller cleared the token and session; the
      // receipt branch below states what was deleted. `pending`: the session
      // is preserved and the status branch below keeps the export available.
    } catch (err) {
      deletionError = err instanceof Error ? err.message : 'Your account could not be deleted.';
      deleting = false;
      secondConfirmation = false;
      return;
    }
    deleting = false;
  }
</script>

<Page
  eyebrow="Settings · Your data"
  title="Your data, in your hands."
  lede="Download a structured copy of what is attached to your account, or permanently delete the account."
>
  <section class="sec" aria-labelledby="export-title">
    <div class="sec__head"><h2 class="sec__title" id="export-title">{ACCOUNT_COPY.download}</h2></div>
    <div class="card">
      <p class="card__text">{DATA_EXPORT_NOTICE_PLACEHOLDER.text}</p>
      {#if import.meta.env.DEV && DATA_EXPORT_NOTICE_PLACEHOLDER.placeholder}
        <p class="placeholder">Placeholder legal text · {DATA_EXPORT_NOTICE_PLACEHOLDER.id}</p>
      {/if}
      <div class="actions">
        <button class="btn" type="button" onclick={exportData} disabled={session.guest || session.dataExport.status === 'exporting'}>
          {session.dataExport.status === 'exporting' ? 'Preparing export…' : 'Download JSON export'}
        </button>
        <div aria-live="polite">
          {#if session.dataExport.status === 'complete'}
            <span class="tag tag--good">Downloaded {session.dataExport.filename}</span>
          {:else if session.dataExport.status === 'error'}
            <span class="error">{session.dataExport.error}</span>
          {/if}
        </div>
      </div>
    </div>
  </section>

  <section class="sec" aria-labelledby="delete-title">
    <div class="sec__head"><h2 class="sec__title" id="delete-title">{ACCOUNT_COPY.delete}</h2></div>
    <div class="card card--warm">
      <p class="card__text">{ACCOUNT_DELETION_NOTICE_PLACEHOLDER.text}</p>
      <p>Retention gap: the guide requires consent/destruction records for duration of consent +5 years and backup rotation within 35 days. The current demo deletes account-linked consent records; a legal retention exception and provider/backup deletion are not implemented.</p>
      {#if import.meta.env.DEV && ACCOUNT_DELETION_NOTICE_PLACEHOLDER.placeholder}
        <p class="placeholder">Placeholder legal text · {ACCOUNT_DELETION_NOTICE_PLACEHOLDER.id}</p>
      {/if}

      {#if completedReceipt}
        <div class="receipt" role="status">
          <strong>Your account is deleted.</strong>
          <p>{completedReceipt.message}</p>
          <p>Permanently removed: your profile, preferences, {completedReceipt.blobsShredded} stored photo file{completedReceipt.blobsShredded === 1 ? '' : 's'}, scans, progress photos, routine, memories, consent history and sessions. You are signed out.</p>
        </div>
      {:else if pendingReceipt}
        <div class="receipt receipt--pending" role="status">
          <strong>Deletion is pending.</strong>
          <p>{pendingReceipt.message}</p>
          <ul>
            {#each pendingReceipt.outstanding as job (job)}
              <li>{job}</li>
            {/each}
          </ul>
          <p>Your data is not yet fully erased. You stay signed in, and your export above remains available.</p>
        </div>
      {:else}
        <label class="confirm-field">
          <span>Type <strong>{phrase}</strong> to continue</span>
          <input bind:value={typed} autocomplete="off" disabled={deleting || secondConfirmation} aria-label="Type DELETE to confirm account deletion" />
        </label>

        {#if secondConfirmation}
          <div class="second-confirm" role="alert">
            <strong>Final confirmation</strong>
            <p>This cannot be undone. Delete the account and all attached data now?</p>
            <div class="actions">
              <button class="btn btn--danger" type="button" onclick={removeAccount} disabled={deleting || !typedCorrectly}>
                {deleting ? 'Deleting account…' : 'Permanently delete my account'}
              </button>
              <button class="btn" type="button" onclick={() => (secondConfirmation = false)} disabled={deleting}>Go back</button>
            </div>
          </div>
        {:else}
          <button class="btn btn--danger" type="button" onclick={continueDeletion} disabled={!typedCorrectly || deleting || session.guest}>Continue</button>
        {/if}
        {#if deletionError}
          <p class="error" aria-live="assertive">{deletionError}</p>
          <p class="intact">Your account and data are intact — nothing was deleted. Your export above is still available, and you can retry once the problem passes.</p>
        {/if}
      {/if}
    </div>
  </section>
</Page>

<style>
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); margin-top: var(--s-4); }
  .placeholder { color: var(--warm); font: 600 var(--t-sm)/1.4 var(--font); text-transform: uppercase; letter-spacing: .08em; }
  .confirm-field { display: grid; gap: var(--s-2); margin: var(--s-5) 0 var(--s-4); }
  .confirm-field input { max-width: 22rem; padding: var(--s-3); border: 1px solid var(--line); border-radius: 4px; background: var(--surface); color: var(--ink); font: inherit; }
  .second-confirm { margin-top: var(--s-4); }
  .second-confirm p { margin: var(--s-2) 0 0; }
  .error { color: var(--danger, #a43b32); }
  .receipt { margin-top: var(--s-4); padding: var(--s-4); border: 1px solid var(--line); border-radius: 4px; background: var(--surface); }
  .receipt strong { display: block; margin-bottom: var(--s-2); }
  .receipt ul { margin: var(--s-2) 0; padding-left: var(--s-5); }
  .receipt--pending { border-style: dashed; }
  .intact { color: var(--quiet); }
</style>
