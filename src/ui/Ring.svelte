<!--
  A score ring: the Progress health-score dial, the scan's metric gauges, a
  milestone's in-progress arc.

  Drawn as a conic gradient masked to a ring (flat ends, clockwise from 12
  o'clock), so the arc can shade along its length the way the mockup's does.
  The middle is yours: pass children for the number and its caption.

  It is an image to assistive technology, named by `label` (default
  "{value} out of {max}"), so put the same facts in text nearby if they matter.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    value: number;
    max?: number;
    /** Outer diameter in px. */
    size?: number;
    /** Ring thickness in px. */
    thickness?: number;
    tone?: 'rose' | 'sage' | 'raspberry' | 'holo';
    label?: string;
    class?: string;
    children?: Snippet;
  }

  const {
    value,
    max = 100,
    size = 186,
    thickness = 18,
    tone = 'rose',
    label,
    class: className = '',
    children,
  }: Props = $props();

  const fraction = $derived(max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);
  const name = $derived(label ?? `${Math.round(value)} out of ${max}`);
</script>

<div
  class="ev-ring ev-ring--{tone} {className}"
  style:--ring-size="{size}px"
  style:--ring-thick="{thickness}px"
  style:--ring-deg="{fraction * 360}deg"
  role="img"
  aria-label={name}
>
  <span class="ev-ring__arc" aria-hidden="true"></span>
  {#if children}
    <div class="ev-ring__centre">{@render children()}</div>
  {/if}
</div>

<style>
  @property --ring-deg {
    syntax: '<angle>';
    inherits: true;
    initial-value: 0deg;
  }

  .ev-ring {
    --ring-a: var(--ring-rose-a);
    --ring-b: var(--ring-rose-b);
    --ring-c: var(--ring-rose-c);
    --ring-d: var(--ring-rose-d);
    --ring-track: var(--ring-rose-track);
    position: relative;
    display: inline-grid;
    place-items: center;
    width: var(--ring-size);
    height: var(--ring-size);
    flex: none;
    transition: --ring-deg var(--dur-slow) var(--ease-out);
  }
  .ev-ring__arc {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(
      from 0deg,
      var(--ring-a) 0deg,
      var(--ring-b) calc(var(--ring-deg) * 0.35),
      var(--ring-c) calc(var(--ring-deg) * 0.55),
      var(--ring-d) var(--ring-deg),
      var(--ring-track) var(--ring-deg) 360deg
    );
    -webkit-mask: radial-gradient(
      farthest-side,
      transparent calc(100% - var(--ring-thick) - 0.5px),
      #000 calc(100% - var(--ring-thick))
    );
    mask: radial-gradient(
      farthest-side,
      transparent calc(100% - var(--ring-thick) - 0.5px),
      #000 calc(100% - var(--ring-thick))
    );
  }
  .ev-ring__centre {
    position: relative;
    display: grid;
    justify-items: center;
    text-align: center;
    line-height: 1.1;
  }

  .ev-ring--sage {
    --ring-a: var(--sage-400);
    --ring-b: var(--sage-500);
    --ring-c: var(--sage-500);
    --ring-d: var(--sage-600);
    --ring-track: var(--sage-100);
  }
  .ev-ring--raspberry {
    --ring-a: var(--rose-700);
    --ring-b: var(--rose-700);
    --ring-c: var(--rose-600);
    --ring-d: var(--rose-700);
    --ring-track: var(--rose-100);
  }
  .ev-ring--holo {
    --ring-a: var(--ring-holo-arc);
    --ring-b: var(--ring-holo-arc);
    --ring-c: var(--holo-cyan);
    --ring-d: var(--ring-holo-arc);
    --ring-track: var(--ring-holo-track);
    color: var(--holo-ink-strong);
  }
</style>
