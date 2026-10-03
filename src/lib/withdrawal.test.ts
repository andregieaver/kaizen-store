import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETURN_SETTINGS,
  LEGAL_WITHDRAWAL_DAYS,
  REFUSALS,
  REFUSAL_KEYS,
  RETURN_REASONS,
  countsAgainstLine,
  declaredProblems,
  isReturnReason,
  lineEligibility,
  orderEligibility,
  orderRight,
  refundDeadline,
  refundDue,
  remainingQuantity,
  sendBackDay,
  takenQuantity,
  withdrawalWindow,
  type ReturnSettings,
  type WithdrawalLine,
  type WithdrawalOrder,
} from "./withdrawal";

const OSLO = "Europe/Oslo";
const settings = (over: Partial<ReturnSettings> = {}): ReturnSettings => ({ ...DEFAULT_RETURN_SETTINGS, ...over });
const order = (over: Partial<WithdrawalOrder> = {}): WithdrawalOrder => ({
  status: "fulfilled",
  copied: false,
  business: false,
  deliveredAt: "2026-05-04T10:00:00Z",
  lastShippedAt: null,
  ...over,
});
const line = (over: Partial<WithdrawalLine> = {}): WithdrawalLine => ({
  id: "l1",
  quantity: 3,
  withdrawalExclusion: "none",
  delivery: "physical",
  takenQuantity: 0,
  ...over,
});

describe("the legal period", () => {
  it("is 14 days, and a store's window can only be longer", () => {
    expect(LEGAL_WITHDRAWAL_DAYS).toBe(14);
    // A window shorter than the legal period is read as the legal one.
    const w = withdrawalWindow({ deliveredAt: "2026-05-04T10:00:00Z", lastShippedAt: null }, settings({ windowDays: 7 }), OSLO, "2026-05-10T10:00:00Z");
    expect(w.voluntaryEndDay).toBe(w.statutoryEndDay);
  });
});

