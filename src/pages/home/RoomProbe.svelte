<!--
  Draws nothing: reports whether the enclosing Room is showing its CSS
  stand-in, so Home can frame the stand-in by its own anchors rather than the
  render's (the render's image can fail after its anchors have loaded).
-->
<script lang="ts">
  import { useRoom } from '@/stage/room-anchors.ts';

  interface Props {
    onchange: (fallback: boolean) => void;
  }

  const { onchange }: Props = $props();
  const room = useRoom();

  $effect(() => {
    onchange(room?.fallback ?? true);
  });
</script>
