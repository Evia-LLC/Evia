<script lang="ts">
  /**
   * A consent document and its decision, in the legal frame. Every consent
   * page is this with its own record id.
   */
  import { LEGAL_CONTENT, type LegalContentId } from '../../../shared/legal-content.ts';
  import LegalShell from '@/components/legal/LegalShell.svelte';
  import LegalDocument from '@/components/legal/LegalDocument.svelte';
  import ConsentDecision from '@/components/legal/ConsentDecision.svelte';
  import { submitLegalDecision } from '@/lib/legal-consent.ts';
  let { contentId }: { contentId: LegalContentId } = $props();
  const content = $derived(LEGAL_CONTENT[contentId]);
</script>

<LegalShell>
  <LegalDocument {content} />
  <ConsentDecision {content} onDecision={(decision, version) => submitLegalDecision(content.id, decision, version)} />
</LegalShell>
