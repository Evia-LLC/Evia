<!--
  Privacy: the account controls (main, Section 5, 7d776c7) in the dashboard's
  language.

  Main replaced this page's earlier content with the Consent Wording Pack's
  section 10 controls (components/legal/AccountControls.svelte): withdrawing
  scan consent, the progress-photo preference and per-photo deletion,
  download and deletion, marketing, cookie preferences, the policy version
  history and the under-18 guardian notice. The earlier "Where things go"
  cards and the two consent switches went with it - the on-device promise no
  longer holds once a signed-in scan can be analysed by Perfect Corp, and the
  cloud-reasoning switch was never live (its wording is unapproved).

  With sample data on, a signed-in account is set aside (BUILD-PLAN 3.1): the
  controls act on the account, so they are paused and the note offers the way
  back. A guest sees them working in this tab only, as main intended.
-->
<script lang="ts">
  import { session } from '@/state/session.svelte.ts';
  import { sample } from '@/sample/mode.svelte.ts';
  import AccountControls from '@/components/legal/AccountControls.svelte';
  import PageFrame from './frame/PageFrame.svelte';
  import SampleAccountNote from './frame/SampleAccountNote.svelte';
</script>

<PageFrame
  title="Privacy"
  subtitle="Review each consent separately, withdraw scan consent, and manage your sample account data."
  back={{ href: '/settings', label: 'Settings' }}
>
  {#if sample.on && !session.guest}
    <SampleAccountNote action="see and change your choices" />
  {:else}
    <AccountControls />
  {/if}
</PageFrame>
