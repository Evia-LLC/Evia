<!--
  Sample data is on while an account is signed in: say that the account is set
  aside, and offer the one way back to it.

  BUILD-PLAN 3.1: sample mode never mixes with real data and never writes to
  the server. The account pages (Settings' account card, Profile, Privacy,
  Your data) therefore neither show the account's own details nor act on it
  while the sample is on screen - they show this instead, and turning sample
  data off brings the account back (App.svelte reloads its history).

  A guest has no account to set aside, so the pages say "Looking around"
  instead and never show this.
-->
<script lang="ts">
  import { setSample } from '@/sample/mode.svelte.ts';
  import Button from '@/ui/Button.svelte';
  import Icon from '@/ui/Icon.svelte';

  interface Props {
    /** What is paused on this page, finishing "…turn sample data off to …". */
    action?: string;
    class?: string;
  }

  const { action = 'see and change it', class: className = '' }: Props = $props();
</script>

<div class="sample-note {className}" role="note">
  <Icon name="info" size={18} stroke={1.8} class="sample-note__icon" />
  <p class="sample-note__text">
    <strong>Sample data is on,</strong> so your account is set aside: nothing on this page is read from it or saved to
    it. Turn sample data off to {action}.
  </p>
  <Button variant="secondary" size="sm" onclick={() => setSample(false)}>Turn off sample data</Button>
</div>

<style>
  .sample-note {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 14px;
    margin: 0;
    padding: 12px 14px 12px 16px;
    border-radius: var(--r-md);
    background: var(--amber-100);
    color: var(--amber-900);
  }
  .sample-note :global(.sample-note__icon) {
    flex: none;
    align-self: flex-start;
    margin-top: 2px;
  }
  .sample-note__text {
    flex: 1 1 260px;
    min-width: 0;
    max-width: 62ch;
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
  }
  .sample-note__text strong {
    font-weight: var(--fw-semibold);
  }
</style>
