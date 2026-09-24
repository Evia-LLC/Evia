<!--
  A labelled text input for the settings pages (and the confirmation field on
  Your data): the label above, a 48px blush field with a 3:1 edge, an
  optional hint under it that the input is described by.

  The input is not wrapped in its label: an explicit for/id keeps the
  accessible name exactly the label's words.
-->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props {
    label: string;
    value: string;
    hint?: string;
    placeholder?: string;
    type?: 'text' | 'email';
    autocomplete?: HTMLInputAttributes['autocomplete'];
    disabled?: boolean;
    /** An accessible name that differs from the visible label. */
    ariaLabel?: string;
    /** Width of the field itself; the label and hint keep the column's width. */
    size?: 'full' | 'short';
    class?: string;
  }

  let {
    label,
    value = $bindable(),
    hint,
    placeholder,
    type = 'text',
    autocomplete,
    disabled = false,
    ariaLabel,
    size = 'full',
    class: className = '',
  }: Props = $props();

  const id = $props.id();
</script>

<div class="ev-field {className}">
  <label class="ev-field__label" for="{id}-input">{label}</label>
  <input
    id="{id}-input"
    class="ev-field__input ev-field__input--{size}"
    {type}
    bind:value
    {placeholder}
    {autocomplete}
    {disabled}
    aria-label={ariaLabel}
    aria-describedby={hint ? `${id}-hint` : undefined}
  />
  {#if hint}<p class="ev-field__hint" id="{id}-hint">{hint}</p>{/if}
</div>

<style>
  .ev-field {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .ev-field__label {
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    line-height: 1.3;
    color: var(--text-strong);
  }
  .ev-field__input {
    box-sizing: border-box;
    width: 100%;
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--cream-0);
    color: var(--text-strong);
    font-family: var(--font-sans);
    font-size: var(--fs-label);
    line-height: 1.3;
    transition:
      border-color var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .ev-field__input--short {
    max-width: 22rem;
  }
  .ev-field__input::placeholder {
    color: var(--text-muted);
    opacity: 1;
  }
  .ev-field__input:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 1px;
    border-color: var(--focus-ring);
  }
  .ev-field__input:disabled {
    background: var(--surface-sunken);
    color: var(--text-secondary);
    cursor: not-allowed;
  }
  .ev-field__hint {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text-secondary);
  }
</style>
