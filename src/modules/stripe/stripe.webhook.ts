import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripe } from "./stripe.service.js";
import { config } from "../../config/index.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";

/** Verify webhook signature; throws if invalid. */
export function verifyWebhookEvent(
  rawBody: Buffer,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/**
 * Process event after ACK. Idempotent via PaymentEvent (unique stripeEventId).
 * Logs: requestId, event.id, type only (no full payload in prod).
 */
function processEvent(event: Stripe.Event, requestId?: string): void {
  const meta = { requestId, stripeEventId: event.id, type: event.type };

  if (process.env.NODE_ENV !== "production") {
    logger.info("Stripe webhook event", meta);
  } else {
    logger.info("Stripe webhook event", { ...meta, stripeSessionId: (event.data?.object as { id?: string })?.id });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.orderId ?? session.client_reference_id;
    const sessionId = session.id;

    if (!orderId) {
      logger.warn("checkout.session.completed missing orderId in metadata", {
        ...meta,
        stripeSessionId: sessionId,
      });
      return;
    }

    // Minimal snapshot only (no full session/PII)
    const payloadSnapshot = {
      type: event.type,
      stripeEventId: event.id,
      orderId,
      stripeSessionId: sessionId,
      amount_total: session.amount_total ?? undefined,
      currency: session.currency ?? undefined,
      payment_status: session.payment_status ?? undefined,
    };

    // Crash-safe + idempotent: single transaction; P2002 => event already processed (NOOP)
    void prisma
      .$transaction(async (tx) => {
        await tx.paymentEvent.create({
          data: {
            stripeEventId: event.id,
            type: event.type,
            orderId,
            payload: payloadSnapshot,
          },
        });
        return tx.order.updateMany({
          where: { id: orderId, stripeSessionId: sessionId },
          data: { status: "paid" },
        });
      })
      .then((r) => {
        if (r.count > 0) {
          logger.info("Order marked paid", { requestId, orderId, stripeSessionId: sessionId });
        }
      })
      .catch((err: { code?: string }) => {
        if (err?.code === "P2002") {
          logger.info("Stripe event already processed (idempotent skip)", { ...meta, orderId });
          return;
        }
        logger.error("Webhook processing failed", {
          requestId,
          orderId,
          stripeSessionId: sessionId,
          stripeEventId: event.id,
          error: String(err),
        });
      });
  }
}

/** Verify signature → 200 ACK → process event async (raw body required). */
export function handleStripeWebhook(req: Request, res: Response): void {
  const rawBody = req.body as Buffer | undefined;
  const sig = req.headers["stripe-signature"] as string | undefined;

  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Missing raw body" });
    return;
  }

  if (!sig) {
    logger.warn("Stripe webhook missing signature", { requestId: req.requestId });
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.warn("STRIPE_WEBHOOK_SECRET not set");
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    logger.warn("Stripe webhook signature verification failed", {
      requestId: req.requestId,
      error: message,
    });
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  res.status(200).json({ received: true });
  setImmediate(() => processEvent(event, req.requestId));
}
