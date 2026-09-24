<script lang="ts">
  import { onMount } from 'svelte';
  import { AI_COPY } from '@shared/legal-screen-copy.ts';
  import { recordLegalReview } from '@/lib/legal-review.ts';
  import { session } from '@/state/session.svelte.ts';
  let { consultation = false, result = false }: { consultation?: boolean; result?: boolean } = $props();
  let loggingError = $state('');
  onMount(() => {
    void recordLegalReview('ai-disclosure', 'viewed', session.guest ? undefined : session.user?.id)
      .catch(() => { loggingError = 'Disclosure displayed; review logging is unavailable.'; });
  });
</script>
<aside class="ai-notice" aria-label="AI disclosure">
  {#if consultation}<p>{AI_COPY.consultation}</p>{/if}
  {#if result}<p>{AI_COPY.result}</p>{/if}
  <p>{AI_COPY.escalation}</p>
  {#if loggingError}<small>{loggingError}</small>{/if}
</aside>
<style>.ai-notice{font-size:.85rem;line-height:1.5;padding:.65rem 0;color:inherit}.ai-notice p{margin:.3rem 0}</style>
