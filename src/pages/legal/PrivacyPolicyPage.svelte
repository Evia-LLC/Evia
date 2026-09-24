<script lang="ts">
  import { LEGAL_CONTENT } from '../../../shared/legal-content.ts';
  import LegalShell from '@/components/legal/LegalShell.svelte';
  import LegalDocument from '@/components/legal/LegalDocument.svelte';
  const content = LEGAL_CONTENT['privacy-policy'];
</script>

<LegalShell>
  <LegalDocument {content} />
</LegalShell>
