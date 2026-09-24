<script lang="ts">
  import FacialScanConsent from '@/components/legal/FacialScanConsent.svelte';
  import { router } from '@/router/router.svelte.ts';
</script>
<main>
  <FacialScanConsent onAccepted={() => router.go('/scan')} onDeclined={() => router.go('/')} />
  <details><summary>Guardian wording preview (16/17)</summary><FacialScanConsent guardian /></details>
</main>
<style>main { position:absolute; inset:0; overflow:auto; z-index:20; padding:2rem; background:#12100f; color:#f6f0e9; } details { margin-top:2rem; }</style>
