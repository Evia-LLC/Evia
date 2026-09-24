<!--
  A horizontal bar: the score card's per-metric rows, a lesson's scrubber
  track, an upload.

  `value` is out of `max` (100 by default). With `label` it draws the row the
  Progress mockup uses (label left, value right, bar under); without, just the
  bar, named for screen readers by `label` anyway (pass `hideLabel`).
  `valueText` overrides what is read out and shown ("78", "3 of 4").
-->
<script lang="ts">
  interface Props {
    value: number;
    max?: number;
    label: string;
    hideLabel?: boolean;
    valueText?: string;
    tone?: 'rose' | 'sage' | 'holo' | 'dark';
    size?: 'sm' | 'md';
    class?: string;
  }

  const {
    value,
    max = 100,
    label,
    hideLabel = false,
    valueText,
    tone = 'rose',
    size = 'md',
    class: className = '',
  }: Props = $props();

  const fraction = $derived(max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);
  const shown = $derived(valueText ?? String(Math.round(value)));
  const id = $props.id();
</script>

<div class="ev-bar ev-bar--{tone} ev-bar--{size} {className}" class:has-label={!hideLabel}>
  {#if !hideLabel}
    <div class="ev-bar__row">
      <span class="ev-bar__label" id="{id}-label">{label}</span>
      <span class="ev-bar__value t-num" aria-hidden="true">{shown}</span>
    </div>
  {/if}
  <div
    class="ev-bar__track"
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={max}
    aria-valuenow={value}
    aria-valuetext={valueText}
    aria-labelledby={hideLabel ? undefined : `${id}-label`}
    aria-label={hideLabel ? label : undefined}
  >
    <span class="ev-bar__fill" style:width="{fraction * 100}%"></span>
  </div>
</div>

<style>
  .ev-bar {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .ev-bar__row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .ev-bar__label {
    font-size: var(--fs-body-sm);
    color: var(--text);
  }
  .ev-bar__value {
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .ev-bar__track {
    position: relative;
    height: 10px;
    border-radius: 5px;
    background: var(--bar-track);
    overflow: hidden;
  }
  .ev-bar--sm .ev-bar__track {
    height: 6px;
    border-radius: 3px;
  }
  .ev-bar__fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background:
      linear-gradient(180deg, var(--bar-sheen), transparent 60%),
      linear-gradient(90deg, var(--bar-from), var(--bar-to));
    transition: width var(--dur-slow) var(--ease-out);
  }
  .ev-bar--sage .ev-bar__fill {
    background: linear-gradient(90deg, var(--sage-400), var(--sage-600));
  }
  .ev-bar--holo .ev-bar__track {
    background: var(--holo-track);
  }
  .ev-bar--holo .ev-bar__fill {
    background: linear-gradient(90deg, var(--holo-rim), var(--holo-cyan));
  }
  .ev-bar--dark .ev-bar__track {
    background: var(--scrub-rest);
  }
  .ev-bar--dark .ev-bar__fill {
    background: var(--scrub-played);
  }
  .ev-bar--dark .ev-bar__label {
    color: var(--text-on-dark);
  }
  .ev-bar--dark .ev-bar__value {
    color: var(--text-on-dark-strong);
  }
</style>
