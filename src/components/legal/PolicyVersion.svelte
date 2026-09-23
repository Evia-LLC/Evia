<script lang="ts">
  import type { LegalContentRecord } from '../../../shared/legal-content.ts';
  let { content }: { content: LegalContentRecord } = $props();
</script>

<p class="legal-version">
  <span>Wording version <code>{content.wordingVersionId}</code></span>
  <span>{content.effectiveDateLabel}{content.effectiveDate ? `: ${content.effectiveDate}` : ''}</span>
</p>

<style>
  .legal-version { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; opacity: .72; font-size: .82rem; }
  code { font: inherit; overflow-wrap: anywhere; }
</style>
