import app from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const MIGRATION_REQUIRED_MSG =
  "Migration required: column Order.stripe_payment_intent_id is missing";

async function ensureMigrationStripePaymentIntentId(): Promise<void> {
  const isProd = config.NODE_ENV === "production";
  try {
    const r = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Order' AND column_name = 'stripe_payment_intent_id'
    `;
    if (Array.isArray(r) && r.length === 0) {
      logger.error(`${MIGRATION_REQUIRED_MSG}. Run: npx prisma migrate deploy`);
      if (isProd) {
        console.error(MIGRATION_REQUIRED_MSG);
        process.exit(1);
      }
    }
  } catch (e) {
    logger.error("Could not verify migration stripePaymentIntentId", { error: String(e) });
    if (isProd) {
      console.error(MIGRATION_REQUIRED_MSG);
      process.exit(1);
    }
  }
}

const server = app.listen(config.PORT, () => {
  const meta: Record<string, unknown> = { env: config.NODE_ENV };
  const stripeMode = config.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : "test";
  meta.stripeKeyMode = stripeMode;
  logger.info(`Server listening on port ${config.PORT}`, meta);
  if (config.NODE_ENV === "production" && config.TRUST_PROXY !== true) {
    logger.warn(
      "TRUST_PROXY not set in production: req.ip and rate-limit (e.g. /stripe/webhook) may see a single proxy IP. Set TRUST_PROXY=1 if behind Nginx/Render/Fly."
    );
  }
});
void ensureMigrationStripePaymentIntentId();

let shuttingDown = false;

function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown start", { signal });
  server.close(() => {
    prisma
      .$disconnect()
      .then(() => {
        logger.info("shutdown complete");
        process.exit(0);
      })
      .catch((err) => {
        logger.error("prisma disconnect error", { error: String(err) });
        process.exit(1);
      });
  });
  const forceExit = setTimeout(() => {
    logger.warn("shutdown timeout, forcing exit");
    process.exit(1);
  }, 15000);
  forceExit.unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export default server;
