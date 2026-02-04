import { Router } from "express";
import express from "express";
import { config } from "../../config/index.js";
import { handleStripeWebhook } from "./stripe.webhook.js";

/**
 * Webhook Stripe: raw body (Buffer) for signature verification, body size limit.
 * Mounted before express.json() in app so this route never gets parsed JSON.
 */
const router = Router();

router.post(
  "/webhook",
  express.raw({ type: "application/json", limit: config.WEBHOOK_BODY_LIMIT }),
  handleStripeWebhook
);

export const stripeWebhookRoutes = router;
