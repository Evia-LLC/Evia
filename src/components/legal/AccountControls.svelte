<!--
  Account controls (main, Section 5, 7d776c7): the Consent Wording Pack's
  section 10 controls, each under its own verbatim heading - withdraw scan
  consent, progress photos (a default-off sample preference, and per-photo
  deletion), download, delete, marketing (off for everyone), cookie
  preferences, the policy version history, and the under-18 guardian notice.
  The wording and the logic are his; nothing here claims legal approval.

  Restyled into the dashboard's cards (BUILD-PLAN decision 9): a two-column
  grid from 1024px, one column below, the shared buttons and check rows, the
  readability minimums. The one status line follows the page down so the
  result of an action is seen wherever the action was.
-->
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
  import { reviewAccountId } from '@/lib/review-account.ts';
  import { openCookieSettings } from '@/lib/cookie-preferences.ts';
  import { cancelScanFlow, discardPendingCapture } from '@/state/controller.ts';
  import { link } from '@/router/router.svelte.ts';
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import Button from '@/ui/Button.svelte';
  import Icon from '@/ui/Icon.svelte';
  let message = $state(''); let busy = $state(false); let photoReview = $state(false);
  let history = $state<ConsentDecision[]>([]);
  const accountId = $derived(reviewAccountId());
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

