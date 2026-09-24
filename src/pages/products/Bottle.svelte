<!--
  A product package, drawn (products.md section 5.1): front-on, lit from the
  upper left, a soft cylinder shade with a narrow highlight a fifth of the
  way in, and a contact shadow at the base.

  Sample mode draws the mockup's eight, recognisable by their shapes and
  colours only: every label is abstract lines and blocks, never lettering, so
  no brand's wordmark is reproduced (and no stray text sits in the page).
  Real mode draws an unbranded package by category when a shop product has no
  picture of its own.

  Every package is drawn on one 80 x 160 grid with its base on y = 156, so a
  row of them stands on the same line whatever their heights.
-->
<script module lang="ts">
  let nextId = 0;
</script>

<script lang="ts">
  import type { BottleKind } from '@/view/products.ts';

  interface Props {
    kind: BottleKind;
    /** Accessible name; decorative (hidden) when omitted. */
    label?: string;
    class?: string;
  }

  const { kind, label, class: className = '' }: Props = $props();

  const uid = `bt${nextId++}`;
  const shade = `url(#${uid}-shade)`;

  /* Body outlines, reused for the fill, the shade and the label clip. */
  const PUMP_BODY = 'M15.5 58Q15.5 48 25.5 48H54.5Q64.5 48 64.5 58V150Q64.5 156 58.5 156H21.5Q15.5 156 15.5 150Z';
  const OVAL_BODY = 'M13 68Q13 44 35 44H45Q67 44 67 68V148Q67 156 59 156H21Q13 156 13 148Z';
  const TONER_BODY = 'M19.5 40Q19.5 37 22.5 37H57.5Q60.5 37 60.5 40V153Q60.5 156 57.5 156H22.5Q19.5 156 19.5 153Z';
  const DROPPER_BODY = 'M19 89Q19 73 34 73H46Q61 73 61 89V151Q61 156 56 156H24Q19 156 19 151Z';
  const TUBE_DOWN = 'M8.5 41H71.5L66 122H14Z';
  const TUBE_UP = 'M16 27H64L54 135H26Z';
  const SLIM_TUBE = 'M18.5 25H61.5L55.5 134H24.5Z';
  const JAR_BODY = 'M16 108H64V148Q64 156 56 156H24Q16 156 16 148Z';
  const COMPACT_BODY = 'M20 102Q20 96 26 96H54Q60 96 60 102V150Q60 156 54 156H26Q20 156 20 150Z';

  /** Base width, for the contact shadow. */
  const FOOT: Record<BottleKind, number> = {
    'cerave-cleanser': 25,
    pump: 25,
    'anua-toner': 21,
    toner: 21,
    'ordinary-serum': 21,
    dropper: 21,
    'lrp-cream': 27,
    'boj-sun': 16,
    tube: 16,
    'pc-bha': 21,
    'lrp-duo': 17,
    'slim-tube': 17,
    'cerave-pm': 27,
    jar: 25,
    compact: 21,
  };
</script>

