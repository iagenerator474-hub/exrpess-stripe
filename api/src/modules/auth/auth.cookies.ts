import type { Request, Response } from "express";
import { getCookieSecure, getCookieDomain, getCookieSameSite } from "../../config/index.js";

const COOKIE_NAME = "refreshToken";

export function getRefreshTokenFromRequest(req: Request): string | undefined {
  const fromCookie = req.cookies?.[COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const parsed = req.body as { refreshToken?: string };
  return typeof parsed?.refreshToken === "string" ? parsed.refreshToken : undefined;
}

/** Cookie refresh: httpOnly, sameSite from config (lax|none|strict), Secure when sameSite=none or prod. */
export function setRefreshTokenCookie(
  res: Response,
  refreshToken: string,
  expiresAt: Date
): void {
  const maxAgeMs = Math.max(0, expiresAt.getTime() - Date.now());
  const sameSite = getCookieSameSite();
  const options: { httpOnly: boolean; sameSite: "lax" | "none" | "strict"; secure: boolean; path: string; maxAge: number; domain?: string } = {
    httpOnly: true,
    sameSite,
    secure: getCookieSecure(),
    path: "/",
    maxAge: maxAgeMs,
  };
  const domain = getCookieDomain();
  if (domain) options.domain = domain;
  res.cookie(COOKIE_NAME, refreshToken, options);
}

export function clearRefreshTokenCookie(res: Response): void {
  const sameSite = getCookieSameSite();
  const options: { httpOnly: boolean; sameSite: "lax" | "none" | "strict"; secure: boolean; path: string; domain?: string } = {
    httpOnly: true,
    sameSite,
    secure: getCookieSecure(),
    path: "/",
  };
  const domain = getCookieDomain();
  if (domain) options.domain = domain;
  res.clearCookie(COOKIE_NAME, options);
}
