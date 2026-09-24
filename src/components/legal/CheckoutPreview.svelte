<script lang="ts">
  import { AGE_FLOW_COPY as copy } from '@shared/age-flow.ts';
  import { PaymentService, PAYMENT_UNAVAILABLE } from '@/lib/payment-service.ts';
  let { guardian = false, firstName = "[user's first name]", onChoice = async (_action: string, _choice: string) => {} }: {
    guardian?: boolean; firstName?: string; onChoice?: (action: string, choice: string) => Promise<void>;
  } = $props();
  let euUk = $state(false);
  let withdrawal = $state(false);
  let message = $state('');
  let busy = $state(false);
  async function recordWithdrawal(event: Event) {
    withdrawal = (event.currentTarget as HTMLInputElement).checked;
    try { await onChoice('withdrawal_rights', withdrawal ? 'accepted' : 'declined'); }
    catch { message = 'The withdrawal-rights choice could not be recorded.'; }
  }
  async function pay() {
    if (busy || (euUk && !withdrawal)) return;
    busy = true;
    if (!PaymentService.isEnabled()) message = PAYMENT_UNAVAILABLE;
    try { await onChoice('subscription_attempt', 'attempted'); }
    catch { message = `${PAYMENT_UNAVAILABLE}. The review choice could not be recorded.`; }
    finally { busy = false; }
  }
</script>
<section aria-label="Subscription disclosure">
  <p>Checkout preview — no card details collected and no payment taken.</p>
  {#if guardian}<h3>{copy.guardianCheckout.replace("[user's first name]", firstName)}</h3>{/if}
  <label><input type="checkbox" bind:checked={euUk} /> EU/UK withdrawal-rights scenario</label>
  <div class="disclosure">
    <p>{copy.checkout}</p>
    {#if euUk}<label><input type="checkbox" required bind:checked={withdrawal} disabled={busy} onchange={recordWithdrawal} /> {copy.withdrawal}</label>{/if}
    <button type="button" class="cta" disabled={busy || (euUk && !withdrawal)} onclick={pay}>{copy.subscribe}</button>
  </div>
  {#if message}<p role="status">{message}</p>{/if}
</section>
<style>.disclosure { border:1px solid var(--line); padding:1rem; margin:1rem 0; } label { display:flex; align-items:flex-start; gap:.7rem; margin:.8rem 0; } input { margin-top:.3rem; }</style>