<svg
  class="bottle {className}"
  viewBox="0 0 80 160"
  preserveAspectRatio="xMidYMax meet"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  <defs>
    <linearGradient id="{uid}-shade" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#3a1d14" stop-opacity=".14" />
      <stop offset=".16" stop-color="#fff" stop-opacity=".42" />
      <stop offset=".3" stop-color="#fff" stop-opacity="0" />
      <stop offset=".72" stop-color="#3a1d14" stop-opacity=".03" />
      <stop offset="1" stop-color="#3a1d14" stop-opacity=".16" />
    </linearGradient>
    <radialGradient id="{uid}-foot" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#6e463c" stop-opacity=".32" />
      <stop offset="1" stop-color="#6e463c" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="{uid}-green" x1="0" x2="1">
      <stop offset="0" stop-color="#2fb52c" />
      <stop offset=".45" stop-color="#139810" />
      <stop offset="1" stop-color="#047403" />
    </linearGradient>
    <linearGradient id="{uid}-frost" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#dcd5d4" />
      <stop offset=".78" stop-color="#ded8d8" />
      <stop offset=".86" stop-color="#ebe6e5" />
      <stop offset="1" stop-color="#f1eded" />
    </linearGradient>
    <linearGradient id="{uid}-glass" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#dcd7d5" />
      <stop offset="1" stop-color="#cdc7c7" />
    </linearGradient>
    <linearGradient id="{uid}-amber" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#c98f62" />
      <stop offset="1" stop-color="#9f613a" />
    </linearGradient>
    <linearGradient id="{uid}-blue-cap" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#3a9ad8" />
      <stop offset=".35" stop-color="#147ab6" />
      <stop offset="1" stop-color="#0f6aa0" />
    </linearGradient>
    <linearGradient id="{uid}-silver" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#f2f2f2" />
      <stop offset="1" stop-color="#cbcbcb" />
    </linearGradient>
    <linearGradient id="{uid}-rosegold" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ecc9bb" />
      <stop offset="1" stop-color="#d9ab9a" />
    </linearGradient>
    <clipPath id="{uid}-pump"><path d={PUMP_BODY} /></clipPath>
    <clipPath id="{uid}-oval"><path d={OVAL_BODY} /></clipPath>
  </defs>

  <ellipse cx="40" cy="156.2" rx={FOOT[kind] + 5} ry="3.6" fill="url(#{uid}-foot)" />

  {#if kind === 'cerave-cleanser' || kind === 'pump'}
    {@const brand = kind === 'cerave-cleanser'}
    <path d="M36 20H60Q62 20 62 22V22.8Q62 24.6 60 24.6H36Z" fill="#f3f2ef" stroke="#d6d2cd" stroke-width=".5" />
    <rect x="36.2" y="24" width="7" height="10" fill="#ebe9e5" />
    <rect x="29.5" y="33" width="21" height="15" rx="2" fill={brand ? `url(#${uid}-green)` : '#d9a39a'} />
    <path d={PUMP_BODY} fill="#f6f3ee" />
    {#if brand}
      <path d="M40.5 60H64.5V100L61.5 112Z" fill="#022d5e" clip-path="url(#{uid}-pump)" />
      <rect x="21" y="70" width="18" height="4.6" rx="1" fill="#244175" />
      <rect x="21" y="84" width="16" height="2.2" rx=".6" fill="#3a9a3a" />
      <rect x="21" y="88.5" width="13" height="2.2" rx=".6" fill="#3a9a3a" />
      <rect x="21" y="93" width="15" height="2.2" rx=".6" fill="#3a9a3a" />
      <g fill="#bdb8b3"><rect x="21" y="100" width="18" height="1.2" /><rect x="21" y="103.5" width="14" height="1.2" /><rect x="21" y="107" width="17" height="1.2" /></g>
      <rect x="21" y="122" width="26" height="3" rx=".8" fill="#9aa57f" />
      <g fill="#244175"><rect x="21" y="132" width="22" height="1.4" /><rect x="21" y="136" width="18" height="1.4" /></g>
      <rect x="31" y="147.5" width="18" height="3" rx="1.5" fill="#cfcac6" />
    {:else}
      <rect x="23" y="80" width="34" height="46" rx="3" fill="#fbf8f5" stroke="#e7dcd6" stroke-width=".6" />
      <rect x="28" y="90" width="24" height="3" rx="1" fill="#c79a90" />
      <g fill="#cbc3be"><rect x="28" y="98" width="20" height="1.3" /><rect x="28" y="102" width="16" height="1.3" /><rect x="28" y="106" width="18" height="1.3" /></g>
    {/if}
    <path d={PUMP_BODY} fill={shade} />
  {:else if kind === 'cerave-pm'}
    <rect x="34" y="22" width="12" height="8" rx="1.5" fill="#f4f3f0" stroke="#d9d5d0" stroke-width=".5" />
    <rect x="29.5" y="29" width="21" height="15" rx="2" fill="#052a58" />
    <path d={OVAL_BODY} fill="#f7f5f1" />
    <path d="M44 52H67V96L58 106Z" fill="#052a58" clip-path="url(#{uid}-oval)" />
    <rect x="21" y="72" width="18" height="4.6" rx="1" fill="#244175" />
    <rect x="26" y="84.5" width="10" height="4.2" rx="2.1" fill="#3aa043" />
    <g fill="#052a58"><rect x="21" y="92" width="24" height="1.3" /><rect x="21" y="95.6" width="20" height="1.3" /><rect x="21" y="99.2" width="22" height="1.3" /></g>
    <rect x="21" y="112" width="28" height="3" rx=".8" fill="#052a58" />
    <g fill="#c4bfba"><rect x="21" y="122" width="22" height="1.2" /><rect x="21" y="126" width="18" height="1.2" /><rect x="21" y="130" width="20" height="1.2" /></g>
    <path d={OVAL_BODY} fill={shade} />
  {:else if kind === 'anua-toner' || kind === 'toner'}
    {@const brand = kind === 'anua-toner'}
    <rect x="30" y="15" width="20" height="22.5" rx="2.2" fill={brand ? '#e3d8d6' : '#e8cfc9'} />
    <path d={TONER_BODY} fill={brand ? `url(#${uid}-frost)` : '#ecdcd8'} />
    {#if brand}
      <rect x="19.5" y="55" width="41" height="76" fill="#fbfaf8" />
      <rect x="35" y="58.5" width="10" height="2" rx=".6" fill="#2b2b2b" />
      <rect x="23" y="66" width="11" height="1.6" rx=".5" fill="#8e8a88" />
      <g fill="none" stroke="#141212" stroke-width="2.3" stroke-linecap="square" stroke-linejoin="miter">
        <path d="M38.2 70.2H43.6L40.6 83.6" />
        <path d="M45.2 70.2H50.6L47.6 83.6" />
        <path d="M57.6 70L52.6 83.8" stroke-width="1.5" />
      </g>
      <circle cx="53.4" cy="71.6" r="1.4" fill="#141212" />
      <circle cx="56.8" cy="82.2" r="1.4" fill="#141212" />
      <g fill="#b6b1ae"><rect x="23" y="92" width="30" height="1.2" /><rect x="23" y="96" width="24" height="1.2" /><rect x="23" y="100" width="28" height="1.2" /><rect x="23" y="104" width="20" height="1.2" /></g>
    {:else}
      <rect x="24" y="70" width="32" height="44" rx="2" fill="#fbf8f5" opacity=".92" />
      <rect x="29" y="80" width="22" height="3" rx="1" fill="#c79a90" />
      <g fill="#cbc3be"><rect x="29" y="88" width="18" height="1.3" /><rect x="29" y="92" width="14" height="1.3" /></g>
    {/if}
    <path d={TONER_BODY} fill={shade} />
  {:else if kind === 'ordinary-serum' || kind === 'dropper'}
    {@const brand = kind === 'ordinary-serum'}
    <path d="M35 46V28Q35 22 40 22Q45 22 45 28V46Z" fill={brand ? '#f4f2ef' : '#2f2521'} />
    <rect x="25" y="46" width="30" height="15" rx="2" fill={brand ? '#eeece8' : '#3a2e29'} />
    <g stroke={brand ? '#d6d2cd' : '#57463f'} stroke-width=".6">
      <path d="M29 47v13M33 47v13M37 47v13M41 47v13M45 47v13M49 47v13" />
    </g>
    <rect x="30" y="61" width="20" height="12" fill={brand ? '#e4e0dd' : '#b9804f'} />
    <path d={DROPPER_BODY} fill={brand ? `url(#${uid}-glass)` : `url(#${uid}-amber)`} />
    <rect x="22" y="98" width="36" height="44" rx="1.2" fill="#fbfaf8" />
    {#if brand}
      <rect x="26" y="111" width="7" height="2.4" rx=".5" fill="#141212" />
      <rect x="26" y="115" width="18" height="2.8" rx=".5" fill="#141212" />
      <rect x="26" y="121" width="28" height=".8" fill="#b8b8b8" />
      <g fill="#bdb8b3"><rect x="26" y="126" width="22" height="1.1" /><rect x="26" y="129.5" width="18" height="1.1" /><rect x="26" y="133" width="20" height="1.1" /></g>
    {:else}
      <rect x="27" y="110" width="20" height="3" rx="1" fill="#b77c5c" />
      <g fill="#cbc3be"><rect x="27" y="118" width="24" height="1.3" /><rect x="27" y="122" width="18" height="1.3" /></g>
    {/if}
    <path d={DROPPER_BODY} fill={shade} />
  {:else if kind === 'lrp-cream'}
    <rect x="8.5" y="36" width="63" height="5.5" rx="1" fill="#eeebe7" />
    <path d="M12 36.5v4.6M16 36.5v4.6M20 36.5v4.6M24 36.5v4.6M28 36.5v4.6M32 36.5v4.6M36 36.5v4.6M40 36.5v4.6M44 36.5v4.6M48 36.5v4.6M52 36.5v4.6M56 36.5v4.6M60 36.5v4.6M64 36.5v4.6M68 36.5v4.6" stroke="#d9d4ce" stroke-width=".5" />
    <path d={TUBE_DOWN} fill="#fafaf8" />
    <rect x="14" y="121" width="52" height="35" rx="3" fill="url(#{uid}-blue-cap)" />
    <rect x="34" y="45" width="12" height="12" rx="1" fill="#0395d7" />
    <rect x="22" y="64" width="36" height="2.4" rx=".5" fill="#1b1b1b" />
    <g fill="#bdb8b3"><rect x="24" y="70" width="32" height="1.2" /><rect x="26" y="74" width="28" height="1.2" /></g>
    <rect x="16" y="86" width="48" height="10" fill="#9fbfc6" />
    <g fill="#0395d7"><rect x="25" y="101" width="30" height="1.4" /><rect x="29" y="105" width="22" height="1.4" /></g>
    <path d={TUBE_DOWN} fill={shade} />
    <rect x="14" y="121" width="52" height="35" rx="3" fill={shade} />
  {:else if kind === 'boj-sun' || kind === 'tube'}
    {@const brand = kind === 'boj-sun'}
    <rect x="16" y="22" width="48" height="5.5" rx="1" fill={brand ? '#e2cfc2' : '#ecd2c4'} />
    <path d={TUBE_UP} fill={brand ? '#ecdcd1' : '#f3ddd0'} />
    <rect x="25.5" y="134.5" width="29" height="21.5" rx="2" fill="#faf8f5" stroke="#e2dcd6" stroke-width=".5" />
    {#if brand}
      <g stroke="#4a4340" stroke-width="1"><path d="M33 44v34M37 44v28M41 44v31M45 44v24" /></g>
      <rect x="30" y="96" width="20" height=".9" fill="#e7a2a6" />
      <rect x="39" y="104" width="6" height="7" rx="1" fill="#1a1a1a" />
      <circle cx="46.5" cy="112" r="1.4" fill="#e46a76" />
    {:else}
      <rect x="28" y="56" width="24" height="3" rx="1" fill="#c79a90" />
      <g fill="#cbc3be"><rect x="29" y="64" width="22" height="1.3" /><rect x="31" y="68" width="18" height="1.3" /></g>
    {/if}
    <path d={TUBE_UP} fill={shade} />
    <rect x="25.5" y="134.5" width="29" height="21.5" rx="2" fill={shade} />
  {:else if kind === 'pc-bha'}
    <rect x="20" y="22" width="40" height="26" rx="2" fill="url(#{uid}-silver)" />
    <rect x="20" y="48" width="40" height="108" rx="2" fill="#2a2a2c" />
    <path d="M25 70V145" stroke="#f2f2f2" stroke-width="4" stroke-dasharray="9 2 5 2 7 2 4 2" />
    <g fill="#f2f2f2"><rect x="35" y="70" width="18" height="1.6" /><rect x="35" y="74" width="14" height="1.6" /><rect x="35" y="78" width="16" height="1.6" /></g>
    <g fill="#8a8a8c"><rect x="35" y="96" width="18" height="1.1" /><rect x="35" y="100" width="14" height="1.1" /><rect x="35" y="104" width="16" height="1.1" /></g>
    <rect x="20" y="22" width="40" height="134" rx="2" fill={shade} />
  {:else if kind === 'lrp-duo' || kind === 'slim-tube'}
    {@const brand = kind === 'lrp-duo'}
    <rect x="18.5" y="21" width="43" height="4.5" rx="1" fill="#eeebe7" />
    <path d={SLIM_TUBE} fill="#fafaf8" />
    <rect x="24" y="133.5" width="32" height="22.5" rx="2" fill={brand ? '#d6cecb' : '#e8b9b1'} opacity=".9" />
    {#if brand}
      <rect x="33.5" y="28" width="12" height="12" rx="1" fill="#0395d7" />
      <rect x="27" y="44" width="26" height="1.8" rx=".5" fill="#9a9694" />
      <rect x="25" y="64" width="30" height="2.6" rx=".5" fill="#1b1b1b" />
      <g fill="#9cc7e6"><rect x="27" y="72" width="26" height="1.3" /><rect x="29" y="76" width="22" height="1.3" /><rect x="28" y="80" width="24" height="1.3" /></g>
      <rect x="27" y="104" width="26" height="12" fill="none" stroke="#0395d7" stroke-width=".9" />
    {:else}
      <rect x="28" y="52" width="24" height="3" rx="1" fill="#c79a90" />
      <g fill="#cbc3be"><rect x="29" y="60" width="22" height="1.3" /><rect x="31" y="64" width="18" height="1.3" /></g>
    {/if}
    <path d={SLIM_TUBE} fill={shade} />
  {:else if kind === 'jar'}
    <rect x="14" y="92" width="52" height="17" rx="3.4" fill="#f0dbd2" />
    <rect x="14" y="104.5" width="52" height="4.5" fill="#e3c8bd" />
    <path d={JAR_BODY} fill="url(#{uid}-rosegold)" />
    <rect x="22" y="121" width="36" height="17" rx="2" fill="#fbf6f2" opacity=".9" />
    <rect x="28" y="126" width="24" height="2.6" rx="1" fill="#c79a90" />
    <rect x="31" y="131.5" width="18" height="1.2" fill="#cbc3be" />
    <path d={JAR_BODY} fill={shade} />
    <rect x="14" y="92" width="52" height="17" rx="3.4" fill={shade} />
  {:else if kind === 'compact'}
    <rect x="28" y="78" width="24" height="18.5" rx="2" fill="#3a2c2a" />
    <path d={COMPACT_BODY} fill="#e9c3b5" />
    <rect x="26" y="114" width="28" height="22" rx="2" fill="#fbf6f2" opacity=".85" />
    <rect x="31" y="120" width="18" height="2.6" rx="1" fill="#b98476" />
    <path d={COMPACT_BODY} fill={shade} />
  {/if}
</svg>

<style>
  .bottle {
    display: block;
    height: 100%;
    width: auto;
    max-width: 100%;
    overflow: visible;
  }
</style>
