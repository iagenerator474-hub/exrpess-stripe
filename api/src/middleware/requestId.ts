import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

export function requestId(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const id = randomUUID();
  req.requestId = id;
  res.locals.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
