import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma.js";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    order: { findMany: vi.fn() },
    paymentEvent: { deleteMany: vi.fn() },
  },
}));

import {
  purgeByUserId,
  parseArgs,
  isEraseAllowed,
} from "../src/scripts/purgePaymentEvents.js";

describe("purgePaymentEvents", () => {
  beforeEach(() => {
    vi.mocked(prisma.order.findMany).mockReset();
    vi.mocked(prisma.paymentEvent.deleteMany).mockReset();
  });

  describe("parseArgs", () => {
    it('["node","script","erase","user123"] => mode erase, userId user123', () => {
      const out = parseArgs(["node", "script", "erase", "user123"], "retain");
      expect(out.mode).toBe("erase");
      expect(out.userId).toBe("user123");
    });

    it('["node","script","retain"] => mode retain', () => {
      const out = parseArgs(["node", "script", "retain"], "erase");
      expect(out.mode).toBe("retain");
      expect(out.userId).toBeUndefined();
    });

    it('["node","script"] => mode from config default', () => {
      const out = parseArgs(["node", "script"], "retain");
      expect(out.mode).toBe("retain");
      expect(out.userId).toBeUndefined();

      const outErase = parseArgs(["node", "script"], "erase");
      expect(outErase.mode).toBe("erase");
      expect(outErase.userId).toBeUndefined();
    });

    it("erase with no userId => userId undefined", () => {
      const out = parseArgs(["node", "script", "erase"], "erase");
      expect(out.mode).toBe("erase");
      expect(out.userId).toBeUndefined();
    });
  });

  describe("isEraseAllowed", () => {
    it("returns true when PURGE_CONFIRM is YES", () => {
      expect(isEraseAllowed({ PURGE_CONFIRM: "YES" })).toBe(true);
    });

    it("returns false when PURGE_CONFIRM is absent", () => {
      expect(isEraseAllowed({})).toBe(false);
      expect(isEraseAllowed({ PURGE_CONFIRM: undefined })).toBe(false);
    });

    it("returns false when PURGE_CONFIRM is not YES", () => {
      expect(isEraseAllowed({ PURGE_CONFIRM: "yes" })).toBe(false);
      expect(isEraseAllowed({ PURGE_CONFIRM: "1" })).toBe(false);
      expect(isEraseAllowed({ PURGE_CONFIRM: "true" })).toBe(false);
    });
  });

  describe("purgeByUserId", () => {
    it("deletes PaymentEvents whose order belongs to the user", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValueOnce([
        { id: "order-1" },
        { id: "order-2" },
      ]);
      vi.mocked(prisma.paymentEvent.deleteMany).mockResolvedValueOnce({
        count: 3,
      });
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
