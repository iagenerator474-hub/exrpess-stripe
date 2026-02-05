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

/** Minimal payload for ledger: ids only, no secrets. */
function minimalPayload(event: Stripe.Event): Record<string, unknown> {
  const obj = event.data?.object as { id?: string; metadata?: { orderId?: string }; client_reference_id?: string } | undefined;
  return {
    type: event.type,
    stripeEventId: event.id,
    orderId: obj?.metadata?.orderId ?? obj?.client_reference_id ?? undefined,
    stripeSessionId: obj?.id ?? undefined,
  };
}

/**
 * Durable webhook: persist PaymentEvent first, then process, then ACK.
 * Never 2xx before event is in DB. P2002 => 200 (idempotent). Other DB errors => 500 (Stripe retries).
 */
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const rawBody = req.body as Buffer | undefined;
  const sig = req.headers["stripe-signature"] as string | undefined;
  const requestId = req.requestId;

  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Missing raw body" });
    return;
  }

  if (!sig) {
    logger.warn("Stripe webhook missing signature", { requestId });
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
    logger.warn("Stripe webhook signature verification failed", { requestId, error: message });
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  const stripeEventId = event.id;
  const payload = minimalPayload(event);

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderIdFromEvent = session.metadata?.orderId ?? session.client_reference_id ?? null;
      const sessionId = session.id;

      const payloadSnapshot = {
        ...payload,
        amount_total: session.amount_total ?? undefined,
        currency: session.currency ?? undefined,
        payment_status: session.payment_status ?? undefined,
      };

      let orderId: string | null = orderIdFromEvent;
      let orphaned = !orderIdFromEvent;

      if (orderIdFromEvent) {
        const orderExists = await prisma.order.findUnique({
          where: { id: orderIdFromEvent },
          select: { id: true },
        });
        if (!orderExists) {
          orderId = null;
          orphaned = true;
        }
      }

      try {
        await prisma.paymentEvent.create({
          data: {
            stripeEventId,
            type: event.type,
            orderId,
            orphaned,
            payload: payloadSnapshot,
          },
        });
      } catch (createErr: unknown) {
        const code = createErr && typeof createErr === "object" && "code" in createErr ? (createErr as { code?: string }).code : undefined;
        if (code === "P2002") {
          logger.info("Stripe webhook duplicate ignored", { requestId, stripeEventId, stripeSessionId: sessionId, orderId: orderIdFromEvent });
          res.status(200).json({ received: true });
          return;
        }
        logger.error("Webhook persist failed", { requestId, stripeEventId, error: String(createErr) });
        res.status(500).json({ error: "Internal server error" });
        return;
      }

      if (orderIdFromEvent && !orphaned) {
        const updateResult = await prisma.order.updateMany({
          where: {
            id: orderIdFromEvent,
            stripeSessionId: sessionId,
            status: { not: "paid" },
          },
          data: { status: "paid", paidAt: new Date() },
        });
        logger.info("Stripe webhook outcome", {
          requestId,
          stripeEventId,
          stripeSessionId: sessionId,
          orderId: orderIdFromEvent,
          outcome: updateResult.count > 0 ? "updated_order" : "noop",
        });
      } else if (orphaned) {
        logger.warn("checkout.session.completed stored as orphaned", {
          requestId,
          stripeEventId,
          stripeSessionId: sessionId,
          orderId: orderIdFromEvent,
        });
      }
    } else {
      try {
        await prisma.paymentEvent.create({
          data: {
            stripeEventId,
            type: event.type,
            orderId: null,
            orphaned: true,
            payload,
          },
        });
      } catch (createErr: unknown) {
        const code = createErr && typeof createErr === "object" && "code" in createErr ? (createErr as { code?: string }).code : undefined;
        if (code === "P2002") {
          logger.info("Stripe webhook duplicate ignored", { requestId, stripeEventId, type: event.type });
          res.status(200).json({ received: true });
          return;
        }
        logger.error("Webhook persist failed", { requestId, stripeEventId, error: String(createErr) });
        res.status(500).json({ error: "Internal server error" });
        return;
      }
      logger.info("Stripe webhook event", { requestId, stripeEventId, type: event.type });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    logger.error("Webhook processing failed", { requestId, stripeEventId, error: String(err) });
    res.status(500).json({ error: "Internal server error" });
  }
}
