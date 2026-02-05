import app from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const server = app.listen(config.PORT, () => {
  const meta: Record<string, unknown> = { env: config.NODE_ENV };
  if (config.NODE_ENV !== "production") {
    const stripePrefix =
      config.STRIPE_SECRET_KEY.slice(0, 12) +
      (config.STRIPE_SECRET_KEY.length > 12 ? "…" + config.STRIPE_SECRET_KEY.slice(-4) : "");
    meta.stripeKey = stripePrefix;
  }
  logger.info(`Server listening on port ${config.PORT}`, meta);
});

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
