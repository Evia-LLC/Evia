<script lang="ts">
  /**
   * The review-build notice on a placeholder legal record: amber, above the
   * title, so nobody mistakes the draft for the agreement.
   */
  import type { LegalContentRecord } from '../../../shared/legal-content.ts';
  let { content }: { content: LegalContentRecord } = $props();
  const review = import.meta.env.DEV || import.meta.env.MODE === 'review' || import.meta.env.VITE_DEPLOY_ENV === 'review';
</script>

{#if content.status === 'placeholder' && review}
  <aside class="notice" role="status" aria-label="Placeholder legal content">
    <strong>Placeholder · review only</strong>
    <span>This draft is not counsel-approved and cannot unlock a production legal gate.</span>
  </aside>
{/if}

<style>
  .notice {
    display: grid;
    gap: 4px;
    padding: 14px 16px;
    border: 1px solid var(--amber-500);
    border-radius: var(--r-md);
    background: var(--amber-100);
    color: var(--amber-900);
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
  }
  .notice strong {
    font-size: var(--fs-micro);
    font-weight: var(--fw-bold);
    letter-spacing: var(--tr-caps);
    text-transform: uppercase;
  }
</style>
