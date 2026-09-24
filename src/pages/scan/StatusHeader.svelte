<!--
  The floating status line (specs/scan.md 2.1): a cyan dot, the title and a
  spaced-caps eyebrow under it. The title is the page's h1.

  Real mode says what the pipeline is actually doing (src/view/scan.ts): the
  dot pulses only while the analysis runs or she is going through the result,
  and holds still otherwise - never on a timer (SRS section 5). It is a live
  region, politely announced.
-->
<script lang="ts">
  import type { ScanStatus } from '@/view/scan.ts';

  interface Props {
    status: ScanStatus;
    /**
     * On a dark glass tab of its own: outside the consultation the line can sit
     * over the room's lit walls rather than the dark window, and the eyebrow
     * would lose its contrast there.
     */
    backed?: boolean;
    class?: string;
  }

  const { status, backed = false, class: className = '' }: Props = $props();
</script>

<header class="status {className}" class:is-backed={backed} aria-live="polite">
  <h1 class="status__title">
    <span class="status__dot" class:is-live={status.live} aria-hidden="true"></span>
    <span>{status.title}</span>
  </h1>
  <p class="status__eyebrow">{status.eyebrow}</p>
</header>

<style>
  .status {
    color: var(--holo-ink);
    pointer-events: none;
  }
  .status.is-backed {
    width: fit-content;
    max-width: calc(100% - 32px);
    padding: 10px 16px 11px 14px;
    border-radius: 14px;
    background: rgba(8, 13, 24, 0.7);
    box-shadow: inset 0 0 0 1px rgba(150, 170, 210, 0.22);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  .status__title {
    display: flex;
    align-items: center;
    gap: var(--status-gap, 12px);
    margin: 0;
    font-size: var(--s-title, 20px);
    font-weight: var(--fw-regular);
    line-height: 1.2;
    letter-spacing: -0.005em;
    color: #e6f1fc;
    text-shadow:
      0 0 8px rgba(160, 200, 255, 0.25),
      0 1px 2px rgba(6, 10, 20, 0.6);
  }
  .status__dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--holo-cyan);
    box-shadow: 0 0 6px 1px rgba(var(--holo-cyan-rgb), 0.4);
  }
  .status__dot.is-live {
    animation: status-pulse 1.6s var(--ease-in-out) infinite;
  }
  .status__eyebrow {
    margin: 8px 0 0;
    font-size: var(--s-eyebrow, 11px);
    font-weight: var(--fw-semibold);
    line-height: 1.3;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #aab3c3;
    text-shadow: 0 1px 2px rgba(6, 10, 20, 0.7);
  }
  @keyframes status-pulse {
    50% {
      transform: scale(1.15);
      box-shadow: 0 0 10px 3px rgba(var(--holo-cyan-rgb), 0.7);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .status__dot.is-live {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .status__dot.is-live {
    animation: none;
  }
</style>
