<script lang="ts">
  /**
   * /legal/subscription: main's Section 4 checkout walkthrough (7d776c7) - the
   * age and guardian flow opened at its adult-checkout step, with the pack's
   * section 7 disclosure and the disabled payment button - in the legal frame.
   * No card is collected and no payment is taken.
   */
  import { link } from '@/router/router.svelte.ts';
  import LegalShell from '@/components/legal/LegalShell.svelte';
  import AgeGuardianFlow from '@/components/legal/AgeGuardianFlow.svelte';
</script>

<LegalShell>
  <AgeGuardianFlow initialStep={2} />
  <nav class="sibling" aria-label="Subscription review navigation">
    <a href="/legal/cancellation" use:link>Cancellation information preview</a>
  </nav>
</LegalShell>

<style>
  .sibling a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 4px;
    color: var(--text-link);
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    text-underline-offset: 3px;
  }
  .sibling a:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
</style>
