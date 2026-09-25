<script lang="ts">
  /**
   * /legal/age-assurance: main's Section 2 walkthrough (7d776c7), the ten
   * steps of the age and guardian approval flow, in the legal frame. Opens at
   * step 2 (adult checkout) for a signed-in account and at step 1 otherwise.
   * Nothing here verifies an age, approves a guardian or unlocks a camera.
   */
  import AgeGuardianFlow from '@/components/legal/AgeGuardianFlow.svelte';
  import LegalShell from '@/components/legal/LegalShell.svelte';
  import { link } from '@/router/router.svelte.ts';
  import { session } from '@/state/session.svelte.ts';
</script>

<LegalShell>
  <p class="back"><a href="/" use:link>Return to demo</a></p>
  <AgeGuardianFlow initialStep={session.user ? 2 : 1} initialEmail={session.user?.email ?? ''} initialDOB={session.user?.dateOfBirth ?? ''} />
</LegalShell>

<style>
  .back {
    margin: 0;
  }
  .back a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 4px;
    color: var(--text-link);
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    text-underline-offset: 3px;
  }
  .back a:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
</style>
