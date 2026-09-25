<!--
  The frame for the dashboard pages the mockups do not show - Learn,
  Settings and the pages under it (Profile, Privacy, Your data) - drawn in the
  Progress dashboard's language (BUILD-PLAN decision 9): the serif page title
  and serif subtitle top-left, the bell and the light profile pill top-right,
  and the cards below on the page wash.

  It replaced the legacy `components/Page.svelte` frame (now removed), which
  graded a dark column over the old 3D room; this one sits on the shell's
  light wash and leaves the layout of the cards to the page.

  back      a breadcrumb above the title, for pages that live under Settings
  actions   extra header controls, placed before the bell
  width     wide (the dashboard's full content width) or narrow (a reading
            column, for long single-column pages)

  The bell and the pill sit where they sit on every dashboard page (the
  --topbar-* tokens: 16px down, 24px in), and the title starts at the same
  height as Progress's. The pill shows on the Profile page too, marked as the
  current page, so the header does not change shape there.

  Phones: the title steps down (the tokens do that below 820px), the profile
  pill shrinks to its avatar, and the header clears the sample-data badge.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { link } from '@/router/router.svelte.ts';
  import Icon from '@/ui/Icon.svelte';
  import NotificationBell from '@/shell/NotificationBell.svelte';
  import ProfilePill from '@/shell/ProfilePill.svelte';

  interface Props {
    title: string;
    subtitle?: string;
    back?: { href: string; label: string };
    width?: 'wide' | 'narrow';
    actions?: Snippet;
    children: Snippet;
  }

  const { title, subtitle, back, width = 'wide', actions, children }: Props = $props();
</script>

<div class="ev-page ev-page--{width}">
  <header class="ev-page__head">
    <div class="ev-page__titles">
      {#if back}
        <a class="ev-page__back" href={back.href} use:link>
          <Icon name="chevron-left" size={18} stroke={1.8} />
          <span>{back.label}</span>
        </a>
      {/if}
      <h1 class="ev-page__title">{title}</h1>
      {#if subtitle}<p class="ev-page__sub">{subtitle}</p>{/if}
    </div>
    <div class="ev-page__tools">
      {#if actions}{@render actions()}{/if}
      <NotificationBell tone="light" />
      <ProfilePill tone="light" class="ev-page__pill" />
      <ProfilePill tone="light" compact class="ev-page__pill-compact" />
    </div>
  </header>

  <div class="ev-page__body">
    {@render children()}
  </div>
</div>

<style>
  .ev-page {
    --page-x: clamp(16px, 1.8vw, 27px);
    box-sizing: border-box;
    width: 100%;
    max-width: calc(var(--content-max) + 2 * var(--page-x));
    min-height: 100%;
    margin: 0 auto;
    padding: 0 var(--page-x) 40px;
    color: var(--text);
  }
  .ev-page--narrow {
    max-width: calc(980px + 2 * var(--page-x));
  }

  /* The header band: the title block inset 17px from the cards' edge, as the
     Progress title is, and the tools on its right. */
  .ev-page__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px 24px;
    /* The tools' right edge at --topbar-right from the page's edge, whatever
       the page gutter is at this width. */
    margin-right: calc(var(--topbar-right) - var(--page-x));
    padding: var(--topbar-top) 0 24px 17px;
  }
  .ev-page__titles {
    min-width: 0;
  }
  /* Block-level (not inline-flex in a line box), so its 44px target is laid
     out in full and the title below starts under it, not across its foot. */
  .ev-page__back {
    display: flex;
    width: fit-content;
    align-items: center;
    gap: 2px;
    /* A 44px target that reads as a small breadcrumb. */
    min-height: 44px;
    margin: -10px 0 2px -6px;
    padding: 0 10px 0 4px;
    border-radius: var(--r-pill);
    color: var(--text-secondary);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    text-decoration: none;
    transition:
      background-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }
  @media (hover: hover) {
    .ev-page__back:hover {
      background: var(--tint-hover);
      color: var(--text-strong);
    }
  }
  .ev-page__back:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .ev-page__title {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--fs-h1);
    font-weight: var(--fw-regular);
    line-height: 1.05;
    letter-spacing: var(--tr-title);
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }
  .ev-page__sub {
    margin: 10px 0 0;
    max-width: 60ch;
    font-family: var(--font-serif);
    font-size: 19px;
    line-height: 1.35;
    color: var(--text);
  }

  .ev-page__tools {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--topbar-gap);
  }
  .ev-page__tools :global(.ev-page__pill-compact) {
    display: none;
  }

  .ev-page__body {
    display: grid;
    gap: 16px;
  }

  /* Phone: the bell and an avatar-only profile beside the title, and room at
     the top for the sample badge. */
  @media (max-width: 819px) {
    .ev-page {
      padding-bottom: 28px;
    }
    .ev-page__head {
      position: relative;
      margin-right: 0;
      padding: calc(12px + var(--sample-space, 0px) + var(--safe-t)) 2px 18px;
    }
    .ev-page__titles {
      padding-top: 4px;
    }
    .ev-page__sub {
      margin-top: 8px;
      font-size: 17px;
    }
    .ev-page__tools {
      margin-top: 0;
      gap: 4px;
    }
    .ev-page__tools :global(.ev-page__pill) {
      display: none;
    }
    .ev-page__tools :global(.ev-page__pill-compact) {
      display: inline-flex;
    }
  }
</style>
