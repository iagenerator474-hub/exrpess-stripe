import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import * as authService from "../src/modules/auth/auth.service.js";
import * as refreshTokenService from "../src/modules/auth/refreshToken.service.js";
import { AppError } from "../src/middleware/errorHandler.js";

vi.mock("../src/modules/auth/auth.service.js");
vi.mock("../src/modules/auth/refreshToken.service.js");

import app from "../src/app.js";

const validPassword = "password1234";

function getCookieFromResponse(res: request.Response): string | undefined {
  const setCookie = res.headers["set-cookie"];
  if (!setCookie) return undefined;
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return first?.split(";")[0]; // "refreshToken=value"
}

describe("Auth refresh & logout", () => {
  beforeEach(() => {
    vi.mocked(authService.login).mockReset();
    vi.mocked(refreshTokenService.rotate).mockReset();
    vi.mocked(refreshTokenService.revokeByTokenValue).mockReset();
  });

  it("login returns 200 with accessToken and sets refresh token cookie", async () => {
    vi.mocked(authService.login).mockResolvedValueOnce({
      accessToken: "at-1",
      user: { id: "user-1", email: "u@example.com", role: "user" },
      refreshToken: "rt-1",
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "u@example.com", password: validPassword });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe("at-1");
    expect(res.body.user).toBeDefined();
    const cookie = getCookieFromResponse(res);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/^refreshToken=/);
  });

  it("refresh with valid token returns 200 with new accessToken and sets new cookie", async () => {
    vi.mocked(authService.login).mockResolvedValueOnce({
      accessToken: "at-1",
      user: { id: "user-1", email: "u@example.com", role: "user" },
      refreshToken: "rt-1",
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "u@example.com", password: validPassword });
    const cookie = getCookieFromResponse(loginRes);
    expect(cookie).toBeDefined();

    vi.mocked(refreshTokenService.rotate).mockResolvedValueOnce({
      accessToken: "at-2",
      user: { id: "user-1", email: "u@example.com", role: "user" },
      newRefreshTokenValue: "rt-2",
      newExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const refreshRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", cookie!)
      .send();
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBe("at-2");
    expect(refreshRes.body.user).toBeDefined();
    const newCookie = getCookieFromResponse(refreshRes);
    expect(newCookie).toMatch(/^refreshToken=rt-2/);
  });

  it("refresh with old token after rotation returns 401", async () => {
    vi.mocked(authService.login).mockResolvedValueOnce({
      accessToken: "at-1",
      user: { id: "user-1", email: "u@example.com", role: "user" },
      refreshToken: "rt-1",
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "u@example.com", password: validPassword });
    const cookie = getCookieFromResponse(loginRes);

    vi.mocked(refreshTokenService.rotate)
      .mockResolvedValueOnce({
        accessToken: "at-2",
        user: { id: "user-1", email: "u@example.com", role: "user" },
        newRefreshTokenValue: "rt-2",
        newExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .mockRejectedValueOnce(new AppError("Invalid or expired refresh token", 401, "UNAUTHORIZED"));

    await request(app).post("/auth/refresh").set("Cookie", cookie!).send();
    const res2 = await request(app).post("/auth/refresh").set("Cookie", cookie!).send();
    expect(res2.status).toBe(401);
  });

  it("logout returns 204 and revokes token; refresh with same token returns 401", async () => {
    vi.mocked(authService.login).mockResolvedValueOnce({
      accessToken: "at-1",
      user: { id: "user-1", email: "u@example.com", role: "user" },
      refreshToken: "rt-1",
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "u@example.com", password: validPassword });
    const cookie = getCookieFromResponse(loginRes);

    const logoutRes = await request(app).post("/auth/logout").set("Cookie", cookie!).send();
    expect(logoutRes.status).toBe(204);

    vi.mocked(refreshTokenService.rotate).mockRejectedValueOnce(
      new AppError("Invalid or expired refresh token", 401, "UNAUTHORIZED")
    );
    const refreshRes = await request(app).post("/auth/refresh").set("Cookie", cookie!).send();
    expect(refreshRes.status).toBe(401);
  });

  it("refresh with expired or invalid token returns 401", async () => {
    vi.mocked(refreshTokenService.rotate).mockRejectedValueOnce(
      new AppError("Invalid or expired refresh token", 401, "UNAUTHORIZED")
    );
    const res = await request(app)
      .post("/auth/refresh")
      .set("Cookie", "refreshToken=expired-or-invalid")
      .send();
    expect(res.status).toBe(401);
  });

  it("refresh without token returns 401", async () => {
    const res = await request(app).post("/auth/refresh").send();
    expect(res.status).toBe(401);
  });

  it("two parallel refresh with same cookie: one 200 one 401 (double-use safe)", async () => {
    vi.mocked(authService.login).mockResolvedValueOnce({
      accessToken: "at-1",
      user: { id: "user-1", email: "u@example.com", role: "user" },
      refreshToken: "rt-1",
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "u@example.com", password: validPassword });
    const cookie = getCookieFromResponse(loginRes);
    expect(cookie).toBeDefined();

    let callCount = 0;
    vi.mocked(refreshTokenService.rotate).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          accessToken: "at-2",
          user: { id: "user-1", email: "u@example.com", role: "user" },
          newRefreshTokenValue: "rt-2",
          newExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        };
      }
      throw new AppError("Invalid or expired refresh token", 401, "UNAUTHORIZED");
    });

    const [res1, res2] = await Promise.all([
      request(app).post("/auth/refresh").set("Cookie", cookie!).send(),
      request(app).post("/auth/refresh").set("Cookie", cookie!).send(),
    ]);
    const statuses = [res1.status, res2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 401]);
  });
});
