<script lang="ts">
  /**
   * /legal/facial-scan-consent: main's Section 1 screen (7d776c7) - the
   * Consent Wording Pack's section 1 text, verbatim - with the guardian
   * (16/17) wording as a disabled preview below it, in the legal frame.
   * Agreeing goes on to the scan; "Not now" goes back to Evia.
   */
  import FacialScanConsent from '@/components/legal/FacialScanConsent.svelte';
  import LegalShell from '@/components/legal/LegalShell.svelte';
  import { router } from '@/router/router.svelte.ts';
</script>

<LegalShell>
  <FacialScanConsent onAccepted={() => router.go('/scan')} onDeclined={() => router.go('/')} />
  <details class="guardian">
    <summary>Guardian wording preview (16/17)</summary>
    <FacialScanConsent guardian />
  </details>
</LegalShell>

<style>
  .guardian {
    display: grid;
    gap: 12px;
  }
  .guardian summary {
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface-card);
    color: var(--text-strong);
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    cursor: pointer;
  }
  .guardian summary:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .guardian[open] summary {
    margin-bottom: 12px;
  }
</style>
