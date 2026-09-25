<!--
  The Consent Wording Pack's section 8 AI notice (main, Section 5), verbatim:
  the consultation label, the result disclaimer, and the escalation line that
  always follows. Showing it logs a 'viewed' review (against the account, or
  in this tab for a guest or a sample visit); if that fails the notice still
  shows and says so.

  Restyled into the design system: meta-size type (the secondary floor, 12px)
  with a small info glyph, in the ink of the surface it sits on - `tone`
  light (the page wash and cards), dark (rose-brown glass), holo (the scan's
  navy). Every tone meets 4.5:1 on its own backing.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { AI_COPY } from '@shared/legal-screen-copy.ts';
  import { recordLegalReview } from '@/lib/legal-review.ts';
  import { reviewAccountId } from '@/lib/review-account.ts';
  import Icon from '@/ui/Icon.svelte';
  let {
    consultation = false,
    result = false,
    tone = 'light',
    backed,
    class: className = '',
  }: {
    consultation?: boolean;
    result?: boolean;
    tone?: 'light' | 'dark' | 'holo';
    /** A backing panel, for text over a picture; on by default on holo (the scan room). */
    backed?: boolean;
    class?: string;
  } = $props();
  const withBacking = $derived(backed ?? tone === 'holo');
  let loggingError = $state('');
  onMount(() => {
    void recordLegalReview('ai-disclosure', 'viewed', reviewAccountId())
      .catch(() => { loggingError = 'Disclosure displayed; review logging is unavailable.'; });
  });
</script>

<aside class="ai-notice ai-notice--{tone} {className}" class:is-backed={withBacking} aria-label="AI disclosure">
  <Icon name="info" size={14} stroke={1.8} class="ai-notice__icon" />
  <div class="ai-notice__lines">
    {#if consultation}<p class="ai-notice__lead">{AI_COPY.consultation}</p>{/if}
    {#if result}<p class="ai-notice__lead">{AI_COPY.result}</p>{/if}
    <p>{AI_COPY.escalation}</p>
    {#if loggingError}<small>{loggingError}</small>{/if}
  </div>
</aside>

<style>
  .ai-notice {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--fs-meta);
    line-height: 1.45;
  }
  .ai-notice :global(.ai-notice__icon) {
    flex: none;
    margin-top: 2px;
  }
  .ai-notice__lines {
    display: grid;
    gap: 3px;
    min-width: 0;
    max-width: 44em;
  }
  .ai-notice p,
  .ai-notice small {
    margin: 0;
    font-size: inherit;
  }
  .ai-notice__lead {
    font-weight: var(--fw-medium);
  }
  .ai-notice small {
    font-style: italic;
  }

  .ai-notice--light {
    color: var(--text-secondary);
  }
  .ai-notice--light .ai-notice__lead {
    color: var(--text);
  }
  .ai-notice--light :global(.ai-notice__icon) {
    color: var(--terracotta-500);
  }
  .ai-notice--dark {
    color: var(--text-on-dark-muted);
  }
  .ai-notice--dark .ai-notice__lead {
    color: var(--text-on-dark-strong);
  }
  .ai-notice--dark :global(.ai-notice__icon) {
    color: var(--rose-gold-300);
  }
  .ai-notice.is-backed {
    padding: 8px 12px 9px 10px;
    border-radius: var(--r-md);
  }
  .ai-notice--holo {
    color: var(--text-on-holo);
  }
  .ai-notice--holo.is-backed {
    background: var(--glass-holo);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  .ai-notice--dark.is-backed {
    background: var(--glass-dark);
  }
  .ai-notice--holo .ai-notice__lead {
    color: var(--text-on-holo-strong, var(--text-on-holo));
  }
</style>
