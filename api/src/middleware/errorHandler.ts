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
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const serverMessage = isAppError
    ? err.message
    : err instanceof Error
      ? err.message
      : "Internal server error";

  // Always log server-side: message, stack, requestId, route (prod-safe)
  logger.error(serverMessage, {
    requestId,
    statusCode,
    method: req.method,
    path: req.path,
    ...(err instanceof Error && { stack: err.stack }),
  });

  // Client: AppError => expose message; non-AppError => prod = generic 500 only
  const clientMessage =
    isAppError || process.env.NODE_ENV === "development"
      ? serverMessage
      : "Internal server error";

  const body: Record<string, unknown> = {
    error: clientMessage,
    ...(requestId && { requestId }),
    ...(statusCode === 404 && { path: req.method + " " + req.originalUrl }),
    ...(process.env.NODE_ENV === "development" && err instanceof Error && { stack: err.stack }),
  };
  res.status(statusCode).json(body);
}
