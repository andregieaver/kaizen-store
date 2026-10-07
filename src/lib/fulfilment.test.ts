import { describe, expect, it } from "vitest";

import {
  FULFILMENT_STATES,
  FULFILMENT_STATE_LABELS,
  SHIPMENT_PROBLEMS,
  afterParcel,
  fulfilmentState,
  orderUnitsToSend,
  shipmentProblems,
  takeWithdrawnFromUnsent,
  unitsToSend,
  unitsToSendBack,
  withdrawnInFull,
  type FulfilmentLine,
} from "./fulfilment";
import * as limits from "./fulfilment-limits";

const line = (lineId: string, quantity: number, over: Partial<FulfilmentLine> = {}): FulfilmentLine => ({
  lineId,
  quantity,
  physical: true,
  shipped: 0,
  withdrawn: 0,
  ...over,
});

describe("the numbers (4.1)", () => {
  it("pins every limit", () => {
    expect(limits.EDIT_PAY_DAYS).toBe(7);
    expect(limits.EDIT_ADDED_LINES_MAX).toBe(50);
    expect(limits.EDIT_QUANTITY_MAX).toBe(9_999);
    expect(limits.EDIT_PRICE_MAX_MINOR).toBe(1_000_000_000);
    expect(limits.EDITS_PER_ORDER_MAX).toBe(20);
    expect(limits.EDIT_NOTE_MAX).toBe(500);
    expect(limits.EDIT_PAY_PRESSES_PER_HOUR).toBe(20);
    expect(limits.EDIT_PAY_PRESSES_PER_HOUR_STORE).toBe(600);
    expect(limits.EDIT_SENDS_PER_DAY).toBe(5);
    expect(limits.PICK_LIST_MAX).toBe(100);
  });
});

describe("units to send (1.3, 4.2)", () => {
  it("is what was bought less what is in parcels less what was withdrawn, never below 0", () => {
    expect(unitsToSend(line("a", 3))).toBe(3);
    expect(unitsToSend(line("a", 3, { shipped: 1 }))).toBe(2);
    expect(unitsToSend(line("a", 3, { shipped: 1, withdrawn: 1 }))).toBe(1);
    expect(unitsToSend(line("a", 3, { shipped: 2, withdrawn: 2 }))).toBe(0);
    expect(unitsToSend(line("a", 3, { shipped: 3 }))).toBe(0);
    expect(unitsToSend(line("a", 3, { withdrawn: 3 }))).toBe(0);
  });

  it("is less what staff closed as not to be sent (D174, unsent_closures)", () => {
    expect(unitsToSend(line("a", 3, { shipped: 1, closed: 2 }))).toBe(0);
    expect(unitsToSend(line("a", 3, { closed: 1 }))).toBe(2);
    expect(unitsToSend(line("a", 3, { shipped: 1, withdrawn: 1, closed: 1 }))).toBe(0);
    expect(unitsToSend(line("a", 3, { closed: -2 }))).toBe(3);
    expect(unitsToSend(line("d", 2, { physical: false, closed: 1 }))).toBe(0);
  });

  it("is 0 for a download or a service, and reads bad numbers as 0", () => {
    expect(unitsToSend(line("d", 2, { physical: false }))).toBe(0);
    expect(unitsToSend(line("a", 3, { shipped: -1 }))).toBe(3);
    expect(unitsToSend(line("a", 3, { withdrawn: 0.5 }))).toBe(3);
    expect(orderUnitsToSend([line("a", 3, { shipped: 1 }), line("b", 2), line("d", 5, { physical: false })])).toBe(4);
  });
});

