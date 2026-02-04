import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express 4-arg signature
  _next: NextFunction
): void {
  const requestId = req.requestId;
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message =
    err instanceof AppError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Internal server error";

  logger.error(message, {
    requestId,
    statusCode,
    ...(process.env.NODE_ENV !== "production" &&
      err instanceof Error && { stack: err.stack }),
  });

  res.status(statusCode).json({
    error: message,
    ...(requestId && { requestId }),
    ...(process.env.NODE_ENV === "development" && err instanceof Error && { stack: err.stack }),
  });
}
