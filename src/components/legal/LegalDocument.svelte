<script lang="ts">
  import type { LegalContentRecord } from '../../../shared/legal-content.ts';
  import LegalPlaceholderNotice from './LegalPlaceholderNotice.svelte';
  import PolicyVersion from './PolicyVersion.svelte';
  import { link } from '@/router/router.svelte.ts';

  let { content }: { content: LegalContentRecord } = $props();
</script>

<article class="studio-legal-document" aria-labelledby={'legal-' + content.id}>
  <nav class="studio-legal-document__nav" aria-label="Legal document navigation">
    <span>EVIA / POLICY LIBRARY</span>
    <a href="/" use:link>Back to Evia <span aria-hidden="true">↗</span></a>
  </nav>
  <header class="studio-legal-document__header">
    <p>YOUR RIGHTS AND OUR RESPONSIBILITIES</p>
    <h1 id={'legal-' + content.id}>{content.title}</h1>
    <PolicyVersion {content} />
  </header>

  <div class="studio-legal-document__notice"><LegalPlaceholderNotice {content} /></div>
  <div class="studio-legal-document__body">
    {#each content.body as paragraph}
      <p>{paragraph}</p>
    {/each}
  </div>
  <dl class="studio-legal-document__meta">
    <dt>Applies to</dt><dd>{content.applicability.audience}</dd>
    <dt>Jurisdictions</dt><dd>{content.applicability.jurisdictions.join(', ')}</dd>
  </dl>
  <footer class="studio-legal-document__footer">Evia · Personal skin intelligence</footer>
</article>
