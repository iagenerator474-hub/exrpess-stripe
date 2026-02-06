/**
 * Safe context for payment/checkout/webhook logs. Whitelist-only; no PII (e.g. email).
 * Use for all checkout.service and stripe.webhook logs so requestId, orderId, userId,
 * stripeSessionId, stripeEventId, stripePaymentIntentId are standardized and PII is never logged.
 */
const SAFE_PAYMENT_LOG_KEYS = new Set([
  "requestId",
  "orderId",
  "userId",
  "stripeSessionId",
  "stripeEventId",
  "stripePaymentIntentId",
  "type",
  "outcome",
  "reason",
  "error",
  "errorCode",
  "chargeId",
  "paymentIntentId",
  "orphaned",
  "pricingMode",
  "sessionMode",
  "sessionAmount",
  "sessionCurrency",
  "orderAmountCents",
  "orderCurrency",
  "hasCustomerEmail",
  "stripeError",
  "count",
  "payment_status",
  "amount",
  "amount_refunded",
  "amount_received",
  "eventType",
  "orphanReason",
  "metric",
  "stripeSessionId",
]);

/**
 * Returns a copy of ctx with only whitelisted keys and no value containing "@" (guards against email).
 * Use for every payment/checkout/webhook log meta so logs never include PII.
 */
export function safePaymentLogContext(ctx: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(ctx).filter(([k, v]) => {
      if (!SAFE_PAYMENT_LOG_KEYS.has(k)) return false;
      if (typeof v === "string" && v.includes("@")) return false;
      return true;
    })
  );
}
