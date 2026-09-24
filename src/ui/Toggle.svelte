<!--
  An on/off switch with its label (settings rows, "progress photos", voice).

  A real button with role="switch", so Space and Enter work and the state is
  read out. The label is a <label> for it, so tapping the words flips it too;
  the switch itself is a 48x44 target around a 44x26 track.
-->
<script lang="ts">
  interface Props {
    checked: boolean;
    label: string;
    /** A line under the label, for what the switch does. */
    description?: string;
    disabled?: boolean;
    tone?: 'light' | 'dark';
    onchange?: (checked: boolean) => void;
    class?: string;
  }

  let {
    checked = $bindable(),
    label,
    description,
    disabled = false,
    tone = 'light',
    onchange,
    class: className = '',
  }: Props = $props();

  const id = $props.id();

  function flip() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<div class="ev-toggle ev-toggle--{tone} {className}" class:is-disabled={disabled}>
  <span class="ev-toggle__text">
    <label class="ev-toggle__label" id="{id}-label" for="{id}-switch">{label}</label>
    {#if description}<span class="ev-toggle__desc" id="{id}-desc">{description}</span>{/if}
  </span>
  <button
    type="button"
    class="ev-toggle__switch"
    class:is-on={checked}
    id="{id}-switch"
    role="switch"
    aria-checked={checked}
    aria-labelledby="{id}-label"
    aria-describedby={description ? `${id}-desc` : undefined}
    {disabled}
    onclick={flip}
  >
    <span class="ev-toggle__knob" aria-hidden="true"></span>
  </button>
</div>

<style>
  .ev-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 44px;
  }
  .ev-toggle__text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .ev-toggle__label {
    cursor: pointer;
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .ev-toggle__desc {
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
  .ev-toggle--dark .ev-toggle__label {
    color: var(--text-on-dark-strong);
  }
  .ev-toggle--dark .ev-toggle__desc {
    color: var(--text-on-dark-muted);
  }

  .ev-toggle__switch {
    position: relative;
    flex: none;
    width: 48px;
    height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .ev-toggle__switch::before {
    content: '';
    position: absolute;
    left: 2px;
    right: 2px;
    top: 9px;
    height: 26px;
    border-radius: 13px;
    background: var(--toggle-off);
    box-shadow: inset 0 0 0 1px var(--border-strong);
    transition: background-color var(--dur-base) var(--ease-out);
  }
  .ev-toggle__switch.is-on::before {
    background: var(--accent-strong);
    box-shadow: none;
  }
  .ev-toggle__knob {
    position: absolute;
    top: 12px;
    left: 5px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--cream-0);
    box-shadow: var(--shadow-xs), 0 0 0 1px var(--border);
    transition: transform var(--dur-base) var(--ease-out);
  }
  .ev-toggle__switch.is-on .ev-toggle__knob {
    transform: translateX(18px);
    box-shadow: var(--shadow-xs);
  }
  .ev-toggle__switch:focus-visible {
    outline: none;
  }
  .ev-toggle__switch:focus-visible::before {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .ev-toggle--dark .ev-toggle__switch {
    --focus-ring: var(--focus-ring-on-dark);
  }
  .ev-toggle--dark .ev-toggle__switch::before {
    background: var(--tint-press-dark);
    box-shadow: inset 0 0 0 1px var(--border-on-dark-strong);
  }
  .ev-toggle--dark .ev-toggle__switch.is-on::before {
    background: var(--rose-400);
  }
  .is-disabled {
    opacity: 0.5;
  }
  .is-disabled .ev-toggle__switch {
    cursor: not-allowed;
  }
</style>
