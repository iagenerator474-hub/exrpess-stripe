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

/** Process after ACK. Ledger: always create PaymentEvent first (idempotence). If Order missing => orphaned event, no throw. */
function processEvent(event: Stripe.Event, requestId?: string): void {
  const meta = { requestId, stripeEventId: event.id, type: event.type };

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderIdFromEvent = session.metadata?.orderId ?? session.client_reference_id ?? null;
    const sessionId = session.id;

    const payloadSnapshot = {
      type: event.type,
      stripeEventId: event.id,
      orderId: orderIdFromEvent,
      stripeSessionId: sessionId,
      amount_total: session.amount_total ?? undefined,
      currency: session.currency ?? undefined,
      payment_status: session.payment_status ?? undefined,
    };

    void (async () => {
      try {
        if (!orderIdFromEvent) {
          await prisma.paymentEvent.create({
            data: {
              stripeEventId: event.id,
              type: event.type,
              orderId: null,
              orphaned: true,
              payload: payloadSnapshot,
            },
          });
          logger.warn("checkout.session.completed missing orderId in metadata, event stored as orphaned", {
            ...meta,
            stripeSessionId: sessionId,
          });
          return;
        }

        const orderExists = await prisma.order.findUnique({
          where: { id: orderIdFromEvent },
          select: { id: true },
        });

        if (!orderExists) {
          await prisma.paymentEvent.create({
            data: {
              stripeEventId: event.id,
              type: event.type,
              orderId: null,
              orphaned: true,
              payload: payloadSnapshot,
            },
          });
          logger.warn("checkout.session.completed order not found, event stored as orphaned", {
            ...meta,
            orderId: orderIdFromEvent,
            stripeSessionId: sessionId,
          });
          return;
        }

        const result = await prisma.$transaction(async (tx) => {
          await tx.paymentEvent.create({
            data: {
              stripeEventId: event.id,
              type: event.type,
              orderId: orderIdFromEvent,
              orphaned: false,
              payload: payloadSnapshot,
            },
          });
          return tx.order.updateMany({
            where: {
              id: orderIdFromEvent,
              stripeSessionId: sessionId,
              status: { not: "paid" },
            },
            data: { status: "paid", paidAt: new Date() },
          });
        });

        const outcome = result.count > 0 ? "updated_order" : "noop";
        logger.info("Stripe webhook outcome", {
          requestId,
          stripeEventId: event.id,
          stripeSessionId: sessionId,
          orderId: orderIdFromEvent,
          outcome,
        });
      } catch (err: unknown) {
        const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
        if (code === "P2002") {
          logger.info("Stripe webhook duplicate ignored", {
            requestId,
            stripeEventId: event.id,
            stripeSessionId: sessionId,
            orderId: orderIdFromEvent,
          });
          return;
        }
        logger.error("Webhook processing failed", {
          requestId,
          orderId: orderIdFromEvent,
          stripeSessionId: sessionId,
          stripeEventId: event.id,
          error: String(err),
        });
      }
    })();
  } else {
    logger.info("Stripe webhook event", { ...meta, stripeSessionId: (event.data?.object as { id?: string })?.id });
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