describe("the window, in the store's calendar days", () => {
  const delivered = { deliveredAt: "2026-05-04T10:00:00Z", lastShippedAt: null };

  it("counts from the day the goods were received, day 14 being the last", () => {
    const w = withdrawalWindow(delivered, settings(), OSLO, "2026-05-10T09:00:00Z");
    expect(w).toMatchObject({ state: "statutory", basis: "delivered", startDay: "2026-05-04", statutoryEndDay: "2026-05-18", daysLeft: 8 });
    // Day 14, late in the evening in Oslo: still in time.
    expect(withdrawalWindow(delivered, settings(), OSLO, "2026-05-18T21:59:00Z").state).toBe("statutory");
    expect(withdrawalWindow(delivered, settings(), OSLO, "2026-05-18T21:59:00Z").daysLeft).toBe(0);
    // Past midnight in Oslo (22:00 UTC in summer) it is day 15.
    expect(withdrawalWindow(delivered, settings(), OSLO, "2026-05-18T22:00:00Z").state).toBe("closed");
  });

  it("uses the store's day, not UTC's, for the start", () => {
    // 23:30 UTC on 2 March is already 3 March in Oslo.
    const w = withdrawalWindow({ deliveredAt: "2026-03-02T23:30:00Z", lastShippedAt: null }, settings(), OSLO, "2026-03-10T10:00:00Z");
    expect(w.startDay).toBe("2026-03-03");
    expect(w.statutoryEndDay).toBe("2026-03-17");
    expect(withdrawalWindow({ deliveredAt: "2026-03-02T23:30:00Z", lastShippedAt: null }, settings(), "UTC", "2026-03-10T10:00:00Z").startDay).toBe("2026-03-02");
  });

  it("is a calendar count across the clocks changing (a day is 23 or 25 hours twice a year)", () => {
    // Clocks go forward in Oslo on 29 March 2026. Delivered 20 March, so day 14 is 3 April.
    const w = { deliveredAt: "2026-03-20T12:00:00Z", lastShippedAt: null };
    expect(withdrawalWindow(w, settings(), OSLO, "2026-04-03T21:59:00Z")).toMatchObject({ state: "statutory", statutoryEndDay: "2026-04-03" });
    expect(withdrawalWindow(w, settings(), OSLO, "2026-04-03T22:00:00Z").state).toBe("closed");
    // And back in October: delivered 10 October, day 14 is 24 October; clocks go back on 25 October.
    const autumn = { deliveredAt: "2026-10-10T12:00:00Z", lastShippedAt: null };
    expect(withdrawalWindow(autumn, settings(), OSLO, "2026-10-24T21:59:00Z").state).toBe("statutory");
    expect(withdrawalWindow(autumn, settings(), OSLO, "2026-10-24T22:00:00Z").state).toBe("closed");
  });

  it("does not start the period from an estimate: goods sent and not recorded as received leave the right open", () => {
    // A NO store ships to DE on 1 October; the parcel arrives on 9 October. The estimate (sent + 3 days) would close the right on 18
    // October, but the consumer's 14 days run to 23 October: on 20 October the right must still be open.
    const sent = { deliveredAt: null, lastShippedAt: "2026-10-01T08:00:00Z" };
    const early = withdrawalWindow(sent, settings({ transitDays: 3 }), OSLO, "2026-10-20T10:00:00Z");
    expect(early).toMatchObject({ state: "statutory", basis: "sent", startDay: null, statutoryEndDay: null, voluntaryEndDay: null, daysLeft: null });
    // The estimate is only offered for staff to read, from the last shipment plus the transit allowance plus 14 days.
    expect(early.estimatedEndDay).toBe("2026-10-18");
    expect(withdrawalWindow(sent, settings({ transitDays: 0 }), OSLO, "2026-10-20T10:00:00Z").estimatedEndDay).toBe("2026-10-15");
    expect(withdrawalWindow(sent, settings({ transitDays: 99 }), OSLO, "2026-10-20T10:00:00Z").estimatedEndDay).toBe("2026-10-29"); // brought to 14
    // Months later, with no receipt recorded, it is still open (never refused on an estimate).
    expect(withdrawalWindow(sent, settings(), OSLO, "2027-03-01T10:00:00Z").state).toBe("statutory");
    // Once the receipt is recorded the period counts from it: received 9 October, the last day is 23 October.
    const received = { deliveredAt: "2026-10-09T12:00:00Z", lastShippedAt: "2026-10-01T08:00:00Z" };
    expect(withdrawalWindow(received, settings(), OSLO, "2026-10-20T10:00:00Z")).toMatchObject({ state: "statutory", basis: "delivered", startDay: "2026-10-09", statutoryEndDay: "2026-10-23" });
    expect(withdrawalWindow(received, settings(), OSLO, "2026-10-24T10:00:00Z").state).toBe("closed");
  });

  it("is open before anything is sent", () => {
    expect(withdrawalWindow({ deliveredAt: null, lastShippedAt: null }, settings(), OSLO, "2027-01-01T10:00:00Z")).toEqual({
      state: "before_delivery",
      basis: "not_sent",
      startDay: null,
      statutoryEndDay: null,
      voluntaryEndDay: null,
      daysLeft: null,
      estimatedEndDay: null,
    });
  });

  it("offers the store's own longer window after the legal days, then closes", () => {
    const own = settings({ windowDays: 30 });
    expect(withdrawalWindow({ deliveredAt: "2026-05-04T10:00:00Z", lastShippedAt: null }, own, OSLO, "2026-05-25T10:00:00Z")).toMatchObject({
      state: "voluntary",
      voluntaryEndDay: "2026-06-03",
      daysLeft: 9,
    });
    expect(withdrawalWindow({ deliveredAt: "2026-05-04T10:00:00Z", lastShippedAt: null }, own, OSLO, "2026-06-03T21:00:00Z").state).toBe("voluntary");
    expect(withdrawalWindow({ deliveredAt: "2026-05-04T10:00:00Z", lastShippedAt: null }, own, OSLO, "2026-06-03T22:00:00Z").state).toBe("closed");
  });
});

