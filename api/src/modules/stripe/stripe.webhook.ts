import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripe } from "./stripe.service.js";
import { config } from "../../config/index.js";
import { logger } from "../../lib/logger.js";
import { safePaymentLogContext } from "../../lib/logContext.js";
import { prisma } from "../../lib/prisma.js";

/**
 * ACK policy (no PII/secrets in logs; use safePaymentLogContext):
 * - 2xx: Event received and processed (or ignored duplicate / unsupported type). Persist PaymentEvent before 2xx for handled types; unsupported types get 200 immediately so Stripe stops retrying.
 * - 4xx: Missing or invalid stripe-signature / raw body => do not retry (client error).
 * - 5xx: DB error (persist/update failed) or processing exception => Stripe retries.
 */

/** Event types handled by this webhook. Others are logged as ignored_event and ACKed 200. */
const SUPPORTED_EVENTS = new Set<string>([
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "charge.refunded",
  "payment_intent.refunded",
  "ping",
]);

/** Verify webhook signature; throws if invalid. */
export function verifyWebhookEvent(
  rawBody: Buffer,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

const ORPHAN_ACK_AGE_SECONDS = 24 * 3600; // > 24h => 200 to stop retries

/** True if Stripe event creation time is older than 24h (unix seconds). */
function isEventOlderThan24h(event: Stripe.Event): boolean {
  const created = event.created;
  if (created == null || typeof created !== "number") return false;
  return Math.floor(Date.now() / 1000) - created > ORPHAN_ACK_AGE_SECONDS;
}

/**
 * If orphaned and event recent: return 500 for retry; else 200. Call after persisting orphaned PaymentEvent.
 * When orphanReason is "no_order_id" (insoluble), always ACK 200 after persist to avoid infinite retries.
 */
function sendOrphanAck(
  res: Response,
  orphaned: boolean,
  event: Stripe.Event,
  requestId: string | undefined,
  orphanReason?: string
): boolean {
  if (!orphaned) return false;
  if (orphanReason === "no_order_id") {
    res.status(200).json({ received: true });
    return true;
  }
  if (isEventOlderThan24h(event)) {
    res.status(200).json({ received: true });
    return true;
  }
  res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
  return true;
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

/**
 * strict => amount_total === order.amountCents (exact match).
 * flex   => amount_total >= order.amountCents (allows taxes/shipping). Currency + orderId + paid required.
 * Logged once on first use. STRIPE_PRICING_MODE ∈ { strict, flex }, default strict (config).
 */
let pricingModeLogged = false;
function getPricingMode(): "strict" | "flex" {
  const env = process.env.STRIPE_PRICING_MODE;
  const mode = env === "flex" || env === "strict" ? env : config.STRIPE_PRICING_MODE;
  if (!pricingModeLogged) {
    pricingModeLogged = true;
    logger.info("pricing_mode", safePaymentLogContext({ pricingMode: mode, metric: "pricing_mode" }));
  }
  return mode;
}

type SanityCheckResult = { ok: true } | { ok: false; reason: string };

/** Sanity checks before mutating Order from a checkout session. Uses STRIPE_PRICING_MODE (strict|flex). */
function sessionOrderSanityCheck(
  session: Stripe.Checkout.Session,
  orderRow: { id: string; amountCents: number; currency: string },
  pricingMode: "strict" | "flex"
): SanityCheckResult {
  if (session.mode !== "payment") return { ok: false, reason: "mode_not_payment" };
  const refOrderId = session.metadata?.orderId ?? session.client_reference_id ?? null;
  if (refOrderId !== orderRow.id) return { ok: false, reason: "order_id_mismatch" };
  const currencyMatch =
    (session.currency ?? "").toLowerCase() === (orderRow.currency ?? "").toLowerCase();
  if (!currencyMatch) return { ok: false, reason: "currency_mismatch" };

  if (pricingMode === "strict") {
    const amountMatch = session.amount_total != null && session.amount_total === orderRow.amountCents;
    if (!amountMatch) return { ok: false, reason: "amount_mismatch" };
    return { ok: true };
  }

  // flex: require payment_status paid (caller already filters for completed/async_succeeded), and amount_total >= order to avoid underpayment
  const paymentStatus = session.payment_status ?? "";
  if (paymentStatus !== "paid") return { ok: false, reason: "payment_not_paid" };
  if (
    session.amount_total != null &&
    orderRow.amountCents != null &&
    session.amount_total < orderRow.amountCents
  ) {
    return { ok: false, reason: "amount_underpayment" };
  }
  return { ok: true };
}

/**
 * Durable webhook: persist PaymentEvent first, then process, then ACK.
 * Never 2xx before event is in DB. P2002 => 200 (idempotent). Other DB errors => 500 (Stripe retries).
 * Order missing: persist PaymentEvent with orphaned=true and payload.orphanReason (e.g. order_not_found).
 * ACK strategy: if orphaned and (event > 24h old OR duplicate P2002 with existing.orphaned) => 200 (stop retries);
 * else orphaned => 500 for retry. Never 2xx before signature verification. Idempotence via unique stripeEventId.
 */
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const rawBody = req.body as Buffer | undefined;
  const sig = req.headers["stripe-signature"] as string | undefined;
  const requestId = req.requestId;

  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    logger.warn("Stripe webhook missing raw body", safePaymentLogContext({ requestId, metric: "webhook_acked_4xx" }));
    res.status(400).json({ error: "Missing raw body", ...(requestId && { requestId }) });
    return;
  }

  if (!sig) {
    logger.warn("Stripe webhook missing signature", safePaymentLogContext({ requestId, metric: "webhook_acked_4xx" }));
    res.status(400).json({ error: "Missing stripe-signature header", ...(requestId && { requestId }) });
    return;
  }

  const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.warn("STRIPE_WEBHOOK_SECRET not set", safePaymentLogContext({ requestId, metric: "webhook_acked_5xx" }));
    res.status(500).json({ error: "Webhook not configured", ...(requestId && { requestId }) });
    return;
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    logger.warn("Stripe webhook signature verification failed", safePaymentLogContext({ requestId, error: message, metric: "webhook_acked_4xx" }));
    res.status(400).json({ error: "Invalid signature", ...(requestId && { requestId }) });
    return;
  }

  const stripeEventId = event.id;
  logger.info("webhook_received", safePaymentLogContext({ requestId, stripeEventId, eventType: event.type, metric: "webhook_received" }));

  if (!SUPPORTED_EVENTS.has(event.type)) {
    logger.info("ignored_event", safePaymentLogContext({ requestId, stripeEventId, eventType: event.type, metric: "ignored_event" }));
    res.status(200).json({ received: true });
    return;
  }

  const payload = minimalPayload(event);
  const safe = (meta: Record<string, unknown>) => safePaymentLogContext({ requestId, stripeEventId, ...meta });

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderIdFromEvent = session.metadata?.orderId ?? session.client_reference_id ?? null;
      const sessionId = session.id;
      const paymentStatus = session.payment_status ?? "";

      let orphanReason: string | undefined;
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
        orphanReason = "payment_not_paid";
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
          orphaned = true;
          orphanReason = "order_not_found";
          logger.warn("checkout.session.completed order not found, storing as orphaned", {
            requestId,
            stripeEventId,
            stripeSessionId: sessionId,
            orderId: orderIdFromEvent,
            orphaned: true,
            reason: "order_not_found",
          });
        } else {
          const pricingMode = getPricingMode();
          const sanityResult = sessionOrderSanityCheck(session, orderRow, pricingMode);
          if (!sanityResult.ok) {
            orphaned = true;
            orphanReason = "sanity_check_failed";
            logger.warn("checkout.session.completed sanity check failed, order not marked paid", {
              requestId,
              stripeEventId,
              stripeSessionId: sessionId,
              orderId: orderIdFromEvent,
              pricingMode,
              reason: sanityResult.reason,
              sessionMode: session.mode,
              sessionAmount: session.amount_total,
              sessionCurrency: session.currency,
              orderAmountCents: orderRow.amountCents,
              orderCurrency: orderRow.currency,
            });
          }
        }
      }
      if (orphanReason) payloadSnapshot.orphanReason = orphanReason;

      try {
        await prisma.paymentEvent.create({
          data: {
            stripeEventId,
            type: event.type,
            orderId,
            orphaned,
            ...(orphanReason != null && { orphanReason }),
            payload: payloadSnapshot,
          },
        });
        if (orphaned) {
          logger.info(
            "stripe_webhook_orphaned",
            safePaymentLogContext({
              requestId,
              stripeEventId,
              eventType: event.type,
              orderId: orderIdFromEvent ?? undefined,
              orphanReason: orphanReason ?? undefined,
              metric: "payment_orphaned",
            }),
          );
        }
      } catch (createErr: unknown) {
        const code =
          createErr && typeof createErr === "object" && "code" in createErr
            ? (createErr as { code?: string }).code
            : undefined;
        if (code === "P2002") {
          const existing = await prisma.paymentEvent.findUnique({
            where: { stripeEventId },
            select: { orphaned: true },
          });

          // Duplicate of an orphaned ledger: try to repair if Order exists now, otherwise keep orphan ACK strategy.
          if (existing?.orphaned) {
            if (!orderIdFromEvent) {
              // No orderId in event: insoluble orphan → keep existing orphan ACK policy (500 until cutoff, then 200).
              if (sendOrphanAck(res, true, event, requestId, orphanReason)) return;
              logger.info(
                "webhook_acked_200",
                safePaymentLogContext({
                  requestId,
                  stripeEventId,
                  stripeSessionId: sessionId,
                  orderId: orderIdFromEvent ?? undefined,
                  metric: "webhook_acked_200",
                }),
              );
              res.status(200).json({ received: true });
              return;
            }

            const orderRow = await prisma.order.findUnique({
              where: { id: orderIdFromEvent },
              select: { id: true, amountCents: true, currency: true },
            });

            if (!orderRow) {
              // Still orphaned: keep retry policy (500 until cutoff, then 200).
              if (sendOrphanAck(res, true, event, requestId, orphanReason ?? "order_not_found")) return;
              logger.info(
                "webhook_acked_200",
                safePaymentLogContext({
                  requestId,
                  stripeEventId,
                  stripeSessionId: sessionId,
                  orderId: orderIdFromEvent,
                  metric: "webhook_acked_200",
                }),
              );
              res.status(200).json({ received: true });
              return;
            }

            const pricingMode = getPricingMode();
            const sanityResult = sessionOrderSanityCheck(session, orderRow, pricingMode);
            if (!sanityResult.ok) {
              // Still considered orphan/sanity failure: let existing orphan ACK policy apply.
              if (sendOrphanAck(res, true, event, requestId, "sanity_check_failed")) return;
              logger.info(
                "webhook_acked_200",
                safePaymentLogContext({
                  requestId,
                  stripeEventId,
                  stripeSessionId: sessionId,
                  orderId: orderIdFromEvent,
                  metric: "webhook_acked_200",
                }),
              );
              res.status(200).json({ received: true });
              return;
            }

            const paymentIntentId =
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : (session.payment_intent as Stripe.PaymentIntent)?.id ?? null;

            await prisma.$transaction(async (tx) => {
              await tx.order.updateMany({
                where: { id: orderIdFromEvent, status: { not: "paid" } },
                data: {
                  stripeSessionId: sessionId,
                  ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
                  status: "paid",
                  paidAt: new Date(),
                },
              });
              await tx.paymentEvent.update({
                where: { stripeEventId },
                data: { orphaned: false, orphanReason: null, orderId: orderIdFromEvent },
              });
            });

            logger.info(
              "webhook_acked_200",
              safePaymentLogContext({
                requestId,
                stripeEventId,
                stripeSessionId: sessionId,
                orderId: orderIdFromEvent,
                metric: "webhook_acked_200",
              }),
            );
            res.status(200).json({ received: true });
            return;
          }

          logger.info(
            "Stripe webhook duplicate ignored",
            safePaymentLogContext({
              requestId,
              stripeEventId,
              stripeSessionId: sessionId,
              orderId: orderIdFromEvent,
            }),
          );
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
          logger.error(
            "Webhook persist failed",
            safePaymentLogContext({ requestId, stripeEventId, errorCode: "persist_failed", metric: "webhook_acked_5xx" }),
          );
        } else {
          logger.error(
            "Webhook persist failed",
            safePaymentLogContext({ requestId, stripeEventId, error: String(createErr), metric: "webhook_acked_5xx" }),
          );
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
        const paidMetric = updateResult.count > 0 ? "order_marked_paid" : "order_already_paid";
        logger.info("Stripe webhook outcome", safePaymentLogContext({ requestId, stripeEventId, stripeSessionId: sessionId, orderId: orderIdFromEvent, outcome: updateResult.count > 0 ? "updated_order" : "noop", metric: paidMetric }));
      } else if (orphaned) {
        if (sendOrphanAck(res, true, event, requestId, orphanReason)) return;
      }
      logger.info("webhook_acked_200", safePaymentLogContext({ requestId, stripeEventId, stripeSessionId: sessionId, orderId: orderIdFromEvent, metric: "webhook_acked_200" }));
      res.status(200).json({ received: true });
      return;
    } else if (event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderIdFromEvent = session.metadata?.orderId ?? session.client_reference_id ?? null;
      const sessionId = session.id;
      let orphanReason: string | undefined;
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
        if (!orderRow) {
          orphaned = true;
          orphanReason = "order_not_found";
          logger.warn("checkout.session.async_payment_succeeded order not found, storing as orphaned", {
            requestId,
            stripeEventId,
            stripeSessionId: sessionId,
            orderId: orderIdFromEvent,
            orphaned: true,
            reason: "order_not_found",
          });
        } else {
          const pricingMode = getPricingMode();
          const sanityResult = sessionOrderSanityCheck(session, orderRow, pricingMode);
          if (!sanityResult.ok) {
            orphaned = true;
            orphanReason = "sanity_check_failed";
            logger.warn("checkout.session.async_payment_succeeded sanity check failed, order not marked paid", {
              requestId,
              stripeEventId,
              stripeSessionId: sessionId,
              orderId: orderIdFromEvent,
              pricingMode,
              reason: sanityResult.reason,
            });
          }
        }
      }
      if (orphanReason) payloadSnapshot.orphanReason = orphanReason;
      try {
        await prisma.paymentEvent.create({
          data: {
            stripeEventId,
            type: event.type,
            orderId,
            orphaned,
            ...(orphanReason != null && { orphanReason }),
            payload: payloadSnapshot,
          },
        });
        if (orphaned) {
          logger.info(
            "stripe_webhook_orphaned",
            safePaymentLogContext({
              requestId,
              stripeEventId,
              eventType: event.type,
              orderId: orderIdFromEvent ?? undefined,
              orphanReason: orphanReason ?? undefined,
              metric: "payment_orphaned",
            }),
          );
        }
      } catch (createErr: unknown) {
        const code =
          createErr && typeof createErr === "object" && "code" in createErr
            ? (createErr as { code?: string }).code
            : undefined;
        if (code === "P2002") {
          const existing = await prisma.paymentEvent.findUnique({
            where: { stripeEventId },
            select: { orphaned: true },
          });

          if (existing?.orphaned) {
            if (!orderIdFromEvent) {
              if (sendOrphanAck(res, true, event, requestId, orphanReason)) return;
              logger.info(
                "webhook_acked_200",
                safePaymentLogContext({
                  requestId,
                  stripeEventId,
                  stripeSessionId: sessionId,
                  orderId: orderIdFromEvent ?? undefined,
                  metric: "webhook_acked_200",
                }),
              );
              res.status(200).json({ received: true });
              return;
            }

            const orderRow = await prisma.order.findUnique({
              where: { id: orderIdFromEvent },
              select: { id: true, amountCents: true, currency: true },
            });

            if (!orderRow) {
              if (sendOrphanAck(res, true, event, requestId, orphanReason ?? "order_not_found")) return;
              logger.info(
                "webhook_acked_200",
                safePaymentLogContext({
                  requestId,
                  stripeEventId,
                  stripeSessionId: sessionId,
                  orderId: orderIdFromEvent,
                  metric: "webhook_acked_200",
                }),
              );
              res.status(200).json({ received: true });
              return;
            }

            const pricingMode = getPricingMode();
            const sanityResult = sessionOrderSanityCheck(session, orderRow, pricingMode);
            if (!sanityResult.ok) {
              if (sendOrphanAck(res, true, event, requestId, "sanity_check_failed")) return;
              logger.info(
                "webhook_acked_200",
                safePaymentLogContext({
                  requestId,
                  stripeEventId,
                  stripeSessionId: sessionId,
                  orderId: orderIdFromEvent,
                  metric: "webhook_acked_200",
                }),
              );
              res.status(200).json({ received: true });
              return;
            }

            const paymentIntentId =
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : (session.payment_intent as Stripe.PaymentIntent)?.id ?? null;

            await prisma.$transaction(async (tx) => {
              await tx.order.updateMany({
                where: { id: orderIdFromEvent, status: { not: "paid" } },
                data: {
                  stripeSessionId: sessionId,
                  ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
                  status: "paid",
                  paidAt: new Date(),
                },
              });
              await tx.paymentEvent.update({
                where: { stripeEventId },
                data: { orphaned: false, orphanReason: null, orderId: orderIdFromEvent },
              });
            });

            logger.info(
              "webhook_acked_200",
              safePaymentLogContext({
                requestId,
                stripeEventId,
                stripeSessionId: sessionId,
                orderId: orderIdFromEvent,
                metric: "webhook_acked_200",
              }),
            );
            res.status(200).json({ received: true });
            return;
          }

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
          logger.error(
            "Webhook persist failed",
            safePaymentLogContext({ requestId, stripeEventId, errorCode: "persist_failed", metric: "webhook_acked_5xx" }),
          );
        } else {
          logger.error(
            "Webhook persist failed",
            safePaymentLogContext({ requestId, stripeEventId, error: String(createErr), metric: "webhook_acked_5xx" }),
          );
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
        logger.info("Stripe webhook outcome", safePaymentLogContext({ requestId, stripeEventId, stripeSessionId: sessionId, orderId: orderIdFromEvent, outcome: updateResult.count > 0 ? "updated_order" : "noop", metric: updateResult.count > 0 ? "order_marked_paid" : "order_already_paid" }));
      }
      if (orphaned && sendOrphanAck(res, true, event, requestId, orphanReason)) return;
      logger.info("webhook_acked_200", safePaymentLogContext({ requestId, stripeEventId, stripeSessionId: sessionId, orderId: orderIdFromEvent, metric: "webhook_acked_200" }));
      res.status(200).json({ received: true });
      return;
    } else if (
      event.type === "checkout.session.expired" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      // Same idempotent pattern as checkout.session.completed: persist PaymentEvent first, then process. Never validate payment; set Order.status = "failed" only.
      const session = event.data.object as Stripe.Checkout.Session;
      const orderIdFromEvent = session.metadata?.orderId ?? session.client_reference_id ?? null;
      const sessionId = session.id;
      let orphanReason: string | undefined;
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
        if (!orderRow) {
          orphaned = true;
          orphanReason = "order_not_found";
          logger.warn(`${event.type} order not found, storing as orphaned`, {
            requestId,
            stripeEventId,
            stripeSessionId: sessionId,
            orderId: orderIdFromEvent,
            orphaned: true,
            reason: "order_not_found",
          });
        }
      } else {
        orphanReason = "no_order_id";
      }
      if (orphanReason) payloadSnapshot.orphanReason = orphanReason;
      try {
        await prisma.paymentEvent.create({
          data: {
            stripeEventId,
            type: event.type,
            orderId,
            orphaned,
            ...(orphanReason != null && { orphanReason }),
            payload: payloadSnapshot,
          },
        });
        if (orphaned) {
          logger.info(
            "stripe_webhook_orphaned",
            safePaymentLogContext({
              requestId,
              stripeEventId,
              eventType: event.type,
              orderId: orderIdFromEvent ?? undefined,
              orphanReason: orphanReason ?? undefined,
              metric: "payment_orphaned",
            }),
          );
        }
      } catch (createErr: unknown) {
        const code =
          createErr && typeof createErr === "object" && "code" in createErr
            ? (createErr as { code?: string }).code
            : undefined;
        if (code === "P2002") {
          const existing = await prisma.paymentEvent.findUnique({
            where: { stripeEventId },
            select: { orderId: true, orphaned: true },
          });

          if (existing?.orphaned) {
            if (!orderIdFromEvent) {
              if (sendOrphanAck(res, true, event, requestId, orphanReason)) return;
              logger.info(
                "webhook_acked_200",
                safePaymentLogContext({
                  requestId,
                  stripeEventId,
                  stripeSessionId: sessionId,
                  orderId: orderIdFromEvent ?? undefined,
                  metric: "webhook_acked_200",
                }),
              );
              res.status(200).json({ received: true });
              return;
            }

            const orderRow = await prisma.order.findUnique({
              where: { id: orderIdFromEvent },
              select: { id: true },
            });

            if (!orderRow) {
              if (sendOrphanAck(res, true, event, requestId, orphanReason ?? "order_not_found")) return;
              logger.info(
                "webhook_acked_200",
                safePaymentLogContext({
                  requestId,
                  stripeEventId,
                  stripeSessionId: sessionId,
                  orderId: orderIdFromEvent,
                  metric: "webhook_acked_200",
                }),
              );
              res.status(200).json({ received: true });
              return;
            }

            await prisma.$transaction(async (tx) => {
              await tx.order.updateMany({
                where: { id: orderIdFromEvent, status: "pending" },
                data: { status: "failed" },
              });
              await tx.paymentEvent.update({
                where: { stripeEventId },
                data: { orphaned: false, orphanReason: null, orderId: orderIdFromEvent },
              });
            });

            logger.info(
              "webhook_acked_200",
              safePaymentLogContext({
                requestId,
                stripeEventId,
                stripeSessionId: sessionId,
                orderId: orderIdFromEvent,
                metric: "webhook_acked_200",
              }),
            );
            res.status(200).json({ received: true });
            return;
          }

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
          logger.error(
            "Webhook persist failed",
            safePaymentLogContext({ requestId, stripeEventId, errorCode: "persist_failed", metric: "webhook_acked_5xx" }),
          );
        } else {
          logger.error(
            "Webhook persist failed",
            safePaymentLogContext({ requestId, stripeEventId, error: String(createErr), metric: "webhook_acked_5xx" }),
          );
        }
        res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
        return;
      }
      if (orderId && !orphaned) {
        const updateResult = await prisma.order.updateMany({
          where: { id: orderId, status: "pending" },
          data: { status: "failed" },
        });
        logger.info(
          event.type === "checkout.session.expired"
            ? "checkout.session.expired order marked failed"
            : "checkout.session.async_payment_failed order marked failed",
          safePaymentLogContext({ requestId, stripeEventId, stripeSessionId: sessionId, orderId, outcome: updateResult.count > 0 ? "updated_order" : "noop", metric: "webhook_acked_200" })
        );
      } else if (orphaned) {
        if (sendOrphanAck(res, true, event, requestId, orphanReason)) return;
      }
      logger.info("webhook_acked_200", safePaymentLogContext({ requestId, stripeEventId, stripeSessionId: sessionId, orderId: orderIdFromEvent, metric: "webhook_acked_200" }));
      res.status(200).json({ received: true });
      return;
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
            ...(orphaned && { orphanReason: "order_not_found" as const }),
            payload: payloadSnapshot,
          },
        });
        if (orphaned) {
          logger.info("stripe_webhook_orphaned", safePaymentLogContext({ requestId, stripeEventId, eventType: event.type, orderId: undefined, orphanReason: "order_not_found", metric: "payment_orphaned" }));
        }
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
          logger.error("Webhook persist failed", safePaymentLogContext({ requestId, stripeEventId, errorCode: "persist_failed", metric: "webhook_acked_5xx" }));
        } else {
          logger.error("Webhook persist failed", safePaymentLogContext({ requestId, stripeEventId, error: String(createErr), metric: "webhook_acked_5xx" }));
        }
        res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
        return;
      }

      if (orderId && !orphaned && isFullRefund) {
        const updateResult = await prisma.order.updateMany({
          where: { id: orderId, status: "paid" },
          data: { status: "refunded" },
        });
        logger.info("Stripe webhook outcome", safePaymentLogContext({ requestId, stripeEventId, orderId, outcome: updateResult.count > 0 ? "refunded" : "noop", metric: "webhook_acked_200" }));
      }
      logger.info("webhook_acked_200", safePaymentLogContext({ requestId, stripeEventId, orderId: orderId ?? undefined, metric: "webhook_acked_200" }));
      res.status(200).json({ received: true });
      return;
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
      try {
        await prisma.paymentEvent.create({
          data: {
            stripeEventId,
            type: event.type,
            orderId,
            orphaned,
            ...(orphaned && { orphanReason: "order_not_found" as const }),
            payload: payloadSnapshot,
          },
        });
        if (orphaned) {
          logger.info("stripe_webhook_orphaned", safePaymentLogContext({ requestId, stripeEventId, eventType: event.type, orderId: undefined, orphanReason: "order_not_found", metric: "payment_orphaned" }));
        }
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
          logger.error("Webhook persist failed", safePaymentLogContext({ requestId, stripeEventId, errorCode: "persist_failed", metric: "webhook_acked_5xx" }));
        } else {
          logger.error("Webhook persist failed", safePaymentLogContext({ requestId, stripeEventId, error: String(createErr), metric: "webhook_acked_5xx" }));
        }
        res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
        return;
      }

      if (orderId && !orphaned && isFullRefund) {
        const updateResult = await prisma.order.updateMany({
          where: { id: orderId, status: "paid" },
          data: { status: "refunded" },
        });
        logger.info("Stripe webhook outcome", safePaymentLogContext({ requestId, stripeEventId, orderId, outcome: updateResult.count > 0 ? "refunded" : "noop", metric: "webhook_acked_200" }));
      }
      logger.info("webhook_acked_200", safePaymentLogContext({ requestId, stripeEventId, orderId: orderId ?? undefined, metric: "webhook_acked_200" }));
      res.status(200).json({ received: true });
      return;
    } else {
      try {
        await prisma.paymentEvent.create({
          data: {
            stripeEventId,
            type: event.type,
            orderId: null,
            orphaned: true,
            orphanReason: "unknown_event_type",
            payload,
          },
        });
        logger.info("stripe_webhook_orphaned", safePaymentLogContext({ requestId, stripeEventId, eventType: event.type, orderId: undefined, orphanReason: "unknown_event_type", metric: "payment_orphaned" }));
      } catch (createErr: unknown) {
        const code = createErr && typeof createErr === "object" && "code" in createErr ? (createErr as { code?: string }).code : undefined;
        if (code === "P2002") {
          logger.info("Stripe webhook duplicate ignored", safePaymentLogContext({ requestId, stripeEventId, eventType: event.type, metric: "webhook_acked_200" }));
          res.status(200).json({ received: true });
          return;
        }
        if (config.NODE_ENV === "production") {
          logger.error("Webhook persist failed", safePaymentLogContext({ requestId, stripeEventId, errorCode: "persist_failed", metric: "webhook_acked_5xx" }));
        } else {
          logger.error("Webhook persist failed", safePaymentLogContext({ requestId, stripeEventId, error: String(createErr), metric: "webhook_acked_5xx" }));
        }
        res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
        return;
      }
      logger.info("webhook_acked_200", safePaymentLogContext({ requestId, stripeEventId, eventType: event.type, metric: "webhook_acked_200" }));
      res.status(200).json({ received: true });
      return;
    }
  } catch (err) {
    if (config.NODE_ENV === "production") {
      logger.error("Webhook processing failed", safePaymentLogContext({ requestId, stripeEventId, errorCode: "processing_failed", metric: "webhook_acked_5xx" }));
    } else {
      logger.error("Webhook processing failed", safePaymentLogContext({ requestId, stripeEventId, error: String(err), metric: "webhook_acked_5xx" }));
    }
    res.status(500).json({ error: "Internal server error", ...(requestId && { requestId }) });
  }
}
