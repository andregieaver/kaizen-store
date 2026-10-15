import { describe, expect, it } from "vitest";

import {
  ACTION_LABELS,
  CONDITION_LABELS,
  countsSentence,
  dayText,
  declineReasonText,
  dueMark,
  eventSentence,
  EXCHANGE_MARK_LABELS,
  exchangeFilterOf,
  exchangeSentence,
  exclusionLabel,
  labelSentence,
  outcomeLabel,
  outcomeSentence,
  isReturnEvent,
  KIND_LABELS,
  OUTCOME_LABELS,
  pageNumber,
  previewData,
  queueHref,
  REASON_LABELS,
  STATUS_FILTERS,
  STATUS_HINTS,
  STATUS_LABELS,
  timeText,
  todayIn,
} from "./return-admin";
import { RETURN_CONDITIONS, RETURN_FILTER_STATUSES } from "./return-input";
import { refundFor } from "./return-refund";
import { RETURN_ACTIONS, RETURN_EVENT_TYPES, RETURN_KINDS, RETURN_OUTCOMES, RETURN_STATUSES } from "./return-status";
import { REFUSALS, RETURN_REASONS, type RefundDue } from "./withdrawal";

const ZONE = "Europe/Oslo";
const due = (over: Partial<RefundDue>): RefundDue => ({ state: "due", deadline: null, daysToDeadline: null, waitingFor: null, clockStart: null, ...over });

describe("the words of the returns screens", () => {
  it("name every status, kind, outcome, reason, condition and action the system has", () => {
    for (const status of RETURN_STATUSES) {
      expect(STATUS_LABELS[status], status).toBeTruthy();
      expect(STATUS_HINTS[status], status).toBeTruthy();
    }
    for (const kind of RETURN_KINDS) expect(KIND_LABELS[kind], kind).toBeTruthy();
    for (const outcome of RETURN_OUTCOMES) expect(OUTCOME_LABELS[outcome], outcome).toBeTruthy();
    for (const reason of RETURN_REASONS) expect(REASON_LABELS[reason], reason).toBeTruthy();
    for (const condition of RETURN_CONDITIONS) expect(CONDITION_LABELS[condition], condition).toBeTruthy();
    for (const action of RETURN_ACTIONS) expect(ACTION_LABELS[action], action).toBeTruthy();
  });

  it("offer every status the queue can filter by, once", () => {
    expect(STATUS_FILTERS.map((f) => f.value).sort()).toEqual([...RETURN_FILTER_STATUSES].sort());
  });

  it("say why a line was declined: the system's codes in words, a person's words as they were written", () => {
    for (const refusal of REFUSALS) expect(declineReasonText(refusal), refusal).not.toBe(refusal);
    expect(declineReasonText("excluded_by_law")).toMatch(/law excludes/);
    expect(declineReasonText("Worn out")).toBe("Worn out");
    expect(declineReasonText(null)).toBe("Declined");
  });

  it("name what the law excludes, and any other value by its own words", () => {
    expect(exclusionLabel("custom_made")).toMatch(/order/);
    expect(exclusionLabel("none")).toMatch(/applies/);
    expect(exclusionLabel("something_new")).toBe("something new");
  });
});

describe("the queue's addresses", () => {
  const base = "/admin/s/returns";

  it("keep only what differs from the defaults", () => {
    expect(queueHref(base)).toBe(base);
    expect(queueHref(base, { status: "open", kind: "all", q: "", overdue: false, page: 1 })).toBe(base);
    expect(queueHref(base, { status: "requested" })).toBe(`${base}?status=requested`);
    expect(queueHref(base, { overdue: true })).toBe(`${base}?overdue=1`);
    expect(queueHref(base, { status: "all", kind: "withdrawal", q: " 1001 ", page: 3 })).toBe(`${base}?status=all&kind=withdrawal&q=1001&page=3`);
  });

  it("read a page number from the address, and fall back to the first", () => {
    expect(pageNumber("3")).toBe(3);
    expect(pageNumber(["2", "5"])).toBe(2);
    for (const bad of [undefined, "0", "-1", "x", "1.5", "99999"]) expect(pageNumber(bad), String(bad)).toBe(1);
  });
});

