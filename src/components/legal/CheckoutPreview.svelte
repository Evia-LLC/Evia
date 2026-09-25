<!--
  The checkout preview (main, Sections 2 and 4, 7d776c7): the Consent Wording
  Pack's section 7 disclosure and the payment button in one block, the
  guardian heading where it applies, and the EU/UK withdrawal-rights scenario
  with its separate, initially unticked checkbox that the button waits for.
  PaymentService is always off: the button only says "Payments launch soon -
  check back shortly". No card details, no payment.

  Restyled into the design system, logic unchanged: the disclosure and its
  button share one bordered block (the pack's "same visual block"), in the
  inks of the flow around it (AgeGuardianFlow's --f-* properties, light by
  default).
-->
<script lang="ts">
  import { AGE_FLOW_COPY as copy } from '@shared/age-flow.ts';
  import { PaymentService, PAYMENT_UNAVAILABLE } from '@/lib/payment-service.ts';
  import Button from '@/ui/Button.svelte';
  let { guardian = false, firstName = "[user's first name]", tone = 'light', onChoice = async (_action: string, _choice: string) => {} }: {
    guardian?: boolean; firstName?: string; tone?: 'light' | 'dark'; onChoice?: (action: string, choice: string) => Promise<void>;
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

<section class="checkout" aria-label="Subscription disclosure">
  <p class="checkout__demo">Checkout preview — no card details collected and no payment taken.</p>
  {#if guardian}<h3>{copy.guardianCheckout.replace("[user's first name]", firstName)}</h3>{/if}
  <label class="scenario"><input type="checkbox" bind:checked={euUk} /><span>EU/UK withdrawal-rights scenario</span></label>
  <div class="disclosure">
    <p class="disclosure__text">{copy.checkout}</p>
    {#if euUk}<label class="check"><input type="checkbox" required bind:checked={withdrawal} disabled={busy} onchange={recordWithdrawal} /><span>{copy.withdrawal}</span></label>{/if}
    <div><Button tone={tone === 'dark' ? 'dark' : 'light'} disabled={busy || (euUk && !withdrawal)} onclick={pay}>{copy.subscribe}</Button></div>
  </div>
  {#if message}<p class="checkout__status" role="status">{message}</p>{/if}
</section>

<style>
  .checkout {
    display: grid;
    gap: 12px;
    min-width: 0;
    color: var(--f-ink, var(--text));
  }
  p,
  h3 {
    margin: 0;
  }
  .checkout__demo {
    font-size: var(--fs-body-sm);
    color: var(--f-muted, var(--text-secondary));
  }
  h3 {
    font-size: var(--fs-lead);
    font-weight: var(--fw-medium);
    color: var(--f-strong, var(--text-strong));
  }
  .scenario,
  .check {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    cursor: pointer;
  }
  .scenario {
    min-height: 44px;
    align-items: center;
    font-size: var(--fs-body-sm);
    color: var(--f-muted, var(--text-secondary));
  }
  .scenario input,
  .check input {
    flex: none;
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--f-accent, var(--accent-strong));
  }
  .check input {
    margin-top: 2px;
  }
  /* The disclosure and the button it governs: one block. */
  .disclosure {
    display: grid;
    gap: 14px;
    min-width: 0;
    padding: 18px 20px;
    border: 1px solid var(--f-rim, var(--border-strong));
    border-radius: var(--r-md);
    background: var(--f-row, var(--cream-0));
  }
  /* The pack's button label is long: on a phone it wraps inside the block
     rather than pushing the block out of its card. */
  .disclosure :global(.ev-btn) {
    max-width: 100%;
    padding-block: 10px;
    white-space: normal;
    text-align: center;
  }
  .disclosure__text {
    max-width: 38em;
    color: var(--f-strong, var(--text-strong));
  }
  .check {
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--f-sunken, var(--surface-sunken));
    color: var(--f-strong, var(--text-strong));
  }
  .checkout__status {
    padding: 10px 14px;
    border-radius: var(--r-md);
    background: var(--f-sunken, var(--surface-sunken));
    color: var(--f-strong, var(--text-strong));
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
  }
  .scenario input:focus-visible,
  .check input:focus-visible {
    outline: var(--focus-width) solid var(--f-focus, var(--focus-ring));
    outline-offset: var(--focus-offset);
  }
</style>
