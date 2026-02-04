import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import cors from "cors";
import rateLimit from "express-rate-limit";
import { requestId, errorHandler } from "./middleware/index.js";
import { getCorsOrigins } from "./config/index.js";
import { config } from "./config/index.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { stripeWebhookRoutes } from "./modules/stripe/stripe.routes.js";

const app = express();

app.use(helmet());
app.use(requestId);

const origins = getCorsOrigins();
app.use(
  cors({
    origin: origins === "*" ? true : origins,
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

app.get("/demo", (_req, res) => {
  res.sendFile("index.html", { root: path.join(__dirname, "..", "demo") });
});
app.use("/demo", express.static(path.join(__dirname, "..", "demo")));

app.use(errorHandler);

export default app;