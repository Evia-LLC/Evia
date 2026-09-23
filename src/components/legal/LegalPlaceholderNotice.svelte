<script lang="ts">
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
  .notice { border: 1px solid #d8a853; border-radius: 12px; padding: 1rem; background: #2b2114; display: grid; gap: .25rem; }
  .notice strong { color: #f3c777; text-transform: uppercase; letter-spacing: .08em; font-size: .75rem; }
</style>
