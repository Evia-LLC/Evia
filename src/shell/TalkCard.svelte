<!--
  The sidebar's "Talk to Evia" card (Progress and Products mockups).

  No character (BUILD-PLAN decision 3): the tile that held her portrait keeps
  its shape and its pink, and carries a chat mark instead. The whole card is
  one button; it goes home and asks for the conversation (talk.svelte.ts).
  The quote under it shows only where there is room for it.

  The card darkens what is behind it (--talk-glass) rather than lightening it
  as the mockup's glass does, and none of its text is quieter than
  --text-on-dark: it sits over the plate's brightest spot, the LED ledge.

  In the icon rail it collapses to a round chat button.
-->
<script lang="ts">
  import Icon from '@/ui/Icon.svelte';
  import { requestTalk } from './talk.svelte.ts';

  interface Props {
    variant?: 'card' | 'button';
  }

  const { variant = 'card' }: Props = $props();
</script>

{#if variant === 'button'}
  <button type="button" class="ev-talkbtn" aria-label="Talk to Evia" title="Talk to Evia" onclick={requestTalk}>
    <Icon name="message-circle" size={22} />
  </button>
{:else}
  <div class="ev-talk">
    <button type="button" class="ev-talk__main" onclick={requestTalk}>
      <span class="ev-talk__tile" aria-hidden="true"><Icon name="messages" size={26} filled /></span>
      <span class="ev-talk__text">
        <span class="ev-talk__title">
          Talk to Evia
          <span class="ev-talk__go" aria-hidden="true"><Icon name="chevron-right" size={16} stroke={1.8} /></span>
        </span>
        <span class="ev-talk__body">I'm here to help you on your journey.</span>
      </span>
    </button>
    <figure class="ev-talk__quote">
      <blockquote><span>“Consistent care</span> <span class="ev-talk__indent">creates real change.”</span></blockquote>
      <figcaption>— Evia</figcaption>
    </figure>
  </div>
{/if}

<style>
  .ev-talk {
    position: relative;
    display: grid;
    gap: 12px;
    padding: 12px;
    border-radius: var(--r-xl);
    background: var(--talk-glass);
    isolation: isolate;
  }
  .ev-talk::before {
    content: '';
    position: absolute;
    inset: 0;
    padding: 1px;
    border-radius: inherit;
    background: linear-gradient(135deg, var(--glass-dark-rim-hi), var(--glass-dark-rim-lo));
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    mask-composite: exclude;
    pointer-events: none;
  }

  .ev-talk__main {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 0;
    border: 0;
    border-radius: var(--r-md);
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .ev-talk__main:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: 4px;
  }
  .ev-talk__tile {
    display: grid;
    place-items: center;
    width: 52px;
    height: 58px;
    border-radius: 16px;
    background: linear-gradient(160deg, var(--portrait-pink-hi), var(--portrait-pink));
    box-shadow: inset 0 0 0 1px var(--portrait-rim);
    color: var(--cta-icon);
  }
  .ev-talk__text {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .ev-talk__title {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-label);
    font-weight: var(--fw-medium);
    line-height: 1.2;
    color: var(--text-on-dark-strong);
  }
  .ev-talk__body {
    font-size: var(--fs-body-sm);
    line-height: 1.35;
    color: var(--text-on-dark);
  }
  .ev-talk__go {
    display: inline-grid;
    color: var(--text-on-dark);
    transition: transform var(--dur-base) var(--ease-out);
  }
  @media (hover: hover) {
    .ev-talk__main:hover .ev-talk__go {
      transform: translateX(3px);
    }
  }

  .ev-talk__quote {
    margin: 0;
    padding-top: 12px;
    border-top: 1px solid transparent;
    border-image: linear-gradient(90deg, transparent, var(--talk-divider) 40%, var(--talk-divider) 70%, transparent) 1;
  }
  .ev-talk__quote blockquote {
    margin: 0;
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 18px;
    line-height: 1.3;
    color: var(--text-on-dark);
  }
  .ev-talk__quote blockquote span {
    display: block;
  }
  .ev-talk__quote .ev-talk__indent {
    padding-left: 0.9em;
  }
  .ev-talk__quote figcaption {
    margin-top: 4px;
    padding-left: 0.9em;
    font-size: var(--fs-meta);
    color: var(--text-on-dark);
  }
  /* Short windows keep the card and drop the quote. */
  @media (max-height: 900px) {
    .ev-talk__quote {
      display: none;
    }
  }

  .ev-talkbtn {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 1px solid var(--border-on-dark-strong);
    background: var(--talk-glass);
    color: var(--text-on-dark-strong);
    cursor: pointer;
    transition: background-color var(--dur-base) var(--ease-out);
  }
  .ev-talkbtn:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: var(--focus-offset);
  }
  @media (hover: hover) {
    .ev-talkbtn:hover {
      background: var(--tint-press-dark);
    }
  }
</style>
