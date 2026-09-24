<script lang="ts">
  import { onMount } from 'svelte';
  import { AGE_FLOW_COPY as copy, AGE_FLOW_VERSION, REGISTRATION_DOCUMENT_VERSIONS, ageOnDate, adultCardBranch, guardianReviewRecord, type FundingType } from '@shared/age-flow.ts';
  import { LEGAL_CONTENT, FACIAL_SCAN_COPY } from '@shared/legal-content.ts';
  import { session } from '@/state/session.svelte.ts';
  import CheckoutPreview from './CheckoutPreview.svelte';
  import { verifyAge } from '@/lib/age-verification.ts';
  let { initialStep = 1, initialEmail = '', initialDOB = '' }: { initialStep?: number; initialEmail?: string; initialDOB?: string } = $props();
  let step = $state(1);
  let email = $state(''); let dob = $state('');
  onMount(() => { step = initialStep; email = initialEmail; dob = initialDOB; });
  let guardianEmail = $state(''); let guardianName = $state('');
  let cardType = $state<FundingType>('credit');
  let paymentMethod = $state('subscription');
  let relationship = $state(false); let ownCard = $state(false); let linkedCard = $state(false); let illinois = $state(false);
  let terms = $state(false); let guardianTerms = $state(false); let scan = $state(false);
  let adultScan = $state(false);
  let ownTerms = $state(false); let ownScan = $state(false);
  let status = $state(''); let busy = $state(false); let blocked = $state(false);
  let evidence = $state<Record<string, unknown>[]>([]);
  let approvalRecord = $state<Record<string, unknown> | null>(null);
  const facial = LEGAL_CONTENT['facial-scan-consent'];
  const names = ['Date of birth', 'Adult checkout', 'Locked account', 'Guardian invitation', 'Guardian verification', 'Guardian consent', 'Approval record', 'Unlock notice', 'Guardian controls', 'Turning 18'];
  const guestCaseId = crypto.randomUUID();

  async function record(action: string, choice = 'preview') {
    const record = guardianReviewRecord({ accountId: session.guest ? null : session.user?.id ?? null, guardianName, guardianEmail,
      relationship, cardType, illinois, wordingVersions: REGISTRATION_DOCUMENT_VERSIONS });
    if (session.user && !session.guest) {
      const response = await fetch('/api/analysis/onboarding-choice', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, choice, wordingVersionId: AGE_FLOW_VERSION, idempotencyKey: crypto.randomUUID(),
          guardian: { name: guardianName, email: guardianEmail, relationship, cardType, illinois } }),
      });
      if (!response.ok) throw new Error('The sample review choice could not be recorded.');
      const saved = await response.json(); approvalRecord = saved.record;
      evidence = [...evidence, saved.decision];
    } else {
      approvalRecord = record;
      evidence = [...evidence, { guestCaseId, actorId: guestCaseId, actorType: 'guest_review', source: 'age-guardian-demo', accountId: null, action, choice, wordingVersionId: AGE_FLOW_VERSION,
        documentVersions: REGISTRATION_DOCUMENT_VERSIONS, recordedAt: record.timestamp, demoOnly: true, approved: false }];
    }
  }
  async function act(action: string, next: number, choice = 'preview') {
    busy = true; status = '';
    try { await record(action, choice); step = next; return true; }
    catch (error) { status = error instanceof Error ? error.message : 'Could not save the choice.'; return false; }
    finally { busy = false; }
  }
  async function checkAge() {
    busy = true; status = '';
    try {
      const result = await verifyAge({ email, dateOfBirth: dob });
      await record('age_check', 'attempted');
      if (!result.verified || result.mock) {
        step = 3;
        status = `Age check unavailable: ${result.reason}. Mock result; age is not verified. Continue with the guardian review preview. Camera remains locked in this review.`;
      }
    } catch (error) {
      status = error instanceof Error ? error.message : 'The age check could not be completed.';
    } finally { busy = false; }
  }
  function routeDOB() {
    const age = ageOnDate(dob);
    if (age === null) { status = 'Enter a valid date of birth.'; return; }
    if (age < 16) { email = ''; dob = ''; evidence = []; approvalRecord = null; blocked = true; status = copy.under16; return; }
    step = age < 18 ? 3 : 2; status = '';
  }
  async function verifyGuardian() {
    if (!relationship || !guardianName.trim()) { status = 'Enter the guardian name and make the separate relationship declaration.'; return; }
    if (cardType !== 'credit' || !ownCard || linkedCard) {
      if (!await act('guardian_verification', 5, 'declined')) return;
      status = 'Verification cannot continue: use a credit card in the guardian’s own name that is not already linked to the user.';
      return;
    }
    if (!await act('guardian_verification', 6, 'attempted')) return;
    status = 'Verification is unavailable. You are previewing the consent screen; approval and camera access remain locked.';
  }
  async function approve() {
    if (!terms || !guardianTerms || !scan) return;
    if (!await act('guardian_approve', 7, 'attempted')) return;
    status = 'Approval not recorded: guardian payment and identity verification are unavailable. Camera remains locked in this review.';
  }
