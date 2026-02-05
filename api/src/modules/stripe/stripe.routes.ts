import { Router } from "express";
import express from "express";
import { config } from "../../config/index.js";
import { handleStripeWebhook } from "./stripe.webhook.js";

// Raw body required for Stripe signature verification (route mounted before express.json in app)
const router = Router();

router.post(
  "/webhook",
  express.raw({ type: "application/json", limit: config.WEBHOOK_BODY_LIMIT }),
  (req, res, next) => {
    void handleStripeWebhook(req, res).catch(next);
  }
);

export const stripeWebhookRoutes = router;
