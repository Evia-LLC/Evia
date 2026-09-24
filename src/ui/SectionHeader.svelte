<!--
  The head of a card or a section: an optional icon (bare, or on the coral
  disc the Progress cards use), the title, an optional serif accent after it
  ("Recommended *for you*"), a subtitle, and an action on the right ("View
  all", an expand button) passed as a snippet.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';

  interface Props {
    title: string;
    /** Set in the display serif after the title, e.g. "for you". */
    accent?: string;
    subtitle?: string;
    icon?: IconName;
    /** bare (icon only), coral / rose / sage disc behind the icon. */
    iconStyle?: 'bare' | 'coral' | 'rose' | 'sage';
    level?: 2 | 3 | 4;
    size?: 'sm' | 'md' | 'lg';
    tone?: 'light' | 'dark';
    /** Id for the heading, so the section can be aria-labelledby it. */
    id?: string;
    class?: string;
    action?: Snippet;
  }

  const {
    title,
    accent,
    subtitle,
    icon,
    iconStyle = 'coral',
    level = 2,
    size = 'md',
    tone = 'light',
    id,
    class: className = '',
    action,
  }: Props = $props();
</script>

<header class="ev-sechead ev-sechead--{size} ev-sechead--{tone} {className}">
  {#if icon}
    <span class="ev-sechead__icon ev-sechead__icon--{iconStyle}" aria-hidden="true">
      <Icon name={icon} size={iconStyle === 'bare' ? 26 : 20} />
    </span>
  {/if}
  <div class="ev-sechead__text">
    <svelte:element this={`h${level}`} class="ev-sechead__title" {id}>
      {title}{#if accent}{' '}<span class="ev-sechead__accent">{accent}</span>{/if}
    </svelte:element>
    {#if subtitle}<p class="ev-sechead__sub">{subtitle}</p>{/if}
  </div>
  {#if action}<div class="ev-sechead__action">{@render action()}</div>{/if}
</header>

<style>
  .ev-sechead {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .ev-sechead__text {
    flex: 1;
    min-width: 0;
  }
  .ev-sechead__title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--fs-title-sm);
    font-weight: var(--fw-medium);
    line-height: var(--lh-snug);
    letter-spacing: var(--tr-title);
    color: var(--text-strong);
  }
  .ev-sechead--sm .ev-sechead__title {
    font-size: var(--fs-lead);
  }
  .ev-sechead--lg .ev-sechead__title {
    font-size: var(--fs-title);
  }
  .ev-sechead__accent {
    font-family: var(--font-serif);
    font-size: 1.08em;
    font-weight: var(--fw-regular);
    letter-spacing: -0.01em;
  }
  .ev-sechead__sub {
    margin: 4px 0 0;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text-secondary);
  }
  .ev-sechead__action {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ev-sechead__icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    align-self: flex-start;
  }
  .ev-sechead__icon--bare {
    width: auto;
    height: auto;
    color: var(--rose-icon);
  }
  .ev-sechead__icon--coral {
    background: var(--rose-500);
    color: var(--cream-0);
  }
  .ev-sechead__icon--rose {
    background: var(--disc-pink);
    color: var(--rose-600);
  }
  .ev-sechead__icon--sage {
    background: var(--sage-green-disc);
    color: var(--cream-0);
  }

  .ev-sechead--dark .ev-sechead__title {
    color: var(--text-on-dark-strong);
  }
  .ev-sechead--dark .ev-sechead__sub {
    color: var(--text-on-dark-muted);
  }
</style>
