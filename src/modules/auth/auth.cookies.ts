import type { Request, Response } from "express";
import { getCookieSecure } from "../../config/index.js";

const COOKIE_NAME = "refreshToken";

export function getRefreshTokenFromRequest(req: Request): string | undefined {
  const fromCookie = req.cookies?.[COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const parsed = req.body as { refreshToken?: string };
  return typeof parsed?.refreshToken === "string" ? parsed.refreshToken : undefined;
}

/**
 * Set refresh token cookie. Express res.cookie() expects maxAge in MILLISECONDS.
 * Guard: do not pass seconds; maxAge must be computed from expiresAt and clamped >= 0.
 */
export function setRefreshTokenCookie(
  res: Response,
  refreshToken: string,
  expiresAt: Date
): void {
  const maxAgeMs = Math.max(0, expiresAt.getTime() - Date.now());
  res.cookie(COOKIE_NAME, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: getCookieSecure(),
    path: "/",
    maxAge: maxAgeMs, // Express: milliseconds, not seconds
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
