<!--
  The age and guardian approval walkthrough (main, Sections 2-4, 7d776c7):
  the Consent Wording Pack's section 5-7 flow in ten steps, with every quoted
  string verbatim (shared/age-flow.ts, checked against the guide by
  test/age-flow.test.ts). A sample-data walkthrough: nothing here verifies an
  age, sends an email, approves a guardian, takes a payment or unlocks the
  camera, and each screen says so. Review choices are recorded against the
  account on a sample demo server, or kept in this tab for a guest or a
  sample visit (lib/review-account.ts).

  Restyled into the design system with its logic unchanged: one card, the ten
  steps as a row of pills (scrolling sideways on a phone), the shared buttons,
  fields and check rows, the readability minimums. `tone` light is the legal
  pages' wash; dark is the sign-in gate's rose-brown glass, where a 16/17
  signup opens it at step 3.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { AGE_FLOW_COPY as copy, AGE_FLOW_VERSION, REGISTRATION_DOCUMENT_VERSIONS, ageOnDate, adultCardBranch, guardianReviewRecord, type FundingType } from '@shared/age-flow.ts';
  import { LEGAL_CONTENT, FACIAL_SCAN_COPY } from '@shared/legal-content.ts';
  import { session } from '@/state/session.svelte.ts';
  import { reviewAccountId } from '@/lib/review-account.ts';
  import Button from '@/ui/Button.svelte';
  import Icon from '@/ui/Icon.svelte';
  import CheckoutPreview from './CheckoutPreview.svelte';
  import { verifyAge } from '@/lib/age-verification.ts';
  let { initialStep = 1, initialEmail = '', initialDOB = '', tone = 'light' }: {
    initialStep?: number; initialEmail?: string; initialDOB?: string; tone?: 'light' | 'dark';
  } = $props();
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
  const buttonTone = $derived(tone === 'dark' ? 'dark' : 'light');

  async function record(action: string, choice = 'preview') {
    const accountId = reviewAccountId();
    const record = guardianReviewRecord({ accountId: accountId ?? null, guardianName, guardianEmail,
      relationship, cardType, illinois, wordingVersions: REGISTRATION_DOCUMENT_VERSIONS });
    if (accountId) {
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

<section class="flow flow--{tone}">
  <header class="flow__head">
    <h1>Age and guardian approval</h1>
    <p class="flow__notice">
      <Icon name="info" size={16} stroke={1.8} />
      <span>Sample-data walkthrough — no verified age, guardian approval, email delivery or payment. This review never unlocks a camera. Use sample information only.</span>
    </p>
    {#if session.guest || !session.user}<p class="flow__aside">No minor account is created. Only email and date of birth are held for the signup case in this tab; guardian review fields are temporary. Closing this page discards them.</p>{/if}
  </header>

  <nav class="flow__steps" aria-label="Preview the ten steps">
    {#each names as name, i}<button type="button" class="flow__stepbtn" disabled={busy || blocked} aria-current={step === i + 1 ? 'step' : undefined} onclick={() => { step = i + 1; status = ''; }}><span class="flow__stepnum">{i + 1}.</span> {name}</button>{/each}
  </nav>

  <div class="flow__body">
    {#if blocked}
      <p class="flow__alert" role="alert">{copy.under16}</p>
    {:else if step === 1}
      <h2>1. Sign up</h2>
      <form class="flow__form" onsubmit={(event) => { event.preventDefault(); routeDOB(); }}>
        <label class="field"><span class="field__label">Email</span><input type="email" bind:value={email} required /></label>
        <label class="field"><span class="field__label">Date of birth</span><input type="date" bind:value={dob} required /></label>
        <p class="flow__lead">{copy.eligibility}</p>
        <p class="flow__aside">This is the routing preview. Account registration uses the email/password form.</p>
        <div class="flow__actions"><Button type="submit" tone={buttonTone}>Continue</Button></div>
      </form>
    {:else if step === 2}
      <h2>2. Adult checkout</h2>
      <CheckoutPreview {tone} onChoice={(action, choice) => record(action, choice)} />
      <label class="field"><span class="field__label">Sample funding type (not a Stripe result)</span><select bind:value={cardType}><option value="credit">Credit</option><option value="debit">Debit</option><option value="prepaid">Prepaid</option></select></label>
      {#if adultCardBranch(cardType) === 'email-age-check'}
        <p class="flow__lead">{copy.debitNotice}</p>
        <div class="flow__actions"><Button variant="secondary" tone={buttonTone} disabled={busy} onclick={checkAge}>Continue with age check unavailable</Button></div>
        <p class="flow__aside">No age provider is selected. This branch continues to guardian review without verification.</p>
      {:else}
        <p class="flow__aside">Credit-card adulthood and payment have not been verified. Scan consent can be reviewed; camera unlock is unavailable.</p>
        <div class="flow__consent">
          <h3>{facial.title}</h3><p>{facial.body[0]}</p><ul>{#each facial.body.slice(1) as text}<li>{text}</li>{/each}</ul>
          <label class="check"><input type="checkbox" bind:checked={adultScan} disabled={busy} onchange={(event) => { adultScan = event.currentTarget.checked; void act('adult_scan', 2, adultScan ? 'accepted' : 'declined'); }} /><span>{FACIAL_SCAN_COPY.checkbox}</span></label>
          <p class="flow__aside">{FACIAL_SCAN_COPY.footer}</p>
        </div>
        <div class="flow__actions"><Button variant="secondary" tone={buttonTone} disabled={busy} onclick={() => act('adult_card', 3, 'attempted')}>Preview guardian branch</Button></div>
      {/if}
    {:else if step === 3}
      <h2>{copy.guardianHeading}</h2><p class="flow__lead">{copy.guardianBody}</p>
      <form class="flow__form" onsubmit={(event) => { event.preventDefault(); void act('guardian_invite', 4, 'attempted'); }}>
        <label class="field"><span class="field__label">Guardian email</span><input type="email" bind:value={guardianEmail} required /></label>
        <div class="flow__actions"><Button type="submit" tone={buttonTone} disabled={busy}>Preview invitation</Button></div>
      </form>
      <p class="flow__aside">Demo gap: no email is sent, no pending minor account is persisted, and the 14-day account-deletion job is not implemented.</p>
    {:else if step === 4}
      <h2>4. Guardian email preview — not sent</h2>
      <div class="flow__email">
        <p class="flow__email-to">To: {guardianEmail || '[Guardian email]'}</p>
        <h3>{copy.emailSubject}</h3><p>{copy.emailBody.replace("[User's first name]", session.user?.displayName ?? "[User's first name]")}</p>
        <div class="flow__actions"><Button tone={buttonTone} onclick={() => { step = 5; }}>{copy.reviewButton}</Button></div>
        <p class="flow__aside">{copy.emailExpiry}</p>
      </div>
      <p class="flow__aside">This preview has no live invitation token. Token expiry and email delivery remain unavailable.</p>
    {:else if step === 5}
      <h2>5. Guardian verification</h2>
      <label class="field"><span class="field__label">{copy.guardianNameLabel}</span><input bind:value={guardianName} maxlength="120" /></label>
      <label class="check"><input type="checkbox" bind:checked={relationship} disabled={busy} onchange={(event) => { relationship = event.currentTarget.checked; void act('guardian_relationship', 5, relationship ? 'accepted' : 'declined'); }} /><span>{copy.relationship}</span></label>
      <label class="field"><span class="field__label">Verification payment route</span><select bind:value={paymentMethod}><option value="subscription">Guardian subscription as payor</option><option value="refunded">Nominal refunded verification charge</option></select></label>
      <label class="field"><span class="field__label">Sample card funding</span><select bind:value={cardType}><option value="credit">Credit</option><option value="debit">Debit</option><option value="prepaid">Prepaid</option></select></label>
      <div class="flow__scenarios">
        <label class="check check--quiet"><input type="checkbox" bind:checked={ownCard} /><span>Sample scenario: card is in the guardian’s own name</span></label>
        <label class="check check--quiet"><input type="checkbox" bind:checked={linkedCard} /><span>Sample scenario: card fingerprint is already linked to the user</span></label>
        <label class="check check--quiet"><input type="checkbox" bind:checked={illinois} /><span>Illinois scenario</span></label>
      </div>
      {#if illinois}<p class="flow__aside">Illinois requires an ID document check by a certified provider. No provider is configured; do not upload an ID.</p>{/if}
      {#if paymentMethod === 'subscription'}<CheckoutPreview guardian {tone} onChoice={(action, choice) => record(action, choice)} />{:else}<p class="flow__aside">Nominal refunded verification charge unavailable. No charge or refund has occurred.</p>{/if}
      <div class="flow__actions"><Button tone={buttonTone} disabled={busy} onclick={verifyGuardian}>Review verification requirements</Button></div>
    {:else if step === 6}
      <h2>6. Guardian consent preview</h2>
      <p class="flow__aside">Guardian verification has not completed; choices are review evidence only.</p>
      <label class="check"><input type="checkbox" bind:checked={terms} disabled={busy} onchange={(event) => { terms = event.currentTarget.checked; void act('registration_terms_review', 6, terms ? 'accepted' : 'declined'); }} /><span>{copy.terms}</span></label>
      <label class="check"><input type="checkbox" bind:checked={guardianTerms} disabled={busy} onchange={(event) => { guardianTerms = event.currentTarget.checked; void act('guardian_terms', 6, guardianTerms ? 'accepted' : 'declined'); }} /><span>{copy.guardianTerms}</span></label>
      <div class="flow__consent">
        <h3>{facial.title}</h3><p>{facial.body[0]}</p><ul>{#each facial.body.slice(1) as text}<li>{text}</li>{/each}</ul>
        <label class="check"><input type="checkbox" bind:checked={scan} disabled={busy} onchange={(event) => { scan = event.currentTarget.checked; void act('guardian_scan', 6, scan ? 'accepted' : 'declined'); }} /><span>{FACIAL_SCAN_COPY.guardianCheckbox}</span></label>
        <p class="flow__aside">{FACIAL_SCAN_COPY.footer}</p><p class="flow__aside">{copy.minorProtection}</p>
      </div>
      <div class="flow__actions">
        <Button variant="secondary" tone={buttonTone} disabled={busy || !terms || !guardianTerms || !scan} onclick={approve}>{copy.approve}</Button>
        <Button variant="secondary" tone={buttonTone} disabled={busy} onclick={() => act('guardian_approve', 3, 'declined')}>Not now</Button>
      </div>
    {:else if step === 7}
      <h2>7. Approval record — unverified preview</h2><p class="flow__lead">{copy.recordFields}</p>
      <p class="flow__aside">Card last4/fingerprint and Illinois ID evidence remain empty. A guest case has no account ID or server IP. No record here grants approval.</p>
      <pre>{JSON.stringify(approvalRecord ?? guardianReviewRecord({ accountId: reviewAccountId() ?? null, guardianName, guardianEmail, relationship, cardType, illinois, wordingVersions: REGISTRATION_DOCUMENT_VERSIONS }), null, 2)}</pre>
      <div class="flow__actions"><Button variant="secondary" tone={buttonTone} onclick={() => { step = 8; }}>Preview unlock wording</Button></div>
    {:else if step === 8}
      <h2>8. Unlock notice — wording preview only</h2>
      <p class="flow__notice flow__notice--plain">No guardian has been approved. The following is future notice wording, not this account’s status.</p>
      <blockquote>{copy.unlock}</blockquote>
      <p class="flow__aside">Domain finalisation is pending counsel confirmation. The guide also references {copy.domainNote}; no domain was silently substituted.</p>
      <div class="flow__actions"><Button variant="secondary" tone={buttonTone} onclick={() => { step = 9; }}>Preview guardian controls</Button></div>
    {:else if step === 9}
      <h2>9. Guardian login and controls</h2>
      <p class="flow__lead">Required under-18 notice preview: <strong>Guardian has access</strong></p>
      <p class="flow__aside">Guardian authentication and account access are unavailable. These controls preview the required actions.</p>
      <div class="flow__actions">
        {#each copy.controls.replace(/\.$/, '').split(', ') as control}
          <Button variant="secondary" tone={buttonTone} disabled={busy} onclick={async () => { if (!await act('guardian_control', 9, 'attempted')) return; status = `${control}: unavailable until guardian verification and authorisation are implemented.`; }}>{control}</Button>
        {/each}
      </div>
      <p class="flow__aside">Withdrawal must lock the account and trigger deletion before production. No account data is deleted by these preview controls.</p>
      <div class="flow__actions"><Button variant="secondary" tone={buttonTone} onclick={() => { step = 10; }}>Preview turning 18</Button></div>
    {:else if step === 10}
      <h2>10. Turning 18 — lifecycle preview</h2><p class="flow__lead">{copy.turning18}</p>
      <p class="flow__aside">Birthday scheduling, guardian-access revocation and guardian notification are not implemented. This screen creates no real unlock.</p>
      <label class="check"><input type="checkbox" bind:checked={ownTerms} disabled={busy} onchange={(event) => { ownTerms = event.currentTarget.checked; void act('turning18_terms', 10, ownTerms ? 'accepted' : 'declined'); }} /><span>{copy.terms}</span></label>
      <div class="flow__consent">
        <h3>{facial.title}</h3><p>{facial.body[0]}</p><ul>{#each facial.body.slice(1) as text}<li>{text}</li>{/each}</ul>
        <label class="check"><input type="checkbox" bind:checked={ownScan} disabled={busy} onchange={(event) => { ownScan = event.currentTarget.checked; void act('turning18_scan', 10, ownScan ? 'accepted' : 'declined'); }} /><span>{FACIAL_SCAN_COPY.checkbox}</span></label><p class="flow__aside">{FACIAL_SCAN_COPY.footer}</p>
      </div>
      <div class="flow__actions">
        <Button variant="secondary" tone={buttonTone} disabled>{facial.acceptLabel}</Button>
        <Button variant="secondary" tone={buttonTone} disabled={busy} onclick={async () => { ownTerms = false; ownScan = false; await act('turning18_terms', 10, 'declined'); await act('turning18_scan', 10, 'declined'); }}>{facial.declineLabel}</Button>
      </div>
    {/if}
    {#if status}<p class="flow__status" role="status">{status}</p>{/if}
  </div>

  <footer class="flow__foot">
    <nav class="flow__links" aria-label="Facial scan policies">{#each FACIAL_SCAN_COPY.links as label, i}{#if i > 0}<span aria-hidden="true"> | </span>{/if}<a href="#policy-preview">{label}</a>{/each}</nav>
    <details id="policy-preview"><summary>Policy publication and wording versions</summary><p>Full Terms, Privacy, Health, Wellness and AI Disclaimer, Cookie, Biometric and Consumer Health policies remain unapproved publication previews.</p><p><a href="/legal/terms">Terms of Service</a> | <a href="/legal/privacy">Privacy Policy</a></p><pre>{JSON.stringify(REGISTRATION_DOCUMENT_VERSIONS, null, 2)}</pre></details>
    <details><summary>Review decision log</summary><p>{reviewAccountId() ? 'Account review decisions are recorded on the server.' : 'Guest review decisions stay in this tab only.'}</p><pre>{JSON.stringify(evidence, null, 2)}</pre></details>
  </footer>
</section>

<style>
  .flow {
    --f-ink: var(--text);
    --f-strong: var(--text-strong);
    --f-muted: var(--text-secondary);
    --f-rim: var(--border-strong);
    --f-soft-rim: var(--divider);
    --f-field: var(--cream-0);
    --f-row: var(--cream-0);
    --f-row-on: var(--rose-100);
    --f-sunken: var(--surface-sunken);
    --f-link: var(--text-link);
    --f-focus: var(--focus-ring);
    --f-pill-on: var(--rose-100);
    --f-pill-on-rim: var(--chip-selected-border);
    --f-accent: var(--accent-strong);
    box-sizing: border-box;
    display: grid;
    gap: 18px;
    min-width: 0;
    padding: 28px 30px 22px;
    border: 1px solid var(--card-rim);
    border-radius: var(--r-lg);
    background: var(--surface-card);
    box-shadow: var(--shadow-sm);
    color: var(--f-ink);
    font-family: var(--font-sans);
    font-size: var(--fs-body);
    line-height: var(--lh-normal);
  }
  /* On the gate's rose-brown glass: no card of its own, the gate's inks. */
  .flow--dark {
    --f-ink: var(--text-on-dark);
    --f-strong: var(--text-on-dark-strong);
    --f-muted: var(--text-on-dark-muted);
    --f-rim: var(--border-on-dark-strong);
    --f-soft-rim: var(--glass-dark-rim);
    --f-field: rgba(31, 17, 12, 0.35);
    --f-row: rgba(31, 17, 12, 0.25);
    --f-row-on: var(--tint-press-dark);
    --f-sunken: rgba(31, 17, 12, 0.45);
    --f-link: var(--text-on-dark-strong);
    --f-focus: var(--focus-ring-on-dark);
    --f-pill-on: var(--tint-press-dark);
    --f-pill-on-rim: var(--rose-gold-300);
    --f-accent: var(--rose-gold-300);
    padding: 0;
    border: 0;
    background: none;
    box-shadow: none;
  }

  .flow__head {
    display: grid;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: clamp(30px, 4vw, 40px);
    font-weight: var(--fw-regular);
    line-height: 1.1;
    letter-spacing: var(--tr-title);
    color: var(--f-strong);
  }
  .flow--dark h1 {
    font-size: 26px;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-title-sm);
    font-weight: var(--fw-medium);
    line-height: 1.3;
    color: var(--f-strong);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-lead);
    font-weight: var(--fw-medium);
    color: var(--f-strong);
  }
  p {
    margin: 0;
  }

  .flow__notice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--amber-100);
    color: var(--amber-900);
    font-size: var(--fs-body-sm);
  }
  .flow__notice :global(.icon) {
    flex: none;
    margin-top: 2px;
  }
  .flow--dark .flow__notice {
    background: rgba(230, 138, 49, 0.16);
    color: var(--text-on-dark-strong);
  }
  .flow__notice--plain {
    display: block;
  }
  .flow__lead {
    max-width: 38em;
    color: var(--f-ink);
  }
  .flow__aside {
    max-width: 40em;
    font-size: var(--fs-body-sm);
    color: var(--f-muted);
  }
  .flow__alert,
  .flow__status {
    padding: 12px 14px;
    border-radius: var(--r-md);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
  }
  .flow__alert {
    background: rgba(154, 47, 63, 0.12);
    color: var(--text-danger);
  }
  .flow--dark .flow__alert {
    background: rgba(154, 47, 63, 0.35);
    color: var(--text-on-dark-strong);
  }
  .flow__status {
    background: var(--f-sunken);
    color: var(--f-strong);
  }

  /* The ten steps: pills that wrap on a wide card and scroll sideways on a
     phone (the page itself never scrolls sideways). */
  .flow__steps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .flow__stepbtn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid var(--f-rim);
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--f-ink);
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    white-space: nowrap;
    cursor: pointer;
  }
  .flow__stepnum {
    font-variant-numeric: tabular-nums;
    color: var(--f-muted);
  }
  .flow__stepbtn[aria-current='step'] {
    border-color: var(--f-pill-on-rim);
    background: var(--f-pill-on);
    color: var(--f-strong);
    font-weight: var(--fw-semibold);
  }
  .flow__stepbtn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  @media (hover: hover) {
    .flow__stepbtn:not(:disabled):not([aria-current='step']):hover {
      background: var(--f-row);
    }
  }
  @media (max-width: 599px) {
    .flow__steps {
      flex-wrap: nowrap;
      margin: 0 -18px;
      padding: 2px 18px 6px;
      overflow-x: auto;
      scroll-snap-type: x proximity;
      scrollbar-width: thin;
    }
    .flow--dark .flow__steps {
      margin: 0;
      padding: 2px 0 6px;
    }
    .flow__stepbtn {
      min-height: 44px;
      scroll-snap-align: start;
    }
  }

  .flow__body {
    display: grid;
    gap: 14px;
    padding-top: 18px;
    border-top: 1px solid var(--f-soft-rim);
  }
  .flow__form {
    display: grid;
    gap: 14px;
  }
  .flow__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .field {
    display: grid;
    gap: 8px;
    max-width: 26rem;
  }
  .field__label {
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    color: var(--f-strong);
  }
  .field input,
  .field select {
    box-sizing: border-box;
    width: 100%;
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid var(--f-rim);
    border-radius: var(--r-md);
    background: var(--f-field);
    color: var(--f-strong);
    font-family: var(--font-sans);
    font-size: var(--fs-label);
  }
  .flow--dark .field input,
  .flow--dark .field select {
    color-scheme: dark;
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    max-width: 44rem;
    padding: 12px 14px;
    border: 1px solid var(--f-rim);
    border-radius: var(--r-md);
    background: var(--f-row);
    color: var(--f-strong);
    cursor: pointer;
  }
  .check:has(input:checked) {
    background: var(--f-row-on);
  }
  .check input {
    flex: none;
    width: 20px;
    height: 20px;
    margin: 2px 0 0;
    accent-color: var(--f-accent);
  }
  .check--quiet {
    padding: 10px 12px;
    border-style: dashed;
    font-size: var(--fs-body-sm);
  }
  .flow__scenarios {
    display: grid;
    gap: 8px;
  }

  .flow__consent,
  .flow__email {
    display: grid;
    gap: 10px;
    padding: 16px 18px;
    border-radius: var(--r-md);
    background: var(--f-sunken);
  }
  .flow__consent ul {
    display: grid;
    gap: 8px;
    margin: 0;
    padding-left: 1.2em;
    max-width: 40em;
  }
  .flow__email-to {
    font-size: var(--fs-body-sm);
    color: var(--f-muted);
  }
  blockquote {
    margin: 0;
    padding: 12px 16px;
    border-left: 3px solid var(--f-pill-on-rim);
    background: var(--f-sunken);
    color: var(--f-strong);
  }

  pre {
    box-sizing: border-box;
    max-width: 100%;
    max-height: 24rem;
    margin: 0;
    padding: 12px 14px;
    overflow: auto;
    border-radius: var(--r-md);
    background: var(--f-sunken);
    color: var(--f-ink);
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: var(--fs-meta);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .flow__foot {
    display: grid;
    gap: 6px;
    padding-top: 14px;
    border-top: 1px solid var(--f-soft-rim);
    font-size: var(--fs-body-sm);
    color: var(--f-muted);
  }
  .flow__links a,
  details a,
  summary {
    color: var(--f-link);
    font-weight: var(--fw-medium);
    text-underline-offset: 3px;
  }
  .flow__links a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
  summary {
    display: flex;
    align-items: center;
    min-height: 44px;
    cursor: pointer;
  }
  details {
    display: grid;
    gap: 8px;
  }
  details > p {
    margin-bottom: 8px;
  }

  .flow__stepbtn:focus-visible,
  .field input:focus-visible,
  .field select:focus-visible,
  .check input:focus-visible,
  .flow__links a:focus-visible,
  details a:focus-visible,
  summary:focus-visible {
    outline: var(--focus-width) solid var(--f-focus);
    outline-offset: var(--focus-offset);
  }

  @media (max-width: 599px) {
    .flow:not(.flow--dark) {
      padding: 22px 18px 18px;
    }
  }
</style>
