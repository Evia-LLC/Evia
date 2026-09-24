<script lang="ts">
  import AgeGuardianFlow from '@/components/legal/AgeGuardianFlow.svelte';
</script>
<main class="legal-page">
  <a href="/">Back to Evia</a>
  <AgeGuardianFlow initialStep={2} />
  <a href="/legal/cancellation">Cancellation information preview</a>
</main>
<style>.legal-page{position:absolute;inset:0;overflow:auto;z-index:20;background:#12100f;color:#f6f0e9;padding:1.25rem}a{color:inherit}</style>
