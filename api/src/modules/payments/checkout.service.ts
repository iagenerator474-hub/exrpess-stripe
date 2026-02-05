import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import * as stripeService from "../stripe/stripe.service.js";
import { AppError } from "../../middleware/errorHandler.js";

export interface CreateCheckoutSessionInput {
  userId: string;
  productId: string;
}

export interface CreateCheckoutSessionResult {
  checkoutUrl: string;
  stripeSessionId: string;
  orderId: string;
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput
): Promise<CreateCheckoutSessionResult> {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, amountCents: true, currency: true, active: true },
  });
  if (!product || !product.active) {
    throw new AppError("Invalid product", 400, "INVALID_PRODUCT");
  }

  const order = await prisma.order.create({
    data: {
      userId: input.userId,
      amountCents: product.amountCents,
      currency: product.currency,
      status: "pending",
    },
  });

  try {
    const session = await stripeService.createCheckoutSession({
      orderId: order.id,
      amountCents: product.amountCents,
      currency: product.currency,
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { stripeSessionId: session.sessionId },
    });

    logger.info("Checkout session created", {
      orderId: order.id,
      stripeSessionId: session.sessionId,
    });

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
    logger.warn("Checkout session failed, order marked failed", {
      orderId: order.id,
      stripeError: stripeMessage,
    });
    throw new AppError(
      process.env.NODE_ENV === "development"
        ? `Payment setup failed: ${stripeMessage}`
        : "Payment setup failed",
      502,
      "STRIPE_ERROR"
    );
  }
}
