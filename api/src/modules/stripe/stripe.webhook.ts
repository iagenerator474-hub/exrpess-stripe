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

/** Minimal payload for ledger (RGPD): no orderId in payload; orderId stored only in column. */
function minimalPayload(event: Stripe.Event): Record<string, unknown> {
  const obj = event.data?.object as { id?: string } | undefined;
  return {
    type: event.type,
    stripeEventId: event.id,
    stripeSessionId: obj?.id ?? undefined,
  };
}

/** Sanity checks before mutating Order from a checkout session. Returns false if session is incoherent with order. */
function sessionOrderSanityCheck(
  session: Stripe.Checkout.Session,
  orderRow: { id: string; amountCents: number; currency: string }
): boolean {
  if (session.mode !== "payment") return false;
  const refOrderId = session.metadata?.orderId ?? session.client_reference_id ?? null;
  if (refOrderId !== orderRow.id) return false;
  const amountMatch = session.amount_total != null && session.amount_total === orderRow.amountCents;
  const currencyMatch =
    (session.currency ?? "").toLowerCase() === (orderRow.currency ?? "").toLowerCase();
  return amountMatch && currencyMatch;
}

/**
 * Durable webhook: persist PaymentEvent first, then process, then ACK.
 * Never 2xx before event is in DB. P2002 => 200 (idempotent). Other DB errors => 500 (Stripe retries).
 */
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const rawBody = req.body as Buffer | undefined;
  const sig = req.headers["stripe-signature"] as string | undefined;
  const requestId = req.requestId;

  const safeMeta = (meta: Record<string, unknown>) => (requestId ? { ...meta, requestId } : meta);

  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Missing raw body", ...(requestId && { requestId }) });
    return;
  }

  if (!sig) {
    logger.warn("Stripe webhook missing signature", safeMeta({}));
    res.status(400).json({ error: "Missing stripe-signature header", ...(requestId && { requestId }) });
    return;
  }

  const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.warn("STRIPE_WEBHOOK_SECRET not set");
    res.status(500).json({ error: "Webhook not configured", ...(requestId && { requestId }) });
    return;
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    logger.warn("Stripe webhook signature verification failed", safeMeta({ error: message }));
    res.status(400).json({ error: "Invalid signature", ...(requestId && { requestId }) });
    return;
  }

  const stripeEventId = event.id;
  const payload = minimalPayload(event);

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderIdFromEvent = session.metadata?.orderId ?? session.client_reference_id ?? null;
      const sessionId = session.id;
      const paymentStatus = session.payment_status ?? "";

      const payloadSnapshot: Record<string, unknown> = {
        stripeEventId: event.id,
        stripeSessionId: sessionId,
        type: event.type,
        amount_total: session.amount_total ?? undefined,
        currency: session.currency ?? undefined,
        payment_status: session.payment_status ?? undefined,
      };

      let orderId: string | null = orderIdFromEvent;
      let orphaned = !orderIdFromEvent;

      if (paymentStatus !== "paid") {
        orphaned = true;
        if (orderIdFromEvent) {
          logger.warn("checkout.session.completed payment not paid, order not updated", {
            requestId,
            stripeEventId,
            stripeSessionId: sessionId,
            orderId: orderIdFromEvent,
            payment_status: paymentStatus,
          });
        }
      } else if (orderIdFromEvent) {
        const orderRow = await prisma.order.findUnique({
          where: { id: orderIdFromEvent },
          select: { id: true, amountCents: true, currency: true },
        });
        if (!orderRow) {
          orderId = null;
          orphaned = true;
        } else if (!sessionOrderSanityCheck(session, orderRow)) {
          logger.warn("checkout.session.completed sanity check failed, order not marked paid", {
            requestId,
            stripeEventId,
            stripeSessionId: sessionId,
            orderId: orderIdFromEvent,
            sessionMode: session.mode,
            sessionAmount: session.amount_total,
            sessionCurrency: session.currency,
            orderAmountCents: orderRow.amountCents,
            orderCurrency: orderRow.currency,
          });
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
          const existing = await prisma.paymentEvent.findUnique({
            where: { stripeEventId },
            select: { orphaned: true },
          });
          if (orderIdFromEvent && sessionId && existing && !existing.orphaned) {
            const paymentIntentId =
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : (session.payment_intent as Stripe.PaymentIntent)?.id ?? null;
            await prisma.order.updateMany({
              where: { id: orderIdFromEvent, status: { not: "paid" } },
              data: {
                stripeSessionId: sessionId,
                ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
                status: "paid",
                paidAt: new Date(),
              },
            });
          }
          res.status(200).json({ received: true });
          return;
        }
        if (config.NODE_ENV === "production") {
          logger.error("Webhook persist failed", { requestId, stripeEventId, errorCode: "persist_failed" });
        } else {
          logger.error("Webhook persist failed", { requestId, stripeEventId, error: String(createErr) });
        }
        res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
        return;
      }

      if (orderIdFromEvent && !orphaned) {
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent as Stripe.PaymentIntent)?.id ?? null;
        const updateResult = await prisma.order.updateMany({
          where: { id: orderIdFromEvent, status: { not: "paid" } },
          data: {
            stripeSessionId: sessionId,
            ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
            status: "paid",
            paidAt: new Date(),
          },
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
    } else if (event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderIdFromEvent = session.metadata?.orderId ?? session.client_reference_id ?? null;
      const sessionId = session.id;
      const payloadSnapshot: Record<string, unknown> = {
        stripeEventId: event.id,
        stripeSessionId: sessionId,
        type: event.type,
        amount_total: session.amount_total ?? undefined,
        currency: session.currency ?? undefined,
        payment_status: session.payment_status ?? undefined,
      };
      let orderId: string | null = orderIdFromEvent;
      let orphaned = !orderIdFromEvent;
      if (orderIdFromEvent) {
        const orderRow = await prisma.order.findUnique({
          where: { id: orderIdFromEvent },
          select: { id: true, amountCents: true, currency: true },
        });
        if (!orderRow || !sessionOrderSanityCheck(session, orderRow)) {
          orphaned = true;
          if (orderIdFromEvent) {
            logger.warn("checkout.session.async_payment_succeeded sanity check failed, order not marked paid", {
              requestId,
              stripeEventId,
              stripeSessionId: sessionId,
              orderId: orderIdFromEvent,
            });
          }
        }
      }
      try {
        await prisma.paymentEvent.create({
          data: { stripeEventId, type: event.type, orderId, orphaned, payload: payloadSnapshot },
        });
      } catch (createErr: unknown) {
        const code = createErr && typeof createErr === "object" && "code" in createErr ? (createErr as { code?: string }).code : undefined;
        if (code === "P2002") {
          const existing = await prisma.paymentEvent.findUnique({
            where: { stripeEventId },
            select: { orphaned: true },
          });
          if (orderIdFromEvent && sessionId && existing && !existing.orphaned) {
            const paymentIntentId =
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : (session.payment_intent as Stripe.PaymentIntent)?.id ?? null;
            await prisma.order.updateMany({
              where: { id: orderIdFromEvent, status: { not: "paid" } },
              data: {
                stripeSessionId: sessionId,
                ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
                status: "paid",
                paidAt: new Date(),
              },
            });
          }
          res.status(200).json({ received: true });
          return;
        }
        if (config.NODE_ENV === "production") {
          logger.error("Webhook persist failed", { requestId, stripeEventId, errorCode: "persist_failed" });
        } else {
          logger.error("Webhook persist failed", { requestId, stripeEventId, error: String(createErr) });
        }
        res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
        return;
      }
      if (orderIdFromEvent && !orphaned) {
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent as Stripe.PaymentIntent)?.id ?? null;
        await prisma.order.updateMany({
          where: { id: orderIdFromEvent, status: { not: "paid" } },
          data: {
            stripeSessionId: sessionId,
            ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
            status: "paid",
            paidAt: new Date(),
          },
        });
      }
      res.status(200).json({ received: true });
    } else if (event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderIdFromEvent = session.metadata?.orderId ?? session.client_reference_id ?? null;
      const sessionId = session.id;
      const payloadSnapshot: Record<string, unknown> = {
        stripeEventId: event.id,
        stripeSessionId: sessionId,
        type: event.type,
      };
      let orderId: string | null = orderIdFromEvent;
      let orphaned = !orderIdFromEvent;
      if (orderIdFromEvent) {
        const orderRow = await prisma.order.findUnique({
          where: { id: orderIdFromEvent },
          select: { id: true },
        });
        if (orderRow) orphaned = false;
      }
      try {
        await prisma.paymentEvent.create({
          data: { stripeEventId, type: event.type, orderId, orphaned, payload: payloadSnapshot },
        });
      } catch (createErr: unknown) {
        const code = createErr && typeof createErr === "object" && "code" in createErr ? (createErr as { code?: string }).code : undefined;
        if (code === "P2002") {
          const existing = await prisma.paymentEvent.findUnique({
            where: { stripeEventId },
            select: { orderId: true },
          });
          if (existing?.orderId) {
            await prisma.order.updateMany({
              where: { id: existing.orderId, status: "pending" },
              data: { status: "failed" },
            });
          }
          res.status(200).json({ received: true });
          return;
        }
        if (config.NODE_ENV === "production") {
          logger.error("Webhook persist failed", { requestId, stripeEventId, errorCode: "persist_failed" });
        } else {
          logger.error("Webhook persist failed", { requestId, stripeEventId, error: String(createErr) });
        }
        res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
        return;
      }
      if (orderId && !orphaned) {
        await prisma.order.updateMany({
          where: { id: orderId, status: "pending" },
          data: { status: "failed" },
        });
      }
      res.status(200).json({ received: true });
    } else if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
      const amount = charge.amount ?? 0;
      const amountRefunded = charge.amount_refunded ?? 0;
      const isFullRefund = amount > 0 && amountRefunded >= amount;

      const payloadSnapshot: Record<string, unknown> = {
        stripeEventId: event.id,
        type: event.type,
        chargeId: charge.id,
        paymentIntentId: paymentIntentId ?? undefined,
        amount,
        amount_refunded: amountRefunded,
      };

      let orderId: string | null = null;
      let orphaned = true;
      if (paymentIntentId) {
        const orderRow = await prisma.order.findFirst({
          where: { stripePaymentIntentId: paymentIntentId },
          select: { id: true },
        });
        if (orderRow) {
          orderId = orderRow.id;
          orphaned = false;
        }
      }
      if (orphaned) {
        logger.warn("charge.refunded order not found by payment_intent", {
          requestId,
          stripeEventId,
          chargeId: charge.id,
          paymentIntentId: paymentIntentId ?? undefined,
        });
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
          const existing = await prisma.paymentEvent.findUnique({
            where: { stripeEventId },
            select: { orphaned: true, orderId: true },
          });
          if (existing && existing.orderId && !existing.orphaned && isFullRefund) {
            await prisma.order.updateMany({
              where: { id: existing.orderId, status: "paid" },
              data: { status: "refunded" },
            });
          }
          res.status(200).json({ received: true });
          return;
        }
        if (config.NODE_ENV === "production") {
          logger.error("Webhook persist failed", { requestId, stripeEventId, errorCode: "persist_failed" });
        } else {
          logger.error("Webhook persist failed", { requestId, stripeEventId, error: String(createErr) });
        }
        res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
        return;
      }

      if (orderId && !orphaned && isFullRefund) {
        const updateResult = await prisma.order.updateMany({
          where: { id: orderId, status: "paid" },
          data: { status: "refunded" },
        });
        logger.info("Stripe webhook outcome", {
          requestId,
          stripeEventId,
          orderId,
          outcome: updateResult.count > 0 ? "refunded" : "noop",
        });
      } else if (orphaned) {
        logger.warn("charge.refunded stored as orphaned", { requestId, stripeEventId, chargeId: charge.id });
      }
    } else if (event.type === "payment_intent.refunded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const amountReceived = pi.amount_received ?? 0;
      const amountRefunded = pi.amount_refunded ?? 0;
      const isFullRefund = amountReceived > 0 && amountRefunded >= amountReceived;

      const payloadSnapshot: Record<string, unknown> = {
        stripeEventId: event.id,
        type: event.type,
        paymentIntentId: pi.id,
        amount_received: amountReceived,
        amount_refunded: amountRefunded,
      };

      let orderId: string | null = (pi.metadata?.orderId as string) ?? null;
      let orphaned = true;
      if (orderId) {
        const orderRow = await prisma.order.findUnique({
          where: { id: orderId },
          select: { id: true },
        });
        if (!orderRow) {
          orderId = null;
        } else {
          orphaned = false;
        }
      }
      if (orphaned && !orderId) {
        const orderByPi = await prisma.order.findFirst({
          where: { stripePaymentIntentId: pi.id },
          select: { id: true },
        });
        if (orderByPi) {
          orderId = orderByPi.id;
          orphaned = false;
        }
      }
      if (orphaned) {
        logger.warn("payment_intent.refunded order not found", {
          requestId,
          stripeEventId,
          paymentIntentId: pi.id,
        });
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
          const existing = await prisma.paymentEvent.findUnique({
            where: { stripeEventId },
            select: { orphaned: true, orderId: true },
          });
          if (existing && existing.orderId && !existing.orphaned && isFullRefund) {
            await prisma.order.updateMany({
              where: { id: existing.orderId, status: "paid" },
              data: { status: "refunded" },
            });
          }
          res.status(200).json({ received: true });
          return;
        }
        if (config.NODE_ENV === "production") {
          logger.error("Webhook persist failed", { requestId, stripeEventId, errorCode: "persist_failed" });
        } else {
          logger.error("Webhook persist failed", { requestId, stripeEventId, error: String(createErr) });
        }
        res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
        return;
      }

      if (orderId && !orphaned && isFullRefund) {
        const updateResult = await prisma.order.updateMany({
          where: { id: orderId, status: "paid" },
          data: { status: "refunded" },
        });
        logger.info("Stripe webhook outcome", {
          requestId,
          stripeEventId,
          orderId,
          outcome: updateResult.count > 0 ? "refunded" : "noop",
        });
      } else if (orphaned) {
        logger.warn("payment_intent.refunded stored as orphaned", { requestId, stripeEventId, paymentIntentId: pi.id });
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
        if (config.NODE_ENV === "production") {
          logger.error("Webhook persist failed", { requestId, stripeEventId, errorCode: "persist_failed" });
        } else {
          logger.error("Webhook persist failed", { requestId, stripeEventId, error: String(createErr) });
        }
        res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
        return;
      }
      logger.info("Stripe webhook event", { requestId, stripeEventId, type: event.type });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    if (config.NODE_ENV === "production") {
      logger.error("Webhook processing failed", { requestId, stripeEventId, errorCode: "processing_failed" });
    } else {
      logger.error("Webhook processing failed", { requestId, stripeEventId, error: String(err) });
    }
    res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
  }
}
