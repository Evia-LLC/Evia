<script lang="ts">import { LEGAL_CONTENT } from '../../../shared/legal-content.ts'; import LegalDocument from '@/components/legal/LegalDocument.svelte'; const content = LEGAL_CONTENT.terms;</script>
<main class="legal-page"><LegalDocument {content} /></main><style>.legal-page{position:absolute;inset:0;overflow:auto;z-index:20;background:#12100f;color:#f6f0e9}</style>
