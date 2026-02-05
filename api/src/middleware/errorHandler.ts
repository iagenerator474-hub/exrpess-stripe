import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";
import { config } from "../config/index.js";

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

/** Log stack only in dev, or in prod when LOG_STACK_IN_PROD and 500 non-AppError. Never log headers/cookies/body. */
function shouldLogStack(statusCode: number, isAppError: boolean): boolean {
  if (config.NODE_ENV !== "production") return true;
  return config.LOG_STACK_IN_PROD === true && statusCode === 500 && !isAppError;
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

  logger.error(serverMessage, {
    requestId,
    statusCode,
    method: req.method,
    path: req.path,
    ...(err instanceof Error && shouldLogStack(statusCode, isAppError) && { stack: err.stack }),
  });

  const isProduction = process.env.NODE_ENV === "production";
  let clientMessage: string;
  let body: Record<string, unknown>;

  if (isProduction) {
    if (isAppError && err.statusCode < 500) {
      clientMessage = err.message;
      body = {
        error: clientMessage,
        ...(requestId && { requestId }),
        ...(statusCode === 404 && { path: req.method + " " + req.originalUrl }),
        ...(err.code && { code: err.code }),
      };
    } else {
      clientMessage = "Internal server error";
      body = {
        error: clientMessage,
        ...(requestId && { requestId }),
      };
    }
  } else {
    clientMessage =
      isAppError || process.env.NODE_ENV === "development"
        ? serverMessage
        : "Internal server error";
    body = {
      error: clientMessage,
      ...(requestId && { requestId }),
      ...(statusCode === 404 && { path: req.method + " " + req.originalUrl }),
      ...(isAppError && err.code && { code: err.code }),
      ...(err instanceof Error && { stack: err.stack }),
    };
  }

  res.status(statusCode).json(body);
}
