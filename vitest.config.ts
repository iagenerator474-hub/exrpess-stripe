import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    env: {
      NODE_ENV: "test",
      PORT: "3001",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_db_test",
      JWT_ACCESS_SECRET: "test-access-secret-min-32-chars-long",
      JWT_REFRESH_SECRET: "test-refresh-secret-min-32-chars-long",
      STRIPE_SECRET_KEY: "sk_test_placeholder",
      STRIPE_SUCCESS_URL: "https://example.com/success",
      STRIPE_CANCEL_URL: "https://example.com/cancel",
      STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
      RATE_LIMIT_AUTH_MAX: "100",
      RATE_LIMIT_REFRESH_MAX: "100",
      REFRESH_TOKEN_TTL_DAYS: "30",
    },
  },
  resolve: {
    extensions: [".ts"],
  },
  esbuild: {
    target: "node18",
  },
});
