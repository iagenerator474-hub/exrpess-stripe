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

function isLocalhostOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}
import { healthRoutes } from "./modules/health/health.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { productsRoutes } from "./modules/products/products.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { stripeWebhookRoutes } from "./modules/stripe/stripe.routes.js";

const app = express();

// Trust proxy: required behind Nginx/Render/Fly for correct client IP and cookies
if (getTrustProxy()) {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(requestId);

const origins = getCorsOrigins();
app.use(
  cors({
    origin:
      config.NODE_ENV === "development"
        ? (origin, cb) => {
            if (!origin) {
              cb(null, true);
              return;
            }
            if (origins === "*" && isLocalhostOrigin(origin)) {
              cb(null, origin);
              return;
            }
            if (origins === "*") {
              cb(null, true);
              return;
            }
            const list = origins as string[];
            cb(null, list.includes(origin) ? origin : false);
          }
        : origins === "*"
          ? true
          : (origin, cb) => {
              if (!origin) {
                cb(null, true);
                return;
              }
              const list = origins as string[];
              cb(null, list.includes(origin) ? origin : false);
            },
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

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
app.use("/products", productsRoutes);
app.use("/payments", paymentsRoutes);
app.use(healthRoutes);

const demoEnabled = config.NODE_ENV !== "production" || config.ENABLE_DEMO === true;

if (demoEnabled) {
  app.get("/", (_req, res) => res.redirect(302, "/demo"));
  app.get("/demo", (_req, res) => {
    res.sendFile("index.html", { root: path.join(__dirname, "..", "demo") });
  });
  app.get("/demo/", (_req, res) => res.redirect(302, "/demo"));
  app.use("/demo", express.static(path.join(__dirname, "..", "demo")));
} else {
  app.get("/", (_req, res) => res.status(200).json({ status: "ok" }));
}

app.get("/favicon.ico", (_req, res) => res.status(204).end());
app.get("/apple-touch-icon.png", (_req, res) => res.status(204).end());
app.get("/apple-touch-icon-precomposed.png", (_req, res) => res.status(204).end());
app.get("/robots.txt", (_req, res) => res.type("text/plain").send("User-agent: *\nDisallow:\n"));

app.use((req, _res, next) => {
  next(new AppError(`Not found: ${req.method} ${req.originalUrl}`, 404, "NOT_FOUND"));
});

app.use(errorHandler);

export default app;