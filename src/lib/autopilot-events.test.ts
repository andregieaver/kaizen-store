import { describe, expect, it } from "vitest";

import { readAutonomy } from "./autopilot-autonomy";
import { EVENT_KINDS, EVENT_LINES, EVENT_TOOLS, eventMessage, eventRef, isoWeek, stockoutCheckDue, type EventFacts } from "./autopilot-events";
import { MANAGER_TOOLS_BY_NAME } from "./manager-tools";
import { OWNER_TOOLS_BY_NAME } from "./owner-tools";

/** Reacting to events (D331, `docs/ai-autopilot.md` 15.5): the settings, the tools each event may use and the turn's message. */

const support: EventFacts = { kind: "support_waiting", conversation: "c1", waitedMinutes: 22, handoffReason: "customer" };
const test: EventFacts = { kind: "test_ended", experiment: "x1", name: "Bigger photos", stopReason: "guardrail", stoppedAt: "2026-10-25T10:00:00Z" };
const alert: EventFacts = { kind: "alert", alert: "conversion", severity: "urgent", text: "Conversion fell by half.", evidence: ["Conversion: 1.1% (against 2.3%)"] };
// Orders (`docs/100-day-challenge.md` C5).
const unsent: EventFacts = { kind: "order_unsent", order: "1042", orderId: "o1", hours: 51 };
const parcel: EventFacts = { kind: "delivery_problem", order: "1043", orderId: "o2", shipment: "s1", phase: "returned_to_sender" };
const supplier: EventFacts = { kind: "supplier_problem", order: "1044", orderId: "o3", supplierOrder: "so1", supplier: "Nordic Mugs AS", state: "late" };
const held: EventFacts = { kind: "order_held", order: "1045", orderId: "o4", byRule: true };
const dispute: EventFacts = { kind: "dispute_opened", order: "1046", orderId: "o5", dispute: "d1", reason: "fraudulent", dueBy: "2026-11-30T23:59:00Z" };
const failing: EventFacts = { kind: "payments_failing", window: "2026-11-15T12", failed: 7, attempts: 12 };
const request: EventFacts = { kind: "staff_request", request: "11111111-1111-4111-8111-111111111111", ask: "change_address", order: "1042" };
const stockout: EventFacts = { kind: "stockout_risk", sku: "MUG-1", product: "White mug", lastsDays: 4.5, leadDays: 14, suggested: 120 };

describe("the settings", () => {
  it("react to nothing until switched on, and wait 15 minutes for a person by default", () => {
    const planning = readAutonomy({}).planning;
    expect(planning.reacts).toBe(false);
    expect(planning.waitMinutes).toBe(15);
    expect(readAutonomy({ planning: { reacts: true, waitMinutes: 2 } }).planning.reacts).toBe(false); // out of range: the defaults
    expect(readAutonomy({ planning: { reacts: true, waitMinutes: 30 } }).planning).toMatchObject({ reacts: true, waitMinutes: 30 });
  });
});

describe("each event's tools", () => {
  it("are all real tools, and none writes to a customer or decides a plan's start", () => {
    for (const kind of EVENT_KINDS) {
      for (const name of EVENT_TOOLS[kind]) expect([kind, name, Boolean(OWNER_TOOLS_BY_NAME[name] ?? MANAGER_TOOLS_BY_NAME[name])]).toEqual([kind, name, true]);
      for (const never of ["reply_to_support", "end_support_conversation", "email_customer", "send_broadcast", "start_autopilot_plan", "decide_approval"]) {
        expect(EVENT_TOOLS[kind]).not.toContain(never);
      }
    }
    expect(EVENT_TOOLS.support_waiting).toContain("add_support_note");
    expect(EVENT_TOOLS.test_ended).toContain("apply_winner");
    expect(EVENT_TOOLS.alert).toContain("make_autopilot_plan");
    // A held order and a dispute are a person's: the turn reads and leaves a note, and changes nothing else.
    expect(EVENT_TOOLS.order_held.filter((t) => OWNER_TOOLS_BY_NAME[t]?.gate)).toEqual([]);
    expect(EVENT_TOOLS.dispute_opened.filter((t) => OWNER_TOOLS_BY_NAME[t]?.gate)).toEqual([]);
    expect(EVENT_TOOLS.supplier_problem).toEqual(expect.arrayContaining(["list_supplier_orders", "answer_supplier_order", "cancel_order"]));
    // A late order's or a parcel's customer hears only the store's fixed words (D635), never a word the model wrote.
    for (const kind of ["order_unsent", "delivery_problem", "supplier_problem"] as const) expect(EVENT_TOOLS[kind]).toContain("tell_customer_about_order");
    expect(EVENT_TOOLS.order_held).not.toContain("tell_customer_about_order");
  });

  it("come with lines that say nobody is reading along", () => {
    for (const kind of EVENT_KINDS) expect(EVENT_LINES[kind]).toContain("Nobody is reading along");
    expect(EVENT_LINES.support_waiting).toContain("Never write to the customer");
  });
});

