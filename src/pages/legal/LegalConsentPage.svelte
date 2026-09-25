<script lang="ts">
  /**
   * A consent document and its decision, in the legal frame. Every consent
   * page is this with its own record id.
   *
   * The decision is main's Section 5 review (7d776c7), unchanged in logic and
   * wording: a separate, initially unticked checkbox with the pack's own text;
   * accept only once it is ticked; refusal (and, for the optional safety and
   * lifestyle consent, "Skip for now") exactly as prominent; the health
   * consent's WA/NV/CT jurisdiction scenario (Unknown treated conservatively).
   * A choice is sample review evidence - against the account when one is
   * signed in, in this tab for a guest or a sample visit - and never approves
   * production processing. Refusing or skipping goes back to Evia.
   *
   * Restyled into the design system: the document card above, and the
   * decision in a matching card below it, with the shared buttons and the
   * readability minimums.
   */
  import { LEGAL_CONTENT } from '@shared/legal-content.ts';
  import { HEALTH_REGIONS, healthConsentApplies, type ReviewChoice } from '@shared/legal-review.ts';
  import { recordLegalReview } from '@/lib/legal-review.ts';
  import { reviewAccountId } from '@/lib/review-account.ts';
  import { link, router } from '@/router/router.svelte.ts';
  import LegalShell from '@/components/legal/LegalShell.svelte';
  import LegalDocument from '@/components/legal/LegalDocument.svelte';
  import Button from '@/ui/Button.svelte';
  import Icon from '@/ui/Icon.svelte';
  let { contentId }: { contentId: 'health-consent' | 'safety-lifestyle-consent' | 'progress-photo-consent' } = $props();
  const content = $derived(LEGAL_CONTENT[contentId]);
  let checked = $state(false);
  let jurisdiction = $state('Unknown');
  let busy = $state(false);
  let message = $state('');
  const applies = $derived(contentId !== 'health-consent' || healthConsentApplies(jurisdiction));
  async function decide(choice: ReviewChoice) {
    if (busy || (choice === 'accepted' && !checked)) return;
    busy = true; message = '';
    try {
      await recordLegalReview(contentId, choice, reviewAccountId(),
        contentId === 'health-consent' ? { jurisdiction } : {});
      checked = false;
      if (choice === 'skipped' || choice === 'declined') { router.go('/'); return; }
      message = 'Sample review choice recorded. This does not approve production processing or enable photo storage.';
    } catch (error) { message = error instanceof Error ? error.message : 'Could not record the choice.'; }
    finally { busy = false; }
  }
</script>

<LegalShell>
  <LegalDocument {content} />

  <section class="decision" aria-label="Your choice">
    <p class="decision__demo">
      <Icon name="info" size={16} stroke={1.8} />
      <span>Sample-data review only. Full policy publication and production enforcement remain pending. Use sample information only.</span>
    </p>

    {#if contentId === 'health-consent'}
      <label class="field">
        <span class="field__label">Jurisdiction scenario</span>
        <select bind:value={jurisdiction} disabled={busy} onchange={() => { checked = false; message = ''; }}>
          {#each HEALTH_REGIONS as region}<option value={region}>{region}</option>{/each}
        </select>
      </label>
      <p class="hint">WA, NV and CT require this separate choice. Unknown location is treated conservatively. This selector does not verify residence.</p>
    {/if}

    {#if applies}
      <label class="check"><input type="checkbox" bind:checked={checked} disabled={busy} /><span>{content.checkbox}</span></label>
      <div class="actions">
        <Button variant="secondary" disabled={busy || !checked} onclick={() => decide('accepted')}>{content.acceptLabel}</Button>
        <Button variant="secondary" disabled={busy} onclick={() => decide('declined')}>{content.declineLabel}</Button>
        {#if contentId === 'safety-lifestyle-consent'}<Button variant="secondary" disabled={busy} onclick={() => decide('skipped')}>{content.skipLabel}</Button>{/if}
      </div>
    {:else}
      <p class="hint">This jurisdiction scenario does not require the WA/NV/CT consent screen.</p>
      <div class="actions">
        <Button variant="secondary" disabled={busy} onclick={() => decide('skipped')}>Continue without this consent</Button>
      </div>
    {/if}

    {#if content.footer}<p class="footer">{content.footer}</p>{/if}
    {#if message}<p class="status" role="status">{message}</p>{/if}

    <nav class="links" aria-label="Where next">
      <a href="/privacy" use:link>Account controls</a>
      <span aria-hidden="true">·</span>
      <a href="/" use:link>Back to Evia</a>
    </nav>
  </section>
</LegalShell>

<style>
  .decision {
    display: grid;
    gap: 16px;
    min-width: 0;
    padding: 24px 28px 22px;
    border: 1px solid var(--card-rim);
    border-radius: var(--r-lg);
    background: var(--surface-card);
    box-shadow: var(--shadow-sm);
    color: var(--text);
  }
  .decision__demo {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--amber-100);
    color: var(--amber-900);
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
  }
  .decision__demo :global(.icon) {
    flex: none;
    margin-top: 2px;
  }

  .field {
    display: grid;
    gap: 8px;
    max-width: 22rem;
  }
  .field__label {
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  select {
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--cream-0);
    color: var(--text-strong);
    font-family: var(--font-sans);
    font-size: var(--fs-label);
  }
  select:focus-visible,
  .check input:focus-visible,
  .links a:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }

  .hint {
    margin: -6px 0 0;
    max-width: 34em;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text-secondary);
  }

  /* The consent itself: a full-width row with a 44px target, never pre-ticked. */
  .check {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-height: 44px;
    padding: 14px 16px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--cream-0);
    color: var(--text-strong);
    font-size: var(--fs-body);
    line-height: var(--lh-normal);
    cursor: pointer;
  }
  .check:has(input:checked) {
    border-color: var(--chip-selected-border);
    background: var(--rose-100);
  }
  .check span {
    max-width: 38em;
  }
  .check input {
    flex: none;
    width: 20px;
    height: 20px;
    margin: 1px 0 0;
    accent-color: var(--accent-strong);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .footer {
    margin: 0;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .status {
    margin: 0;
    padding: 10px 14px;
    border-radius: var(--r-md);
    background: var(--sage-100, var(--cream-50));
    color: var(--text-strong);
    font-size: var(--fs-body-sm);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 8px;
    color: var(--text-muted);
  }
  .links a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 4px;
    color: var(--text-link);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    text-underline-offset: 3px;
  }

  @media (max-width: 819px) {
    .decision {
      padding: 20px 18px;
    }
  }
</style>
