<!--
  A labelled native <select> in the settings pages' field style: the same
  48px blush field as TextField, with a drawn chevron. Native, so the
  platform's picker (and its keyboard behaviour) is what people get on a
  phone.
-->
<script lang="ts" generics="T extends string">
  import Icon from '@/ui/Icon.svelte';

  interface Props {
    label: string;
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    hint?: string;
    disabled?: boolean;
    class?: string;
  }

  let { label, value = $bindable(), options, hint, disabled = false, class: className = '' }: Props = $props();

  const id = $props.id();
</script>

<div class="ev-select {className}">
  <label class="ev-select__label" for="{id}-select">{label}</label>
  <div class="ev-select__wrap">
    <select
      id="{id}-select"
      class="ev-select__input"
      bind:value
      {disabled}
      aria-describedby={hint ? `${id}-hint` : undefined}
    >
      {#each options as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
    <Icon name="chevron-down" size={18} stroke={1.8} class="ev-select__chev" />
  </div>
  {#if hint}<p class="ev-select__hint" id="{id}-hint">{hint}</p>{/if}
</div>

<style>
  .ev-select {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .ev-select__label {
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    line-height: 1.35;
    color: var(--text-strong);
  }
  .ev-select__wrap {
    position: relative;
  }
  .ev-select__input {
    box-sizing: border-box;
    width: 100%;
    min-height: 48px;
    padding: 0 44px 0 16px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--cream-0);
    color: var(--text-strong);
    font-family: var(--font-sans);
    font-size: var(--fs-label);
    line-height: 1.3;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    text-overflow: ellipsis;
  }
  .ev-select__input:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 1px;
    border-color: var(--focus-ring);
  }
  .ev-select__input:disabled {
    background: var(--surface-sunken);
    color: var(--text-secondary);
    cursor: not-allowed;
  }
  .ev-select__wrap :global(.ev-select__chev) {
    position: absolute;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-secondary);
    pointer-events: none;
  }
  .ev-select__hint {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text-secondary);
  }
</style>
