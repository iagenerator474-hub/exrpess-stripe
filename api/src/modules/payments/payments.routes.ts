import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { authGuard } from "../../middleware/authGuard.js";
import { config } from "../../config/index.js";
import { logger } from "../../lib/logger.js";
import { checkoutSessionBodySchema } from "./checkout.validation.js";
import * as checkoutService from "./checkout.service.js";
import { AppError } from "../../middleware/errorHandler.js";

const router = Router();

// Checkout rate limit: by IP (auth runs after limiter so userId not available). Config: RATE_LIMIT_CHECKOUT_*.
const checkoutLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_CHECKOUT_WINDOW_MS,
  max: config.RATE_LIMIT_CHECKOUT_MAX,
  message: { error: "Too many checkout attempts" },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn("Checkout rate limit exceeded (429)", { requestId: req.requestId });
    res.status(429).json({ error: "Too many checkout attempts" });
  },
});

router.post(
  "/checkout-session",
  checkoutLimiter,
  authGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId ?? req.user?.sub;
      if (!userId) {
        next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
        return;
      }

      const parsed = checkoutSessionBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("Invalid request body", 400, "VALIDATION_ERROR");
      }

      const { productId } = parsed.data;
      const result = await checkoutService.createCheckoutSession({
        userId,
        productId,
        requestId: req.requestId,
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/orders/:id",
  authGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId ?? req.user?.sub;
      if (!userId) {
        next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
        return;
      }
      const orderId = req.params.id;
      if (!orderId) {
        next(new AppError("Order id required", 400, "VALIDATION_ERROR"));
        return;
      }
      const order = await checkoutService.getOrderForUser(orderId, userId);
      if (!order) {
        next(new AppError("Order not found", 404, "NOT_FOUND"));
        return;
      }
      res.status(200).json(order);
    } catch (err) {
      next(err);
    }
  }
);

export const paymentsRoutes = router;