describe("days and times in the store's own zone", () => {
  it("write a day the way people do, in the store's calendar", () => {
    // 23:30 UTC on 11 October is 01:30 on the 12th in Oslo.
    expect(dayText("2026-10-11T23:30:00Z", ZONE)).toBe("12 Oct 2026");
    expect(dayText("2026-10-11T23:30:00Z", "UTC")).toBe("11 Oct 2026");
    expect(timeText("2026-10-11T23:30:00Z", ZONE)).toMatch(/12 Oct 2026.*01:30/);
  });

  it("say what today is in the store, which is not always today in UTC", () => {
    expect(todayIn(ZONE, new Date("2026-10-11T23:30:00Z"))).toBe("2026-10-12");
    expect(todayIn("UTC", new Date("2026-10-11T23:30:00Z"))).toBe("2026-10-11");
  });
});

describe("the refund's mark", () => {
  const deadline = new Date("2026-10-20T10:00:00Z");

  it("says nothing where there is nothing to do about the money", () => {
    expect(dueMark(due({ state: "not_applicable" }), ZONE)).toBeNull();
  });

  it("is calm once refunded", () => {
    expect(dueMark(due({ state: "done" }), ZONE)).toEqual({ text: "Refunded", tone: "calm" });
  });

  it("counts the days to the deadline of a refund that can be made", () => {
    expect(dueMark(due({ state: "due", deadline, daysToDeadline: 8 }), ZONE)).toEqual({ text: "Refund due by 20 Oct 2026 (8 days left)", tone: "calm" });
    expect(dueMark(due({ state: "due", deadline, daysToDeadline: 1 }), ZONE)).toEqual({ text: "Refund due by 20 Oct 2026 (1 day left)", tone: "warn" });
    expect(dueMark(due({ state: "due", deadline, daysToDeadline: 0 }), ZONE)).toEqual({ text: "Refund due today", tone: "warn" });
  });

  it("is ready to refund when there is no deadline (a return request has none)", () => {
    expect(dueMark(due({ state: "due" }), ZONE)).toEqual({ text: "Ready to refund", tone: "calm" });
  });

  it("is urgent when the legal deadline has passed, with or without the goods", () => {
    expect(dueMark(due({ state: "overdue", deadline, daysToDeadline: -3 }), ZONE)).toEqual({ text: "Refund overdue by 3 days (was due 20 Oct 2026)", tone: "urgent" });
    expect(dueMark(due({ state: "overdue", deadline, daysToDeadline: -1 }), ZONE)?.text).toContain("by 1 day ");
    const late = dueMark(due({ state: "waiting_late", deadline, daysToDeadline: -2, waitingFor: "goods" }), ZONE);
    expect(late?.tone).toBe("urgent");
    expect(late?.text).toContain("still waiting for the goods");
  });

  it("says what a refund that waits for the goods waits for", () => {
    expect(dueMark(due({ state: "waiting", deadline, daysToDeadline: 9, waitingFor: "goods" }), ZONE)).toEqual({
      text: "Waiting for the goods, refund due by 20 Oct 2026",
      tone: "calm",
    });
  });
});

