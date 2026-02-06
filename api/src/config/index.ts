import "dotenv/config";
import { z } from "zod";

const DEFAULT_STRIPE_API_VERSION = "2025-02-24.acacia";

/** Reusable boolean env: true only for true / "true" / "1". Accepts string or boolean (test stability). */
export const envBool = z
  .union([z.string(), z.boolean()])
  .transform((v) => v === true || v === "true" || v === "1");

/** Optional boolean env; undefined when absent. */
const envBoolOptional = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) =>
    v === undefined ? undefined : v === true || v === "true" || v === "1"
  );

/** Optional boolean env with default. */
const envBoolDefault = (d: boolean) =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) =>
      v === undefined ? d : v === true || v === "true" || v === "1"
    )
    .default(d);

const postgresUrlSchema = z
  .string()
  .min(1, "DATABASE_URL is required")
  .refine(
    (s) => s.startsWith("postgresql://") || s.startsWith("postgres://"),
    "DATABASE_URL must be a PostgreSQL URL (postgresql:// or postgres://)"
  );

const stripeSecretKeySchema = z
  .string({ required_error: "STRIPE_SECRET_KEY is required (Stripe Dashboard → API keys). Use sk_test_ in dev, sk_live_ in production." })
  .min(1, "STRIPE_SECRET_KEY must not be empty")
  .refine((s) => s.startsWith("sk_"), "STRIPE_SECRET_KEY must start with sk_ (sk_test_ or sk_live_).");

const stripeWebhookSecretSchema = z
  .string({
    required_error:
      "STRIPE_WEBHOOK_SECRET is required. Get the signing secret from Stripe Dashboard → Webhooks → [your endpoint] → Signing secret (whsec_...).",
  })
  .min(1, "STRIPE_WEBHOOK_SECRET must not be empty")
  .refine((s) => s.startsWith("whsec_"), "STRIPE_WEBHOOK_SECRET must start with whsec_.");

const stripeSuccessUrlSchema = z
  .string({ required_error: "STRIPE_SUCCESS_URL is required (redirect after successful checkout). Must be a valid URL." })
  .url("STRIPE_SUCCESS_URL must be a valid URL (e.g. https://app.example.com/success).");

const stripeCancelUrlSchema = z
  .string({ required_error: "STRIPE_CANCEL_URL is required (redirect when user cancels checkout). Must be a valid URL." })
  .url("STRIPE_CANCEL_URL must be a valid URL (e.g. https://app.example.com/cancel).");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: postgresUrlSchema,
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().min(1).max(365).default(30),
  COOKIE_SECURE: envBoolOptional,
  COOKIE_SAMESITE: z.enum(["lax", "none", "strict"]).default("lax"),
  COOKIE_DOMAIN: z.string().optional(),
  STRIPE_SECRET_KEY: stripeSecretKeySchema,
  STRIPE_SUCCESS_URL: stripeSuccessUrlSchema,
  STRIPE_CANCEL_URL: stripeCancelUrlSchema,
  STRIPE_WEBHOOK_SECRET: stripeWebhookSecretSchema,
  STRIPE_API_VERSION: z.string().min(1).default(DEFAULT_STRIPE_API_VERSION),
  WEBHOOK_BODY_LIMIT: z.string().default("512kb"),
  /** strict = amount_total must match order.amountCents; flex = allow taxes/shipping (currency + orderId + paid + amount_total >= order.amountCents). */
  STRIPE_PRICING_MODE: z.enum(["strict", "flex"]).default("strict"),
  CORS_ORIGINS: z.string().default("*"),
  JWT_ISSUER: z.string().min(1).default("express-stripe-auth"),
  JWT_AUDIENCE: z.string().min(1).optional(),
  TRUST_PROXY: envBoolOptional,
  /** In production, when true (default), TRUST_PROXY must be set. Set to false only if app is not behind a proxy. */
  REQUIRE_TRUST_PROXY_IN_PROD: envBoolOptional,
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(10),
  RATE_LIMIT_REFRESH_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_REFRESH_MAX: z.coerce.number().default(30),
  /** Webhook rate limit: window (ms). Applied to POST /stripe/webhook. Default 60s. */
  /** Webhook rate limit: by IP; window (ms). High threshold to avoid blocking Stripe. */
  RATE_LIMIT_WEBHOOK_WINDOW_MS: z.coerce.number().default(60 * 1000),
  /** Webhook rate limit: max requests per window per IP. Default 1000/min; override in .env for dev (e.g. 100). */
  RATE_LIMIT_WEBHOOK_MAX: z.coerce.number().default(1000),
  /** Checkout rate limit: by IP (userId not available at limiter). Window (ms). */
  RATE_LIMIT_CHECKOUT_WINDOW_MS: z.coerce.number().default(60 * 1000),
  /** Checkout rate limit: max requests per window per IP. */
  RATE_LIMIT_CHECKOUT_MAX: z.coerce.number().default(30),
  ENABLE_DEMO: envBoolOptional,
  HEALTH_EXPOSE_ENV: envBoolDefault(false),
  LOG_STACK_IN_PROD: envBoolDefault(false),
  PAYMENT_EVENT_RETENTION_MODE: z.enum(["retain", "erase"]).default("retain"),
  PAYMENT_EVENT_RETENTION_DAYS: z.coerce.number().min(1).max(365 * 10).default(365),
});

export type Config = z.infer<typeof envSchema>;

