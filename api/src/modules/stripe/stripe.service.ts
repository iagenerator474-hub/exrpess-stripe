import Stripe from "stripe";
import { config } from "../../config/index.js";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(config.STRIPE_SECRET_KEY, {
      apiVersion: config.STRIPE_API_VERSION as Stripe.LatestApiVersion,
    });
  }
  return stripeClient;
}

export interface CreateCheckoutSessionParams {
  orderId: string;
  amountCents: number;
  currency: string;
  /** Server-only: from User.email, never from client. Omit if absent. */
  customer_email?: string;
}

export interface CreateCheckoutSessionResult {
  url: string;
  sessionId: string;
}

export async function createCheckoutSession(
  params: CreateCheckoutSessionParams
): Promise<CreateCheckoutSessionResult> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: params.currency.toLowerCase(),
          unit_amount: params.amountCents,
          product_data: {
            name: "Order",
            description: `Order ${params.orderId}`,
          },
        },
        quantity: 1,
      },
    ],
    // success_url: redirect only. Never use it to validate a payment. Validation must always go via GET /payments/orders/:id (webhook updates order, then client polls that endpoint).
    success_url: config.STRIPE_SUCCESS_URL,
    cancel_url: config.STRIPE_CANCEL_URL,
    client_reference_id: params.orderId,
    metadata: { orderId: params.orderId },
    ...(params.customer_email && params.customer_email.trim() && { customer_email: params.customer_email.trim() }),
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }

  return {
    url: session.url,
    sessionId: session.id,
  };
}