describe("the timeline's sentences", () => {
  it("write every event type of a return in words, never the raw type", () => {
    for (const type of RETURN_EVENT_TYPES) {
      const sentence = eventSentence(type, {}, "NOK");
      expect(sentence, type).not.toBe(type);
      expect(sentence, type).not.toMatch(/return\./);
    }
  });

  it("say what the system did on its own, and what a person decided", () => {
    expect(eventSentence("return.approved", { automatic: true }, "NOK")).toMatch(/automatically/);
    expect(eventSentence("return.approved", {}, "NOK")).toBe("Approved");
    expect(eventSentence("return.declined", { reason: "Worn" }, "NOK")).toBe("Declined: Worn");
    expect(eventSentence("return.declined", { scope: "line", reason: "Excluded" }, "NOK")).toBe("A line was declined: Excluded");
  });

  it("write amounts in the order's currency, and say when a refund was made outside", () => {
    const refunded = eventSentence("return.refunded", { amountMinor: 12_345 }, "NOK", "en-GB");
    expect(refunded).toMatch(/^Refunded /);
    expect(refunded.replace(/[\s ]/g, "")).toContain("123.45");
    expect(eventSentence("return.refunded", { amountMinor: 100, outside: true }, "NOK")).toContain("outside Kaizena Flow's Stripe");
    const changed = eventSentence("return.refund_overridden", { computedMinor: 10_000, requestedMinor: 8_000, reason: "Goodwill" }, "NOK");
    expect(changed).toMatch(/changed from .*100.* to .*80.*: Goodwill/);
    expect(eventSentence("return.closed", { outcome: "no_refund" }, "NOK")).toBe("Closed with no refund");
  });

  it("names an event it does not know, and tells returns' from the rest", () => {
    expect(eventSentence("return.something_new", {}, "NOK")).toBe("return.something_new");
    expect(isReturnEvent("return.received")).toBe(true);
    expect(isReturnEvent("order.paid")).toBe(false);
  });
});

describe("the counts' sentence", () => {
  it("leads with what the law makes urgent", () => {
    expect(countsSentence({ open: 5, requested: 2, overdue: 1, acknowledgementPending: 1 })).toBe("1 past the refund deadline, 1 acknowledgement was not sent, 2 to approve.");
    expect(countsSentence({ open: 3, requested: 0, overdue: 0, acknowledgementPending: 2 })).toBe("2 acknowledgements were not sent.");
  });

  it("says plainly when nothing waits on the store", () => {
    expect(countsSentence({ open: 4, requested: 0, overdue: 0, acknowledgementPending: 0 })).toBe("4 open, none waiting on you.");
    expect(countsSentence({ open: 0, requested: 0, overdue: 0, acknowledgementPending: 0 })).toBe("No returns are open.");
  });
});

