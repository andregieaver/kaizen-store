import { describe, expect, it } from "vitest";

import {
  EMPTY_CELL,
  adjustPayload,
  deltaText,
  figureText,
  heldWords,
  historyHref,
  historyQuery,
  inventoryPaths,
  listHref,
  listQuery,
  parseTyped,
  policyCell,
  putBackChoice,
  putBackWords,
  reviewRows,
  rowStates,
  savedWords,
  sendable,
  takenFromWords,
  type CellRef,
} from "./inventory-admin";
import { adjustInput } from "./inventory";

const V = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222222";
const L2 = "33333333-3333-4333-8333-333333333333";

const cell = (over: Partial<CellRef> = {}): CellRef => ({ key: `${V}:${L1}`, variantId: V, locationId: L1, was: 10, sku: "SKU-1", title: "Cup", options: "Red", location: "Oslo", ...over });

describe("the Inventory pages' addresses", () => {
  it("has one address for each tab", () => {
    expect(inventoryPaths("shop")).toEqual({
      list: "/admin/shop/inventory",
      history: "/admin/shop/inventory/history",
      locations: "/admin/shop/inventory/locations",
      import: "/admin/shop/inventory/import",
      export: "/admin/shop/inventory/export",
    });
  });

  it("reads a list filter and ignores whatever is not a known value", () => {
    expect(listQuery({ q: "  cup ", location: L1.toUpperCase(), status: "low", after: "abc_-123" })).toEqual({ search: "cup", location: L1, status: "low", after: "abc_-123" });
    expect(listQuery({ location: "x", status: "everything", after: "has space" })).toEqual({ search: "", location: null, status: "all", after: null });
    expect(listQuery({ q: ["a", "b"] }).search).toBe("a");
    expect(listQuery({ q: "x".repeat(300) }).search).toHaveLength(100);
  });

  it("builds a list address without empty values", () => {
    expect(listHref("/b", {})).toBe("/b");
    expect(listHref("/b", { status: "all", search: "" })).toBe("/b");
    expect(listHref("/b", { status: "out", search: "mug cup", location: L1 })).toBe(`/b?q=mug+cup&location=${L1}&status=out`);
  });

  it("reads the history's filter and builds its address", () => {
    const q = historyQuery({ sku: " A-1 ", variant: V, location: L2, reason: "damaged", from: "2026-10-01", to: "2026-10-31", after: "42" });
    expect(q).toEqual({ sku: "A-1", variant: V, location: L2, reason: "damaged", from: "2026-10-01", to: "2026-10-31", after: "42" });
    expect(historyQuery({ reason: "made-up", from: "01/10/2026", after: "-1" })).toEqual({ sku: "", variant: null, location: null, reason: null, from: null, to: null, after: null });
    expect(historyHref("/h", q)).toBe(`/h?sku=A-1&variant=${V}&location=${L2}&reason=damaged&from=2026-10-01&to=2026-10-31&after=42`);
    expect(historyHref("/h", {})).toBe("/h");
  });
});

describe("a row's marks", () => {
  const row = { onHand: 5, committed: 0, available: 5, owed: 0, stockPolicy: "deny" as const, backorderDays: null, lowStockThreshold: null };
  it("says nothing of a variant with stock", () => {
    expect(rowStates(row)).toEqual([]);
  });
  it("marks a sold-out variant as sold out, or as on backorder when it keeps selling", () => {
    expect(rowStates({ ...row, onHand: 0, available: 0 })).toEqual(["out"]);
    expect(rowStates({ ...row, onHand: 3, committed: 3, available: 0 })).toEqual(["out"]);
    expect(rowStates({ ...row, onHand: 0, available: 0, stockPolicy: "continue", backorderDays: 7 })).toEqual(["backorder"]);
  });
  it("marks below zero, low and owed, most serious first", () => {
    expect(rowStates({ ...row, onHand: -2, available: -2, stockPolicy: "continue", backorderDays: 7, lowStockThreshold: 3, owed: 2 })).toEqual(["negative", "backorder", "low", "owed"]);
  });
  it("marks a variant at its low-stock level, and one just above it not", () => {
    expect(rowStates({ ...row, lowStockThreshold: 5 })).toEqual(["low"]);
    expect(rowStates({ ...row, lowStockThreshold: 4 })).toEqual([]);
  });
});

