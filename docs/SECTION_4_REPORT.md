# Section 4 pause report — Demo checkout

Sections 4 and 5 were authorized together. This checkpoint records Section 4 before Section 5 implementation.

## Built and verbatim confirmation

- `src/pages/legal/SubscriptionDisclosurePage.svelte:6` opens the adult checkout walkthrough at `/legal/subscription`, with account review logging and the guardian branch available.
- `src/components/legal/CheckoutPreview.svelte` retains the same-block disclosure and payment button, guardian heading, and separate initially unticked EU/UK checkbox. Pending submissions cannot be repeated. The unavailable-payment notice appears immediately, including when review logging fails.
- `shared/age-flow.ts:27` retains the guide §7 text: “You are subscribing to Evia. 20.99 US dollars for the first month, then 40 US dollars per month until you cancel. Charged to your payment method each month. Cancel any time in Settings or through the Stripe customer portal.” Button: “Subscribe and pay 20.99 US dollars”. The existing exact-copy test checks every §5–7 string against the guide.
- `src/lib/payment-service.ts:5`: `PaymentService.isEnabled()` remains false even if Stripe variables are present. Click message: “Payments launch soon — check back shortly”. No card collection, provider call or charge occurs.

## Deviations and issues

No deviation from demo payment scope. EU/UK is an explicitly labelled scenario selector, not verified jurisdiction. No subscription or cancellation portal exists. Confirmation email is **Not yet — needs live payment before prod**; it must repeat intro price, renewal price, renewal date and cancellation method. Engineering owns integration; legal owns final publication. Guest logging remains temporary; account attempts use the existing sample-only immutable event endpoint. No browser or live payment test was performed.

## Validation

`npm run typecheck && npm run check && npm run test:local` passed: TypeScript exit 0; Svelte 0 errors/0 warnings; 35 test files / 307 tests passed in 176.83 seconds. Disposable database stopped and discarded.

## Tracker diff

- P-07: partial checkout → demo checkout complete, confirmation email not yet implemented. Live Stripe, webhook, funding evidence, emails and policy publication remain pre-production requirements (engineering + legal).
- P-17: payment availability guard confirmed; no live provider/environment dependency. P-17's broader status is unchanged until Section 5 validation.
- Current allowance and Section 4 delta updated; the other pledge rows are unchanged.