describe("the order's state (1.3; commerce.order_fulfilment() says the same)", () => {
  const cases: [string, FulfilmentLine[], boolean, (typeof FULFILMENT_STATES)[number]][] = [
    ["no physical line", [line("d", 1, { physical: false })], false, "none"],
    ["no line at all", [], true, "none"],
    ["nothing sent", [line("a", 3)], false, "unsent"],
    ["two of three sent", [line("a", 3, { shipped: 2 })], true, "partly_sent"],
    ["one line sent, one not", [line("a", 1, { shipped: 1 }), line("b", 1)], true, "partly_sent"],
    ["everything sent", [line("a", 3, { shipped: 3 })], true, "sent"],
    ["the rest withdrawn after a parcel", [line("a", 3, { shipped: 1, withdrawn: 2 })], true, "sent"],
    ["withdrawn before sending", [line("a", 3, { withdrawn: 3 })], false, "withdrawn"],
    ["the rest closed as not to be sent after a parcel", [line("a", 3, { shipped: 1, closed: 2 })], true, "sent"],
    ["some closed, the rest still to send", [line("a", 3, { shipped: 1, closed: 1 })], true, "partly_sent"],
    ["everything closed before sending", [line("a", 2, { closed: 2 })], false, "closed"],
    ["withdrawn and closed before sending", [line("a", 2, { withdrawn: 1, closed: 1 })], false, "closed"],
    ["one closed before sending, the rest to send", [line("a", 3, { closed: 1 })], false, "unsent"],
    ["a legacy parcel counts as everything", [line("a", 3, { shipped: 3 }), line("b", 2, { shipped: 2 })], true, "sent"],
  ];
  it.each(cases)("%s", (_name, lines, hasShipment, state) => {
    expect(fulfilmentState(lines, hasShipment)).toBe(state);
  });

  it("names every state", () => {
    for (const s of FULFILMENT_STATES) expect(FULFILMENT_STATE_LABELS[s]).toMatch(/\w/);
    expect(FULFILMENT_STATE_LABELS.partly_sent).toBe("Partly sent");
  });

  it("is withdrawn in full only when nothing was sent and nothing is left", () => {
    expect(withdrawnInFull([line("a", 2, { withdrawn: 2 })], false)).toBe(true);
    expect(withdrawnInFull([line("a", 2, { withdrawn: 1 })], false)).toBe(false);
    expect(withdrawnInFull([line("a", 2, { shipped: 1, withdrawn: 1 })], true)).toBe(false);
  });
});

describe("withdrawn units are taken from the unsent ones first (4.2)", () => {
  it("withdrew 1 of 3 with 1 sent: nothing comes back", () => {
    expect(takeWithdrawnFromUnsent({ quantity: 3, shippedBefore: 1, withdrawn: 1 })).toEqual({ unsent: 1, toComeBack: 0 });
    expect(unitsToSendBack({ quantity: 3, shippedBefore: 1, withdrawnBefore: 0, withdrawnNow: 1 })).toBe(0);
  });

  it("withdrew 2 of 3 with 2 sent: one comes back", () => {
    expect(takeWithdrawnFromUnsent({ quantity: 3, shippedBefore: 2, withdrawn: 2 })).toEqual({ unsent: 1, toComeBack: 1 });
    expect(unitsToSendBack({ quantity: 3, shippedBefore: 2, withdrawnBefore: 0, withdrawnNow: 2 })).toBe(1);
  });

  it("splits over two withdrawals: the first takes the unsent unit, the second asks a sent one back", () => {
    expect(unitsToSendBack({ quantity: 3, shippedBefore: 2, withdrawnBefore: 0, withdrawnNow: 1 })).toBe(0);
    expect(unitsToSendBack({ quantity: 3, shippedBefore: 2, withdrawnBefore: 1, withdrawnNow: 1 })).toBe(1);
  });

  it("with nothing sent, nothing ever comes back; with everything sent, all of it does", () => {
    expect(unitsToSendBack({ quantity: 4, shippedBefore: 0, withdrawnBefore: 1, withdrawnNow: 3 })).toBe(0);
    expect(unitsToSendBack({ quantity: 4, shippedBefore: 4, withdrawnBefore: 1, withdrawnNow: 3 })).toBe(3);
  });

  it("never counts more than the line holds", () => {
    expect(takeWithdrawnFromUnsent({ quantity: 2, shippedBefore: 5, withdrawn: 9 })).toEqual({ unsent: 0, toComeBack: 2 });
  });

  it("never takes a unit closed as not to be sent (3.16): 1 of 3 sent, 2 closed, withdrew 1 asks the sent one back", () => {
    expect(takeWithdrawnFromUnsent({ quantity: 3, shippedBefore: 1, withdrawn: 1, closedBefore: 2 })).toEqual({ unsent: 0, toComeBack: 1 });
    expect(unitsToSendBack({ quantity: 3, shippedBefore: 1, withdrawnBefore: 0, withdrawnNow: 1, closedBefore: 2 })).toBe(1);
    // 1 of 3 closed, nothing sent: a withdrawal of 1 still takes an unsent unit.
    expect(unitsToSendBack({ quantity: 3, shippedBefore: 0, withdrawnBefore: 0, withdrawnNow: 1, closedBefore: 1 })).toBe(0);
    expect(takeWithdrawnFromUnsent({ quantity: 2, shippedBefore: 1, withdrawn: 1, closedBefore: 5 })).toEqual({ unsent: 0, toComeBack: 1 });
  });
});

