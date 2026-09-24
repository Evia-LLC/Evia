<!--
  Detailed / Gen-Z explanation (specs/scan.md 2.8): the shared segmented
  control in its holo tone - navy track, rose pill - as a radio group. It
  switches the cards' register and asks the controller to keep it as her
  explanation style (explain.svelte.ts).
-->
<script lang="ts">
  import SegmentedTabs from '@/ui/SegmentedTabs.svelte';
  import type { ExplainStyle } from '@/view/scan.ts';
  import { chooseExplainStyle, explain } from './explain.svelte.ts';

  interface Props {
    full?: boolean;
    class?: string;
  }

  const { full = false, class: className = '' }: Props = $props();

  const options = [
    { id: 'detailed', label: 'Detailed' },
    { id: 'genz', label: 'Gen-Z explanation' },
  ];
</script>

<div class="explain {className}">
  <SegmentedTabs
    {options}
    value={explain.style}
    label="How Evia explains your reading"
    tone="holo"
    size="sm"
    {full}
    onchange={(id) => chooseExplainStyle(id as ExplainStyle)}
  />
</div>

<style>
  .explain {
    display: flex;
    justify-content: center;
    animation: explain-in 420ms var(--ease-out) both;
    animation-delay: 1.9s;
  }
  .explain :global(.ev-seg) {
    box-shadow:
      inset 0 0 0 1.5px rgba(140, 165, 210, 0.55),
      inset 0 1px 0 rgba(200, 220, 255, 0.12);
    background: rgba(28, 48, 76, 0.78);
  }
  .explain :global(.ev-seg__pill) {
    box-shadow: 0 0 10px rgba(240, 170, 190, 0.35);
  }
  @keyframes explain-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .explain {
      animation: none;
    }
  }
  :global([data-reduced-motion='true']) .explain {
    animation: none;
  }
</style>
