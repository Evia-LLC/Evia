<!--
  The sample-only deployment notice (Ugochukwu's `sample_demo` release, main
  83817a6). The legal build guard refuses that release profile unless the
  build carries VITE_SAMPLE_DEMO=1, i.e. unless this strip is on screen: it is
  the visible half of the profile, so it shows on every screen - the gate, the
  legal pages and the app - and cannot be dismissed. It is a disclosure, not
  an access restriction (LEGAL_PROMISE_TRACKER, "Vercel main-branch sample
  release"). The wording is his and stays as written.

  Restyled into the design system: the sample badge's dark rose-brown and
  cream (17:1), 12px meta type rather than 11px, one line from 600px wide and
  two below. The strip's height is added to the top safe-area inset
  (`--safe-t`) at the root, so every top bar, the sample badge and the scan
  page's overlays start below it instead of under it.
-->
<script lang="ts">
  import { SAMPLE_ONLY_DEPLOYMENT } from '@/sample/mode.svelte.ts';

  $effect(() => {
    if (!SAMPLE_ONLY_DEPLOYMENT) return;
    const root = document.documentElement;
    root.dataset.sampleDeployment = 'true';
    return () => {
      delete root.dataset.sampleDeployment;
    };
  });
</script>

{#if SAMPLE_ONLY_DEPLOYMENT}
  <aside class="ev-demo-notice" aria-label="Demo notice">
    Pre-launch demo · Sample data only · No real users, payments or verified age checks.
  </aside>
{/if}

<style>
  :global(:root[data-sample-deployment='true']) {
    --demo-strip-h: 28px;
    --safe-t: calc(env(safe-area-inset-top, 0px) + var(--demo-strip-h));
  }
  @media (max-width: 599px) {
    :global(:root[data-sample-deployment='true']) {
      --demo-strip-h: 44px;
    }
  }

  .ev-demo-notice {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: calc(var(--z-badge) + 1);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    height: calc(env(safe-area-inset-top, 0px) + var(--demo-strip-h, 28px));
    padding: env(safe-area-inset-top, 0px) max(16px, env(safe-area-inset-right, 0px)) 0
      max(16px, env(safe-area-inset-left, 0px));
    background: var(--sample-bg);
    box-shadow: inset 0 -1px 0 var(--sample-rim);
    color: var(--sample-ink);
    font-family: var(--font-sans);
    font-size: var(--fs-meta);
    font-weight: var(--fw-medium);
    line-height: 1.35;
    letter-spacing: 0.01em;
    text-align: center;
    pointer-events: none;
  }
</style>
