<!--
  The header bell. There is no notification feed yet, so by default it shows
  no badge and opens a small note saying so - a badge appears only when a
  page passes a real `count` above zero (BUILD-PLAN decision 2).
-->
<script lang="ts">
  import IconButton from '@/ui/IconButton.svelte';

  interface Props {
    tone?: 'light' | 'dark';
    count?: number;
    /** Replace the built-in "nothing new" note with your own handler. */
    onclick?: () => void;
    class?: string;
  }

  const { tone = 'light', count = 0, onclick, class: className = '' }: Props = $props();

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();
  const id = $props.id();
  const label = $derived(count > 0 ? `Notifications, ${count} new` : 'Notifications');

  function toggle() {
    if (onclick) onclick();
    else open = !open;
  }

  $effect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) open = false;
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') open = false;
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  });
</script>

<div class="ev-bell {className}" bind:this={root}>
  <IconButton
    icon="bell"
    {label}
    tone={tone === 'dark' ? 'dark' : 'light'}
    iconSize={26}
    expanded={onclick ? undefined : open}
    controls={onclick ? undefined : `${id}-note`}
    onclick={toggle}
  />
  {#if count > 0}
    <span class="ev-bell__badge t-num" aria-hidden="true">{count > 9 ? '9+' : count}</span>
  {/if}
  {#if open}
    <div class="ev-bell__note" id="{id}-note" role="status">
      <strong>You're all caught up.</strong>
      <span>Reminders and updates will show here.</span>
    </div>
  {/if}
</div>

<style>
  .ev-bell {
    position: relative;
    display: inline-flex;
  }
  .ev-bell__badge {
    position: absolute;
    top: 4px;
    right: 3px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--rose-700);
    color: var(--cream-0);
    font-size: var(--fs-meta);
    font-weight: var(--fw-semibold);
    line-height: 18px;
    text-align: center;
    pointer-events: none;
  }
  .ev-bell__note {
    position: absolute;
    top: calc(100% + 8px);
    right: -8px;
    z-index: var(--z-sheet);
    display: grid;
    gap: 2px;
    width: max-content;
    max-width: 260px;
    padding: 12px 14px;
    border-radius: var(--r-lg);
    background: var(--cream-0);
    border: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-md);
    color: var(--text);
    font-size: var(--fs-body-sm);
    line-height: 1.35;
  }
  .ev-bell__note strong {
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .ev-bell__note span {
    color: var(--text-secondary);
  }
</style>
