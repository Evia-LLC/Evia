<!--
  One row of a settings list: an icon on a soft disc, a title, a line of what
  it is, and on the right either a chevron (a link to a page) or a tag.

  href    the row is a link; in-app paths route without a reload
  status  a tag in place of the chevron. "soon" is the SRS section 11 control
          that does not exist yet: the row is plain text, not a link and not
          a disabled button, so nothing pretends it can be pressed.
  tag     a short label beside the title (e.g. "Draft" on a legal document)

  Rendered as an <li>; put rows in a <ul class="..." role="list">.
-->
<script lang="ts">
  import { link } from '@/router/router.svelte.ts';
  import Icon from '@/ui/Icon.svelte';
  import Pill from '@/ui/Pill.svelte';
  import type { IconName } from '@/ui/icons.ts';

  interface Props {
    title: string;
    description?: string;
    icon?: IconName;
    href?: string;
    status?: 'soon';
    tag?: string;
  }

  const { title, description, icon, href, status, tag }: Props = $props();
</script>

{#snippet body()}
  {#if icon}
    <span class="ev-row__icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
  {/if}
  <span class="ev-row__text">
    <span class="ev-row__title">
      {title}
      {#if tag}<span class="ev-row__tag">{tag}</span>{/if}
      {#if status === 'soon'}<span class="ev-row__soon-inline">Coming soon</span>{/if}
    </span>
    {#if description}<span class="ev-row__desc">{description}</span>{/if}
  </span>
  {#if status === 'soon'}
    <Pill size="sm" tone="neutral" class="ev-row__soon">Coming soon</Pill>
  {:else if href}
    <Icon name="chevron-right" size={20} stroke={1.7} class="ev-row__chev" />
  {/if}
{/snippet}

<li class="ev-row" class:is-soon={status === 'soon'}>
  {#if href && status !== 'soon'}
    <a class="ev-row__inner ev-row__inner--link" {href} use:link>{@render body()}</a>
  {:else}
    <div class="ev-row__inner">{@render body()}</div>
  {/if}
</li>

<style>
  .ev-row {
    list-style: none;
  }
  .ev-row:not(:first-child) {
    border-top: 1px solid var(--divider);
  }
  .ev-row__inner {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 64px;
    padding: 10px 8px;
    color: var(--text);
    text-decoration: none;
  }
  .ev-row__inner--link {
    margin: 0 -8px;
    padding-inline: 16px;
    border-radius: var(--r-md);
    transition: background-color var(--dur-base) var(--ease-out);
  }
  @media (hover: hover) {
    .ev-row__inner--link:hover {
      background: var(--tint-hover);
    }
    .ev-row__inner--link:hover :global(.ev-row__chev) {
      transform: translateX(2px);
    }
  }
  .ev-row__inner--link:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 0;
  }

  .ev-row__icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--disc-pink);
    color: var(--terracotta-500);
  }
  .is-soon .ev-row__icon {
    background: var(--surface-sunken);
    color: var(--text-muted);
  }

  .ev-row__text {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .ev-row__title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    font-size: var(--fs-label);
    font-weight: var(--fw-medium);
    line-height: 1.3;
    color: var(--text-strong);
  }
  .ev-row__tag {
    font-size: var(--fs-micro);
    font-weight: var(--fw-semibold);
    letter-spacing: var(--tr-micro);
    text-transform: uppercase;
    color: var(--amber-900);
  }
  .ev-row__desc {
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text-secondary);
  }
  .ev-row :global(.ev-row__chev) {
    flex: none;
    color: var(--text-muted);
    transition: transform var(--dur-base) var(--ease-out);
  }
  .ev-row :global(.ev-row__soon) {
    flex: none;
  }

  .ev-row__soon-inline {
    display: none;
  }
  /* Narrow phones: the "Coming soon" tag moves up beside the title, so the
     description keeps the row's full width. */
  @media (max-width: 480px) {
    .ev-row :global(.ev-row__soon) {
      display: none;
    }
    .ev-row__soon-inline {
      display: inline;
      font-size: var(--fs-micro);
      font-weight: var(--fw-semibold);
      letter-spacing: var(--tr-micro);
      text-transform: uppercase;
      color: var(--text-muted);
    }
  }
</style>