describe("what a parcel may hold (3.4, markSent())", () => {
  const lines = [line("a", 3), line("b", 2, { shipped: 1 }), line("d", 1, { physical: false }), line("c", 1, { withdrawn: 1 })];

  it("sends everything still to send when no lines are chosen (every caller from before parcels named lines)", () => {
    expect(shipmentProblems(lines)).toEqual({ ok: true, parcel: [{ lineId: "a", quantity: 3 }, { lineId: "b", quantity: 1 }], left: 0 });
    expect(shipmentProblems(lines, null)).toMatchObject({ ok: true, left: 0 });
  });

  it("sends part of a line and says what is left", () => {
    expect(shipmentProblems(lines, [{ lineId: "a", quantity: 2 }])).toEqual({ ok: true, parcel: [{ lineId: "a", quantity: 2 }], left: 2 });
  });

  it("leaves out lines chosen with 0 units, and keeps the order's line order", () => {
    expect(shipmentProblems(lines, [{ lineId: "b", quantity: 1 }, { lineId: "a", quantity: 0 }, { lineId: "a", quantity: 1 }])).toEqual({
      ok: true,
      parcel: [{ lineId: "a", quantity: 1 }, { lineId: "b", quantity: 1 }],
      left: 2,
    });
  });

  it("refuses more than is left, a download, a line of another order, a bad number, a duplicate and an empty parcel", () => {
    expect(shipmentProblems(lines, [{ lineId: "b", quantity: 2 }])).toEqual({ ok: false, problems: [{ code: "too_many", lineId: "b" }] });
    expect(shipmentProblems(lines, [{ lineId: "c", quantity: 1 }])).toEqual({ ok: false, problems: [{ code: "too_many", lineId: "c" }] });
    expect(shipmentProblems(lines, [{ lineId: "d", quantity: 1 }])).toEqual({ ok: false, problems: [{ code: "not_physical", lineId: "d" }] });
    expect(shipmentProblems(lines, [{ lineId: "zz", quantity: 1 }])).toEqual({ ok: false, problems: [{ code: "not_in_order", lineId: "zz" }] });
    expect(shipmentProblems(lines, [{ lineId: "a", quantity: 1.5 }])).toEqual({ ok: false, problems: [{ code: "quantity_invalid", lineId: "a" }] });
    expect(shipmentProblems(lines, [{ lineId: "a", quantity: -1 }])).toEqual({ ok: false, problems: [{ code: "quantity_invalid", lineId: "a" }] });
    expect(shipmentProblems(lines, [{ lineId: "a", quantity: 1 }, { lineId: "a", quantity: 1 }])).toEqual({ ok: false, problems: [{ code: "quantity_invalid", lineId: "a" }] });
    expect(shipmentProblems(lines, [{ lineId: "a", quantity: 0 }])).toEqual({ ok: false, problems: [{ code: "empty" }] });
    expect(shipmentProblems(lines, [])).toEqual({ ok: false, problems: [{ code: "empty" }] });
  });

  it("says there is nothing to send, and why, when nothing is left", () => {
    expect(shipmentProblems([line("a", 1, { shipped: 1 })], undefined, true)).toEqual({ ok: false, problems: [{ code: "nothing_to_send" }] });
    expect(shipmentProblems([line("a", 1, { withdrawn: 1 })], undefined, false)).toEqual({ ok: false, problems: [{ code: "withdrawn_in_full" }] });
    expect(shipmentProblems([line("a", 2, { closed: 2 })], undefined, false)).toEqual({ ok: false, problems: [{ code: "nothing_to_send" }] });
    expect(shipmentProblems([line("a", 3, { shipped: 1, closed: 1 })], [{ lineId: "a", quantity: 2 }], true)).toEqual({ ok: false, problems: [{ code: "too_many", lineId: "a" }] });
    expect(shipmentProblems([line("a", 3, { shipped: 1, closed: 1 })], undefined, true)).toEqual({ ok: true, parcel: [{ lineId: "a", quantity: 1 }], left: 0 });
    expect(shipmentProblems([line("d", 1, { physical: false })], [{ lineId: "d", quantity: 1 }])).toEqual({ ok: false, problems: [{ code: "nothing_to_send" }] });
  });

  it("has words for every problem, and the state after the parcel follows", () => {
    for (const text of Object.values(SHIPMENT_PROBLEMS)) expect(text).toMatch(/\.$/);
    const after = afterParcel(lines, [{ lineId: "a", quantity: 2 }]);
    expect(fulfilmentState(after, true)).toBe("partly_sent");
    expect(fulfilmentState(afterParcel(after, [{ lineId: "a", quantity: 1 }, { lineId: "b", quantity: 1 }]), true)).toBe("sent");
  });
});
