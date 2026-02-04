import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { authGuard } from "../../middleware/authGuard.js";
import { config } from "../../config/index.js";
import { registerBodySchema, loginBodySchema } from "./auth.validation.js";
import * as authService from "./auth.service.js";
import * as refreshTokenService from "./refreshToken.service.js";
import {
  getRefreshTokenFromRequest,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} from "./auth.cookies.js";
import { AppError } from "../../middleware/errorHandler.js";

const router = Router();

const refreshLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_REFRESH_WINDOW_MS,
  max: config.RATE_LIMIT_REFRESH_MAX,
  message: { error: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = registerBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors.map((e) => e.message).join("; ") || "Validation failed";
      throw new AppError(msg, 400, "VALIDATION_ERROR");
    }
    const result = await authService.register(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors.map((e) => e.message).join("; ") || "Validation failed";
      throw new AppError(msg, 400, "VALIDATION_ERROR");
    }
    const result = await authService.login(parsed.data);
    setRefreshTokenCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
    res.status(200).json({ accessToken: result.accessToken, user: result.user });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
      return;
    }
    const result = await authService.getMe(userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/refresh",
  refreshLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = getRefreshTokenFromRequest(req);
      if (!token) {
        throw new AppError("Refresh token required", 401, "UNAUTHORIZED");
      }
      const result = await refreshTokenService.rotate(token);
      setRefreshTokenCookie(res, result.newRefreshTokenValue, result.newExpiresAt);
      res.status(200).json({ accessToken: result.accessToken, user: result.user });
    } catch (err) {
      next(err);
    }
  }
);

router.post("/logout", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = getRefreshTokenFromRequest(req);
    if (token) {
      await refreshTokenService.revokeByTokenValue(token);
    }
    clearRefreshTokenCookie(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post("/logout-all", authGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId ?? req.user?.sub;
    if (!userId) {
      next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
      return;
    }
    await refreshTokenService.revokeAllForUser(userId);
    clearRefreshTokenCookie(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export const authRoutes = router;
