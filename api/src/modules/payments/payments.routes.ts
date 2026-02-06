import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { authGuard } from "../../middleware/authGuard.js";
import { config } from "../../config/index.js";
import { checkoutSessionBodySchema } from "./checkout.validation.js";
import * as checkoutService from "./checkout.service.js";
import { AppError } from "../../middleware/errorHandler.js";

const router = Router();

const checkoutLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_CHECKOUT_WINDOW_MS,
  max: config.RATE_LIMIT_CHECKOUT_MAX,
  message: { error: "Too many checkout attempts" },
  standardHeaders: true,
  legacyHeaders: false,
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
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export const paymentsRoutes = router;