describe("quantities", () => {
  it("leaves what was not taken, never below 0", () => {
    expect(remainingQuantity(3, 0)).toBe(3);
    expect(remainingQuantity(3, 2)).toBe(1);
    expect(remainingQuantity(3, 5)).toBe(0);
    expect(remainingQuantity(3, -1)).toBe(3);
  });

  it("counts only accepted units on returns that are not declined or cancelled", () => {
    expect(countsAgainstLine("approved", "accept")).toBe(true);
    expect(countsAgainstLine("closed", "accept")).toBe(true);
    expect(countsAgainstLine("declined", "accept")).toBe(false);
    expect(countsAgainstLine("cancelled", "accept")).toBe(false);
    expect(countsAgainstLine("approved", "decline")).toBe(false);
    expect(
      takenQuantity([
        { quantity: 2, returnStatus: "received", decision: "accept" },
        { quantity: 5, returnStatus: "declined", decision: "accept" },
        { quantity: 1, returnStatus: "requested", decision: "decline" },
        { quantity: 1, returnStatus: "closed", decision: "accept" },
      ]),
    ).toBe(3);
  });
});

describe("a line's eligibility", () => {
  const now = "2026-05-10T10:00:00Z"; // day 6 after the delivery
  const at = (l: Partial<WithdrawalLine> = {}, o: Partial<WithdrawalOrder> = {}, s: Partial<ReturnSettings> = {}, when = now) =>
    lineEligibility(line(l), order(o), settings(s), OSLO, when);

  it("is a withdrawal, of all that is left, for goods inside the 14 days", () => {
    expect(at()).toEqual({ lineId: "l1", right: "withdrawal", maxQuantity: 3, remaining: 3, refusal: null, exclusion: null, sealed: false, voluntaryOffered: false });
    expect(at({ takenQuantity: 2 })).toMatchObject({ right: "withdrawal", maxQuantity: 1, remaining: 1 });
  });

  it("is open before the goods are sent, and for an order that was only sent, however long ago", () => {
    expect(at({}, { deliveredAt: null, lastShippedAt: null }).right).toBe("withdrawal");
    expect(at({}, { deliveredAt: null, lastShippedAt: "2026-05-08T10:00:00Z" }).right).toBe("withdrawal");
    // Sent 40 days ago and never recorded as received: the period has not started, so nothing is refused on an estimate.
    expect(at({}, { deliveredAt: null, lastShippedAt: "2026-04-01T10:00:00Z" }).right).toBe("withdrawal");
  });

  it("keeps the right for sealed goods until they are unsealed (Art. 16(e), (i)), marking the line, and refuses what the law excludes", () => {
    for (const exclusion of ["sealed_hygiene", "sealed_media"]) {
      expect(at({ withdrawalExclusion: exclusion })).toMatchObject({ right: "withdrawal", maxQuantity: 3, refusal: null, sealed: true });
      // Past the period it is over like any other line, and a company has no right to them either.
      expect(at({ withdrawalExclusion: exclusion }, { deliveredAt: "2026-04-01T10:00:00Z" })).toMatchObject({ right: "none", refusal: "period_over" });
      expect(at({ withdrawalExclusion: exclusion }, { business: true })).toMatchObject({ right: "none", refusal: "business_order" });
    }
    // The other exclusions are still refused from the start, and not marked sealed.
    expect(at({ withdrawalExclusion: "perishable" })).toMatchObject({ right: "none", refusal: "excluded_by_law", sealed: false });
  });

  it("refuses with the plain reason, never silently", () => {
    expect(at({ takenQuantity: 3 })).toMatchObject({ right: "none", refusal: "already_returned", maxQuantity: 0, remaining: 0 });
    expect(at({}, { status: "pending_payment" })).toMatchObject({ right: "none", refusal: "order_not_paid" });
    expect(at({}, { status: "cancelled" })).toMatchObject({ right: "none", refusal: "order_not_paid" });
    expect(at({}, { copied: true })).toMatchObject({ right: "none", refusal: "copied_order" });
    expect(at({ withdrawalExclusion: "perishable" })).toMatchObject({ right: "none", refusal: "excluded_by_law", exclusion: "perishable" });
    expect(at({ withdrawalExclusion: "custom_made" })).toMatchObject({ refusal: "excluded_by_law", exclusion: "custom_made" });
    expect(at({}, { deliveredAt: "2026-04-01T10:00:00Z" })).toMatchObject({ right: "none", refusal: "period_over" });
    expect(at({}, { business: true })).toMatchObject({ right: "none", refusal: "business_order" });
  });

  it("says copied or unpaid before anything else, and already returned before the period", () => {
    expect(at({ takenQuantity: 3, withdrawalExclusion: "perishable" }, { copied: true }).refusal).toBe("copied_order");
    expect(at({ takenQuantity: 3 }, { deliveredAt: "2026-04-01T10:00:00Z" }).refusal).toBe("already_returned");
  });

  it("takes away the right for digital content the shopper agreed to lose it for, and for a booking", () => {
    expect(at({ delivery: "digital" }, { digitalConsent: true })).toMatchObject({ right: "none", refusal: "digital_content" });
    expect(at({ delivery: "digital", withdrawalExclusion: "digital_content" })).toMatchObject({ right: "none", refusal: "digital_content" });
    // Digital without the tick keeps the right.
    expect(at({ delivery: "digital" }, { digitalConsent: false }).right).toBe("withdrawal");
    expect(at({ delivery: "service" })).toMatchObject({ right: "none", refusal: "booking" });
    expect(at({ withdrawalExclusion: "dated_service" })).toMatchObject({ right: "none", refusal: "booking" });
  });

  it("is a voluntary return after the legal days, inside the store's window", () => {
    const own = { windowDays: 30 };
    expect(at({}, { deliveredAt: "2026-04-20T10:00:00Z" }, own)).toMatchObject({ right: "return", maxQuantity: 3, voluntaryOffered: true });
    expect(at({}, { deliveredAt: "2026-03-20T10:00:00Z" }, own)).toMatchObject({ right: "none", refusal: "period_over" });
    // With the default window, past the 14 days there is nothing.
    expect(at({}, { deliveredAt: "2026-04-20T10:00:00Z" }).refusal).toBe("period_over");
  });

  it("returns excluded goods voluntarily only when the store accepts them, never digital content or a booking", () => {
    const accept = { acceptExcluded: true };
    expect(at({ withdrawalExclusion: "perishable" }, {}, accept)).toMatchObject({ right: "return", maxQuantity: 3 });
    expect(at({ withdrawalExclusion: "perishable" }, { deliveredAt: "2026-03-01T10:00:00Z" }, accept).refusal).toBe("period_over");
    expect(at({ withdrawalExclusion: "digital_content", delivery: "digital" }, {}, accept).refusal).toBe("digital_content");
    expect(at({ withdrawalExclusion: "dated_service" }, {}, accept).refusal).toBe("booking");
    expect(at({ delivery: "service" }, {}, accept).refusal).toBe("booking");
  });

  it("gives a company no statutory right, and a voluntary return only when the store allows it", () => {
    expect(at({}, { business: true }, { b2bReturns: true })).toMatchObject({ right: "return" });
    expect(at({}, { business: true }, { b2bReturns: true }, "2026-07-10T10:00:00Z").refusal).toBe("period_over");
    expect(at({}, { business: true }, { b2bReturns: false }).refusal).toBe("business_order");
  });

  it("accepts a subscription order like any other (ending the subscription is separate)", () => {
    expect(at({}, { subscription: true }).right).toBe("withdrawal");
  });

  it("covers every refusal with a message key", () => {
    expect(Object.keys(REFUSAL_KEYS).sort()).toEqual([...REFUSALS].sort());
  });
});

