import app from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./lib/logger.js";

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

export default server;
