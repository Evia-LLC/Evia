<script lang="ts">
  /**
   * Mounts the 3D stage.
   *
   * This is the only component that touches the scene director, and it does so
   * through a registration hook so nothing else in the UI ever imports three.js.
   *
   * There is no text overlay here any more. Holographic text used to be DOM
   * written into a full-screen layer and positioned by projecting 3D anchors,
   * which is what let it drift over the rest of the interface. It now lives in
   * `HoloPanel.svelte`, laid out in CSS like everything else.
   */
  import { onMount } from 'svelte';
  import { SessionDirector } from '@/scene/director.ts';
  import { registerDirector } from '@/state/controller.ts';
  import { session } from '@/state/session.svelte.ts';

  let canvas: HTMLCanvasElement;
  let characterStatus = $state<'loading' | 'ready' | 'fallback'>('loading');

  onMount(() => {
    const tier = session.user?.preferences.qualityTier ?? 'auto';
    const director = new SessionDirector(canvas, tier);
    director.onCharacterStatus = (status) => { characterStatus = status; };
    characterStatus = director.characterStatus;
    registerDirector(director);

/*
     * She notices being touched.
     *
     * A rendered person who does not react to the screen being tapped is a
     * picture of a person, however well she is animated the rest of the time —
     * the reaction is what makes the difference between watching her and being
     * in the room with her.
     *
     * Deliberately just attention, not a game: she looks where you touched and
     * her expression acknowledges it, then she goes back to what she was doing.
     * Anything more would be a toy, and she is meant to be a consultant.
     */
    const onPoke = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      director.glanceAtScreen(ndcX, ndcY);
      // A tap on her is hers to react to; a tap on the room is just noticed.
      if (!director.pokeAt(ndcX, ndcY)) director.acknowledgeTouch();
    };
    canvas.addEventListener('pointerdown', onPoke);

    const onResize = () => director.resize();
    window.addEventListener('resize', onResize);
    // Orientation changes report the old size for a frame or two on mobile.
    const onOrientation = () => setTimeout(onResize, 180);
    window.addEventListener('orientationchange', onOrientation);

    return () => {
      canvas.removeEventListener('pointerdown', onPoke);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientation);
      registerDirector(null);
      director.dispose();
    };
  });
</script>

<canvas class="stage-canvas" bind:this={canvas} aria-label="Evia, your virtual skincare companion"></canvas>
{#if characterStatus !== 'ready'}
  <div class="character-status" role="status" aria-live="polite">
    {characterStatus === 'loading' ? 'Loading Evia…' : 'Showing the standard avatar. The 3D character could not load.'}
  </div>
{/if}

<style>
  .character-status {
    position: fixed;
    left: 50%;
    top: calc(env(safe-area-inset-top, 0px) + 0.75rem);
    transform: translateX(-50%);
    z-index: 30;
    max-width: min(90vw, 32rem);
    padding: 0.5rem 0.9rem;
    border-radius: 1rem;
    background: rgb(12 16 22 / 88%);
    color: #edf1f4;
    font-size: 0.8rem;
    text-align: center;
    pointer-events: none;
  }
</style>
