<script lang="ts">
  import Page from '@/components/Page.svelte';
  import { link } from '@/router/router.svelte.ts';
</script>
<Page eyebrow="Navigation" title="That page is not here." lede="The address may be incomplete or out of date.">
  <a class="cta" href="/" use:link>Return to Evia</a>
</Page>
