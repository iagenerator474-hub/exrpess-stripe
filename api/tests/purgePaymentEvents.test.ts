import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    order: { findMany: vi.fn() },
    paymentEvent: { deleteMany: vi.fn() },
  },
}));

import { purgeByUserId } from "../src/scripts/purgePaymentEvents.js";

describe("purgePaymentEvents", () => {
  beforeEach(() => {
    vi.mocked(prisma.order.findMany).mockReset();
    vi.mocked(prisma.paymentEvent.deleteMany).mockReset();
  });

  describe("purgeByUserId", () => {
    it("deletes PaymentEvents whose order belongs to the user", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValueOnce([{ id: "order-1" }, { id: "order-2" }]);
      vi.mocked(prisma.paymentEvent.deleteMany).mockResolvedValueOnce({ count: 3 });
      const count = await purgeByUserId("user-1");
      expect(count).toBe(3);
      expect(prisma.order.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        select: { id: true },
      });
      expect(prisma.paymentEvent.deleteMany).toHaveBeenCalledWith({
        where: { orderId: { in: ["order-1", "order-2"] } },
      });
    });

    it("returns 0 when user has no orders", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValueOnce([]);
      const count = await purgeByUserId("user-none");
      expect(count).toBe(0);
      expect(prisma.paymentEvent.deleteMany).not.toHaveBeenCalled();
    });
  });
});
