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
  const paymentEventFindUnique = vi.fn();
  const prismaInstance = {
    order: { findUnique: orderFindUnique, updateMany: orderUpdateMany },
    paymentEvent: { create: paymentEventCreate, findUnique: paymentEventFindUnique },
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
    vi.mocked(prisma.paymentEvent.findUnique).mockReset();
  });

  it("returns 400 when stripe-signature header is missing and body includes requestId", async () => {
    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .send(rawBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature|Missing/i);
    expect(res.body).toHaveProperty("requestId");
    expect(res.headers["x-request-id"]).toBeDefined();
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
    vi.mocked(prisma.paymentEvent.create).mockResolvedValueOnce({
      id: "pe-ping",
      orderId: null,
      orphaned: true,
      stripeEventId: "evt_123",
      type: "ping",
      payload: null,
      receivedAt: new Date(),
    });
    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,valid")
      .send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it("on checkout.session.completed with payment_status paid and amount/currency OK updates Order to paid", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_cs_completed",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_session_123",
          amount_total: 1000,
          currency: "eur",
          payment_status: "paid",
          metadata: { orderId: "order-1" },
          client_reference_id: "order-1",
        },
      },
    });
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-1", amountCents: 1000, currency: "eur" });
    vi.mocked(prisma.paymentEvent.create).mockResolvedValueOnce({
      id: "pe-1",
      orderId: "order-1",
      orphaned: false,
      stripeEventId: "evt_cs_completed",
      type: "checkout.session.completed",
      payload: null,
      receivedAt: new Date(),
    });
    vi.mocked(prisma.order.updateMany).mockResolvedValueOnce({ count: 1 });

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,valid")
      .send(rawBody);
    expect(res.status).toBe(200);

    expect(prisma.paymentEvent.create).toHaveBeenCalledWith({
      data: {
        stripeEventId: "evt_cs_completed",
        type: "checkout.session.completed",
        orderId: "order-1",
        orphaned: false,
        payload: expect.any(Object),
      },
    });
    const createCall = vi.mocked(prisma.paymentEvent.create).mock.calls[0][0];
    expect(createCall.data.payload).not.toHaveProperty("orderId");
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order-1", status: { not: "paid" } },
      data: { stripeSessionId: "cs_session_123", status: "paid", paidAt: expect.any(Date) },
    });
  });

  it("returns 500 when paymentEvent.create fails (non-P2002)", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_500",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_500",
          amount_total: 1000,
          currency: "eur",
          payment_status: "paid",
          metadata: { orderId: "order-1" },
          client_reference_id: "order-1",
        },
      },
    });
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-1", amountCents: 1000, currency: "eur" });
    vi.mocked(prisma.paymentEvent.create).mockRejectedValueOnce(new Error("DB unavailable"));

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,valid")
      .send(rawBody);
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("requestId");
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it("replay same checkout.session.completed 5 times: duplicate returns 200 without retriggering order update", async () => {
    const sameEvent = {
      id: "evt_replay_id",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_replay",
          amount_total: 1999,
          currency: "eur",
          payment_status: "paid",
          metadata: { orderId: "order-replay" },
          client_reference_id: "order-replay",
        },
      },
    };
    constructEventMock.mockReturnValue(sameEvent);
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-replay", amountCents: 1999, currency: "eur" });
    vi.mocked(prisma.paymentEvent.findUnique).mockResolvedValue({ orphaned: false });

    vi.mocked(prisma.paymentEvent.create)
      .mockResolvedValueOnce({
        id: "pe-replay",
        orderId: "order-replay",
        orphaned: false,
        stripeEventId: "evt_replay_id",
        type: "checkout.session.completed",
        payload: null,
        receivedAt: new Date(),
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

    expect(prisma.paymentEvent.create).toHaveBeenCalledTimes(5);
    expect(prisma.order.updateMany).toHaveBeenCalledTimes(5);
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order-replay", status: { not: "paid" } },
      data: { stripeSessionId: "cs_replay", status: "paid", paidAt: expect.any(Date) },
    });
  });

  it("on payment_status unpaid: stores PaymentEvent as orphaned, does not update Order, returns 200", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_unpaid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_unpaid",
          amount_total: 1000,
          currency: "eur",
          payment_status: "unpaid",
          metadata: { orderId: "order-1" },
          client_reference_id: "order-1",
        },
      },
    });
    vi.mocked(prisma.paymentEvent.create).mockResolvedValueOnce({
      id: "pe-unpaid",
      orderId: "order-1",
      orphaned: true,
      stripeEventId: "evt_unpaid",
      type: "checkout.session.completed",
      payload: null,
      receivedAt: new Date(),
    });

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,unpaid")
      .send(
        Buffer.from(
          JSON.stringify({
            id: "evt_unpaid",
            type: "checkout.session.completed",
            data: {
              object: {
                id: "cs_unpaid",
                amount_total: 1000,
                currency: "eur",
                payment_status: "unpaid",
                metadata: { orderId: "order-1" },
                client_reference_id: "order-1",
              },
            },
          })
        )
      );
    expect(res.status).toBe(200);
    expect(prisma.paymentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stripeEventId: "evt_unpaid",
        orderId: "order-1",
        orphaned: true,
      }),
    });
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it("stores event as orphaned when order not found", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_orphan",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_orphan",
          payment_status: "paid",
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
      receivedAt: new Date(),
    });

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,orphan")
      .send(
        Buffer.from(
          JSON.stringify({
            id: "evt_orphan",
            type: "checkout.session.completed",
            data: { object: { id: "cs_orphan", metadata: { orderId: "order-missing" } } },
          })
        )
      );
    expect(res.status).toBe(200);

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

  it("on amount_total or currency mismatch stores event as orphaned and does not mark order paid", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_mismatch",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_mismatch",
          amount_total: 999,
          currency: "eur",
          payment_status: "paid",
          metadata: { orderId: "order-1" },
          client_reference_id: "order-1",
        },
      },
    });
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-1", amountCents: 1000, currency: "eur" });
    vi.mocked(prisma.paymentEvent.create).mockResolvedValueOnce({
      id: "pe-mismatch",
      orderId: "order-1",
      orphaned: true,
      stripeEventId: "evt_mismatch",
      type: "checkout.session.completed",
      payload: null,
      receivedAt: new Date(),
    });

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,mismatch")
      .send(
        Buffer.from(
          JSON.stringify({
            id: "evt_mismatch",
            type: "checkout.session.completed",
            data: {
              object: {
                id: "cs_mismatch",
                amount_total: 999,
                currency: "eur",
                metadata: { orderId: "order-1" },
                client_reference_id: "order-1",
              },
            },
          })
        )
      );
    expect(res.status).toBe(200);
    expect(prisma.paymentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stripeEventId: "evt_mismatch",
        orderId: "order-1",
        orphaned: true,
      }),
    });
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it("durable: create PaymentEvent then updateMany Order before ACK 200", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_tx",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_tx",
          amount_total: 500,
          currency: "eur",
          payment_status: "paid",
          metadata: { orderId: "order-tx" },
          client_reference_id: "order-tx",
        },
      },
    });
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-tx", amountCents: 500, currency: "eur" });
    vi.mocked(prisma.paymentEvent.create).mockResolvedValueOnce({
      id: "pe-tx",
      orderId: "order-tx",
      orphaned: false,
      stripeEventId: "evt_tx",
      type: "checkout.session.completed",
      payload: null,
      receivedAt: new Date(),
    });
    vi.mocked(prisma.order.updateMany).mockResolvedValueOnce({ count: 1 });

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "v1,tx")
      .send(
        Buffer.from(
          JSON.stringify({
            id: "evt_tx",
            type: "checkout.session.completed",
            data: { object: { id: "cs_tx", metadata: { orderId: "order-tx" } } },
          })
        )
      );
    expect(res.status).toBe(200);

    expect(prisma.paymentEvent.create).toHaveBeenCalled();
    expect(prisma.order.updateMany).toHaveBeenCalled();
  });
});
