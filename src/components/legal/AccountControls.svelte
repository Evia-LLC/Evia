<script lang="ts">
  import { onMount } from 'svelte';
  import { ACCOUNT_COPY, PHOTO_COPY } from '@shared/legal-screen-copy.ts';
  import { LEGAL_CONTENT, approvedConsent } from '@shared/legal-content.ts';
  import { CONSENT_KEYS } from '@shared/consent-keys.ts';
  import { ageOnDate } from '@shared/age-flow.ts';
  import type { ConsentDecision } from '@shared/types.ts';
  import { session } from '@/state/session.svelte.ts';
  import { api } from '@/lib/api.ts';
  import { recordFacialChoice } from '@/lib/facial-consent.ts';
  import { recordLegalReview, guestLegalReviews } from '@/lib/legal-review.ts';
  import { openCookieSettings } from '@/lib/cookie-preferences.ts';
  import { cancelScanFlow, discardPendingCapture } from '@/state/controller.ts';
  let message = $state(''); let busy = $state(false); let photoReview = $state(false);
  let history = $state<ConsentDecision[]>([]);
  const accountId = $derived(session.guest ? undefined : session.user?.id);
  const age = $derived(session.user?.dateOfBirth ? ageOnDate(session.user.dateOfBirth) : null);
  async function loadHistory() {
    if (!accountId) return;
    history = (await api.consentHistory()).decisions;
  }
  onMount(() => { void loadHistory().catch(() => { message = 'Policy history could not be loaded.'; }); });
  async function act(task: () => Promise<void>) {
    if (busy) return;
    busy = true; message = '';
    try { await task(); await loadHistory(); }
    catch (error) { message = error instanceof Error ? error.message : 'The action could not be completed.'; }
    finally { busy = false; }
  }
  async function withdraw() {
    await recordFacialChoice('declined', accountId);
    cancelScanFlow(); discardPendingCapture();
    if (accountId && session.user) session.user.consents = (await api.consents()).consents;
    message = 'Scan consent withdrawn. The current capture is stopped and the Perfect Corp proxy will refuse further uploads. Stored history has not been deleted; use the deletion controls below. Other scan APIs still need production enforcement.';
  }
  async function photoChoice(event: Event) {
    const selected = (event.currentTarget as HTMLInputElement).checked;
    await act(async () => {
      await recordLegalReview('progress-photo-consent', selected ? 'accepted' : 'declined', accountId);
      if (!selected && accountId && approvedConsent(session.user?.consents[CONSENT_KEYS.PROGRESS_PHOTOS])) {
        await api.recordConsentDecision(CONSENT_KEYS.PROGRESS_PHOTOS, LEGAL_CONTENT['progress-photo-consent'].wordingVersionId, 'withdrawn');
        if (session.user) session.user.consents = (await api.consents()).consents;
      }
      photoReview = selected;
      message = 'Sample photo preference recorded. New photo storage remains unavailable pending approved wording. Existing photos can be deleted individually below.';
    });
    (event.target as HTMLInputElement).checked = photoReview;
  }
  async function removePhoto(id: string) {
    await api.deleteProgressPhoto(id);
    session.progressPhotos = session.progressPhotos.filter(photo => photo.id !== id);
    message = 'Photo deleted.';
    try { await recordLegalReview('account-controls', 'attempted', accountId, { action: 'delete_photo', targetId: id }); }
    catch { message = 'Photo deleted, but the additional review event could not be recorded.'; }
  }
