import app from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./lib/logger.js";

const server = app.listen(config.PORT, () => {
  logger.info(`Server listening on port ${config.PORT}`, { env: config.NODE_ENV });
});

export default server;
