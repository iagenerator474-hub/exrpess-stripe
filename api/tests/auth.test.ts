import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import * as authService from "../src/modules/auth/auth.service.js";
import { AppError } from "../src/middleware/errorHandler.js";

vi.mock("../src/modules/auth/auth.service.js");

import app from "../src/app.js";

const validPassword = "password1234";

describe("Auth", () => {
  beforeEach(() => {
    vi.mocked(authService.register).mockReset();
    vi.mocked(authService.login).mockReset();
    vi.mocked(authService.getMe).mockReset();
  });

  describe("POST /auth/register", () => {
    it("returns 201 and user (id, email, role, createdAt)", async () => {
      const email = "new@example.com";
      vi.mocked(authService.register).mockResolvedValueOnce({
        user: {
          id: "user-1",
          email,
          role: "user",
          createdAt: new Date("2025-01-01"),
        },
      });
      const res = await request(app)
        .post("/auth/register")
        .send({ email, password: validPassword });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("user");
      expect(res.body.user).toMatchObject({ email, role: "user" });
      expect(res.body.user).toHaveProperty("id");
      expect(res.body.user).toHaveProperty("createdAt");
    });

    it("returns 409 when email already used", async () => {
      const email = "existing@example.com";
      vi.mocked(authService.register)
        .mockRejectedValueOnce(new AppError("Email already registered", 409, "CONFLICT"));
      const res = await request(app)
        .post("/auth/register")
        .send({ email, password: validPassword });
      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/already registered|conflict/i);
    });
  });

  describe("POST /auth/login", () => {
    it("returns 200 with accessToken and user and sets refresh token cookie", async () => {
      const email = "user@example.com";
      vi.mocked(authService.login).mockResolvedValueOnce({
        accessToken: "fake-jwt-token",
        user: { id: "user-1", email, role: "user" },
        refreshToken: "fake-refresh-token",
        refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      const res = await request(app)
        .post("/auth/login")
        .send({ email, password: validPassword });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("accessToken");
      expect(typeof res.body.accessToken).toBe("string");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user).toMatchObject({ email, role: "user" });
      expect(res.body.user).toHaveProperty("id");
      expect(res.body).not.toHaveProperty("refreshToken");
      expect(res.headers["set-cookie"]).toBeDefined();
      expect(res.headers["set-cookie"]?.some((c: string) => c.startsWith("refreshToken="))).toBe(true);
    });

    it("returns 401 on wrong password", async () => {
      vi.mocked(authService.login).mockRejectedValueOnce(
        new AppError("Invalid credentials", 401, "UNAUTHORIZED")
      );
      const res = await request(app)
        .post("/auth/login")
        .send({ email: "user@example.com", password: "wrongpassword123" });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("GET /auth/me", () => {
    it("returns 401 without token", async () => {
      const res = await request(app).get("/auth/me");
      expect(res.status).toBe(401);
    });

    it("returns 401 with token signed with wrong issuer", async () => {
      const { config } = await import("../src/config/index.js");
      const token = jwt.sign(
        { sub: "user-1", role: "user" },
        config.JWT_ACCESS_SECRET,
        { expiresIn: "15m", issuer: "wrong-issuer" }
      );
      const res = await request(app)
        .get("/auth/me")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid|expired|token/i);
    });

    it("returns 200 with valid token and user from DB (email from DB, not JWT)", async () => {
      const { config } = await import("../src/config/index.js");
      const opts: jwt.SignOptions = { expiresIn: "15m", issuer: config.JWT_ISSUER };
      if (config.JWT_AUDIENCE) opts.audience = config.JWT_AUDIENCE;
      const token = jwt.sign(
        { sub: "user-1", role: "user" },
        config.JWT_ACCESS_SECRET,
        opts
      );
      vi.mocked(authService.getMe).mockResolvedValueOnce({
        user: { id: "user-1", email: "me@example.com", role: "user" },
      });
      const res = await request(app)
        .get("/auth/me")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("user");
      expect(res.body.user).toMatchObject({ email: "me@example.com", role: "user" });
      expect(res.body.user).toHaveProperty("id");
    });

    it("JWT payload does not contain email (RGPD)", async () => {
      const { generateAccessToken } = await import("../src/modules/auth/token.service.js");
      const token = generateAccessToken({ sub: "user-1", role: "user" });
      const decoded = jwt.decode(token) as Record<string, unknown> | null;
      expect(decoded).not.toBeNull();
      expect(decoded).not.toHaveProperty("email");
      expect(decoded).toHaveProperty("sub", "user-1");
      expect(decoded).toHaveProperty("role", "user");
    });
  });

  describe("auth rate limit", () => {
    it("returns 429 after exceeding auth rate limit (wrong password N+1 times)", async () => {
      vi.mocked(authService.login).mockImplementation(() =>
        Promise.reject(new AppError("Invalid credentials", 401, "UNAUTHORIZED"))
      );
      const body = { email: "rate@example.com", password: "wrongpass12" };
      const statuses: number[] = [];
      // Vitest env sets RATE_LIMIT_AUTH_MAX=100; exceed it to trigger 429 (run last so /auth quota is exhausted only after)
      for (let i = 0; i < 105; i++) {
        const res = await request(app).post("/auth/login").send(body);
        statuses.push(res.status);
        if (res.status === 429) break;
      }
      expect(statuses).toContain(429);
    });
  });
});
