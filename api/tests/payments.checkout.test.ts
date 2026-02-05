import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import * as stripeService from "../src/modules/stripe/stripe.service.js";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/config/index.js";

vi.mock("../src/modules/stripe/stripe.service.js");
vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    product: { findUnique: vi.fn() },
    order: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import app from "../src/app.js";

function validToken() {
  const opts: jwt.SignOptions = { expiresIn: "15m", issuer: config.JWT_ISSUER };
  if (config.JWT_AUDIENCE) opts.audience = config.JWT_AUDIENCE;
  return jwt.sign(
    { sub: "user-1", userId: "user-1", role: "user" },
    config.JWT_ACCESS_SECRET,
    opts
  );
}

describe("POST /payments/checkout-session", () => {
  beforeEach(() => {
    vi.mocked(prisma.product.findUnique).mockReset();
    vi.mocked(prisma.order.create).mockReset();
    vi.mocked(prisma.order.update).mockReset();
    vi.mocked(stripeService.createCheckoutSession).mockReset();
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/payments/checkout-session")
      .send({ productId: "prod-1" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when body has amount/currency instead of productId (anti-tampering)", async () => {
    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Authorization", `Bearer ${validToken()}`)
      .send({ amount: 1000, currency: "eur" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 on invalid productId (INVALID_PRODUCT)", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(null);
    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Authorization", `Bearer ${validToken()}`)
      .send({ productId: "invalid-id" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid product", code: "INVALID_PRODUCT" });
  });

  it("returns 400 when product is inactive", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: "prod-1",
      amountCents: 1000,
      currency: "eur",
      active: false,
    });
    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Authorization", `Bearer ${validToken()}`)
      .send({ productId: "prod-1" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Invalid product");
  });

  it("creates Order from product price and returns checkoutUrl when Stripe succeeds", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: "prod-1",
      amountCents: 1000,
      currency: "eur",
      active: true,
    });
    vi.mocked(prisma.order.create).mockResolvedValueOnce({
      id: "order-1",
      userId: "user-1",
      stripeSessionId: null,
      amountCents: 1000,
      currency: "eur",
      status: "pending",
      paidAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(stripeService.createCheckoutSession).mockResolvedValueOnce({
      url: "https://checkout.stripe.com/session-123",
      sessionId: "cs_123",
    });
    vi.mocked(prisma.order.update).mockResolvedValueOnce({
      id: "order-1",
      userId: "user-1",
      stripeSessionId: "cs_123",
      amountCents: 1000,
      currency: "eur",
      status: "pending",
      paidAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Authorization", `Bearer ${validToken()}`)
      .send({ productId: "prod-1" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      checkoutUrl: "https://checkout.stripe.com/session-123",
      stripeSessionId: "cs_123",
      orderId: "order-1",
    });
    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: "prod-1" },
      select: { id: true, amountCents: true, currency: true, active: true },
    });
    expect(prisma.order.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        amountCents: 1000,
        currency: "eur",
        status: "pending",
      },
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { stripeSessionId: "cs_123" },
    });
  });

  it("marks Order as failed when Stripe fails", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: "prod-2",
      amountCents: 500,
      currency: "eur",
      active: true,
    });
    vi.mocked(prisma.order.create).mockResolvedValueOnce({
      id: "order-2",
      userId: "user-1",
      stripeSessionId: null,
      amountCents: 500,
      currency: "eur",
      status: "pending",
      paidAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(stripeService.createCheckoutSession).mockRejectedValueOnce(new Error("Stripe API error"));
    vi.mocked(prisma.order.update).mockResolvedValueOnce({} as never);

    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Authorization", `Bearer ${validToken()}`)
      .send({ productId: "prod-2" });

    expect(res.status).toBe(502);
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: "order-2" },
      data: { status: "failed" },
    });
  });
});