describe("figures and words", () => {
  it("writes figures with a real minus sign and a signed change", () => {
    expect(figureText(1200)).toBe("1,200");
    expect(figureText(-3)).toBe("−3");
    expect(deltaText(4)).toBe("+4");
    expect(deltaText(-4)).toBe("−4");
    expect(deltaText(0)).toBe("0");
  });
  it("says the policy at zero stock with its days", () => {
    expect(policyCell("deny", null)).toBe("Stop selling at zero");
    expect(policyCell("continue", 7)).toBe("Keep selling: 7 days");
    expect(policyCell("continue", 1)).toBe("Keep selling: 1 day");
  });
  it("says what a location holds", () => {
    expect(heldWords(1, 1)).toBe("1 unit across 1 variant");
    expect(heldWords(12, 3)).toBe("12 units across 3 variants");
  });
});

describe("what a person typed", () => {
  it("reads whole numbers with a sign and nothing else", () => {
    expect(parseTyped("")).toBeNull();
    expect(parseTyped("  ")).toBeNull();
    expect(parseTyped("12")).toBe(12);
    expect(parseTyped("+5")).toBe(5);
    expect(parseTyped("-2")).toBe(-2);
    expect(parseTyped("−2")).toBe(-2);
    expect(parseTyped("1 200")).toBe(1200);
    expect(parseTyped("1.5")).toBe("invalid");
    expect(parseTyped("1,5")).toBe("invalid");
    expect(parseTyped("abc")).toBe("invalid");
    expect(parseTyped("12345678901")).toBe("invalid");
  });

  it("leaves a cell alone unless a different figure was typed", () => {
    expect(reviewRows([cell()], {})).toEqual([]);
    expect(reviewRows([cell()], { [cell().key]: { set: "10", by: "" } })).toEqual([]);
    expect(reviewRows([cell()], { [cell().key]: { set: "", by: "0" } })).toEqual([]);
    expect(reviewRows([cell()], { [cell().key]: EMPTY_CELL })).toEqual([]);
  });

  it("works a counted figure and a change out from the figure the cell was loaded with", () => {
    const [set] = reviewRows([cell()], { [cell().key]: { set: "25", by: "" } });
    expect(set).toMatchObject({ mode: "set", value: 25, next: 25, delta: 15, problem: null });
    const [by] = reviewRows([cell()], { [cell().key]: { set: "", by: "-4" } });
    expect(by).toMatchObject({ mode: "adjust", value: -4, next: 6, delta: -4, problem: null });
  });

  it("lets Adjust by win when both are typed", () => {
    const [row] = reviewRows([cell()], { [cell().key]: { set: "3", by: "+2" } });
    expect(row).toMatchObject({ mode: "adjust", next: 12 });
  });

  it("lists a figure that cannot be saved with its sentence and leaves it out of the save", () => {
    const rows = reviewRows([cell(), cell({ key: "b", variantId: "44444444-4444-4444-8444-444444444444" })], {
      [cell().key]: { set: "", by: "-11" },
      b: { set: "1.5", by: "" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].problem).toMatch(/below 0/);
    expect(rows[1].problem).toMatch(/whole number/);
    expect(sendable(rows)).toEqual([]);
    expect(rows.every((r) => r.next === null && r.delta === null)).toBe(true);
  });

  it("refuses a counted figure below zero, and a figure over the limit", () => {
    const [low] = reviewRows([cell()], { [cell().key]: { set: "-1", by: "" } });
    expect(low.problem).toMatch(/cannot be below 0/);
    const [high] = reviewRows([cell()], { [cell().key]: { set: "1000001", by: "" } });
    expect(high.problem).toMatch(/cannot be more than/);
  });

  it("makes the body the server takes, and the server's own check accepts it", () => {
    const rows = reviewRows([cell(), cell({ key: `${V}:${L2}`, locationId: L2, was: 0 })], {
      [`${V}:${L1}`]: { set: "", by: "+5" },
      [`${V}:${L2}`]: { set: "7", by: "" },
    });
    const payload = adjustPayload(rows, "received", "  Delivery 12 ");
    expect(payload.note).toBe("Delivery 12");
    expect(payload.rows).toEqual([
      { variantId: V, locationId: L1, mode: "adjust", value: 5, was: 10 },
      { variantId: V, locationId: L2, mode: "set", value: 7, was: 0 },
    ]);
    expect(adjustInput.safeParse(payload).success).toBe(true);
    expect(adjustPayload(rows, "count", "   ").note).toBeNull();
  });

  it("sends only the rows without a problem", () => {
    const rows = reviewRows([cell(), cell({ key: "b", variantId: "44444444-4444-4444-8444-444444444444" })], {
      [cell().key]: { set: "20", by: "" },
      b: { set: "", by: "-100" },
    });
    expect(adjustPayload(rows, "correction", "").rows).toHaveLength(1);
  });
});

describe("the words of a save", () => {
  it("counts what happened and says nothing else", () => {
    expect(savedWords({ written: 1, unchanged: 0, conflicts: 0, refused: 0, failed: 0 })).toBe("1 figure saved.");
    expect(savedWords({ written: 3, unchanged: 1, conflicts: 2, refused: 1, failed: 1 })).toBe(
      "3 figures saved, 1 already as typed, 2 figures not saved because the stock had changed, 1 refused, 1 could not be saved.",
    );
  });
});

describe("where an order's units came from and go back", () => {
  const locations = [
    { id: L1, name: "Oslo", active: true },
    { id: L2, name: "Bergen", active: true },
  ];

  it("lists where the units were taken from in rank order", () => {
    expect(takenFromWords([{ locationId: L2, quantity: 1 }, { locationId: L1, quantity: 2 }], locations)).toBe("Oslo 2, Bergen 1");
    expect(takenFromWords([], locations)).toBe("");
    expect(takenFromWords([{ locationId: L1, quantity: 0 }], locations)).toBe("");
  });

  it("says a restock goes back where the units were taken from", () => {
    expect(putBackWords([{ locationId: L1, quantity: 2 }, { locationId: L2, quantity: 1 }], [], locations)).toBe("They go back where they were taken from: Oslo 2, Bergen 1.");
  });

  it("lists the places in rank order, whatever order the movements were read in", () => {
    expect(putBackWords([{ locationId: L2, quantity: 1 }, { locationId: L1, quantity: 2 }], [], locations)).toBe("They go back where they were taken from: Oslo 2, Bergen 1.");
  });

  it("takes away what already went back", () => {
    expect(putBackWords([{ locationId: L1, quantity: 2 }, { locationId: L2, quantity: 1 }], [{ locationId: L1, quantity: 2 }], locations)).toBe("They go back where they were taken from: Bergen 1.");
    expect(putBackWords([{ locationId: L1, quantity: 2 }], [{ locationId: L1, quantity: 2 }], locations)).toMatch(/already gone back: any more goes to Oslo/);
  });

  it("names the first active location when nothing is recorded or the place is no longer active", () => {
    expect(putBackWords([], [], locations)).toBe("No record of where these were taken from: they go back to Oslo.");
    const closed = [{ id: L1, name: "Oslo", active: false }, { id: L2, name: "Bergen", active: true }];
    expect(putBackWords([{ locationId: L1, quantity: 2 }], [], closed)).toBe("Taken from Oslo 2. Oslo is not active, so those units go back to Bergen.");
    expect(putBackWords([{ locationId: L1, quantity: 2 }], [], [{ id: L1, name: "Oslo", active: false }])).toBe("");
  });

  it("reads the place chosen in a refund form", () => {
    expect(putBackChoice("")).toBeNull();
    expect(putBackChoice(null)).toBeNull();
    expect(putBackChoice("not-a-uuid")).toBeNull();
    expect(putBackChoice(L2.toUpperCase())).toBe(L2);
  });
});
