import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isRefundEvent, refundStatusOf } = await import("./stripe-refunds");

describe("Stripe's refund statuses", () => {
  it("are the database's three: succeeded, failed (also canceled), and pending for anything not final", () => {
    expect(refundStatusOf("succeeded")).toBe("succeeded");
    expect(refundStatusOf("failed")).toBe("failed");
    expect(refundStatusOf("canceled")).toBe("failed");
    for (const status of ["pending", "requires_action", null, undefined, "something_new"]) expect(refundStatusOf(status), String(status)).toBe("pending");
  });

  it("come in four events, all handled the same way", () => {
    for (const type of ["refund.created", "refund.updated", "refund.failed", "charge.refund.updated"]) expect(isRefundEvent(type), type).toBe(true);
    for (const type of ["charge.refunded", "checkout.session.completed", "invoice.paid", ""]) expect(isRefundEvent(type), type).toBe(false);
  });
});
