<script lang="ts">
  /** The record's wording version and effective date, as quiet meta under the title. */
  import type { LegalContentRecord } from '../../../shared/legal-content.ts';
  let { content }: { content: LegalContentRecord } = $props();
</script>

<p class="legal-version">
  <span>Wording version <code>{content.wordingVersionId}</code></span>
  <span>{content.effectiveDateLabel}{content.effectiveDate ? `: ${content.effectiveDate}` : ''}</span>
</p>

<style>
  .legal-version {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 20px;
    margin: 0;
    font-size: var(--fs-meta);
    line-height: 1.4;
    color: var(--text-muted);
  }
  code {
    font-family: var(--font-sans);
    font-weight: var(--fw-medium);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
</style>
