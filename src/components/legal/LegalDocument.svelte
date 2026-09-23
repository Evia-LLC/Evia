<script lang="ts">
  import type { LegalContentRecord } from '../../../shared/legal-content.ts';
  import LegalPlaceholderNotice from './LegalPlaceholderNotice.svelte';
  import PolicyVersion from './PolicyVersion.svelte';
  let { content }: { content: LegalContentRecord } = $props();
</script>

<article class="legal-document" aria-labelledby={`legal-${content.id}`}>
  <LegalPlaceholderNotice {content} />
  <h1 id={`legal-${content.id}`}>{content.title}</h1>
  <PolicyVersion {content} />
  <div class="legal-copy">
    {#each content.body as paragraph}<p>{paragraph}</p>{/each}
  </div>
  <dl>
    <dt>Applies to</dt><dd>{content.applicability.audience}</dd>
    <dt>Jurisdictions</dt><dd>{content.applicability.jurisdictions.join(', ')}</dd>
  </dl>
</article>

<style>
  .legal-document { max-width: 46rem; margin: 0 auto; padding: 6rem max(1.25rem, 5vw); position: relative; z-index: 2; }
  h1 { font-size: clamp(2rem, 7vw, 4rem); line-height: 1; }
  .legal-copy { margin: 2rem 0; font-size: 1.05rem; white-space: pre-wrap; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .4rem 1rem; }
  dt { font-weight: 700; } dd { margin: 0; }
</style>
