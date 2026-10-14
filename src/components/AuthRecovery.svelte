<script lang="ts">
  import Page from '@/components/Page.svelte';
  import { api } from '@/lib/api.ts';
  import { session } from '@/state/session.svelte.ts';
  import { link } from '@/router/router.svelte.ts';
  let password=$state(''); let repeated=$state(''); let busy=$state(false);
  let error=$state(''); let complete=$state(false);
  async function submit(event:SubmitEvent) {
    event.preventDefault(); if(busy)return; error='';
    if(password!==repeated) {error='The passwords do not match.';return;}
    busy=true;
    try {await api.updatePassword(password); password='';repeated='';session.reset();complete=true;}
    catch(cause){error=cause instanceof Error?cause.message:'The password could not be changed.';}
    finally{busy=false;}
  }
</script>
<Page eyebrow="Account" title="Reset your password." lede="Use the reset link in the same browser that requested it.">
  {#if complete}
    <p role="status">Your password has been changed. Sign in again with your new password.</p>
    <a class="cta" href="/" use:link>Return to sign in</a>
  {:else}
    <form onsubmit={submit} class="card">
      <label class="field"><span>New password</span><input type="password" autocomplete="new-password" bind:value={password} minlength="8" required disabled={busy} /></label>
      <label class="field"><span>Confirm new password</span><input type="password" autocomplete="new-password" bind:value={repeated} minlength="8" required disabled={busy} /></label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="cta" type="submit" disabled={busy}>{busy?'Updating password...':'Update password'}</button>
      <a href="/" use:link>Return to sign in</a>
    </form>
  {/if}
</Page>
