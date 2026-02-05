import "dotenv/config";
import { z } from "zod";

const DEFAULT_STRIPE_API_VERSION = "2025-02-24.acacia";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().min(1).max(365).default(30),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  COOKIE_DOMAIN: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_SUCCESS_URL: z.string().url(),
  STRIPE_CANCEL_URL: z.string().url(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  STRIPE_API_VERSION: z.string().min(1).default(DEFAULT_STRIPE_API_VERSION),
  WEBHOOK_BODY_LIMIT: z.string().default("1mb"),
  CORS_ORIGINS: z.string().default("*"),
  JWT_ISSUER: z.string().min(1).default("express-stripe-auth"),
  JWT_AUDIENCE: z.string().min(1).optional(),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(10),
  RATE_LIMIT_REFRESH_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_REFRESH_MAX: z.coerce.number().default(30),
  RATE_LIMIT_WEBHOOK_WINDOW_MS: z.coerce.number().default(60 * 1000),
  RATE_LIMIT_WEBHOOK_MAX: z.coerce.number().default(100),
  RATE_LIMIT_CHECKOUT_WINDOW_MS: z.coerce.number().default(60 * 1000),
  RATE_LIMIT_CHECKOUT_MAX: z.coerce.number().default(30),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment config:", parsed.error.flatten());
    throw new Error("Invalid environment configuration");
  }
  const data = parsed.data;
  if (data.NODE_ENV === "production" && data.CORS_ORIGINS === "*") {
    console.error("CORS_ORIGINS must not be * in production. Set explicit origins.");
    throw new Error("Invalid environment configuration");
  }
  return data;
}

export const config = loadConfig();

export function getCorsOrigins(): string[] | "*" {
  if (config.CORS_ORIGINS === "*") return "*";
  return config.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
}

export function getCookieSecure(): boolean {
  if (config.COOKIE_SECURE !== undefined) return config.COOKIE_SECURE;
  return config.NODE_ENV === "production";
}

export function getCookieDomain(): string | undefined {
  const v = config.COOKIE_DOMAIN;
  return v && v.trim() ? v.trim() : undefined;
}

export function getTrustProxy(): boolean {
  return config.TRUST_PROXY === true;
}
