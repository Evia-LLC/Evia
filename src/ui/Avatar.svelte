<!--
  The user's avatar: initials on a blush disc, never a face (BUILD-PLAN
  decision 3). Built from the display name; an empty name shows a person
  glyph instead of guessing.
-->
<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    name: string;
    size?: number;
    /** A thin light ring, as the profile pill's avatar has. */
    ring?: boolean;
    class?: string;
  }

  const { name, size = 48, ring = true, class: className = '' }: Props = $props();

  const initials = $derived.by(() => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    const first = Array.from(words[0])[0] ?? '';
    const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';
    return (first + last).toLocaleUpperCase();
  });
</script>

<span
  class="ev-avatar {className}"
  class:has-ring={ring}
  style:--avatar-size="{size}px"
  aria-hidden="true"
>
  {#if initials}
    <span class="ev-avatar__initials">{initials}</span>
  {:else}
    <Icon name="user" size={Math.round(size * 0.46)} />
  {/if}
</span>

<style>
  .ev-avatar {
    display: inline-grid;
    place-items: center;
    width: var(--avatar-size);
    height: var(--avatar-size);
    flex: none;
    border-radius: 50%;
    background: radial-gradient(120% 120% at 30% 20%, var(--avatar-from), var(--avatar-to));
    color: var(--avatar-ink);
    font-family: var(--font-serif);
    font-size: calc(var(--avatar-size) * 0.4);
    font-weight: var(--fw-medium);
    line-height: 1;
    letter-spacing: 0.01em;
    user-select: none;
  }
  .ev-avatar.has-ring {
    box-shadow:
      0 0 0 1.5px var(--avatar-ring),
      var(--shadow-avatar);
  }
  .ev-avatar__initials {
    transform: translateY(0.02em);
  }
</style>
