import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { AppError } from "./errorHandler.js";

export function authGuard(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
    return;
  }

  try {
    const verifyOptions: jwt.VerifyOptions = { issuer: config.JWT_ISSUER };
    if (config.JWT_AUDIENCE) verifyOptions.audience = config.JWT_AUDIENCE;
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, verifyOptions) as jwt.JwtPayload & {
      sub: string;
      email?: string;
      role?: string;
    };
    req.user = { ...decoded, userId: decoded.sub };
    next();
  } catch {
    next(new AppError("Invalid or expired token", 401, "UNAUTHORIZED"));
  }
}
