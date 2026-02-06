import { describe, it, expect } from "vitest";
import { safePaymentLogContext } from "../src/lib/logContext.js";

describe("safePaymentLogContext", () => {
  it("returns only whitelisted keys and strips unknown keys (e.g. email)", () => {
    const out = safePaymentLogContext({
      orderId: "o1",
      userId: "u1",
      email: "user@example.com",
      fullName: "John Doe",
    });
    expect(out).toHaveProperty("orderId", "o1");
    expect(out).toHaveProperty("userId", "u1");
    expect(out).not.toHaveProperty("email");
    expect(out).not.toHaveProperty("fullName");
  });

  it("never includes a value containing '@' (no email in logs)", () => {
    const out = safePaymentLogContext({
      requestId: "req-1",
      orderId: "o1",
      stripeSessionId: "cs_1",
      email: "pii@domain.com",
      reason: "amount_mismatch",
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("@");
    expect(out).not.toHaveProperty("email");
    expect(out).toHaveProperty("requestId", "req-1");
    expect(out).toHaveProperty("reason", "amount_mismatch");
  });

  it("allows safe payment keys through", () => {
    const out = safePaymentLogContext({
      requestId: "r1",
      orderId: "ord1",
      userId: "u1",
      stripeSessionId: "cs_1",
      stripeEventId: "evt_1",
      stripePaymentIntentId: "pi_1",
      outcome: "updated_order",
      type: "checkout.session.completed",
    });
    expect(Object.keys(out).sort()).toEqual(
      ["orderId", "outcome", "requestId", "stripeEventId", "stripePaymentIntentId", "stripeSessionId", "type", "userId"].sort()
    );
  });
});
