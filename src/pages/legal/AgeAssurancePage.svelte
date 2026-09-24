<script lang="ts">
  import AgeGuardianFlow from '@/components/legal/AgeGuardianFlow.svelte';
  import { link } from '@/router/router.svelte.ts';
  import { session } from '@/state/session.svelte.ts';
</script>
<main><p><a href="/" use:link>Return to demo</a></p><AgeGuardianFlow initialStep={session.user ? 2 : 1} initialEmail={session.user?.email ?? ''} initialDOB={session.user?.dateOfBirth ?? ''} /></main>
<style>main { position:absolute; inset:0; overflow:auto; z-index:20; padding:2rem; background:#12100f; color:#f6f0e9; }</style>
