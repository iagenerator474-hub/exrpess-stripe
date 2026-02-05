import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    product: { findMany: vi.fn() },
  },
}));

import app from "../src/app.js";

describe("GET /products", () => {
  beforeEach(() => {
    vi.mocked(prisma.product.findMany).mockReset();
  });

  it("returns 200 and list of active products (id, name, amountCents, currency only)", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
      { id: "prod-1", name: "Basic", amountCents: 999, currency: "eur" },
      { id: "prod-2", name: "Pro", amountCents: 1999, currency: "eur" },
    ]);
    const res = await request(app).get("/products");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toEqual({ id: "prod-1", name: "Basic", amountCents: 999, currency: "eur" });
    expect(res.body[1]).toEqual({ id: "prod-2", name: "Pro", amountCents: 1999, currency: "eur" });
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { active: true },
      select: { id: true, name: true, amountCents: true, currency: true },
      orderBy: { amountCents: "asc" },
    });
  });

  it("returns empty array when no active products", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([]);
    const res = await request(app).get("/products");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
