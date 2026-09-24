/** Demo checkout is disabled even if Stripe environment variables are present.
 * Live payment processing and confirmation emails require a separate production integration.
 */
export class PaymentService {
  static isEnabled(): boolean { return false; }
}
export const PAYMENT_UNAVAILABLE = 'Payments launch soon — check back shortly';
