<!--
  The header profile pill: initials avatar, display name, and a membership
  line only when there is one to show. The app has no membership data, so in
  real mode there is none; sample mode shows the mockups' "Premium Member"
  (BUILD-PLAN decision 2). No photo, ever (decision 3).

  tone     dark (glass over the room, Home) or light (blush, dashboards)
  compact  the avatar alone, for phone top bars
  Links to the profile page.
-->
<script lang="ts">
  import { link } from '@/router/router.svelte.ts';
  import { session } from '@/state/session.svelte.ts';
  import { sample } from '@/sample/mode.svelte.ts';
  import Avatar from '@/ui/Avatar.svelte';
  import Icon from '@/ui/Icon.svelte';

  interface Props {
    tone?: 'dark' | 'light';
    /** Override the name (defaults to the session's, or the sample's). */
    name?: string;
    /** Override the membership line; null hides it. */
    membership?: string | null;
    compact?: boolean;
    href?: string;
    class?: string;
  }

  const { tone = 'light', name, membership, compact = false, href = '/profile', class: className = '' }: Props =
    $props();

  const shownName = $derived(
    name ?? (sample.on ? 'Destiny' : (session.user?.displayName ?? (session.guest ? 'Guest' : ''))),
  );
  const shownMembership = $derived(membership === undefined ? (sample.on ? 'Premium Member' : null) : membership);
  const label = $derived(`Your profile${shownName ? `, ${shownName}` : ''}`);
</script>

<a class="ev-profile ev-profile--{tone} {className}" class:is-compact={compact} {href} use:link aria-label={label}>
  <Avatar name={shownName} size={compact ? 40 : 52} />
  {#if !compact}
    <span class="ev-profile__text" aria-hidden="true">
      <span class="ev-profile__name">{shownName || 'Your profile'}</span>
      {#if shownMembership}<span class="ev-profile__meta">{shownMembership}</span>{/if}
    </span>
    <Icon name="chevron-right" size={20} stroke={1.7} class="ev-profile__chev" />
  {/if}
</a>

<style>
  .ev-profile {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    min-height: 64px;
    padding: 5px 16px 5px 5px;
    border-radius: var(--r-pill);
    text-decoration: none;
    transition:
      background-color var(--dur-base) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
    max-width: 100%;
  }
  .ev-profile.is-compact {
    min-height: 44px;
    padding: 2px;
  }
  .ev-profile:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .ev-profile__text {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding-right: 14px;
  }
  .ev-profile__name {
    font-size: var(--fs-label);
    font-weight: var(--fw-semibold);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ev-profile__meta {
    font-size: var(--fs-meta);
    line-height: 1.2;
    white-space: nowrap;
  }
  .ev-profile :global(.ev-profile__chev) {
    margin-left: auto;
    transition: transform var(--dur-base) var(--ease-out);
  }
  @media (hover: hover) {
    .ev-profile:hover :global(.ev-profile__chev) {
      transform: translateX(2px);
    }
  }

  .ev-profile--light {
    background: var(--surface-pill);
    border: 1px solid var(--blush-200);
    color: var(--text-strong);
  }
  .ev-profile--light .ev-profile__meta {
    color: var(--text-muted);
  }
  .ev-profile--light :global(.ev-profile__chev) {
    color: var(--text-muted);
  }
  @media (hover: hover) {
    .ev-profile--light:hover {
      background: var(--blush-150);
    }
  }

  .ev-profile--dark {
    --focus-ring: var(--focus-ring-on-dark);
    background: var(--pill-glass-dark);
    box-shadow:
      inset 0 0 0 1px var(--glass-dark-rim),
      var(--shadow-pill-dark);
    color: var(--text-on-dark-strong);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
  }
  .ev-profile--dark .ev-profile__name {
    font-weight: var(--fw-medium);
  }
  .ev-profile--dark .ev-profile__meta {
    color: var(--text-on-dark);
  }
  .ev-profile--dark :global(.ev-profile__chev) {
    color: var(--text-on-dark);
  }
  .ev-profile--dark.is-compact,
  .ev-profile--light.is-compact {
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }
</style>
