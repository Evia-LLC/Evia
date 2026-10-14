<script lang="ts">
  import { session } from '@/state/session.svelte.ts';
  import { ApiError } from '@/lib/api.ts';
  function unhandled(event:PromiseRejectionEvent) {
    if (!(event.reason instanceof ApiError)) return;
    session.operationError=event.reason.message;
    event.preventDefault();
  }
</script>
<svelte:window onunhandledrejection={unhandled} />
{#if session.operationError}
  <aside class="operation-notice" role="alert">
    <p>{session.operationError}</p>
    <button class="btn btn--mini" type="button" onclick={()=>session.operationError=null}>Dismiss</button>
  </aside>
{/if}
<style>
  .operation-notice { position:fixed; z-index:10001; top:max(1rem,env(safe-area-inset-top)); right:1rem; max-width:min(30rem,calc(100vw - 2rem)); padding:1rem; background:var(--surface-strong); border:1px solid var(--line-strong); border-radius:var(--radius); color:var(--ink); box-shadow:var(--shadow); }
  p{margin:0 0 .5rem;line-height:1.5;}
</style>
