<!--
  A metric card on the pedestal tray (specs/scan.md 2.7): a gauge disc with the
  metric's glyph, the title over a short hairline, the value, a rose status
  line, and a two-line description in the chosen register.

  Sample mode draws the mockup's ring: half full on every card whatever the
  number, which is decoration and is labelled as such to assistive tech. Real
  mode has no number to draw - the value is the band word - so the ring is a
  plain track (`arc: null`), never a gauge.
-->
<script lang="ts">
  import Ring from '@/ui/Ring.svelte';
  import type { ExplainStyle, ScanCard } from '@/view/scan.ts';
  import Glyph from './Glyph.svelte';

  interface Props {
    card: ScanCard;
    style: ExplainStyle;
    active?: boolean;
    index?: number;
    /** The gauge's diameter, px (smaller on the desk stage at the smaller desktop sizes). */
    gauge?: number;
    class?: string;
  }

  const { card, style, active = false, index = 0, gauge = 70, class: className = '' }: Props = $props();

  const titleId = $derived(`scan-card-${card.id}`);
</script>

<article class="mcard {className}" class:is-active={active} style:--i={index} aria-labelledby={titleId}>
  <div class="mcard__gauge" style:--gauge="{gauge}px">
    <span class="mcard__disc" aria-hidden="true"></span>
    <Ring
      value={card.arc === null ? 0 : card.arc * 100}
      size={gauge}
      thickness={2}
      tone="holo"
      label={card.arc === null ? `${card.title.toLowerCase()}: no gauge, band only` : 'Decorative gauge, not a measurement'}
      class="mcard__ring"
    >
      <span class="mcard__glyph"><Glyph name={card.glyph} size={Math.round(((card.glyph === 'texture' ? 24 : 26) * gauge) / 70)} stroke={1.6} /></span>
    </Ring>
  </div>
  <div class="mcard__head">
    <h3 class="mcard__title" id={titleId}>{card.title}</h3>
    <p class="mcard__value" class:is-band={card.valueKind === 'band'}>{card.value}</p>
    {#if card.status}<p class="mcard__status">{card.status}</p>{/if}
  </div>
  {#key style}
    <p class="mcard__desc">{card.copy[style]}</p>
  {/key}
</article>

<style>
  .mcard {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas:
      'gauge head'
      'desc desc';
    column-gap: var(--card-gap, 14px);
    row-gap: 8px;
    align-items: center;
    padding: var(--card-pad, 12px 14px 12px 12px);
    border-radius: 12px;
    background: var(--scan-card, rgba(22, 27, 42, 0.88));
    box-shadow:
      inset 0 0 0 1px rgba(110, 135, 180, 0.45),
      inset 0 1px 0 rgba(180, 200, 240, 0.12),
      0 10px 24px rgba(0, 0, 0, 0.35);
    color: var(--holo-ink-body);
    animation: mcard-in 460ms var(--ease-out) both;
    animation-delay: calc(1.7s + var(--i) * 90ms);
  }
  .mcard.is-active {
    box-shadow:
      inset 0 0 0 1px rgba(160, 200, 255, 0.6),
      0 0 18px rgba(134, 221, 248, 0.16),
      0 10px 24px rgba(0, 0, 0, 0.35);
  }
  .mcard__gauge {
    grid-area: gauge;
    position: relative;
    width: var(--gauge, 70px);
    height: var(--gauge, 70px);
  }
  .mcard__disc {
    position: absolute;
    inset: 2px;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 45%, #26344c, #1b293e);
  }
  .mcard__glyph {
    display: grid;
    place-items: center;
    color: #a6d0e8;
    filter: drop-shadow(0 0 3px rgba(140, 190, 230, 0.45));
  }
  .mcard__head {
    grid-area: head;
    min-width: 0;
  }
  .mcard__title {
    margin: 0;
    font-size: var(--card-title, var(--s-head, 12px));
    font-weight: var(--fw-semibold);
    letter-spacing: 0.045em;
    line-height: 1.2;
    text-transform: uppercase;
    color: #e3eeff;
  }
  .mcard__title::after {
    content: '';
    display: block;
    width: 2.3em;
    height: 1px;
    margin: 6px 0 6px;
    background: linear-gradient(90deg, rgba(190, 205, 235, 0.55), transparent);
  }
  .mcard__value {
    margin: 0;
    font-size: var(--s-value, 22px);
    font-weight: var(--fw-light);
    line-height: 1.05;
    letter-spacing: -0.005em;
    color: #f2f8ff;
    font-variant-numeric: tabular-nums lining-nums;
  }
  .mcard__value.is-band {
    font-size: var(--s-band, 20px);
  }
  .mcard__status {
    margin: 5px 0 0;
    font-size: var(--s-meta, 12px);
    line-height: 1.3;
    color: #e2b0ba;
  }
  .mcard__desc {
    grid-area: desc;
    margin: 0;
    font-size: var(--s-body, 14px);
    line-height: 1.38;
    color: #c9d3ec;
    animation: desc-in 180ms var(--ease-out) both;
  }
  @keyframes mcard-in {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
  }
  @keyframes desc-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mcard,
    .mcard__desc {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .mcard,
  :global([data-reduced-motion='true']) .mcard__desc {
    animation: none;
  }
</style>
