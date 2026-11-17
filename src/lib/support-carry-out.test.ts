import { describe, expect, it } from "vitest";

import { STAFF_REQUEST_KINDS } from "./support-actions";
import { CARRY_OUT_OF, carryOutOffer, changesRequests, type RequestFacts } from "./support-carry-out";

/** Ecosystem plan E2.7 (D713): what a staff request offers to carry out, by its kind, the person and the order as it stands. */

const ORDER: NonNullable<RequestFacts["order"]> = {
  status: "paid",
  sent: false,
  held: false,
  editPending: false,
  refundableMinor: 5000,
  canRefund: true,
  paidOutside: false,
};
const facts = (kind: RequestFacts["kind"], over: Partial<RequestFacts> = {}, order: Partial<RequestFacts["order"] & object> = {}): RequestFacts => ({
  kind,
  verified: true,
  hasAddress: true,
  order: { ...ORDER, ...order },
  ...over,
});
const ALL = { decide: true, changeOrders: true };

describe("carryOutOffer (E2.7)", () => {
  it("offers a cancellation, an address change and a refund by kind, and nothing for an exception or anything else", () => {
    expect(carryOutOffer(facts("cancel_order"), ALL)).toEqual({ carryOut: "cancel", why: null });
    expect(carryOutOffer(facts("change_address"), ALL)).toEqual({ carryOut: "address", why: null });
    expect(carryOutOffer(facts("refund"), ALL)).toEqual({ carryOut: "refund", why: null });
    expect(carryOutOffer(facts("exception"), ALL)).toEqual({ carryOut: null, why: null });
    expect(carryOutOffer(facts("other"), ALL)).toEqual({ carryOut: null, why: null });
    // Every kind is either carried out or keeps Done and Decline only: none is forgotten.
    expect(STAFF_REQUEST_KINDS.filter((k) => CARRY_OUT_OF[k])).toEqual(["refund", "cancel_order", "change_address"]);
  });

  it("offers nothing, and says nothing, to a person who may not decide requests or change orders", () => {
    for (const kind of STAFF_REQUEST_KINDS) {
      expect(carryOutOffer(facts(kind), { decide: true, changeOrders: false })).toEqual({ carryOut: null, why: null });
      expect(carryOutOffer(facts(kind), { decide: false, changeOrders: true })).toEqual({ carryOut: null, why: null });
    }
    // Even where the order would refuse anyway: the reason is for those who could act on it.
    expect(carryOutOffer(facts("refund", { order: null }), { decide: false, changeOrders: false })).toEqual({ carryOut: null, why: null });
  });

  it("says why when the order named is not the store's", () => {
    for (const kind of ["cancel_order", "change_address", "refund"] as const) expect(carryOutOffer(facts(kind, { order: null }), ALL).why).toBe("noOrder");
  });

  it("cancels only a paid order with nothing sent, nothing paid outside and no change waiting", () => {
    expect(carryOutOffer(facts("cancel_order", {}, { status: "cancelled" }), ALL).why).toBe("cancelled");
    expect(carryOutOffer(facts("cancel_order", {}, { status: "fulfilled" }), ALL).why).toBe("sent");
    expect(carryOutOffer(facts("cancel_order", {}, { sent: true }), ALL).why).toBe("sent");
    expect(carryOutOffer(facts("cancel_order", {}, { status: "authorized" }), ALL).why).toBe("notPaid");
    expect(carryOutOffer(facts("cancel_order", {}, { status: "pending_payment" }), ALL).why).toBe("notPaid");
    expect(carryOutOffer(facts("cancel_order", {}, { paidOutside: true }), ALL).why).toBe("paidOutside");
    expect(carryOutOffer(facts("cancel_order", {}, { editPending: true }), ALL).why).toBe("changeWaiting");
    // Whoever asks: a cancellation refunds to the order's own payment.
    expect(carryOutOffer(facts("cancel_order", { verified: false }), ALL).carryOut).toBe("cancel");
  });

  it("changes the address only to a full one, for the order's own customer, before anything is sent or while it is held", () => {
    expect(carryOutOffer(facts("change_address", { hasAddress: false }), ALL).why).toBe("noAddress");
    expect(carryOutOffer(facts("change_address", { verified: false }), ALL).why).toBe("notVerified");
    expect(carryOutOffer(facts("change_address", {}, { held: true }), ALL).why).toBe("held");
    expect(carryOutOffer(facts("change_address", {}, { sent: true }), ALL).why).toBe("sent");
    expect(carryOutOffer(facts("change_address", {}, { status: "cancelled" }), ALL).why).toBe("cancelled");
    expect(carryOutOffer(facts("change_address", {}, { status: "pending_payment" }), ALL).why).toBe("notPaid");
    expect(carryOutOffer(facts("change_address", {}, { status: "authorized" }), ALL).carryOut).toBe("address");
  });

  it("refunds only what is left through Kaizena Flow's payments, and never money taken outside", () => {
    expect(carryOutOffer(facts("refund", {}, { paidOutside: true }), ALL).why).toBe("paidOutside");
    expect(carryOutOffer(facts("refund", {}, { canRefund: false }), ALL).why).toBe("notThroughUs");
    expect(carryOutOffer(facts("refund", {}, { refundableMinor: 0 }), ALL).why).toBe("nothingToRefund");
    expect(carryOutOffer(facts("refund", {}, { editPending: true }), ALL).why).toBe("changeWaiting");
    // A sent or cancelled order may still have money left to give back.
    expect(carryOutOffer(facts("refund", {}, { status: "fulfilled", sent: true }), ALL).carryOut).toBe("refund");
    expect(carryOutOffer(facts("refund", { verified: false }), ALL).carryOut).toBe("refund");
  });
});

describe("changesRequests (E2.7)", () => {
  it("is true for the assistant's request and a decision, false for anything else", () => {
    expect(changesRequests({ author: "ai", kind: null, tools: ["lookup_order", "request_staff_action"] })).toBe(true);
    expect(changesRequests({ author: "system", kind: "request_done", tools: [] })).toBe(true);
    expect(changesRequests({ author: "system", kind: "request_declined", tools: [] })).toBe(true);
    expect(changesRequests({ author: "ai", kind: null, tools: ["lookup_order"] })).toBe(false);
    expect(changesRequests({ author: "customer", kind: null, tools: ["request_staff_action"] })).toBe(false);
    expect(changesRequests({ author: "system", kind: "joined", tools: [] })).toBe(false);
  });
});
