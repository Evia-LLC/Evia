<!--
  The persistent AI disclosure the SRS asks for on Home, chat and Scan: one
  small line, placed by the page where the mockup has free space.

  Its words are the Consent Wording Pack's section 8 consultation label,
  verbatim (AI_COPY, brought in from main): the pack controls where it and the
  SRS differ, so the earlier paraphrase ("Evia is an AI. General skincare
  guidance, not medical advice.") is gone. Where a screen shows the full
  section 8 notice (components/legal/AIDisclosure.svelte) this line is not
  repeated.

  tone: light (on light pages), dark (over the room or dark glass), holo (the
  scan's navy). Its text is 12px, the meta floor, and always meets 4.5:1 on
  its own backing.
-->
<script lang="ts">
  import Icon from '@/ui/Icon.svelte';
  import { AI_COPY } from '@shared/legal-screen-copy.ts';

  interface Props {
    tone?: 'light' | 'dark' | 'holo';
    /** A backing pill, for busy imagery. On by default on dark and holo,
        where the page behind is a picture whose brightness is not known. */
    backed?: boolean;
    class?: string;
  }

  const { tone = 'dark', backed, class: className = '' }: Props = $props();
  const withBacking = $derived(backed ?? tone !== 'light');
</script>

<p class="ev-ai ev-ai--{tone} {className}" class:is-backed={withBacking}>
  <Icon name="info" size={14} stroke={1.8} />
  <span>{AI_COPY.consultation}</span>
</p>

<style>
  .ev-ai {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--fs-meta);
    font-weight: var(--fw-regular);
    line-height: 1.3;
    letter-spacing: 0;
  }
  .ev-ai.is-backed {
    padding: 5px 12px 5px 10px;
    border-radius: var(--r-pill);
  }
  .ev-ai--light {
    color: var(--text-muted);
  }
  .ev-ai--light.is-backed {
    background: var(--glass-light);
  }
  .ev-ai--dark {
    color: var(--text-on-dark);
    text-shadow: var(--text-lift);
  }
  .ev-ai--dark.is-backed {
    background: var(--glass-dark);
    text-shadow: none;
  }
  /* Not the muted holo ink: over the hologram's bright core the backing is
     only 72% navy, and --text-on-holo is what still keeps 4.5:1 there. */
  .ev-ai--holo {
    color: var(--text-on-holo);
  }
  .ev-ai--holo.is-backed {
    background: var(--glass-holo);
  }
</style>
