<script lang="ts">
  import { LEGAL_CONTENT } from '../../../shared/legal-content.ts';
  import { link } from '@/router/router.svelte.ts';
  import LegalShell from '@/components/legal/LegalShell.svelte';
  import LegalDocument from '@/components/legal/LegalDocument.svelte';
  const content = LEGAL_CONTENT['subscription-disclosure'];
</script>

<LegalShell>
  <LegalDocument {content} />
  <nav class="sibling" aria-label="Subscription review navigation">
    <a href="/legal/cancellation" use:link>Review cancellation placeholder</a>
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
