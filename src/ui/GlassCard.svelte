<!--
  Frosted glass over the room, a photo or a plate.

  dark   rose-brown glass (the Home tip card, the sidebar's Talk to Evia card,
         the lesson card's tip box). Its tint alone keeps cream text at 4.5:1
         or better over the brightest glow a plate can put behind it, so the
         blur is decoration, not the thing making it readable.
  light  blush frosted glass for light backdrops (the Products hero's search
         and profile pill). Not for dark imagery: use `dark` there.
  holo   the scan's navy glass.

  The rim is a 1px gradient, brighter at the top-left like the mockups'
  glass edges. Browsers without backdrop-filter get a more opaque tint.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLElement> {
    variant?: 'dark' | 'light' | 'holo';
    as?: 'section' | 'article' | 'div' | 'aside' | 'li';
    padding?: 'none' | 'sm' | 'md' | 'lg';
    radius?: 'md' | 'lg' | 'xl' | '2xl';
    /** Denser tint, for small text or busy plates. */
    strong?: boolean;
    class?: string;
    children: Snippet;
  }

  const {
    variant = 'dark',
    as = 'div',
    padding = 'md',
    radius = 'xl',
    strong = false,
    class: className = '',
    children,
    ...rest
  }: Props = $props();
</script>

<svelte:element
  this={as}
  class="ev-glass ev-glass--{variant} ev-glass--pad-{padding} ev-glass--r-{radius} {className}"
  class:ev-glass--strong={strong}
  class:on-dark={variant === 'dark'}
  class:on-holo={variant === 'holo'}
  {...rest}
>
  {@render children()}
</svelte:element>

<style>
  .ev-glass {
    --glass-pad: 20px;
    --glass-r: var(--r-xl);
    --rim-a: var(--glass-dark-rim-hi);
    --rim-b: var(--glass-dark-rim-lo);
    position: relative;
    min-width: 0;
    padding: var(--glass-pad);
    border-radius: var(--glass-r);
    isolation: isolate;
  }
  .ev-glass::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    padding: 1px;
    border-radius: inherit;
    background: linear-gradient(135deg, var(--rim-a), var(--rim-b));
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

  .ev-glass--pad-none {
    --glass-pad: 0px;
  }
  .ev-glass--pad-sm {
    --glass-pad: 12px;
  }
  .ev-glass--pad-lg {
    --glass-pad: 24px;
  }
  .ev-glass--r-md {
    --glass-r: var(--r-md);
  }
  .ev-glass--r-lg {
    --glass-r: var(--r-lg);
  }
  .ev-glass--r-2xl {
    --glass-r: var(--r-2xl);
  }

  .ev-glass--dark {
    background: linear-gradient(135deg, var(--glass-dark-sheen) 0%, transparent 55%), var(--glass-dark);
    color: var(--text-on-dark);
    box-shadow: var(--shadow-lg);
    -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.1);
    backdrop-filter: blur(var(--glass-blur)) saturate(1.1);
  }
  .ev-glass--dark.ev-glass--strong {
    background: linear-gradient(135deg, var(--glass-dark-sheen) 0%, transparent 55%), var(--glass-dark-strong);
  }

  .ev-glass--light {
    --rim-a: var(--glass-light-rim-hi);
    --rim-b: var(--glass-light-rim);
    background: var(--glass-light);
    color: var(--text);
    box-shadow: var(--shadow-sm);
    -webkit-backdrop-filter: blur(14px) saturate(1.05);
    backdrop-filter: blur(14px) saturate(1.05);
  }
  .ev-glass--light.ev-glass--strong {
    background: var(--glass-light-strong);
  }

  .ev-glass--holo {
    --rim-a: var(--holo-rim-hi);
    --rim-b: var(--navy-line-faint);
    background: var(--glass-holo);
    color: var(--text-on-holo);
    box-shadow: var(--shadow-holo);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }

  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .ev-glass--dark {
      background: var(--glass-dark-strong);
    }
    .ev-glass--light {
      background: var(--glass-light-strong);
    }
    .ev-glass--holo {
      background: var(--navy-850);
    }
  }
</style>
