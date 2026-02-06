/**
 * Reconcile a single order with Stripe Checkout Session (ops only, not exposed as route).
 * Use after a long outage if a webhook may have been missed: fetch session from Stripe, if paid then set Order to paid.
 *
 * Usage: ORDER_ID=order_xxx npx tsx src/scripts/reconcileOrder.ts
 *    or: npx tsx src/scripts/reconcileOrder.ts order_xxx
 *
 * Safe logs only (orderId, stripeSessionId, outcome); no PII.
 */
import "dotenv/config";
import { getStripe } from "../modules/stripe/stripe.service.js";
import { prisma } from "../lib/prisma.js";

async function main(): Promise<void> {
  const orderId = process.env.ORDER_ID ?? process.argv[2];
  if (!orderId?.trim()) {
    console.error("Usage: ORDER_ID=order_xxx npx tsx src/scripts/reconcileOrder.ts   OR   npx tsx src/scripts/reconcileOrder.ts <orderId>");
    process.exit(1);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, stripeSessionId: true, stripePaymentIntentId: true, amountCents: true, currency: true },
  });
  if (!order) {
    console.error("Order not found", { orderId });
    process.exit(1);
  }
  if (!order.stripeSessionId) {
    console.error("Order has no stripeSessionId", { orderId });
    process.exit(1);
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId, { expand: ["payment_intent"] });
  const paymentStatus = session.payment_status ?? "";
  const amountTotal = session.amount_total ?? 0;

  if (paymentStatus !== "paid") {
    console.info("Reconcile: session not paid, no update", { orderId, stripeSessionId: order.stripeSessionId, paymentStatus });
    process.exit(0);
  }
  if (amountTotal < (order.amountCents ?? 0)) {
    console.info("Reconcile: session amount less than order, no update", { orderId, stripeSessionId: order.stripeSessionId });
    process.exit(0);
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent as { id?: string })?.id ?? null;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: { not: "paid" } },
      data: {
        status: "paid",
        paidAt: new Date(),
        ...(paymentIntentId && !order.stripePaymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      },
    });
    if (updated.count > 0) {
      console.info("Reconcile: order marked paid", { orderId, stripeSessionId: order.stripeSessionId, outcome: "updated" });
    } else {
      console.info("Reconcile: order already paid, no change", { orderId, stripeSessionId: order.stripeSessionId, outcome: "noop" });
    }
  });
}

main().catch((err) => {
  console.error("Reconcile failed", err instanceof Error ? err.message : String(err));
  process.exit(1);
});