const WEBHOOK_SECRET_MIN_LENGTH_AFTER_PREFIX = 20;
const WEBHOOK_SECRET_PLACEHOLDERS = [
  "whsec_123",
  "whsec_test",
  "whsec_placeholder",
  "whsec_changeme",
  "whsec_your_webhook_secret",
];

/** Rejects weak or placeholder STRIPE_WEBHOOK_SECRET in production. Throws with clear message. */
function validateStripeWebhookSecretForProd(secret: string): void {
  const s = secret.trim();
  if (!s) {
    const msg = "STRIPE_WEBHOOK_SECRET is required in production and must not be empty.";
    console.error(msg);
    throw new Error(msg);
  }
  if (s.length < 6 + WEBHOOK_SECRET_MIN_LENGTH_AFTER_PREFIX) {
    const msg = `STRIPE_WEBHOOK_SECRET must be at least ${6 + WEBHOOK_SECRET_MIN_LENGTH_AFTER_PREFIX} characters (whsec_ + at least ${WEBHOOK_SECRET_MIN_LENGTH_AFTER_PREFIX} chars).`;
    console.error(msg);
    throw new Error(msg);
  }
  if (!/^whsec_[A-Za-z0-9]+$/.test(s)) {
    const msg = "STRIPE_WEBHOOK_SECRET must match pattern whsec_<alphanumeric> (no spaces or special chars).";
    console.error(msg);
    throw new Error(msg);
  }
  const lower = s.toLowerCase();
  if (WEBHOOK_SECRET_PLACEHOLDERS.some((p) => lower === p || lower.includes("your_webhook_secret"))) {
    const msg =
      "STRIPE_WEBHOOK_SECRET must be the real signing secret from Stripe Dashboard (Webhooks). Placeholder values are not allowed in production.";
    console.error(msg);
    throw new Error(msg);
  }
}

/** Production-only checks; throws if invalid. Used by loadConfig and by tests. */
export function validateProductionConfig(data: Config): void {
  if (data.NODE_ENV !== "production") return;
  if (data.CORS_ORIGINS === "*") {
    const msg =
      "CORS_ORIGINS must not be * in production. Set explicit origins (e.g. CORS_ORIGINS=https://app.example.com).";
    console.error(msg);
    throw new Error(msg);
  }
  if (data.STRIPE_SECRET_KEY.startsWith("sk_test_")) {
    const msg = "STRIPE_SECRET_KEY must be a live key (sk_live_...) in production. Use Stripe Dashboard → API keys.";
    console.error(msg);
    throw new Error(msg);
  }
  if (data.ENABLE_DEMO === true) {
    const msg = "ENABLE_DEMO must not be true in production. Keep disabled except for explicit demo needs.";
    console.error(msg);
    throw new Error(msg);
  }
  if (data.JWT_ACCESS_SECRET.length < 32) {
    const msg = "JWT_ACCESS_SECRET must be at least 32 characters in production.";
    console.error(msg);
    throw new Error(msg);
  }
  const requireTrustProxy = data.REQUIRE_TRUST_PROXY_IN_PROD !== false;
  if (requireTrustProxy && data.TRUST_PROXY !== true) {
    const msg =
      "TRUST_PROXY is required in production when the app is behind a reverse proxy (Nginx, Render, Fly). Set TRUST_PROXY=1, or REQUIRE_TRUST_PROXY_IN_PROD=false if not behind a proxy.";
    console.error(msg);
    throw new Error(msg);
  }
  validateStripeWebhookSecretForProd(data.STRIPE_WEBHOOK_SECRET);
  if (!data.STRIPE_SUCCESS_URL.startsWith("https://")) {
    const msg = "STRIPE_SUCCESS_URL must use https:// in production.";
    console.error(msg);
    throw new Error(msg);
  }
  if (!data.STRIPE_CANCEL_URL.startsWith("https://")) {
    const msg = "STRIPE_CANCEL_URL must use https:// in production.";
    console.error(msg);
    throw new Error(msg);
  }
}

function formatConfigError(parsed: z.SafeParseError<unknown>): string {
  const flat = parsed.error.flatten();
  const field = flat.fieldErrors && Object.keys(flat.fieldErrors).length > 0 ? Object.keys(flat.fieldErrors)[0] : null;
  const msg = field && flat.fieldErrors?.[field]?.[0];
  if (typeof msg === "string") return `${field}: ${msg}`;
  return "Invalid environment configuration. Check the variables listed above.";
}

function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = formatConfigError(parsed);
    console.error("Invalid environment config:", message);
    console.error("Details:", parsed.error.flatten());
    throw new Error(message);
  }
  const data = parsed.data;
  validateProductionConfig(data);
  return data;
}

export const config = loadConfig();

export function getCorsOrigins(): string[] | "*" {
  if (config.CORS_ORIGINS === "*") return "*";
  return config.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
}

export function getCookieSecure(): boolean {
  if (config.COOKIE_SECURE !== undefined) return config.COOKIE_SECURE;
  if (config.COOKIE_SAMESITE === "none") return true;
  return config.NODE_ENV === "production";
}

export function getCookieSameSite(): "lax" | "none" | "strict" {
  return config.COOKIE_SAMESITE;
}

export function getCookieDomain(): string | undefined {
  const v = config.COOKIE_DOMAIN;
  return v && v.trim() ? v.trim() : undefined;
}

export function getTrustProxy(): boolean {
  return config.TRUST_PROXY === true;
}
