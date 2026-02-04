import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";

describe("GET /health", () => {
  it("returns 200 when DB up, 503 when DB down; always includes status, env, db", async () => {
    const res = await request(app).get("/health");
    expect(res.body).toHaveProperty("env");
    expect(res.body).toHaveProperty("db");
    if (res.status === 200) {
      expect(res.body).toHaveProperty("status", "ok");
      expect(res.body.db).toBe("up");
    } else {
      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty("status", "degraded");
      expect(res.body.db).toBe("down");
    }
  });
});

describe("GET /ready", () => {
  it("returns 200 with status ready when DB is up, or 503 with not ready when DB is down", async () => {
    const res = await request(app).get("/ready");
    if (res.status === 200) {
      expect(res.body).toEqual({ status: "ready" });
    } else {
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: "not ready" });
    }
  });
});
