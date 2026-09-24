<!--
  The toast under the profile pill (progress.md 2.9).

  Sample mode keeps the mockup's "You're doing great!" on screen (it is a
  claim with no data behind it, so it never appears for real). Real mode shows
  a toast only when something real warrants one - a scan in the last two days
  that improved a reading past its noise floor - and lets it go after a few
  seconds. A tap dismisses either.
-->
<script lang="ts">
  import Icon from '@/ui/Icon.svelte';
  import type { ToastView } from '@/view/progress.ts';

  interface Props {
    toast: ToastView;
    /** Leave after this many ms; 0 stays until dismissed. */
    autoHide?: number;
    class?: string;
  }

  const { toast, autoHide = 0, class: className = '' }: Props = $props();
  let open = $state(true);

  $effect(() => {
    if (!autoHide || !open) return;
    const timer = setTimeout(() => (open = false), autoHide);
    return () => clearTimeout(timer);
  });
</script>

<div class="pg-toast {className}" role="status">
  {#if open}
    <div class="pg-toast__body">
      <p class="pg-toast__text">
        <span>{toast.title}</span>
        {#if toast.celebrate}
          <svg class="pg-toast__popper" width="17" height="16" viewBox="0 0 17 16" aria-hidden="true">
            <path d="M1.5 15 5 4.5l7 6.8Z" fill="#f2a33a" />
            <path d="M5 4.5 12 11.3 9.4 12.3 4.1 7.3Z" fill="#e5862c" />
            <circle cx="11.5" cy="3" r="1.1" fill="#e2566b" />
            <circle cx="14.6" cy="6.4" r="1" fill="#4f9ad8" />
            <circle cx="8.6" cy="1.6" r="0.9" fill="#7cb36a" />
            <path d="M13 1.2l.6 1.7M15.4 9.2l1.2.3M10 5.8l1.8-1.6" stroke="#e2566b" stroke-width="1" stroke-linecap="round" />
          </svg>
        {/if}
        <span class="pg-toast__line2">{toast.body}</span>
      </p>
      <span class="pg-toast__spark" aria-hidden="true">
        <Icon name="sparkle" size={20} filled />
        <i></i>
      </span>
      <button type="button" class="pg-toast__close" aria-label="Dismiss" onclick={() => (open = false)}></button>
    </div>
  {/if}
</div>

<style>
  .pg-toast__body {
    position: relative;
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 65px;
    padding: 12px 20px 12px 20px;
    border: 1px solid rgba(200, 150, 140, 0.24);
    border-radius: 32px;
    background: var(--blush-100);
    box-shadow: 0 6px 18px rgba(120, 60, 50, 0.08);
    animation: toast-in var(--dur-slow) var(--ease-out) both;
  }
  .pg-toast__text {
    flex: 1;
    margin: 0;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    line-height: 20px;
    color: var(--text-strong);
  }
  .pg-toast__popper {
    display: inline-block;
    margin-left: 4px;
    vertical-align: -2px;
  }
  .pg-toast__line2 {
    display: block;
  }
  .pg-toast__spark {
    position: relative;
    flex: none;
    color: var(--rose-600);
  }
  .pg-toast__spark i {
    position: absolute;
    top: -3px;
    right: -6px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
  }
  /* The whole toast is the dismiss target. */
  .pg-toast__close {
    position: absolute;
    inset: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
    cursor: pointer;
  }
  .pg-toast__close:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 2px;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
  }
</style>
