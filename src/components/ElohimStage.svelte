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
  let director = $state<SessionDirector | null>(null);
  $effect(() => { director?.setPresentation(session.entryStage); });

  onMount(() => {
    const tier = session.user?.preferences.qualityTier ?? 'auto';
    director = new SessionDirector(canvas, tier);
    const liveDirector = director;
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
      liveDirector.glanceAtScreen(ndcX, ndcY);
      // A tap on her is hers to react to; a tap on the room is just noticed.
      if (!liveDirector.pokeAt(ndcX, ndcY)) liveDirector.acknowledgeTouch();
    };
    let drag: { pointer: number; x: number; y: number; moved: boolean } | null = null;
    const onDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      if (liveDirector.canDragCharacter(x, y)) {
        drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        canvas.setPointerCapture(event.pointerId);
      } else onPoke(event);
    };
    const onMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 7) drag.moved = true;
      if (drag.moved) {
        const rect = canvas.getBoundingClientRect();
        liveDirector.moveCharacter(((event.clientX - rect.left) / rect.width) * 2 - 1);
      }
    };
    const onUp = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      if (event.type !== 'pointercancel' && !drag.moved) onPoke(event);
      drag = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    const onResize = () => liveDirector.resize();
    window.addEventListener('resize', onResize);
    // Orientation changes report the old size for a frame or two on mobile.
    const onOrientation = () => setTimeout(onResize, 180);
    window.addEventListener('orientationchange', onOrientation);

    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientation);
      registerDirector(null);
      liveDirector.dispose();
      director = null;
    };
  });
</script>

<canvas class="stage-canvas" bind:this={canvas}></canvas>
{#if session.entryStage !== 'film' && session.characterStatus !== 'ready'}
  <div class="character-loading" role="status">
    {#if session.characterStatus === 'loading'}Ese is arriving…{:else}Ese’s model could not load. <button onclick={() => director?.retryCharacter()}>Try again</button>{/if}
  </div>
{/if}

<style>
  .character-loading{position:fixed;left:24px;bottom:90px;z-index:50;font-size:11px;color:#e6d3e5;background:#151220d9;border:1px solid #b79ec437;padding:10px 14px;border-radius:30px;max-width:280px;}.character-loading button{font:inherit;border:0;background:none;color:#dcc0f6;text-decoration:underline;cursor:pointer;}
</style>
