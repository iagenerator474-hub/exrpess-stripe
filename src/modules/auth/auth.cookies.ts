import type { Request, Response } from "express";
import { getCookieSecure } from "../../config/index.js";

const COOKIE_NAME = "refreshToken";

export function getRefreshTokenFromRequest(req: Request): string | undefined {
  const fromCookie = req.cookies?.[COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const parsed = req.body as { refreshToken?: string };
  return typeof parsed?.refreshToken === "string" ? parsed.refreshToken : undefined;
}

export function setRefreshTokenCookie(
  res: Response,
  refreshToken: string,
  expiresAt: Date
): void {
  const maxAgeMs = expiresAt.getTime() - Date.now();
  const maxAgeSec = Math.max(0, Math.floor(maxAgeMs / 1000));
  res.cookie(COOKIE_NAME, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: getCookieSecure(),
    path: "/",
    maxAge: maxAgeSec,
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: getCookieSecure(),
    path: "/",
  });
}
