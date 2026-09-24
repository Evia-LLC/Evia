<!--
  The hero's still life, standing where the mockup had its character
  (BUILD-PLAN decision 3: no figure anywhere). Three unbranded packages - a
  pump bottle, an amber dropper and a cream jar - on a round travertine
  plinth, a sprig of eucalyptus leaning in behind them. No marks, no lettering:
  it is set dressing for the room, and the same in sample and real mode.
-->
<script lang="ts">
  import Bottle from './Bottle.svelte';
</script>

<div class="still" aria-hidden="true">
  <svg class="still__set" viewBox="0 0 300 240" preserveAspectRatio="xMidYMax meet" focusable="false">
    <defs>
      <linearGradient id="still-plinth" x1="0" x2="1">
        <stop offset="0" stop-color="#e7cfc6" />
        <stop offset=".3" stop-color="#f8ebe5" />
        <stop offset=".75" stop-color="#ecd7cf" />
        <stop offset="1" stop-color="#d9bcb1" />
      </linearGradient>
      <linearGradient id="still-top" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#fbf2ee" />
        <stop offset="1" stop-color="#eedcd4" />
      </linearGradient>
      <radialGradient id="still-shadow" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#7a4a3c" stop-opacity=".22" />
        <stop offset="1" stop-color="#7a4a3c" stop-opacity="0" />
      </radialGradient>
    </defs>
    <!-- eucalyptus sprig, rising behind the bottles -->
    <g fill="none" stroke-linecap="round">
      <path d="M150 196C146 160 152 120 168 84S196 30 204 12" stroke="#8a9a82" stroke-width="2" />
      <path d="M160 128C170 112 184 104 196 100" stroke="#8a9a82" stroke-width="1.6" />
    </g>
    <g fill="#9fb39a" opacity=".92">
      <ellipse cx="156" cy="112" rx="11" ry="7" transform="rotate(-35 156 112)" />
      <ellipse cx="172" cy="76" rx="10" ry="6.5" transform="rotate(-50 172 76)" />
      <ellipse cx="186" cy="46" rx="9" ry="6" transform="rotate(-55 186 46)" />
      <ellipse cx="199" cy="22" rx="7.5" ry="5" transform="rotate(-60 199 22)" />
      <ellipse cx="143" cy="92" rx="10" ry="6.5" transform="rotate(30 143 92)" />
      <ellipse cx="184" cy="100" rx="10" ry="6.5" transform="rotate(-10 184 100)" />
      <ellipse cx="160" cy="60" rx="8.5" ry="5.5" transform="rotate(25 160 60)" />
      <ellipse cx="203" cy="94" rx="8" ry="5.2" transform="rotate(-20 203 94)" />
    </g>
    <g fill="#b7c7b1" opacity=".7">
      <ellipse cx="146" cy="134" rx="9" ry="6" transform="rotate(40 146 134)" />
      <ellipse cx="180" cy="32" rx="7" ry="4.6" transform="rotate(20 180 32)" />
    </g>
    <!-- plinth -->
    <ellipse cx="150" cy="238" rx="150" ry="10" fill="url(#still-shadow)" />
    <path d="M36 196V240H264V196Z" fill="url(#still-plinth)" />
    <ellipse cx="150" cy="196" rx="114" ry="16" fill="url(#still-top)" />
    <g fill="#d4b6aa" opacity=".35">
      <ellipse cx="96" cy="222" rx="7" ry="2" />
      <ellipse cx="186" cy="216" rx="5" ry="1.6" />
      <ellipse cx="226" cy="228" rx="6" ry="1.8" />
    </g>
  </svg>
  <div class="still__item still__item--pump"><Bottle kind="pump" /></div>
  <div class="still__item still__item--dropper"><Bottle kind="dropper" /></div>
  <div class="still__item still__item--jar"><Bottle kind="jar" /></div>
</div>

<style>
  .still {
    position: relative;
    height: 100%;
    aspect-ratio: 300 / 240;
  }
  .still__set {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  /* The plinth's top sits at 196/240 of the height; each package stands on it. */
  .still__item {
    position: absolute;
    bottom: calc(100% - 196 / 240 * 100% - 1%);
    display: flex;
    justify-content: center;
    transform: translateX(-50%);
  }
  .still__item--pump {
    left: 36%;
    height: 72%;
  }
  .still__item--dropper {
    left: 57%;
    height: 56%;
    bottom: calc(100% - 200 / 240 * 100% - 1%);
  }
  .still__item--jar {
    left: 74%;
    height: 50%;
    bottom: calc(100% - 204 / 240 * 100% - 1%);
  }
</style>
