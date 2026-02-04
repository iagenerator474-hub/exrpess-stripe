import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import cors from "cors";
import rateLimit from "express-rate-limit";
import { requestId, errorHandler, AppError } from "./middleware/index.js";
import { getCorsOrigins, getTrustProxy } from "./config/index.js";
import { config } from "./config/index.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { stripeWebhookRoutes } from "./modules/stripe/stripe.routes.js";

const app = express();

if (getTrustProxy()) {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(requestId);

const origins = getCorsOrigins();
app.use(
  cors({
    origin: origins === "*" ? true : origins,
    credentials: origins !== "*",
    optionsSuccessStatus: 200,
  })
);

// Rate-limit placeholders: auth login
const authLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_AUTH_WINDOW_MS,
  max: config.RATE_LIMIT_AUTH_MAX,
  message: { error: "Too many attempts" },
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WEBHOOK_WINDOW_MS,
  max: config.RATE_LIMIT_WEBHOOK_MAX,
  message: { error: "Too many webhook requests" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/stripe", webhookLimiter, stripeWebhookRoutes);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use("/auth", authLimiter, authRoutes);
app.use("/payments", paymentsRoutes);
app.use(healthRoutes);

app.get("/", (_req, res) => {
  res.redirect(302, "/demo");
});

// Avoid 404 JSON for common browser/automation requests
app.get("/favicon.ico", (_req, res) => res.status(204).end());
app.get("/apple-touch-icon.png", (_req, res) => res.status(204).end());
app.get("/apple-touch-icon-precomposed.png", (_req, res) => res.status(204).end());
app.get("/robots.txt", (_req, res) => res.type("text/plain").send("User-agent: *\nDisallow:\n"));

app.get("/demo", (_req, res) => {
  res.sendFile("index.html", { root: path.join(__dirname, "..", "demo") });
});
app.get("/demo/", (_req, res) => {
  res.redirect(302, "/demo");
});
app.use("/demo", express.static(path.join(__dirname, "..", "demo")));

// 404 for any other path (must be after all routes)
app.use((req, _res, next) => {
  next(new AppError(`Not found: ${req.method} ${req.originalUrl}`, 404, "NOT_FOUND"));
});

app.use(errorHandler);

export default app;