<section class="ac" aria-labelledby="ac-title">
  <div class="ac__intro">
    <h2 id="ac-title">Account controls</h2>
    <p class="ac__demo">
      <Icon name="info" size={16} stroke={1.8} />
      <span>Sample-data demo. Review choices do not constitute approved legal consent. Full policies remain unpublished.</span>
    </p>
  </div>

  <div class="ac__grid">
    <Card class="ac__card" aria-labelledby="ac-withdraw">
      <SectionHeader id="ac-withdraw" title={ACCOUNT_COPY.withdraw} icon="shield" level={3} />
      <p class="ac__text">Withdrawal stops the current capture and revokes uploads through the Perfect Corp consent gate. Automatic deletion of stored results, account-wide scan blocking, provider deletion and backup handling remain production gaps.</p>
      <div class="ac__actions"><Button variant="secondary" disabled={busy} onclick={() => act(withdraw)}>Withdraw scan consent</Button></div>
      <p class="ac__links"><a href="/progress" use:link>Review and delete past scans and photos</a> <span aria-hidden="true">·</span> <a href="/settings/data" use:link>Delete account and stored data</a></p>
    </Card>

    <Card class="ac__card" aria-labelledby="ac-photos">
      <SectionHeader id="ac-photos" title={ACCOUNT_COPY.photos} icon="camera" level={3} />
      <p class="ac__text">Sample preference, initially off. Storage is blocked until the wording is approved; this toggle does not save a capture.</p>
      <label class="ac__check"><input type="checkbox" checked={photoReview} disabled={busy} onchange={photoChoice} /><span>{PHOTO_COPY.checkbox}</span></label>
      <p class="ac__links"><a href="/legal/progress-photo-consent" use:link>Read the full progress-photo consent</a></p>
      <ul class="ac__photos" role="list">
        {#each session.progressPhotos as photo}
          <li class="ac__photo"><span>Photo {photo.id}</span><Button variant="secondary" size="sm" disabled={busy || !accountId} onclick={() => act(() => removePhoto(photo.id))}>Delete this photo</Button></li>
        {:else}<li class="ac__empty">No saved progress photos.</li>{/each}
      </ul>
    </Card>

    <Card class="ac__card" aria-labelledby="ac-download">
      <SectionHeader id="ac-download" title={ACCOUNT_COPY.download} icon="arrow-up-right" level={3} />
      <div class="ac__actions"><Button variant="secondary" href="/settings/data">Download my data</Button></div>
      <SectionHeader id="ac-delete" title={ACCOUNT_COPY.delete} icon="x" iconStyle="rose" level={3} class="ac__subhead" />
      <div class="ac__actions"><Button variant="secondary" href="/settings/data">Review account deletion and confirm</Button></div>
      <p class="ac__text ac__text--gap">The current delete operation removes active account records and attempts to shred stored images. The guide requires consent/destruction records for duration of consent +5 years and backup rotation within 35 days. This demo does not yet implement that retention exception or processor/backup propagation; it must be completed before production.</p>
    </Card>

    <Card class="ac__card" aria-labelledby="ac-marketing">
      <SectionHeader id="ac-marketing" title={ACCOUNT_COPY.marketing} icon="bell" level={3} />
      <label class="ac__check ac__check--off"><input type="checkbox" disabled /><span>Marketing messages</span></label>
      <p class="ac__text">Off for everyone in this demo. No marketing audience or delivery system is enabled, and under-18 accounts must never receive marketing.</p>
      <div class="ac__actions"><Button variant="secondary" disabled={busy} onclick={() => act(async () => { await recordLegalReview('account-controls', 'declined', accountId, { action: 'marketing' }); message = 'Marketing remains off.'; })}>Keep marketing off</Button></div>
      <SectionHeader id="ac-cookies" title={ACCOUNT_COPY.cookies} icon="sliders" level={3} class="ac__subhead" />
      <div class="ac__actions"><Button variant="secondary" onclick={openCookieSettings}>Manage cookie preferences</Button></div>
    </Card>

    <Card class="ac__card ac__card--wide" aria-labelledby="ac-history">
      <SectionHeader id="ac-history" title={ACCOUNT_COPY.history} icon="clipboard-list" level={3} />
      <div class="ac__actions"><Button variant="secondary" disabled={busy} onclick={() => act(async () => { await recordLegalReview('account-controls', 'viewed', accountId, { action: 'policy_history' }); })}>Refresh policy history</Button></div>
      <p class="ac__text">Entries show actual recorded choices and wording versions. Demo review entries are not approved policy acceptance.</p>
      <div class="ac__history">
        {#each history as item (item.id)}
          <article class="ac__entry"><p class="ac__entry-what">{item.consentType}: {String(item.metadata?.choice ?? item.state)}</p><p class="ac__entry-when">{item.wordingVersionId} · {item.recordedAt}</p>
            {#if item.metadata?.documentVersions}<pre>{JSON.stringify(item.metadata.documentVersions, null, 2)}</pre>{/if}
          </article>
        {:else}<p class="ac__empty">No account policy history available.</p>{/each}
      </div>
      {#if !accountId}<details class="ac__details"><summary>Temporary guest review evidence</summary><pre>{JSON.stringify(guestLegalReviews, null, 2)}</pre></details>{/if}
    </Card>

    <Card class="ac__card ac__card--wide" tone="sunken" aria-labelledby="ac-guardian">
      {#if age !== null && age < 18}<SectionHeader id="ac-guardian" title={ACCOUNT_COPY.guardian} icon="user" level={3} /><p class="ac__text">Required under-18 notice preview. Guardian verification and actual access are not implemented; this is not a claim that a guardian has been approved.</p>
      {:else}<h3 class="visually-hidden" id="ac-guardian">Guardian access and separate consent reviews</h3>{/if}
      <p class="ac__links"><a href="/legal/age-assurance" use:link>Guardian access and Step 9 controls preview</a></p>
      <nav class="ac__links" aria-label="Separate consent reviews"><a href="/legal/health-consent" use:link>Consumer health consent</a> <span aria-hidden="true">·</span> <a href="/legal/safety-lifestyle-consent" use:link>Optional safety and lifestyle consent</a> <span aria-hidden="true">·</span> <a href="/legal/subscription" use:link>Subscription preview</a></nav>
    </Card>
  </div>

  {#if message}<p class="ac__status" role="status">{message}</p>{/if}
</section>

<style>
  .ac {
    display: grid;
    gap: 16px;
  }
  .ac__intro {
    display: grid;
    gap: 10px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--fs-h3);
    font-weight: var(--fw-regular);
    line-height: 1.2;
    color: var(--text-strong);
  }
  .ac__demo {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--amber-100);
    color: var(--amber-900);
    font-size: var(--fs-body-sm);
  }
  .ac__demo :global(.icon) {
    flex: none;
    margin-top: 2px;
  }

  .ac__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 1023px) {
    .ac__grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .ac__grid :global(.ac__card) {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    align-content: start;
  }
  /* The pack's action labels are long ("Review account deletion and
     confirm"): on a phone they wrap inside the card, never past it. */
  .ac__grid :global(.ac__actions .ev-btn) {
    max-width: 100%;
    padding-block: 10px;
    white-space: normal;
    text-align: center;
  }
  .ac__grid :global(.ac__card--wide) {
    grid-column: 1 / -1;
  }
  .ac__grid :global(.ac__subhead) {
    margin-top: 8px;
    padding-top: 16px;
    border-top: 1px solid var(--divider);
  }

  .ac__text {
    margin: 0;
    max-width: 34em;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-relaxed);
    color: var(--text-secondary);
  }
  .ac__text--gap {
    color: var(--text-muted);
  }
  .ac__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .ac__links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 8px;
    margin: 0;
    color: var(--text-muted);
  }
  .ac__links a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 2px;
    color: var(--text-link);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    text-underline-offset: 3px;
  }

  .ac__check {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--cream-0);
    color: var(--text-strong);
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    cursor: pointer;
  }
  .ac__check:has(input:checked) {
    border-color: var(--chip-selected-border);
    background: var(--rose-100);
  }
  .ac__check--off {
    cursor: not-allowed;
    color: var(--text-secondary);
    background: var(--surface-sunken);
  }
  .ac__check input {
    flex: none;
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--accent-strong);
  }

  .ac__photos {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ac__photo {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    font-size: var(--fs-body-sm);
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .ac__empty {
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }

  .ac__history {
    display: grid;
  }
  .ac__entry {
    display: grid;
    gap: 2px;
    padding: 10px 0;
    border-bottom: 1px solid var(--divider);
    overflow-wrap: anywhere;
  }
  .ac__entry p {
    margin: 0;
  }
  .ac__entry-what {
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .ac__entry-when {
    font-size: var(--fs-meta);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  pre {
    margin: 6px 0 0;
    padding: 10px 12px;
    max-height: 18rem;
    overflow: auto;
    border-radius: var(--r-md);
    background: var(--surface-sunken);
    color: var(--text);
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: var(--fs-meta);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .ac__details summary {
    display: flex;
    align-items: center;
    min-height: 44px;
    color: var(--text-link);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    cursor: pointer;
  }

  /* The one status line: it rides the bottom of the view while it has news. */
  .ac__status {
    position: sticky;
    bottom: 16px;
    z-index: 2;
    margin: 0;
    padding: 12px 16px;
    border-radius: var(--r-md);
    background: var(--choc-900);
    box-shadow: var(--shadow-md);
    color: var(--cream-0);
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
  }

  .ac__check input:focus-visible,
  .ac__links a:focus-visible,
  .ac__details summary:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
</style>