describe("an order's lines", () => {
  const lines = [line({ id: "a" }), line({ id: "b", withdrawalExclusion: "perishable" }), line({ id: "c", takenQuantity: 3 })];

  it("lists every line with its eligibility, and what the order as a whole allows", () => {
    const eligible = orderEligibility(lines, order(), settings(), OSLO, "2026-05-10T10:00:00Z");
    expect(eligible.map((e) => [e.lineId, e.right, e.refusal])).toEqual([
      ["a", "withdrawal", null],
      ["b", "none", "excluded_by_law"],
      ["c", "none", "already_returned"],
    ]);
    expect(orderRight(eligible)).toBe("withdrawal");
    expect(orderRight(eligible.slice(1))).toBe("none");
    expect(orderRight(orderEligibility([line()], order({ deliveredAt: "2026-04-20T10:00:00Z" }), settings({ windowDays: 40 }), OSLO, "2026-05-10T10:00:00Z"))).toBe("return");
  });

  it("checks a declaration: only the order's lines, the right asked for, each once, never more than is left", () => {
    const eligible = orderEligibility(lines, order(), settings(), OSLO, "2026-05-10T10:00:00Z");
    expect(declaredProblems([{ lineId: "a", quantity: 3 }], eligible, "withdrawal")).toEqual([]);
    expect(declaredProblems([{ lineId: "a", quantity: 4 }], eligible, "withdrawal")).toEqual([{ lineId: "a", code: "too_many" }]);
    expect(declaredProblems([{ lineId: "a", quantity: 0 }], eligible, "withdrawal")).toEqual([{ lineId: "a", code: "not_positive" }]);
    expect(declaredProblems([{ lineId: "a", quantity: 1.5 }], eligible, "withdrawal")).toEqual([{ lineId: "a", code: "not_positive" }]);
    expect(declaredProblems([{ lineId: "z", quantity: 1 }], eligible, "withdrawal")).toEqual([{ lineId: "z", code: "unknown_line" }]);
    expect(declaredProblems([{ lineId: "b", quantity: 1 }], eligible, "withdrawal")).toEqual([{ lineId: "b", code: "no_right" }]);
    expect(declaredProblems([{ lineId: "a", quantity: 1 }], eligible, "return")).toEqual([{ lineId: "a", code: "no_right" }]);
    expect(
      declaredProblems(
        [
          { lineId: "a", quantity: 1 },
          { lineId: "a", quantity: 1 },
        ],
        eligible,
        "withdrawal",
      ),
    ).toEqual([{ lineId: "a", code: "duplicate" }]);
  });
});

