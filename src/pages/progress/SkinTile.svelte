<!--
  A neutral skin-texture tile: what sample mode shows where the mockup has a
  person's face (BUILD-PLAN decision 3 - no faces, not even placeholder ones).

  A warm skin-tone wash with a soft key light, a fine grain (an inline SVG
  turbulence, so nothing is fetched) and a scatter of soft darker marks whose
  strength is `texture` (0 smooth .. 1 dense). A "before" tile reads rougher
  than an "after" one without depicting anyone. It is decoration: the dates
  and labels around it carry the information.
-->
<script lang="ts">
  interface Props {
    /** 0..1: how much grain and how many marks show. */
    texture?: number;
    /** A small caption in the corner ("Before", "After"). */
    label?: string;
    /** Where the caption sits. */
    labelAt?: 'start' | 'end';
    class?: string;
  }

  const { texture = 0.5, label, labelAt = 'start', class: className = '' }: Props = $props();
  const t = $derived(Math.max(0, Math.min(1, texture)));
</script>

<div class="skin-tile {className}" style:--texture={t} aria-hidden={label ? undefined : 'true'}>
  <span class="skin-tile__grain" aria-hidden="true"></span>
  <span class="skin-tile__marks" aria-hidden="true"></span>
  <span class="skin-tile__light" aria-hidden="true"></span>
  {#if label}
    <span class="skin-tile__label skin-tile__label--{labelAt}">{label}</span>
  {/if}
</div>

<style>
  .skin-tile {
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 100%;
    background:
      radial-gradient(110% 85% at 32% 28%, rgba(255, 212, 186, 0.5), rgba(255, 212, 186, 0) 62%),
      radial-gradient(90% 70% at 85% 95%, rgba(80, 38, 24, 0.4), rgba(80, 38, 24, 0) 70%),
      linear-gradient(150deg, #c48b6c 0%, #a5684c 52%, #7f4b36 100%);
  }

  /* Fine pore-scale grain: fractal noise, desaturated and warmed. */
  .skin-tile__grain {
    position: absolute;
    inset: 0;
    opacity: calc(0.18 + var(--texture) * 0.5);
    mix-blend-mode: soft-light;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0 0.08  0 0 0 1.4 -0.3'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
    background-size: 180px 180px;
  }

  /* Soft uneven marks, scattered by hand so they never form a grid. */
  .skin-tile__marks {
    position: absolute;
    inset: 0;
    opacity: calc(var(--texture) * 0.9);
    filter: blur(0.6px);
    background:
      radial-gradient(circle at 18% 22%, rgba(74, 34, 22, 0.55) 0 2px, transparent 4px),
      radial-gradient(circle at 27% 47%, rgba(74, 34, 22, 0.45) 0 1.6px, transparent 3.4px),
      radial-gradient(circle at 36% 31%, rgba(74, 34, 22, 0.5) 0 2.4px, transparent 4.6px),
      radial-gradient(circle at 44% 62%, rgba(74, 34, 22, 0.42) 0 1.8px, transparent 3.6px),
      radial-gradient(circle at 58% 38%, rgba(74, 34, 22, 0.48) 0 2.2px, transparent 4.2px),
      radial-gradient(circle at 63% 71%, rgba(74, 34, 22, 0.4) 0 1.5px, transparent 3.2px),
      radial-gradient(circle at 72% 24%, rgba(74, 34, 22, 0.46) 0 1.8px, transparent 3.8px),
      radial-gradient(circle at 81% 55%, rgba(74, 34, 22, 0.5) 0 2.6px, transparent 5px),
      radial-gradient(circle at 12% 70%, rgba(74, 34, 22, 0.42) 0 1.7px, transparent 3.6px),
      radial-gradient(circle at 33% 84%, rgba(74, 34, 22, 0.38) 0 1.4px, transparent 3px),
      radial-gradient(circle at 52% 16%, rgba(74, 34, 22, 0.4) 0 1.5px, transparent 3.2px),
      radial-gradient(circle at 88% 82%, rgba(74, 34, 22, 0.44) 0 2px, transparent 4px),
      radial-gradient(circle at 68% 50%, rgba(74, 34, 22, 0.3) 0 3.5px, transparent 7px),
      radial-gradient(circle at 23% 58%, rgba(74, 34, 22, 0.28) 0 3px, transparent 6.5px),
      radial-gradient(circle at 48% 42%, rgba(74, 34, 22, 0.36) 0 1.3px, transparent 2.8px),
      radial-gradient(circle at 91% 34%, rgba(74, 34, 22, 0.4) 0 1.6px, transparent 3.4px);
    background-size: 100% 100%;
  }

  /* A soft sheen that grows as the texture smooths out. */
  .skin-tile__light {
    position: absolute;
    inset: 0;
    opacity: calc(0.2 + (1 - var(--texture)) * 0.6);
    background: radial-gradient(55% 42% at 40% 36%, rgba(255, 234, 218, 0.5), rgba(255, 234, 218, 0) 72%);
  }

  .skin-tile__label {
    position: absolute;
    bottom: 12px;
    display: inline-flex;
    align-items: center;
    min-height: 26px;
    padding: 0 10px;
    border-radius: var(--r-sm);
    background: var(--photo-badge-bg);
    box-shadow: inset 0 -1px 0 var(--photo-badge-rim);
    color: var(--photo-badge-ink);
    font-size: var(--fs-meta);
    font-weight: var(--fw-medium);
    letter-spacing: 0;
  }
  .skin-tile__label--start {
    left: 12px;
  }
  .skin-tile__label--end {
    right: 12px;
  }
</style>
