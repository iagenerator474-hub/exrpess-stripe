import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";

const constructEventMock = vi.fn();
vi.mock("../src/modules/stripe/stripe.service.js", async (importOriginal) => {
  const actual = (await importOriginal()) as { getStripe: unknown; createCheckoutSession: unknown };
  return {
    ...actual,
    getStripe: vi.fn(() => ({
      webhooks: { constructEvent: constructEventMock },
    })),
  };
});

vi.mock("../src/lib/prisma.js", () => {
  const orderFindUnique = vi.fn();
  const orderUpdateMany = vi.fn();
  const paymentEventCreate = vi.fn();
  const prismaInstance = {
    $transaction: vi.fn((cb: (tx: unknown) => unknown) =>
      typeof cb === "function" ? (cb(prismaInstance) as Promise<unknown>) : Promise.resolve([])
    ),
    order: { findUnique: orderFindUnique, updateMany: orderUpdateMany },
    paymentEvent: { create: paymentEventCreate },
  };
  return { prisma: prismaInstance };
});

import app from "../src/app.js";

const rawBody = Buffer.from(JSON.stringify({ type: "test", id: "evt_1" }));

describe("POST /stripe/webhook", () => {
  beforeEach(() => {
    constructEventMock.mockReset();
    vi.mocked(prisma.order.findUnique).mockReset();
    vi.mocked(prisma.order.updateMany).mockReset();
    vi.mocked(prisma.paymentEvent.create).mockReset();
    vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: unknown) => unknown) =>
      typeof cb === "function" ? (cb(prisma) as Promise<unknown>) : Promise.resolve([])
    );
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .send(rawBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature|Missing/i);
  });

  it("returns 400 when signature is invalid", async () => {
    constructEventMock.mockImplementationOnce(() => {
      throw new Error("Invalid signature");
    });
    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,invalid")
      .send(rawBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature|Invalid/i);
  });

  it("returns 200 when signature is valid", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_123",
      type: "ping",
      data: { object: {} },
    });
    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,valid")
      .send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it("on checkout.session.completed with metadata.orderId updates Order to paid", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_cs_completed",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_session_123",
          metadata: { orderId: "order-1" },
          client_reference_id: "order-1",
        },
      },
    });
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-1" });
    vi.mocked(prisma.paymentEvent.create).mockResolvedValueOnce({
      id: "pe-1",
      orderId: "order-1",
      orphaned: false,
      stripeEventId: "evt_cs_completed",
      type: "checkout.session.completed",
      payload: null,
      processedAt: new Date(),
    });
    vi.mocked(prisma.order.updateMany).mockResolvedValueOnce({ count: 1 });

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,valid")
      .send(rawBody);
    expect(res.status).toBe(200);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(prisma.paymentEvent.create).toHaveBeenCalledWith({
      data: {
        stripeEventId: "evt_cs_completed",
        type: "checkout.session.completed",
        orderId: "order-1",
        orphaned: false,
        payload: expect.any(Object),
      },
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order-1", stripeSessionId: "cs_session_123", status: { not: "paid" } },
      data: { status: "paid", paidAt: expect.any(Date) },
    });
  });

  it("replay same checkout.session.completed 5 times results in single PaymentEvent and single Order update", async () => {
    const sameEvent = {
      id: "evt_replay_id",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_replay",
          metadata: { orderId: "order-replay" },
          client_reference_id: "order-replay",
        },
      },
    };
    constructEventMock.mockReturnValue(sameEvent);
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-replay" });

    vi.mocked(prisma.paymentEvent.create)
      .mockResolvedValueOnce({
        id: "pe-replay",
        orderId: "order-replay",
        orphaned: false,
        stripeEventId: "evt_replay_id",
        type: "checkout.session.completed",
        payload: null,
        processedAt: new Date(),
      })
      .mockRejectedValueOnce({ code: "P2002" })
      .mockRejectedValueOnce({ code: "P2002" })
      .mockRejectedValueOnce({ code: "P2002" })
      .mockRejectedValueOnce({ code: "P2002" });
    vi.mocked(prisma.order.updateMany).mockResolvedValue({ count: 1 });

    const payload = Buffer.from(JSON.stringify(sameEvent));
    const send = () =>
      request(app)
        .post("/stripe/webhook")
        .set("Content-Type", "application/json")
        .set("stripe-signature", "v1,same")
        .send(payload);

    const responses = await Promise.all([send(), send(), send(), send(), send()]);
    responses.forEach((r) => expect(r.status).toBe(200));

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(prisma.paymentEvent.create).toHaveBeenCalledTimes(5);
    expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order-replay", stripeSessionId: "cs_replay", status: { not: "paid" } },
      data: { status: "paid", paidAt: expect.any(Date) },
    });
  });

  it("stores event as orphaned when order not found", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_orphan",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_orphan",
          metadata: { orderId: "order-missing" },
          client_reference_id: "order-missing",
        },
      },
    });
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.paymentEvent.create).mockResolvedValueOnce({
      id: "pe-orphan",
      orderId: null,
      orphaned: true,
      stripeEventId: "evt_orphan",
      type: "checkout.session.completed",
      payload: null,
      processedAt: new Date(),
    });

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,orphan")
      .send(Buffer.from(JSON.stringify({ id: "evt_orphan", type: "checkout.session.completed", data: { object: { id: "cs_orphan", metadata: { orderId: "order-missing" } } } })));
    expect(res.status).toBe(200);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(prisma.paymentEvent.create).toHaveBeenCalledWith({
      data: {
        stripeEventId: "evt_orphan",
        type: "checkout.session.completed",
        orderId: null,
        orphaned: true,
        payload: expect.any(Object),
      },
    });
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it("uses transaction (create PaymentEvent + updateMany Order) for crash-safe processing", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_tx",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_tx",
          metadata: { orderId: "order-tx" },
          client_reference_id: "order-tx",
        },
      },
    });
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-tx" });
    vi.mocked(prisma.$transaction).mockImplementationOnce((cb) =>
      typeof cb === "function" ? (cb(prisma) as Promise<unknown>) : Promise.resolve([])
    );
    vi.mocked(prisma.paymentEvent.create).mockResolvedValueOnce({
      id: "pe-tx",
      orderId: "order-tx",
      orphaned: false,
      stripeEventId: "evt_tx",
      type: "checkout.session.completed",
      payload: null,
      processedAt: new Date(),
    });
    vi.mocked(prisma.order.updateMany).mockResolvedValueOnce({ count: 1 });

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,tx")
      .send(Buffer.from(JSON.stringify({ id: "evt_tx", type: "checkout.session.completed", data: { object: { id: "cs_tx", metadata: { orderId: "order-tx" } } } })));
    expect(res.status).toBe(200);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.paymentEvent.create).toHaveBeenCalled();
    expect(prisma.order.updateMany).toHaveBeenCalled();
  });
});
