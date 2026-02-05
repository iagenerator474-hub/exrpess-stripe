import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../../config/index.js";

const REFRESH_TOKEN_BYTES = 32;

/** JWT payload: sub + role only (RGPD: no email in token; /me returns email from DB). */
export function generateAccessToken(payload: { sub: string; role: string }): string {
  const options: jwt.SignOptions = {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    issuer: config.JWT_ISSUER,
  };
  if (config.JWT_AUDIENCE) options.audience = config.JWT_AUDIENCE;
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, options);
}

export function generateRefreshTokenValue(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
