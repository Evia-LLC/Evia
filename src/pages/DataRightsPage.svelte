<script lang="ts">
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
      await deleteAccount();
    } catch (err) {
      deletionError = err instanceof Error ? err.message : 'Your account could not be deleted.';
      deleting = false;
      secondConfirmation = false;
    }
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
      {#if deletionError}<p class="error" aria-live="assertive">{deletionError}</p>{/if}
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
</style>