describe("reasons", () => {
  it("are the list of the contract, each recognised", () => {
    expect([...RETURN_REASONS]).toEqual(["changed_mind", "too_big", "too_small", "defective", "not_as_described", "damaged_in_transit", "wrong_item", "arrived_late", "other"]);
    expect(RETURN_REASONS.every(isReturnReason)).toBe(true);
    expect(isReturnReason("because")).toBe(false);
    expect(isReturnReason(undefined)).toBe(false);
  });
});

describe("deadlines", () => {
  it("gives the store 14 days from being informed to refund, and the shopper 14 days from the declaration to send back", () => {
    expect(refundDeadline("2026-05-04T10:15:00Z").toISOString()).toBe("2026-05-18T10:15:00.000Z");
    // The shopper's last day is in the store's calendar: a declaration at 23:30 UTC on the 4th is the 5th in Oslo.
    expect(sendBackDay("2026-05-04T23:30:00Z", OSLO)).toBe("2026-05-19");
    expect(sendBackDay("2026-05-04T23:30:00Z", "UTC")).toBe("2026-05-18");
  });
});

describe("when a refund is due", () => {
  const confirmed = "2026-05-04T10:00:00Z";
  const base = { kind: "withdrawal" as const, status: "approved", confirmedAt: confirmed, shippedAt: null, receivedAt: null, refunded: false };
  const due = (over: Partial<Parameters<typeof refundDue>[0]> = {}, when = "2026-05-08T10:00:00Z", refundWhen: "received" | "request" = "received") =>
    refundDue({ ...base, ...over }, { refundWhen }, OSLO, when);

  it("waits for the goods or proof of sending when the store waits for them", () => {
    expect(due()).toMatchObject({ state: "waiting", waitingFor: "goods", clockStart: null, daysToDeadline: 10 });
    expect(due({ shippedAt: "2026-05-06T10:00:00Z" })).toMatchObject({ state: "due", waitingFor: null });
    expect(due({ receivedAt: "2026-05-07T10:00:00Z" })).toMatchObject({ state: "due" });
  });

  it("starts the clock at the earlier of received and proof of sending", () => {
    const r = due({ shippedAt: "2026-05-06T10:00:00Z", receivedAt: "2026-05-07T10:00:00Z" });
    expect(r.clockStart?.toISOString()).toBe("2026-05-06T10:00:00.000Z");
    expect(due({ receivedAt: "2026-05-05T10:00:00Z", shippedAt: "2026-05-06T10:00:00Z" }).clockStart?.toISOString()).toBe("2026-05-05T10:00:00.000Z");
  });

  it("is due at once when the store does not wait for the goods", () => {
    const r = due({}, "2026-05-08T10:00:00Z", "request");
    expect(r).toMatchObject({ state: "due", waitingFor: null });
    expect(r.clockStart?.toISOString()).toBe("2026-05-04T10:00:00.000Z");
  });

  it("is overdue after the 14 days when it can be refunded, and a late wait for the goods is its own state", () => {
    const after = "2026-05-19T10:00:00Z";
    expect(due({ receivedAt: "2026-05-10T10:00:00Z" }, after)).toMatchObject({ state: "overdue", daysToDeadline: -1 });
    expect(due({}, after)).toMatchObject({ state: "waiting_late", waitingFor: "goods" });
    // Exactly at the deadline is not yet late.
    expect(due({ receivedAt: "2026-05-10T10:00:00Z" }, "2026-05-18T10:00:00Z").state).toBe("due");
    expect(due({ receivedAt: "2026-05-10T10:00:00Z" }, "2026-05-18T10:00:01Z").state).toBe("overdue");
  });

  it("uses the deadline the database holds when there is one", () => {
    const r = due({ refundDeadline: "2026-05-06T10:00:00Z", receivedAt: "2026-05-05T10:00:00Z" });
    expect(r.deadline?.toISOString()).toBe("2026-05-06T10:00:00.000Z");
    expect(r.state).toBe("overdue");
  });

  it("is due at once for a withdrawal made before anything was sent: there is no goods or proof of sending to wait for (Art. 13(3))", () => {
    const r = due({ nothingToSendBack: true });
    expect(r).toMatchObject({ state: "due", waitingFor: null });
    expect(r.clockStart?.toISOString()).toBe("2026-05-04T10:00:00.000Z");
    expect(due({ nothingToSendBack: true }, "2026-05-19T10:00:00Z").state).toBe("overdue");
  });

  it("is done once refunded, and does not apply to a return that has not been approved or has ended", () => {
    expect(due({ refunded: true })).toMatchObject({ state: "done", deadline: null });
    for (const status of ["requested", "declined", "cancelled", "closed"]) expect(due({ status }).state).toBe("not_applicable");
  });

  it("has no legal deadline for a voluntary return", () => {
    const r = due({ kind: "return", confirmedAt: null, receivedAt: "2026-05-07T10:00:00Z" }, "2026-08-01T10:00:00Z");
    expect(r).toMatchObject({ state: "due", deadline: null, daysToDeadline: null });
  });
});