</script>
<section class="sec">
  <h2>Account controls</h2>
  <p>Sample-data demo. Review choices do not constitute approved legal consent. Full policies remain unpublished.</p>
  <h3>{ACCOUNT_COPY.withdraw}</h3>
  <p>Withdrawal stops the current capture and revokes uploads through the Perfect Corp consent gate. Automatic deletion of stored results, account-wide scan blocking, provider deletion and backup handling remain production gaps.</p>
  <button class="btn" disabled={busy} onclick={() => act(withdraw)}>Withdraw scan consent</button>
  <p><a href="/progress">Review and delete past scans and photos</a> · <a href="/settings/data">Delete account and stored data</a></p>

  <h3>{ACCOUNT_COPY.photos}</h3>
  <p>Sample preference, initially off. Storage is blocked until the wording is approved; this toggle does not save a capture.</p>
  <label><input type="checkbox" checked={photoReview} disabled={busy} onchange={photoChoice} />{PHOTO_COPY.checkbox}</label>
  <p><a href="/legal/progress-photo-consent">Read the full progress-photo consent</a></p>
  {#each session.progressPhotos as photo}
    <div class="photo-row"><span>Photo {photo.id}</span><button class="btn" disabled={busy || !accountId} onclick={() => act(() => removePhoto(photo.id))}>Delete this photo</button></div>
  {:else}<p>No saved progress photos.</p>{/each}

  <h3>{ACCOUNT_COPY.download}</h3><a href="/settings/data">Download my data</a>
  <h3>{ACCOUNT_COPY.delete}</h3><a href="/settings/data">Review account deletion and confirm</a>
  <p>The current delete operation removes active account records and attempts to shred stored images. The guide requires consent/destruction records for duration of consent +5 years and backup rotation within 35 days. This demo does not yet implement that retention exception or processor/backup propagation; it must be completed before production.</p>

  <h3>{ACCOUNT_COPY.marketing}</h3>
  <label><input type="checkbox" disabled /> Marketing messages</label>
  <p>Off for everyone in this demo. No marketing audience or delivery system is enabled, and under-18 accounts must never receive marketing.</p>
  <button class="btn" disabled={busy} onclick={() => act(async () => { await recordLegalReview('account-controls', 'declined', accountId, { action: 'marketing' }); message = 'Marketing remains off.'; })}>Keep marketing off</button>
  <h3>{ACCOUNT_COPY.cookies}</h3><button class="btn" onclick={openCookieSettings}>Manage cookie preferences</button>

  <h3>{ACCOUNT_COPY.history}</h3>
  <button class="btn" disabled={busy} onclick={() => act(async () => { await recordLegalReview('account-controls', 'viewed', accountId, { action: 'policy_history' }); })}>Refresh policy history</button>
  <p>Entries show actual recorded choices and wording versions. Demo review entries are not approved policy acceptance.</p>
  {#each history as item (item.id)}
    <article class="history"><p>{item.consentType}: {String(item.metadata?.choice ?? item.state)}</p><p>{item.wordingVersionId} · {item.recordedAt}</p>
      {#if item.metadata?.documentVersions}<pre>{JSON.stringify(item.metadata.documentVersions, null, 2)}</pre>{/if}
    </article>
  {:else}<p>No account policy history available.</p>{/each}
  {#if !accountId}<details><summary>Temporary guest review evidence</summary><pre>{JSON.stringify(guestLegalReviews, null, 2)}</pre></details>{/if}

  {#if age !== null && age < 18}<h3>{ACCOUNT_COPY.guardian}</h3><p>Required under-18 notice preview. Guardian verification and actual access are not implemented; this is not a claim that a guardian has been approved.</p>{/if}
  <a href="/legal/age-assurance">Guardian access and Step 9 controls preview</a>
  <nav aria-label="Separate consent reviews"><a href="/legal/health-consent">Consumer health consent</a> · <a href="/legal/safety-lifestyle-consent">Optional safety and lifestyle consent</a> · <a href="/legal/subscription">Subscription preview</a></nav>
  {#if message}<p role="status">{message}</p>{/if}
</section>
<style>
  h3{margin:1.5rem 0 .6rem}label{display:flex;align-items:flex-start;gap:.7rem}a{color:inherit;text-decoration:underline}
  .history{border-bottom:1px solid var(--line);padding:.5rem 0;overflow-wrap:anywhere}pre{white-space:pre-wrap}.photo-row{display:flex;gap:1rem;align-items:center;margin:.5rem 0}nav{margin-top:1.5rem}
</style>
