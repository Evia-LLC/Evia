<!--
  OBSERVED CONCERNS (specs/scan.md 2.5): a glass list of what the reading
  flagged, one row per concern with its glyph in a thin ring and the band word
  right-aligned. The severity column is one muted rose for every level, as in
  the mockup: it is a word to read, not a traffic light.

  Real mode rows come from the analysis only (src/view/scan.ts); when nothing
  reached a band the panel says so plainly, without calling the skin healthy
  (SRS section 10).
-->
<script lang="ts">
  import type { SkinMetricKey } from '@shared/types.ts';
  import type { ScanConcern } from '@/view/scan.ts';
  import Glyph from './Glyph.svelte';

  interface Props {
    rows: ScanConcern[];
    empty: string | null;
    active?: SkinMetricKey | null;
    class?: string;
  }

  const { rows, empty, active = null, class: className = '' }: Props = $props();
</script>

<section class="concerns {className}" aria-labelledby="scan-concerns-title">
  <header class="concerns__head">
    <h2 class="concerns__title" id="scan-concerns-title">Observed concerns</h2>
  </header>
  {#if rows.length}
    <ul class="concerns__rows">
      {#each rows as row, i (row.id)}
        <li class="concerns__row" class:is-active={row.metric !== null && row.metric === active} style:--i={i}>
          <span class="concerns__icon concerns__icon--{row.tone}"><Glyph name={row.glyph} size={24} ring /></span>
          <span class="concerns__label">{row.label}</span>
          {#if row.severity}<span class="concerns__sev">{row.severity}</span>{/if}
        </li>
      {/each}
    </ul>
  {:else if empty}
    <p class="concerns__empty">{empty}</p>
  {/if}
</section>

<style>
  .concerns {
    border-radius: 12px;
    background: var(--scan-glass-2, rgba(10, 14, 24, 0.62));
    box-shadow: inset 0 0 0 1px rgba(150, 170, 210, 0.28);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    overflow: hidden;
    animation: concerns-in 420ms var(--ease-out) both;
    animation-delay: 1.35s;
  }
  .concerns__head {
    position: relative;
    padding: 12px 16px 10px;
    background: rgba(8, 12, 20, 0.35);
    border-bottom: 1px solid rgba(160, 180, 220, 0.12);
  }
  .concerns__head::before {
    content: '';
    position: absolute;
    left: 6px;
    top: 5px;
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: rgba(174, 191, 224, 0.7);
  }
  .concerns__title {
    margin: 0;
    font-size: var(--s-panel, 13px);
    font-weight: var(--fw-medium);
    letter-spacing: 0.07em;
    line-height: 1.2;
    text-transform: uppercase;
    color: #e6f0ff;
  }
  .concerns__rows {
    margin: 0;
    padding: 6px 14px 10px 12px;
    list-style: none;
  }
  .concerns__row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    min-height: var(--row-h, 34px);
    /* A row that does wrap (a narrow panel) keeps clear of its neighbours. */
    padding-block: 3px;
    animation: concerns-in 360ms var(--ease-out) both;
    animation-delay: calc(1.5s + var(--i) * 60ms);
  }
  .concerns__icon {
    display: grid;
    place-items: center;
  }
  .concerns__icon--blue {
    color: #9cc3ee;
  }
  .concerns__icon--steel {
    color: #93b1dc;
  }
  .concerns__icon--rose {
    color: #d7a3b1;
  }
  .concerns__icon--periwinkle {
    color: #b9c6e8;
  }
  .concerns__icon--lavender {
    color: #cbc4e4;
  }
  .concerns__label {
    font-size: var(--s-list, 14px);
    font-weight: var(--fw-medium);
    line-height: 1.25;
    color: #cdd8f0;
  }
  .concerns__sev {
    font-size: var(--s-meta, 12px);
    line-height: 1.2;
    color: #d0adb7;
    text-align: right;
    white-space: nowrap;
  }
  .concerns__row.is-active .concerns__label {
    color: #f2f8ff;
  }
  .concerns__empty {
    margin: 0;
    padding: 12px 16px 14px;
    font-size: var(--s-list, 14px);
    line-height: 1.45;
    color: var(--holo-ink-body);
  }
  @keyframes concerns-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .concerns,
    .concerns__row {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .concerns,
  :global([data-reduced-motion='true']) .concerns__row {
    animation: none;
  }
</style>
