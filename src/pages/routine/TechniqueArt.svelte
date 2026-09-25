<!--
  The lesson card's picture, drawn in code. There is no person in it
  (BUILD-PLAN decision 3): where the mockup has a demo video of a face, this is
  an abstract picture of the technique - two presses rippling outward where the
  palms would rest, the upward guide arrows and the curved "motion" arrow from
  the mockup's overlay (routine.md C16), over the studio's plum haze and its
  lavender light slats.

  lesson   the technique, animated while `playing`: the arrows flow upward,
           the presses ripple, the curved arrow draws on.
  calm     the haze and the light slats only - no technique is claimed. Real
           mode uses this: no step in the plan has a technique to show.

  The drawing is 300 x 366 units, the right-hand zone of the mockup's card
  (card x 216-516), so the arrows sit where the mockup puts them. The caption
  is HTML placed in the same units, so it stays crisp at any size.
-->
<script lang="ts">
  interface Props {
    variant?: 'lesson' | 'calm';
    playing?: boolean;
    /** The overlay caption, one entry per line ("Gentle, upward", "motions"). */
    caption?: string[];
    class?: string;
  }

  const { variant = 'lesson', playing = false, caption = [], class: className = '' }: Props = $props();
  const id = $props.id();
</script>

<div class="rt-art {className}" class:is-playing={playing} data-variant={variant} aria-hidden="true">
  <svg class="rt-art__svg" viewBox="0 0 300 366" preserveAspectRatio="xMidYMid meet" focusable="false">
    <defs>
      <radialGradient id="{id}-haze" cx="0.42" cy="0.44" r="0.6">
        <stop offset="0" stop-color="#59466a" stop-opacity="0.95" />
        <stop offset="0.55" stop-color="#4e3d5e" stop-opacity="0.55" />
        <stop offset="1" stop-color="#41323e" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="{id}-rose" cx="1" cy="0.5" r="0.55">
        <!-- Held to 0.6 so the caption over it keeps 5:1 (#EBDAF4 on #6F505F). -->
        <stop offset="0" stop-color="#88616f" stop-opacity="0.6" />
        <stop offset="1" stop-color="#664548" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="{id}-beam" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8678b1" stop-opacity="0" />
        <stop offset="0.35" stop-color="#8678b1" stop-opacity="0.85" />
        <stop offset="0.7" stop-color="#7e6ba3" stop-opacity="0.6" />
        <stop offset="1" stop-color="#7e6ba3" stop-opacity="0" />
      </linearGradient>
      <radialGradient id="{id}-orb" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#f3d9ea" stop-opacity="0.55" />
        <stop offset="0.6" stop-color="#b79ad0" stop-opacity="0.18" />
        <stop offset="1" stop-color="#b79ad0" stop-opacity="0" />
      </radialGradient>
      <!-- The skin swatch the technique is shown on: a soft pink ground with a fine pore grid. -->
      <linearGradient id="{id}-skin" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c79aae" stop-opacity="0.34" />
        <stop offset="1" stop-color="#9b7392" stop-opacity="0.2" />
      </linearGradient>
      <pattern id="{id}-pores" width="9" height="9" patternUnits="userSpaceOnUse">
        <circle cx="4.5" cy="4.5" r="0.8" fill="#f3dbe8" fill-opacity="0.32" />
      </pattern>
      <filter id="{id}-soft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      <filter id="{id}-glow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="2.2" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    <!-- The studio: plum haze, a rose edge light, two lavender light slats and a bokeh dot. -->
    <rect x="0" y="0" width="300" height="366" fill="url(#{id}-haze)" />
    <rect x="160" y="0" width="140" height="366" fill="url(#{id}-rose)" />
    <g class="rt-art__beams" filter="url(#{id}-soft)">
      <rect x="38" y="30" width="9" height="150" rx="4.5" fill="url(#{id}-beam)" />
      <rect x="183" y="40" width="9" height="140" rx="4.5" fill="url(#{id}-beam)" />
      <rect x="122" y="10" width="6" height="110" rx="3" fill="url(#{id}-beam)" opacity="0.5" />
    </g>
    <ellipse cx="274" cy="132" rx="9" ry="6" fill="#d89d9d" opacity="0.7" filter="url(#{id}-soft)" />
    <circle class="rt-art__orb" cx="125" cy="165" r="74" fill="url(#{id}-orb)" />

    {#if variant === 'lesson'}
      <!-- What the guides act on: a swatch of skin (not a face, decision 3), so the
           presses and arrows read as a diagram of the technique rather than
           marks floating in the haze. -->
      <g class="rt-art__swatch">
        <rect x="16" y="70" width="186" height="186" rx="30" fill="url(#{id}-skin)" />
        <rect x="16" y="70" width="186" height="186" rx="30" fill="url(#{id}-pores)" />
        <rect x="16.5" y="70.5" width="185" height="185" rx="29.5" fill="none" stroke="#ecd3ea" stroke-opacity="0.38" stroke-dasharray="3 4" />
      </g>
      <!-- The presses: rings rippling out where the palms rest (G2, G3). -->
      <g class="rt-art__press" fill="none" stroke="#f0c3d6" stroke-width="1.4">
        {#each [82, 170] as cx (cx)}
          <circle cx={cx} cy="160" r="6" opacity="0.9" />
          <circle class="rt-art__ripple" cx={cx} cy="160" r="6" />
          <circle class="rt-art__ripple rt-art__ripple--late" cx={cx} cy="160" r="6" />
        {/each}
      </g>

      <!-- The node and its guide lines (G1). -->
      <g class="rt-art__node" filter="url(#{id}-glow)" stroke="#f9daeb" stroke-width="1.5" stroke-linecap="round" fill="none">
        <path d="M126 95v23" />
        <path d="M126 95h19" />
        <circle cx="126" cy="95" r="2.6" fill="#f9daeb" />
      </g>

      <!-- The upward arrows (G4, G5): the shaft flows upward while playing. -->
      <g class="rt-art__arrows" filter="url(#{id}-glow)" stroke="#d0d8fe" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path class="rt-art__flow" d="M42.5 223V181" />
        <path d="M38 186.5l4.5-6 4.5 6" />
        <path class="rt-art__flow" d="M192.5 221V185" />
        <path d="M188.5 190.5l4-6 4 6" />
        <path class="rt-art__streak" d="M192 241v20M199 243v16" stroke="#d9e0ff" opacity="0.6" />
      </g>

      <!-- The curved motion arrow (G6), drawn on while playing. -->
      <g filter="url(#{id}-glow)" stroke="#fff4ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path class="rt-art__curve" pathLength="1" d="M193 218c6 4 13 5 20 3 9-3 17-11 24-24" />
        <path d="M229.5 199.5l7.5-2.5 1.5 7.8" />
      </g>
    {/if}
  </svg>

  {#if variant === 'lesson' && caption.length}
    <p class="rt-art__caption">
      {#each caption as line, i (i)}<span class:is-indent={i > 0}>{line}</span>{/each}
    </p>
  {/if}
</div>

<style>
  .rt-art {
    position: relative;
    height: 100%;
    aspect-ratio: 300 / 366;
    pointer-events: none;
  }
  .rt-art__svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  /* The caption sits at the mockup's spot: zone x 204-296, y 157 (C17).
     Anchored by its right edge (x 296) so the app's slightly wider sans
     grows leftward into the picture, never past the card's edge. */
  .rt-art__caption {
    position: absolute;
    right: 3%;
    top: 42.3%;
    margin: 0;
    color: #ebdaf4;
    font-family: var(--font-sans);
    font-size: var(--fs-small);
    font-weight: var(--fw-medium);
    line-height: 17px;
    white-space: nowrap;
    text-shadow:
      0 0 6px rgba(200, 180, 255, 0.35),
      0 1px 2px rgba(40, 20, 45, 0.6);
  }
  .rt-art__caption span {
    display: block;
  }
  .rt-art__caption .is-indent {
    padding-left: 8px;
  }

  /* ---- motion (only while playing; nothing loops under reduced motion) ---- */
  .rt-art__beams {
    animation: rt-shimmer 7s var(--ease-in-out) infinite alternate;
    animation-play-state: paused;
  }
  .rt-art__flow {
    stroke-dasharray: 6 5;
    animation: rt-flow 1.6s linear infinite;
    animation-play-state: paused;
  }
  .rt-art__arrows {
    animation: rt-breathe 1.6s var(--ease-in-out) infinite alternate;
    animation-play-state: paused;
  }
  .rt-art__curve {
    stroke-dasharray: 1;
    stroke-dashoffset: 0;
    animation: rt-draw 2.4s var(--ease-out) infinite;
    animation-play-state: paused;
  }
  .rt-art__ripple {
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: rt-ripple 2.2s var(--ease-out) infinite;
    animation-play-state: paused;
  }
  .rt-art__ripple--late {
    animation-delay: 1.1s;
  }
  .rt-art__node {
    animation: rt-breathe 2.6s var(--ease-in-out) infinite alternate;
    animation-play-state: paused;
  }
  .is-playing :is(.rt-art__beams, .rt-art__flow, .rt-art__arrows, .rt-art__curve, .rt-art__ripple, .rt-art__node) {
    animation-play-state: running;
  }
  /* Paused, the picture rests fully drawn rather than on a frame mid-loop. */
  .rt-art:not(.is-playing) :is(.rt-art__curve, .rt-art__ripple) {
    animation: none;
  }

  @keyframes rt-flow {
    to {
      stroke-dashoffset: -22;
    }
  }
  @keyframes rt-breathe {
    from {
      opacity: 0.6;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes rt-shimmer {
    from {
      opacity: 0.75;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes rt-draw {
    0% {
      stroke-dashoffset: 1;
    }
    55%,
    100% {
      stroke-dashoffset: 0;
    }
  }
  @keyframes rt-ripple {
    0% {
      opacity: 0.8;
      transform: scale(1);
    }
    100% {
      opacity: 0;
      transform: scale(4.2);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rt-art :is(.rt-art__beams, .rt-art__flow, .rt-art__arrows, .rt-art__curve, .rt-art__ripple, .rt-art__node) {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .rt-art :is(.rt-art__beams, .rt-art__flow, .rt-art__arrows, .rt-art__curve, .rt-art__ripple, .rt-art__node) {
    animation: none;
  }
</style>
