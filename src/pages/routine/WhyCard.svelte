<!--
  "Why this routine?" (routine.md C25): the rose note under the list. The
  whole card is the button; it opens in place to show, step by step, what put
  each step in the plan (real mode) - the sample's sentence stands alone.

  Real mode writes the sentence from what the plan was really built from (the
  latest reading, the profile when it holds anything) plus the plan's own
  caveat; the sample's "your goals / as we learn more about your skin" wording
  is listed for counsel.
-->
<script lang="ts">
  import Card from '@/ui/Card.svelte';
  import Icon from '@/ui/Icon.svelte';
  import type { RoutineWhy } from '@/view/routine.ts';

  interface Props {
    why: RoutineWhy;
  }

  const { why }: Props = $props();
  const id = $props.id();
  let open = $state(false);
  const expandable = $derived(why.details.length > 0);
</script>

<Card as="section" tone="rose" padding="none" class="rt-why" aria-labelledby="{id}-title">
  <button
    type="button"
    class="rt-why__head"
    aria-expanded={expandable ? open : undefined}
    aria-controls={expandable ? `${id}-more` : undefined}
    disabled={!expandable}
    onclick={() => (open = !open)}
  >
    <!-- The mockup's own mark: a capped badge with a drop-shaped "!" and rays. -->
    <svg class="rt-why__icon" width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="M9 9.5h5.5L17 6.5l2.5 3H25a3 3 0 0 1 3 3V27a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V12.5a3 3 0 0 1 3-3z" />
      <path d="M17 14.5c-.9 0-1.4.6-1.3 1.5l.6 5.2c.1.5.4.8.7.8s.6-.3.7-.8l.6-5.2c.1-.9-.4-1.5-1.3-1.5z" />
      <circle cx="17" cy="25" r=".6" fill="currentColor" />
      <path d="M3.5 6.5l1.2 1.2M30.5 6.5l-1.2 1.2M1.8 16h1.4M31.2 16h1.4" />
    </svg>
    <span class="rt-why__text">
      <span class="rt-why__title" id="{id}-title">{why.title}</span>
      <span class="rt-why__body">{why.body}</span>
    </span>
    {#if expandable}
      <span class="rt-why__chev" class:is-open={open} aria-hidden="true"><Icon name="chevron-right" size={20} stroke={1.5} /></span>
    {/if}
  </button>

  {#if expandable && open}
    <ul class="rt-why__more" id="{id}-more" role="list">
      {#each why.details as detail (detail.title)}
        <li>
          <span class="rt-why__step">{detail.title}</span>
          <span class="rt-why__reason">{detail.text}</span>
        </li>
      {/each}
    </ul>
  {/if}
</Card>

<style>
  .rt-why__head {
    display: flex;
    align-items: center;
    gap: 20px;
    width: 100%;
    min-height: 94px;
    padding: 15px 20px 15px 16px;
    border: 0;
    border-radius: var(--r-lg);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .rt-why__head:disabled {
    cursor: default;
  }
  .rt-why__head:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: -2px;
  }
  .rt-why__icon {
    flex: none;
    align-self: flex-start;
    margin-top: 2px;
    color: var(--terracotta-400);
  }
  .rt-why__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .rt-why__title {
    color: #20100e;
    font-size: 16.5px;
    font-weight: var(--fw-medium);
    line-height: 20px;
  }
  .rt-why__body {
    max-width: 62ch;
    color: #5b4441;
    font-size: var(--fs-body-sm);
    line-height: 17px;
  }
  .rt-why__chev {
    display: grid;
    place-items: center;
    flex: none;
    color: #6a4f4b;
    transition: transform var(--dur-base) var(--ease-out);
  }
  .rt-why__chev.is-open {
    transform: rotate(90deg);
  }
  @media (hover: hover) {
    .rt-why__head:not(:disabled):hover .rt-why__chev:not(.is-open) {
      transform: translateX(2px);
    }
  }

  .rt-why__more {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0 20px 18px 70px;
    list-style: none;
  }
  .rt-why__more li {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rt-why__step {
    color: var(--text-strong);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
  }
  .rt-why__reason {
    color: var(--text-secondary);
    font-size: var(--fs-body-sm);
    line-height: 1.4;
  }

  @container routine (max-width: 420px) {
    .rt-why__head {
      gap: 14px;
      padding: 14px 14px 14px 12px;
    }
    .rt-why__more {
      padding-left: 60px;
    }
  }
</style>
