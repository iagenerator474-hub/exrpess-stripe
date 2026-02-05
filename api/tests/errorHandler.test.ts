import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import * as authService from "../src/modules/auth/auth.service.js";
import { AppError } from "../src/middleware/errorHandler.js";

vi.mock("../src/modules/auth/auth.service.js");

import app from "../src/app.js";

describe("Error handler", () => {
  beforeEach(() => {
    vi.mocked(authService.getMe).mockReset();
  });

  afterEach(() => {
    process.env.NODE_ENV = "test";
  });

  it("returns AppError statusCode and message to client", async () => {
    vi.mocked(authService.getMe).mockRejectedValueOnce(
      new AppError("Not found", 404, "NOT_FOUND")
    );
    const { config } = await import("../src/config/index.js");
    const token = jwt.sign(
      { sub: "user-1", role: "user" },
      config.JWT_ACCESS_SECRET,
      { expiresIn: "15m", issuer: config.JWT_ISSUER }
    );
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });

  it("returns 500 with generic message when non-AppError and NODE_ENV=production", async () => {
    vi.mocked(authService.getMe).mockRejectedValueOnce(new Error("DB leak secret"));
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const { config } = await import("../src/config/index.js");
    const token = jwt.sign(
      { sub: "user-1", role: "user" },
      config.JWT_ACCESS_SECRET,
      { expiresIn: "15m", issuer: config.JWT_ISSUER }
    );
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);
    process.env.NODE_ENV = prev;
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    expect(res.body.error).not.toMatch(/leak|secret/i);
    expect(res.body).not.toHaveProperty("stack");
  });

  it("in production, 500 response body does not contain stack (prod-safe logs)", async () => {
    vi.mocked(authService.getMe).mockRejectedValueOnce(new Error("Unexpected"));
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const { config } = await import("../src/config/index.js");
    const token = jwt.sign(
      { sub: "user-1", role: "user" },
      config.JWT_ACCESS_SECRET,
      { expiresIn: "15m", issuer: config.JWT_ISSUER }
    );
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);
    process.env.NODE_ENV = prev;
    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty("stack");
  });

  it("AppError 500 does not leak message/code in production", async () => {
    vi.mocked(authService.getMe).mockRejectedValueOnce(
      new AppError("DB failed", 500, "DB_ERROR")
    );
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const { config } = await import("../src/config/index.js");
    const token = jwt.sign(
      { sub: "user-1", role: "user" },
      config.JWT_ACCESS_SECRET,
      { expiresIn: "15m", issuer: config.JWT_ISSUER }
    );
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);
    process.env.NODE_ENV = prev;
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    expect(res.body).not.toHaveProperty("code");
    expect(res.body).not.toHaveProperty("stack");
  });
});