describe("the refund as the screen holds it", () => {
  it("is plain data from the one function that works the refund out", () => {
    const refund = refundFor({
      kind: "withdrawal",
      lines: [{ lineId: "a", quantity: 1, totalMinor: 10_000, priorQuantity: 0, returnQuantity: 1, deductionMinor: 1_000 }],
      shippingPaidMinor: 5_000,
      whoPaysReturn: "shopper",
      returnShippingMinor: 2_000,
      refundableMinor: 20_000,
    });
    const data = previewData({ refund, refundableMinor: 20_000, canRefund: true });
    expect(data).toEqual({
      amountMinor: 12_000,
      working: refund.working,
      cappedBy: null,
      wholeOrder: true,
      refundableMinor: 20_000,
      canRefund: true,
      returnShippingMinor: 2_000,
    });
    // It crosses to the browser and back unchanged.
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});

describe("exchanges and return labels in words (D239)", () => {
  const outcome = (kind: "refund_due" | "even" | "to_pay", refundMinor = 0, toPayMinor = 0) => ({ kind, refundMinor, toPayMinor });

  it("words an exchange's outcome in the order's currency", () => {
    expect(outcomeSentence(outcome("refund_due", 12_000), "NOK")).toMatch(/^Refund due to the customer: .*120.00/);
    expect(outcomeSentence(outcome("to_pay", 0, 14_900), "EUR")).toMatch(/^Payment to collect: .*149\.00/);
    expect(outcomeSentence(outcome("even"), "NOK")).toBe("Even exchange: nothing to refund or collect");
  });

  it("says where an exchange stands, for every state", () => {
    const x = (status: string, over: Partial<{ exchangeOrderNumber: string | null; expiresAt: string | null }> = {}) =>
      exchangeSentence({ status, outcome: outcome("to_pay", 0, 5_000), expiresAt: "2026-10-12T21:59:00.000Z", exchangeOrderNumber: "1042", ...over }, "NOK", "Europe/Oslo");
    expect(x("proposed")).toMatch(/waits for their confirmation until 12 Oct/);
    expect(x("processed")).toMatch(/Order 1042 is made and waits for the customer to pay/);
    expect(x("settled")).toBe("Exchanged: order 1042.");
    for (const status of ["draft", "confirmed", "declined_by_customer", "cancelled", "expired", "superseded"]) expect(x(status)).not.toBe(status);
  });

  it("says who pays a label, and never takes off a cost the carrier did not give", () => {
    const booked = { source: "carrier" as const, test: false, costMinor: 9_900, tries: 1 };
    expect(labelSentence(booked, "shopper", "NOK", "Posten / Bring")).toMatch(/99.00 will be taken off the refund/);
    expect(labelSentence({ ...booked, costMinor: null }, "shopper", "NOK", "Posten / Bring")).toMatch(/did not price it/);
    expect(labelSentence(booked, "store", "NOK", "Posten / Bring")).toMatch(/nothing is taken off/);
    expect(labelSentence({ ...booked, test: true }, "store", "NOK", null)).toMatch(/^A test label/);
    expect(labelSentence({ source: "pasted", test: false, costMinor: null, tries: 0 }, "shopper", "NOK", null)).toMatch(/pasted/);
    expect(labelSentence({ source: null, test: false, costMinor: null, tries: 2 }, "shopper", "NOK", null)).toMatch(/did not go through/);
  });

  it("reads the queue's exchange filter, keeps it in the queue's addresses, and words the marks", () => {
    expect(exchangeFilterOf("proposed")).toBe("proposed");
    expect(exchangeFilterOf(["waiting_payment"])).toBe("waiting_payment");
    expect(exchangeFilterOf("nonsense")).toBeNull();
    expect(exchangeFilterOf("toString")).toBeNull();
    expect(queueHref("/r", { exchange: "wished", page: 2 })).toBe("/r?exchange=wished&page=2");
    expect(EXCHANGE_MARK_LABELS.waiting_payment).toBe("Exchange: payment to collect");
  });

  it("words the exchange and label events of the timeline, and an exchanged outcome", () => {
    expect(eventSentence("return.exchange_proposed", { creditMinor: 35_000, totalMinor: 49_900 }, "NOK")).toMatch(/credit .*350.00, replacements .*499.00/);
    expect(eventSentence("return.exchange_confirmed", { confirmedBy: "staff", channel: "phone", day: "2026-10-05", note: "Called" }, "NOK")).toBe(
      "The customer's agreement to the exchange was recorded (by phone, 2026-10-05): Called",
    );
    expect(eventSentence("return.exchange_confirmed", { confirmedBy: "customer" }, "NOK")).toBe("The customer confirmed the exchange");
    expect(eventSentence("return.refunded", { exchange: "x", transferMinor: 24_000, refundMinor: 11_000 }, "NOK")).toMatch(/^Exchanged: .*240.00 of the credit paid the new order, .*110.00 refunded/);
    expect(eventSentence("return.refunded", { amountMinor: 1_000 }, "NOK")).toMatch(/^Refunded/);
    expect(eventSentence("return.label_booked", { test: true }, "NOK")).toBe("Return label booked (a test label)");
    expect(isReturnEvent("exchange.refund_failed")).toBe(true);
    expect(outcomeLabel("exchanged")).toBe("Exchanged");
    expect(outcomeLabel("no_refund")).toBe("Closed with no refund");
  });
});