describe("the turn's message", () => {
  it("carries each event's facts as code wrote them", () => {
    expect(eventMessage(support)).toContain("waited 22 minutes");
    expect(eventMessage(support)).toContain("get_support_conversation (c1)");
    expect(eventMessage(test)).toContain('"Bigger photos" (id x1)');
    expect(eventMessage(test)).toContain("guardrail");
    const withGoals = eventMessage(alert, [{ id: "g1", title: "Double sales" }]);
    expect(withGoals).toContain("Conversion fell by half.");
    expect(withGoals).toContain("Conversion: 1.1% (against 2.3%)");
    expect(withGoals).toContain('"Double sales" (id g1)');
    expect(eventMessage(unsent)).toContain("order 1042 was paid 51 hours ago");
    expect(eventMessage(parcel)).toContain("on its way back to the store");
    expect(eventMessage(supplier)).toContain('"Nordic Mugs AS" has not sent in time');
    expect(eventMessage(held)).toContain("by one of the store's order rules");
    expect(eventMessage(dispute)).toContain("due by 2026-11-30");
    expect(eventMessage(failing)).toContain("7 of 12 payments");
    expect(eventMessage(stockout)).toContain('"White mug" (SKU MUG-1) may run out');
    expect(eventMessage(stockout)).toContain("lasts 4.5 days, and new stock takes 14 days");
    expect(eventMessage(stockout)).toContain("ordering 120 units");
  });

  it("makes an alert once a week and the others once", () => {
    expect(eventRef(support, "2026-10-26")).toBe("c1");
    expect(eventRef(test, "2026-10-26")).toBe("x1");
    expect(eventRef(alert, "2026-10-26")).toBe("conversion:2026-W44");
    expect(eventRef(alert, "2026-11-01")).toBe("conversion:2026-W44");
    expect(eventRef(alert, "2026-11-02")).toBe("conversion:2026-W45");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2024-12-30")).toBe("2025-W01");
    // An order once; a parcel and a supplier's order once per state; failed payments once per window.
    expect(eventRef(unsent, "2026-11-15")).toBe("o1");
    expect(eventRef(parcel, "2026-11-15")).toBe("s1:returned_to_sender");
    expect(eventRef(supplier, "2026-11-15")).toBe("so1:late");
    expect(eventRef(dispute, "2026-11-15")).toBe("d1");
    expect(eventRef(failing, "2026-11-15")).toBe("2026-11-15T12");
  });
});

describe("the stock-out risk event (C4, D638)", () => {
  it("is kept once a week per SKU, checked in the first minutes of every sixth hour, and orders only within the purchasing budget", () => {
    expect(eventRef(stockout, "2026-11-16")).toBe("MUG-1:2026-W47");
    expect(eventRef(stockout, "2026-11-22")).toBe("MUG-1:2026-W47");
    expect(stockoutCheckDue(new Date("2026-11-15T06:03:00Z"))).toBe(true);
    expect(stockoutCheckDue(new Date("2026-11-15T06:07:00Z"))).toBe(false);
    expect(stockoutCheckDue(new Date("2026-11-15T07:01:00Z"))).toBe(false);
    expect(EVENT_TOOLS.stockout_risk).toEqual(["restock_suggestions", "stock_levels", "list_purchase_orders", "create_purchase_order"]);
    expect(EVENT_LINES.stockout_risk).toContain("Never work out a quantity of your own");
  });
});

describe("the staff_request event (B3, D640)", () => {
  it("names the request and the tool that carries it out, and is kept once per request", () => {
    expect(eventMessage(request)).toContain("the customer of order 1042 asked in support to change its delivery address");
    expect(eventMessage(request)).toContain("carry_out_address_change (11111111-1111-4111-8111-111111111111)");
    expect(eventMessage({ ...request, ask: "cancel_order" } as EventFacts)).toContain("cancel it with cancel_order: it waits for the owner's yes");
    expect(eventRef(request, "2026-11-16")).toBe("11111111-1111-4111-8111-111111111111");
    expect(EVENT_TOOLS.staff_request).toEqual(["get_order", "get_support_conversation", "carry_out_address_change", "cancel_order", "add_order_note"]);
    expect(EVENT_LINES.staff_request).toContain("Never write to the customer");
  });
});
