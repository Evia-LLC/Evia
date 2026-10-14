<script lang="ts">
  import Page from '@/components/Page.svelte';
  import AccountControls from '@/components/legal/AccountControls.svelte';
  import { link } from '@/router/router.svelte.ts';
</script>

<Page
  eyebrow="Settings / Privacy"
  title="Your care. Your call."
  lede="Choose what Evia can use, revisit your decisions, and keep control of what has been saved. Each consent is separate."
>
  <div class="studio-context" aria-label="Your privacy at a glance">
    <div>
      <span class="studio-context__icon" aria-hidden="true">01</span>
      <div><strong>Camera first, permission always</strong>
      <p>On-device measurements stay local. Cloud analysis and stored photos require their own choices.</p></div>
    </div>
    <div>
      <span class="studio-context__icon" aria-hidden="true">02</span>
      <div><strong>Your history is yours</strong>
      <p>You can inspect saved readings, remove individual photos, or review an account export and deletion.</p></div>
    </div>
  </div>

  <div class="studio-context__links">
    <a href="/progress" use:link>Review scans and photos <span aria-hidden="true">↗</span></a>
    <a href="/settings/data" use:link>Export or delete account <span aria-hidden="true">↗</span></a>
  </div>
  <AccountControls />
</Page>