</script>
<section class="flow">
  <h1>Age and guardian approval</h1>
  <p class="notice">Sample-data walkthrough — no verified age, guardian approval, email delivery or payment. This review never unlocks a camera. Use sample information only.</p>
  {#if session.guest || !session.user}<p>No minor account is created. Only email and date of birth are held for the signup case in this tab; guardian review fields are temporary. Closing this page discards them.</p>{/if}
  <nav aria-label="Preview the ten steps">
    {#each names as name, i}<button type="button" disabled={busy || blocked} aria-current={step === i + 1 ? 'step' : undefined} onclick={() => { step = i + 1; status = ''; }}>{i + 1}. {name}</button>{/each}
  </nav>
  {#if blocked}
    <p role="alert">{copy.under16}</p>
  {:else if step === 1}
    <h2>1. Sign up</h2>
    <form onsubmit={(event) => { event.preventDefault(); routeDOB(); }}>
      <label>Email<input type="email" bind:value={email} required /></label>
      <label>Date of birth<input type="date" bind:value={dob} required /></label>
      <p>{copy.eligibility}</p>
      <p>This is the routing preview. Account registration uses the email/password form.</p>
      <button class="cta" type="submit">Continue</button>
    </form>
  {:else if step === 2}
    <h2>2. Adult checkout</h2>
    <CheckoutPreview onChoice={(action, choice) => record(action, choice)} />
    <label>Sample funding type (not a Stripe result)<select bind:value={cardType}><option value="credit">Credit</option><option value="debit">Debit</option><option value="prepaid">Prepaid</option></select></label>
    {#if adultCardBranch(cardType) === 'email-age-check'}
      <p>{copy.debitNotice}</p>
      <button class="cta" disabled={busy} onclick={checkAge}>Continue with age check unavailable</button>
      <p>No age provider is selected. This branch continues to guardian review without verification.</p>
    {:else}
      <p>Credit-card adulthood and payment have not been verified. Scan consent can be reviewed; camera unlock is unavailable.</p>
      <h3>{facial.title}</h3><p>{facial.body[0]}</p><ul>{#each facial.body.slice(1) as text}<li>{text}</li>{/each}</ul>
      <label><input type="checkbox" bind:checked={adultScan} disabled={busy} onchange={(event) => { adultScan = event.currentTarget.checked; void act('adult_scan', 2, adultScan ? 'accepted' : 'declined'); }} />{FACIAL_SCAN_COPY.checkbox}</label>
      <p>{FACIAL_SCAN_COPY.footer}</p>
      <button class="cta" disabled={busy} onclick={() => act('adult_card', 3, 'attempted')}>Preview guardian branch</button>
    {/if}
  {:else if step === 3}
    <h2>{copy.guardianHeading}</h2><p>{copy.guardianBody}</p>
    <form onsubmit={(event) => { event.preventDefault(); void act('guardian_invite', 4, 'attempted'); }}>
      <label>Guardian email<input type="email" bind:value={guardianEmail} required /></label>
      <button class="cta" disabled={busy} type="submit">Preview invitation</button>
    </form>
    <p>Demo gap: no email is sent, no pending minor account is persisted, and the 14-day account-deletion job is not implemented.</p>
  {:else if step === 4}
    <h2>4. Guardian email preview — not sent</h2><p>To: {guardianEmail || '[Guardian email]'}</p>
    <h3>{copy.emailSubject}</h3><p>{copy.emailBody.replace("[User's first name]", session.user?.displayName ?? "[User's first name]")}</p>
    <button class="cta" onclick={() => { step = 5; }}>{copy.reviewButton}</button><p>{copy.emailExpiry}</p>
    <p>This preview has no live invitation token. Token expiry and email delivery remain unavailable.</p>
  {:else if step === 5}
    <h2>5. Guardian verification</h2>
    <label>{copy.guardianNameLabel}<input bind:value={guardianName} maxlength="120" /></label>
    <label><input type="checkbox" bind:checked={relationship} disabled={busy} onchange={(event) => { relationship = event.currentTarget.checked; void act('guardian_relationship', 5, relationship ? 'accepted' : 'declined'); }} />{copy.relationship}</label>
    <label>Verification payment route<select bind:value={paymentMethod}><option value="subscription">Guardian subscription as payor</option><option value="refunded">Nominal refunded verification charge</option></select></label>
    <label>Sample card funding<select bind:value={cardType}><option value="credit">Credit</option><option value="debit">Debit</option><option value="prepaid">Prepaid</option></select></label>
    <label><input type="checkbox" bind:checked={ownCard} /> Sample scenario: card is in the guardian’s own name</label>
    <label><input type="checkbox" bind:checked={linkedCard} /> Sample scenario: card fingerprint is already linked to the user</label>
    <label><input type="checkbox" bind:checked={illinois} /> Illinois scenario</label>
    {#if illinois}<p>Illinois requires an ID document check by a certified provider. No provider is configured; do not upload an ID.</p>{/if}
    {#if paymentMethod === 'subscription'}<CheckoutPreview guardian onChoice={(action, choice) => record(action, choice)} />{:else}<p>Nominal refunded verification charge unavailable. No charge or refund has occurred.</p>{/if}
    <button class="cta" disabled={busy} onclick={verifyGuardian}>Review verification requirements</button>
  {:else if step === 6}
    <h2>6. Guardian consent preview</h2>
    <p>Guardian verification has not completed; choices are review evidence only.</p>
    <label><input type="checkbox" bind:checked={terms} disabled={busy} onchange={(event) => { terms = event.currentTarget.checked; void act('registration_terms_review', 6, terms ? 'accepted' : 'declined'); }} />{copy.terms}</label>
    <label><input type="checkbox" bind:checked={guardianTerms} disabled={busy} onchange={(event) => { guardianTerms = event.currentTarget.checked; void act('guardian_terms', 6, guardianTerms ? 'accepted' : 'declined'); }} />{copy.guardianTerms}</label>
    <h3>{facial.title}</h3><p>{facial.body[0]}</p><ul>{#each facial.body.slice(1) as text}<li>{text}</li>{/each}</ul>
    <label><input type="checkbox" bind:checked={scan} disabled={busy} onchange={(event) => { scan = event.currentTarget.checked; void act('guardian_scan', 6, scan ? 'accepted' : 'declined'); }} />{FACIAL_SCAN_COPY.guardianCheckbox}</label>
    <p>{FACIAL_SCAN_COPY.footer}</p><p>{copy.minorProtection}</p>
    <button class="cta" disabled={busy || !terms || !guardianTerms || !scan} onclick={approve}>{copy.approve}</button>
    <button class="cta" disabled={busy} onclick={() => act('guardian_approve', 3, 'declined')}>Not now</button>
  {:else if step === 7}
    <h2>7. Approval record — unverified preview</h2><p>{copy.recordFields}</p>
    <p>Card last4/fingerprint and Illinois ID evidence remain empty. A guest case has no account ID or server IP. No record here grants approval.</p>
    <pre>{JSON.stringify(approvalRecord ?? guardianReviewRecord({ accountId: session.guest ? null : session.user?.id ?? null, guardianName, guardianEmail, relationship, cardType, illinois, wordingVersions: REGISTRATION_DOCUMENT_VERSIONS }), null, 2)}</pre>
    <button class="cta" onclick={() => { step = 8; }}>Preview unlock wording</button>
  {:else if step === 8}
    <h2>8. Unlock notice — wording preview only</h2>
    <p class="notice">No guardian has been approved. The following is future notice wording, not this account’s status.</p>
    <blockquote>{copy.unlock}</blockquote>
    <p>Domain finalisation is pending counsel confirmation. The guide also references {copy.domainNote}; no domain was silently substituted.</p>
    <button class="cta" onclick={() => { step = 9; }}>Preview guardian controls</button>
  {:else if step === 9}
    <h2>9. Guardian login and controls</h2>
    <p>Required under-18 notice preview: <strong>Guardian has access</strong></p>
    <p>Guardian authentication and account access are unavailable. These controls preview the required actions.</p>
    {#each copy.controls.replace(/\.$/, '').split(', ') as control}
      <button class="cta" disabled={busy} onclick={async () => { if (!await act('guardian_control', 9, 'attempted')) return; status = `${control}: unavailable until guardian verification and authorisation are implemented.`; }}>{control}</button>
    {/each}
    <p>Withdrawal must lock the account and trigger deletion before production. No account data is deleted by these preview controls.</p>
    <button class="cta" onclick={() => { step = 10; }}>Preview turning 18</button>
  {:else if step === 10}
    <h2>10. Turning 18 — lifecycle preview</h2><p>{copy.turning18}</p>
    <p>Birthday scheduling, guardian-access revocation and guardian notification are not implemented. This screen creates no real unlock.</p>
    <label><input type="checkbox" bind:checked={ownTerms} disabled={busy} onchange={(event) => { ownTerms = event.currentTarget.checked; void act('turning18_terms', 10, ownTerms ? 'accepted' : 'declined'); }} />{copy.terms}</label>
    <h3>{facial.title}</h3><p>{facial.body[0]}</p><ul>{#each facial.body.slice(1) as text}<li>{text}</li>{/each}</ul>
    <label><input type="checkbox" bind:checked={ownScan} disabled={busy} onchange={(event) => { ownScan = event.currentTarget.checked; void act('turning18_scan', 10, ownScan ? 'accepted' : 'declined'); }} />{FACIAL_SCAN_COPY.checkbox}</label><p>{FACIAL_SCAN_COPY.footer}</p>
    <button class="cta" disabled>{facial.acceptLabel}</button>
    <button class="cta" disabled={busy} onclick={async () => { ownTerms = false; ownScan = false; await act('turning18_terms', 10, 'declined'); await act('turning18_scan', 10, 'declined'); }}>{facial.declineLabel}</button>
  {/if}
  {#if status}<p role="status">{status}</p>{/if}
  <nav aria-label="Facial scan policies">{#each FACIAL_SCAN_COPY.links as label, i}{#if i > 0} | {/if}<a href="#policy-preview">{label}</a>{/each}</nav>
  <details id="policy-preview"><summary>Policy publication and wording versions</summary><p>Full Terms, Privacy, Health, Wellness and AI Disclaimer, Cookie, Biometric and Consumer Health policies remain unapproved publication previews.</p><a href="/legal/terms">Terms of Service</a> | <a href="/legal/privacy">Privacy Policy</a><pre>{JSON.stringify(REGISTRATION_DOCUMENT_VERSIONS, null, 2)}</pre></details>
  <details><summary>Review decision log</summary><p>{session.user && !session.guest ? 'Account review decisions are recorded on the server.' : 'Guest review decisions stay in this tab only.'}</p><pre>{JSON.stringify(evidence, null, 2)}</pre></details>
</section>
<style>
  .flow { max-width:52rem; margin:auto; line-height:1.6; } .notice { padding:1rem; border:1px solid var(--line); }
  nav { display:flex; flex-wrap:wrap; gap:.5rem; margin:1rem 0; } nav button { padding:.5rem; border:1px solid currentColor; } [aria-current='step'] { font-weight:bold; }
  label { display:flex; flex-wrap:wrap; gap:.7rem; align-items:center; margin:1rem 0; } input:not([type='checkbox']), select { padding:.6rem; background:var(--surface-strong); color:inherit; border:1px solid var(--line); }
  button { margin:.3rem; } pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:24rem; overflow:auto; font-size:.8rem; } details { margin:1rem 0; } a { color:inherit; }
</style>
