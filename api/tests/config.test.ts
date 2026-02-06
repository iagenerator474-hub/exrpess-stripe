import { describe, it, expect } from "vitest";
import { envBool, validateProductionConfig, type Config } from "../src/config/index.js";

describe("config envBool", () => {
  it("parses true, 'true', '1' as true", () => {
    expect(envBool.parse(true)).toBe(true);
    expect(envBool.parse("true")).toBe(true);
    expect(envBool.parse("1")).toBe(true);
  });

  it("parses false, 'false', and other strings as false", () => {
    expect(envBool.parse(false)).toBe(false);
    expect(envBool.parse("false")).toBe(false);
    expect(envBool.parse("0")).toBe(false);
  });
});

describe("validateProductionConfig", () => {
  const baseProdConfig = {
    NODE_ENV: "production" as const,
    CORS_ORIGINS: "https://example.com",
    STRIPE_SECRET_KEY: "sk_live_xxxxxxxxxxxxxxxx",
    STRIPE_WEBHOOK_SECRET: "whsec_abcdefghij1234567890",
    JWT_ACCESS_SECRET: "a".repeat(32),
    ENABLE_DEMO: undefined as boolean | undefined,
    TRUST_PROXY: true as boolean | undefined,
    REQUIRE_TRUST_PROXY_IN_PROD: undefined as boolean | undefined,
  };

  it("throws in production when ENABLE_DEMO is true", () => {
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, ENABLE_DEMO: true } as Config)
    ).toThrow("Invalid environment configuration");
  });

  it("throws in production when JWT_ACCESS_SECRET is shorter than 32 characters", () => {
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, JWT_ACCESS_SECRET: "short" } as Config)
    ).toThrow("Invalid environment configuration");
  });

  it("throws in production when STRIPE_WEBHOOK_SECRET is empty or too short", () => {
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, STRIPE_WEBHOOK_SECRET: "" } as Config)
    ).toThrow("Invalid environment configuration");
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, STRIPE_WEBHOOK_SECRET: "whsec_" } as Config)
    ).toThrow("Invalid environment configuration");
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, STRIPE_WEBHOOK_SECRET: "whsec_12345" } as Config)
    ).toThrow("Invalid environment configuration");
  });

  it("does not throw in production when STRIPE_WEBHOOK_SECRET has min length and ENABLE_DEMO not true and JWT long enough", () => {
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, STRIPE_WEBHOOK_SECRET: "whsec_abcdefghij1234567890" } as Config)
    ).not.toThrow();
  });

  it("throws in production when TRUST_PROXY is not set and REQUIRE_TRUST_PROXY_IN_PROD is not false", () => {
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, TRUST_PROXY: undefined, REQUIRE_TRUST_PROXY_IN_PROD: true } as Config)
    ).toThrow("Invalid environment configuration");
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, TRUST_PROXY: false } as Config)
    ).toThrow("Invalid environment configuration");
  });

  it("does not throw in production when TRUST_PROXY is set", () => {
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, TRUST_PROXY: true } as Config)
    ).not.toThrow();
  });

  it("does not throw in production when REQUIRE_TRUST_PROXY_IN_PROD is false (no proxy)", () => {
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, TRUST_PROXY: undefined, REQUIRE_TRUST_PROXY_IN_PROD: false } as Config)
    ).not.toThrow();
  });

  it("throws in production when STRIPE_WEBHOOK_SECRET is placeholder", () => {
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, STRIPE_WEBHOOK_SECRET: "whsec_123" } as Config)
    ).toThrow("Invalid environment configuration");
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, STRIPE_WEBHOOK_SECRET: "whsec_placeholder" } as Config)
    ).toThrow("Invalid environment configuration");
  });

  it("does not run webhook secret check when NODE_ENV is not production", () => {
    expect(() =>
      validateProductionConfig({ ...baseProdConfig, NODE_ENV: "development", STRIPE_WEBHOOK_SECRET: "whsec_" } as Config)
    ).not.toThrow();
  });
});
