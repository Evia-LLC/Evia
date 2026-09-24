<!--
  One step in the routine list (routine.md C21-C24): the number badge, the
  package, the name with its one line and its amount, and a state control.

  done      sage row, sage badge, a green check          (sample only)
  current   coral row, coral badge, a play ring           (sample only;
            a step without a lesson has nothing to play, so it
            shows the open chevron instead)
  locked    off-white row, dusty badge, a lock            (sample only)
  open      off-white row: real mode's only state - no completion record
            either way, so nothing is ticked or locked. Its control shows the
            step in the card.

  The row whose step is in the card is marked `shown` (aria-current="step");
  for an open row that also takes the coral fill, since there is no "current"
  step to reserve it for.
-->
<script lang="ts">
  import Icon from '@/ui/Icon.svelte';
  import IconButton from '@/ui/IconButton.svelte';
  import type { RoutineStepView } from '@/view/routine.ts';
  import ProductArt from './ProductArt.svelte';

  interface Props {
    step: RoutineStepView;
    number: number;
    /** "Step" in the sample's sequence; "Suggestion" in a real plan. */
    noun?: 'Step' | 'Suggestion';
    shown: boolean;
    reordering?: boolean;
    first?: boolean;
    last?: boolean;
    onshow: () => void;
    onplay: () => void;
    onmove?: (by: -1 | 1) => void;
  }

  const {
    step,
    number,
    noun = 'Step',
    shown,
    reordering = false,
    first = false,
    last = false,
    onshow,
    onplay,
    onmove,
  }: Props = $props();

  const viewable = $derived(step.state !== 'locked');
  const label = $derived(
    step.state === 'done'
      ? 'Done'
      : step.state === 'current'
        ? 'Up next'
        : step.state === 'locked'
          ? 'Locked until the steps before it are done'
          : null,
  );
</script>

