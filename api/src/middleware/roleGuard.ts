import type { Request, Response, NextFunction } from "express";
import { AppError } from "./errorHandler.js";

export function roleGuard(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
      return;
    }
    const role = (req.user as { role?: string }).role ?? "user";
    if (!allowedRoles.includes(role)) {
      next(new AppError("Forbidden", 403, "FORBIDDEN"));
      return;
    }
    next();
  };
}
