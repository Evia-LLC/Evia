<script lang="ts">
  import { LEGAL_CONTENT, type LegalContentId } from '../../../shared/legal-content.ts';
  import LegalDocument from '@/components/legal/LegalDocument.svelte';
  import ConsentDecision from '@/components/legal/ConsentDecision.svelte';
  import { submitLegalDecision } from '@/lib/legal-consent.ts';
  let { contentId }: { contentId: LegalContentId } = $props();
  const content = $derived(LEGAL_CONTENT[contentId]);
</script>
<main class="legal-page"><LegalDocument {content} /><div class="decision"><ConsentDecision {content} onDecision={(decision, version) => submitLegalDecision(content.id, decision, version)} /></div></main>
<style>.legal-page { position:absolute; inset:0; overflow:auto; z-index:20; background:#12100f; color:#f6f0e9; }.decision { max-width:46rem; margin:-4rem auto 6rem; padding:0 max(1.25rem,5vw); }</style>
