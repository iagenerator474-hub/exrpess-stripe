import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { safePaymentLogContext } from "../../lib/logContext.js";
import { config } from "../../config/index.js";
import * as stripeService from "../stripe/stripe.service.js";
import { AppError } from "../../middleware/errorHandler.js";

export interface CreateCheckoutSessionInput {
  userId: string;
  productId: string;
  /** From middleware; included in logs for correlation. */
  requestId?: string;
}

export interface CreateCheckoutSessionResult {
  checkoutUrl: string;
  stripeSessionId: string;
  orderId: string;
}

/** Read-only order summary for the owning user. No PII. Returns null if not found or not owner. */
export interface OrderSummary {
  id: string;
  status: string;
  productId: string | null;
  amountCents: number;
  currency: string;
  stripeSessionId: string | null;
  updatedAt: Date;
}

export async function getOrderForUser(
  orderId: string,
  userId: string
): Promise<OrderSummary | null> {
  const row = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true,
      status: true,
      productId: true,
      amountCents: true,
      currency: true,
      stripeSessionId: true,
      updatedAt: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    productId: row.productId,
    amountCents: row.amountCents,
    currency: row.currency,
    stripeSessionId: row.stripeSessionId,
    updatedAt: row.updatedAt,
  };
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput
): Promise<CreateCheckoutSessionResult> {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, amountCents: true, currency: true, active: true, sellable: true },
  });
  if (!product || !product.active) {
    throw new AppError("Invalid product", 400, "INVALID_PRODUCT");
  }
  if (!product.sellable) {
    throw new AppError("Product is not available for purchase", 400, "PRODUCT_NOT_SELLABLE");
  }

  const order = await prisma.order.create({
    data: {
      userId: input.userId,
      productId: input.productId,
      amountCents: product.amountCents,
      currency: product.currency,
      status: "pending",
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true },
  });
  const customerEmail = user?.email?.trim() || undefined;

  try {
    const session = await stripeService.createCheckoutSession({
      orderId: order.id,
      amountCents: product.amountCents,
      currency: product.currency,
      ...(customerEmail && { customer_email: customerEmail }),
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { stripeSessionId: session.sessionId },
    });

    logger.info(
      "Checkout session created",
      safePaymentLogContext({
        requestId: input.requestId,
        orderId: order.id,
        userId: input.userId,
        stripeSessionId: session.sessionId,
        hasCustomerEmail: !!customerEmail,
      })
    );

    return {
      checkoutUrl: session.url,
      stripeSessionId: session.sessionId,
      orderId: order.id,
    };
  } catch (err) {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "failed" },
    });
    const stripeMessage = err instanceof Error ? err.message : String(err);
    logger.warn(
      "Checkout session failed, order marked failed",
      safePaymentLogContext({
        requestId: input.requestId,
        orderId: order.id,
        userId: input.userId,
        stripeError: stripeMessage,
      })
    );
    throw new AppError(
      config.NODE_ENV === "development"
        ? `Payment setup failed: ${stripeMessage}`
        : "Payment setup failed",
      502,
      "STRIPE_ERROR"
    );
  }
}