<li class="rt-row" data-state={step.state} class:is-shown={shown} aria-current={shown ? 'step' : undefined}>
  <!-- The whole row shows its step in the card; the control on the right is
       the row's own action. -->
  <button
    type="button"
    class="rt-row__main"
    disabled={!viewable || reordering}
    onclick={onshow}
    aria-label="{noun} {number}: {step.title}{label ? `. ${label}` : ''}{viewable && !shown ? '. Show in the card' : ''}"
  >
    <span class="rt-row__badge t-num" aria-hidden="true">{number}</span>
    <span class="rt-row__art" aria-hidden="true">
      <ProductArt kind={step.art} src={step.imageUrl} height={step.art === 'jar' ? 50 : 58} />
    </span>
    <span class="rt-row__text" aria-hidden="true">
      <span class="rt-row__title">{step.title}</span>
      {#if step.description}<span class="rt-row__desc">{step.description}</span>{/if}
      {#if step.amount}
        <span class="rt-row__amount">{step.amount}</span>
      {:else if step.stepLabel}
        <span class="rt-row__amount">{step.stepLabel}{step.coveredBy.length ? ' · already covered' : ''}</span>
      {/if}
    </span>
  </button>

  <span class="rt-row__end">
    {#if reordering && onmove}
      <IconButton icon="chevron-up" label="Move {step.title} up" size="sm" variant="soft" disabled={first} onclick={() => onmove(-1)} />
      <IconButton icon="chevron-down" label="Move {step.title} down" size="sm" variant="soft" disabled={last} onclick={() => onmove(1)} />
    {:else if step.state === 'done'}
      <span class="rt-row__done" role="img" aria-label="Done"><Icon name="check" size={16} stroke={2.2} /></span>
    {:else if step.state === 'current' && step.lesson}
      <button type="button" class="rt-row__play" aria-label="Play the {step.title} lesson" onclick={onplay}>
        <Icon name="play" size={13} />
      </button>
    {:else if step.state === 'locked'}
      <span class="rt-row__lock" role="img" aria-label="Locked"><Icon name="lock" size={16} stroke={1.6} /></span>
    {:else}
      <span class="rt-row__open" aria-hidden="true"><Icon name="chevron-right" size={18} /></span>
    {/if}
  </span>
</li>

<style>
  .rt-row {
    --row-fill: #f8e7e5;
    --row-border: transparent;
    --badge: #d1b7b7;
    --badge-ink: #241814;
    --desc: #574b48;
    position: relative;
    display: flex;
    align-items: center;
    min-height: 64px;
    border-radius: var(--r-md);
    background: var(--row-fill);
    box-shadow:
      inset 0 0 0 1px var(--row-border),
      inset 0 1px 0 rgba(255, 255, 255, 0.35);
    transition:
      background-color var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .rt-row[data-state='done'] {
    --row-fill: #e9e8e2;
    --row-border: #e1d9d3;
    --badge: #b1c0aa;
    --badge-ink: #1e2a1a;
    --desc: #46443f;
  }
  .rt-row[data-state='current'],
  .rt-row[data-state='open'].is-shown {
    --row-fill: #fcd0ca;
    --row-border: #eac4bf;
    --badge: #f09d90;
    --badge-ink: #3a120c;
    --desc: #5d4640;
    box-shadow:
      inset 0 0 0 1px var(--row-border),
      0 1px 0 #fadfdc;
  }
  /* A shown row that is not the coral one gets a coral edge instead. */
  .rt-row.is-shown:not([data-state='current']):not([data-state='open']) {
    box-shadow: inset 0 0 0 2px #e79c91;
  }

  .rt-row__main {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    min-height: 64px;
    padding: 0 0 0 13px;
    border: 0;
    border-radius: var(--r-md) 0 0 var(--r-md);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .rt-row__main:disabled {
    cursor: default;
  }
  .rt-row__main:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: -2px;
  }
  @media (hover: hover) {
    .rt-row:has(.rt-row__main:not(:disabled):hover) {
      box-shadow:
        inset 0 0 0 1px #d9aea8,
        var(--shadow-xs);
    }
  }

  .rt-row__badge {
    display: grid;
    place-items: center;
    flex: none;
    width: 24px;
    height: 24px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--badge);
    color: var(--badge-ink);
    font-size: var(--fs-small);
    font-weight: var(--fw-medium);
    line-height: 1;
  }
  .rt-row__art {
    display: grid;
    place-items: center;
    flex: none;
    width: 56px;
    height: 60px;
    margin: 0 9px 0 8px;
  }
  .rt-row__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 5px 6px 5px 0;
  }
  .rt-row__title {
    color: #1c1513;
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    line-height: 19px;
  }
  .rt-row__desc {
    color: var(--desc);
    font-size: var(--fs-body-sm);
    line-height: 18px;
  }
  .rt-row__amount {
    color: #352a27;
    font-size: var(--fs-meta);
    font-weight: var(--fw-medium);
    line-height: 17px;
  }

  .rt-row__end {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex: none;
    min-width: 56px;
    padding-right: 12px;
  }
  .rt-row__done {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--sage-500);
    color: #f2ffec;
  }
  .rt-row__play {
    position: relative;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0 0 0 2px;
    border: 1px solid #a8766e;
    border-radius: 50%;
    background: transparent;
    color: #0c0504;
    cursor: pointer;
  }
  .rt-row__play::before {
    content: '';
    position: absolute;
    inset: -6px;
    border-radius: 50%;
  }
  .rt-row__play:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 2px;
  }
  @media (hover: hover) {
    .rt-row__play:hover {
      background: rgba(255, 255, 255, 0.35);
    }
  }
  .rt-row__lock,
  .rt-row__open {
    display: grid;
    place-items: center;
    width: 33px;
    height: 33px;
    border-radius: 50%;
    background: #fbf1ef;
    box-shadow: inset 0 0 0 1px #eddcda;
    color: #271e1c;
  }
  .rt-row.is-shown .rt-row__open {
    background: rgba(255, 255, 255, 0.45);
    box-shadow: inset 0 0 0 1px #d9aea8;
  }

  @container routine (max-width: 420px) {
    .rt-row__main {
      padding-left: 10px;
    }
    .rt-row__art {
      width: 48px;
      margin: 0 8px;
    }
    .rt-row__end {
      min-width: 52px;
      padding-right: 10px;
    }
  }
</style>
