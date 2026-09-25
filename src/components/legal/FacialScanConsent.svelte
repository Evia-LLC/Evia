<!--
  The facial scan consent (main, Section 1, 7d776c7): the Consent Wording
  Pack's section 1 screen, verbatim - "Before your first scan", the body
  bullets, the separate unticked checkbox (or the guardian wording, as a
  disabled preview), "Agree and continue" / "Not now" equally prominent, the
  policy links and the withdrawal footer. Agreeing is recorded against the
  account (sample demo servers only), or in this tab for a guest or a sample
  visit; a refusal is recorded too.

  Restyled into the design system, logic unchanged. `tone` light is the card
  on the legal pages' wash; holo is the scan room's navy glass, where it
  stands in for the camera until it is answered.
-->
<script lang="ts">
  import { LEGAL_CONTENT, FACIAL_SCAN_COPY } from '@shared/legal-content.ts';
  import { session } from '@/state/session.svelte.ts';
  import { recordFacialChoice } from '@/lib/facial-consent.ts';
  import { reviewAccountId } from '@/lib/review-account.ts';
  import { link } from '@/router/router.svelte.ts';
  import Button from '@/ui/Button.svelte';
  import Icon from '@/ui/Icon.svelte';
  let { onAccepted = () => {}, onDeclined = () => {}, guardian = false, tone = 'light' }: {
    onAccepted?: () => void; onDeclined?: () => void; guardian?: boolean; tone?: 'light' | 'holo';
  } = $props();
  const content = LEGAL_CONTENT['facial-scan-consent'];
  let selected = $state(false);
  let busy = $state(false);
  let error = $state('');
  const buttonTone = $derived(tone === 'holo' ? 'dark' : 'light');
  async function decide(choice: 'accepted' | 'declined') {
    if (busy || guardian || (choice === 'accepted' && !selected)) return;
    busy = true; error = '';
    try {
      await recordFacialChoice(choice, reviewAccountId());
      if (choice === 'accepted') onAccepted(); else onDeclined();
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Your choice could not be saved.'; }
    finally { busy = false; }
  }
</script>

<section class="consent consent--{tone}" aria-label={content.title}>
  <p class="demo">
    <Icon name="info" size={16} stroke={1.8} />
    <span>Sample-data demo — wording shown for review; not approved for production. Age and guardian verification are not yet enforced.</span>
  </p>
  <h2>{content.title}</h2>
  <p class="lead">{content.body[0]}</p>
  <ul>{#each content.body.slice(1) as bullet}<li>{bullet}</li>{/each}</ul>
  <label class="check"><input type="checkbox" bind:checked={selected} disabled={busy || guardian} /><span>{guardian ? FACIAL_SCAN_COPY.guardianCheckbox : FACIAL_SCAN_COPY.checkbox}</span></label>
  {#if guardian}<p class="note">Guardian wording preview only. Verified guardian approval is not available yet.</p>{/if}
  <div class="actions">
    <Button variant="secondary" tone={buttonTone} disabled={!selected || busy || guardian} onclick={() => decide('accepted')}>{content.acceptLabel}</Button>
    <Button variant="secondary" tone={buttonTone} disabled={busy || guardian} onclick={() => decide('declined')}>{content.declineLabel}</Button>
  </div>
  <nav class="links" aria-label="Scan policies"><a href="#biometric-policy-preview">Biometric Data Policy</a> <span aria-hidden="true">|</span> <a href="/legal/privacy" use:link>Privacy Policy</a> <span aria-hidden="true">|</span> <a href="#health-policy-preview">Consumer Health Data Privacy Policy</a></nav>
  <p class="footer">{FACIAL_SCAN_COPY.footer}</p>
  <details id="biometric-policy-preview"><summary>Biometric Data Policy — preview</summary><p>Full policy publication pending. The scan notice above is the verbatim consent screen, not the complete policy.</p></details>
  <details id="health-policy-preview"><summary>Consumer Health Data Privacy Policy — preview</summary><p>Full policy publication pending. Sample data only; no real users.</p></details>
  {#if session.guest || !session.user}<p class="note">Guest choices are recorded for this tab only. Sign in to record a choice against an account and use Perfect Corp.</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .consent {
    --c-ink: var(--text);
    --c-strong: var(--text-strong);
    --c-muted: var(--text-secondary);
    --c-rim: var(--border-strong);
    --c-row: var(--cream-0);
    --c-row-on: var(--rose-100);
    --c-link: var(--text-link);
    --c-focus: var(--focus-ring);
    display: grid;
    gap: 14px;
    box-sizing: border-box;
    width: 100%;
    max-width: 46rem;
    padding: 28px 30px 24px;
    border: 1px solid var(--card-rim);
    border-radius: var(--r-lg);
    background: var(--surface-card);
    box-shadow: var(--shadow-sm);
    color: var(--c-ink);
    font-family: var(--font-sans);
    font-size: var(--fs-body);
    line-height: var(--lh-normal);
  }
  /* The scan room: navy glass, the hologram's inks (all 4.5:1 or better on it). */
  .consent--holo {
    --c-ink: var(--holo-ink-body);
    --c-strong: var(--holo-ink-strong);
    --c-muted: var(--holo-ink-muted);
    --c-rim: rgba(150, 170, 210, 0.42);
    --c-row: rgba(255, 255, 255, 0.04);
    --c-row-on: rgba(120, 200, 230, 0.12);
    --c-link: var(--holo-ink-strong);
    --c-focus: var(--focus-ring-on-dark);
    border-color: rgba(150, 170, 210, 0.3);
    background: rgba(8, 13, 24, 0.88);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }

  .demo {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0;
    padding: 10px 14px;
    border-radius: var(--r-md);
    background: var(--amber-100);
    color: var(--amber-900);
    font-size: var(--fs-body-sm);
  }
  .demo :global(.icon) {
    flex: none;
    margin-top: 2px;
  }
  .consent--holo .demo {
    background: rgba(230, 170, 90, 0.16);
    color: #f6dcb8;
  }

  h2 {
    margin: 4px 0 0;
    font-family: var(--font-serif);
    font-size: clamp(26px, 3vw, 32px);
    font-weight: var(--fw-regular);
    line-height: 1.15;
    color: var(--c-strong);
  }
  .consent--holo h2 {
    font-family: var(--font-sans);
  }
  .lead,
  li {
    max-width: 38em;
  }
  .lead {
    margin: 0;
  }
  ul {
    display: grid;
    gap: 10px;
    margin: 0;
    padding-left: 1.2em;
  }
  li::marker {
    color: var(--c-muted);
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--c-rim);
    border-radius: var(--r-md);
    background: var(--c-row);
    color: var(--c-strong);
    cursor: pointer;
  }
  .check:has(input:checked) {
    background: var(--c-row-on);
  }
  .check:has(input:disabled) {
    cursor: not-allowed;
  }
  .check input {
    flex: none;
    width: 20px;
    height: 20px;
    margin: 2px 0 0;
    accent-color: var(--accent-strong);
  }
  .consent--holo .check input {
    accent-color: var(--holo-rose, var(--rose-400));
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 6px;
    color: var(--c-muted);
    font-size: var(--fs-body-sm);
  }
  .links a,
  summary {
    color: var(--c-link);
    font-weight: var(--fw-medium);
  }
  .links a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 2px;
    text-underline-offset: 3px;
  }
  .footer,
  .note {
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--c-muted);
  }
  details {
    font-size: var(--fs-body-sm);
    color: var(--c-muted);
  }
  summary {
    display: flex;
    align-items: center;
    min-height: 44px;
    cursor: pointer;
  }
  details p {
    margin: 0 0 8px;
  }
  .error {
    margin: 0;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    color: var(--text-danger);
  }
  .consent--holo .error {
    color: #f4c3cc;
  }
  .check input:focus-visible,
  .links a:focus-visible,
  summary:focus-visible {
    outline: var(--focus-width) solid var(--c-focus);
    outline-offset: var(--focus-offset);
  }

  @media (max-width: 599px) {
    .consent {
      padding: 22px 18px 20px;
    }
  }
</style>
