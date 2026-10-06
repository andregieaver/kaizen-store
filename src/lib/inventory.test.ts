import { describe, expect, it } from "vitest";

import { productInput } from "./product-input";
import {
  ADJUST_PROBLEM_WORDS,
  ADJUST_REASONS,
  ADJUST_ROWS_MAX,
  BACKORDER_DAYS_MAX,
  INVENTORY_RETENTION_MONTHS,
  MOVEMENT_REASONS,
  MOVEMENT_SOURCES,
  NOTE_MAX,
  STOCK_MAX,
  adjustInput,
  bulkPolicyInput,
  byWords,
  compareRank,
  deactivationWords,
  inRankOrder,
  isAdjustReason,
  isMovementReason,
  isMovementSource,
  locationInput,
  moveInRank,
  policyProblem,
  policyWords,
  reasonWord,
  resultOf,
  stockContextArgs,
} from "./inventory";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (over: Record<string, unknown> = {}) => ({ variantId: id(1), locationId: id(2), mode: "set", value: 5, was: 3, ...over });

describe("the reasons and sources", () => {
  it("has the manual reasons a person can give, and the system's on top of them", () => {
    expect(ADJUST_REASONS).toEqual(["received", "correction", "count", "damaged", "lost", "promotion"]);
    expect(MOVEMENT_REASONS).toEqual([...ADJUST_REASONS, "sale", "order_restock", "return_restock", "opening", "system"]);
    expect(MOVEMENT_REASONS).toHaveLength(new Set(MOVEMENT_REASONS).size);
    expect(MOVEMENT_SOURCES).toHaveLength(new Set(MOVEMENT_SOURCES).size);
    expect(MOVEMENT_SOURCES).toContain("file");
    expect(INVENTORY_RETENTION_MONTHS).toBe(24);
  });

  it("tells a person's reason from the system's", () => {
    expect(isAdjustReason("damaged")).toBe(true);
    expect(isAdjustReason("sale")).toBe(false);
    expect(isMovementReason("sale")).toBe(true);
    expect(isMovementReason("theft")).toBe(false);
    expect(isMovementReason(3)).toBe(false);
    expect(isMovementSource("inventory_page")).toBe(true);
    expect(isMovementSource("hacker")).toBe(false);
  });

  it("has words for every reason, and 'Other' for one it does not know", () => {
    for (const reason of MOVEMENT_REASONS) expect(reasonWord(reason).length).toBeGreaterThan(2);
    expect(reasonWord("lost")).toBe("Theft or loss");
    expect(reasonWord("whatever")).toBe("Other");
  });

  it("says who or what made a change", () => {
    expect(byWords({ source: "inventory_page", actorName: "Kari Nordmann" })).toBe("Kari Nordmann");
    expect(byWords({ source: "inventory_page" })).toBe("A staff member");
    expect(byWords({ source: "order", orderNumber: "1042" })).toBe("Order 1042");
    expect(byWords({ source: "return", returnNumber: "1042-R1", orderNumber: "1042" })).toBe("Return 1042-R1");
    // A return's restock goes through the refund of its order: the return is what is named.
    expect(byWords({ source: "order", orderNumber: "1042", returnNumber: "1042-R1" })).toBe("Return 1042-R1");
    expect(byWords({ source: "checkout" })).toBe("Checkout");
    expect(byWords({ source: "file", actorName: "Kari" })).toBe("File import (Kari)");
    expect(byWords({ source: "file" })).toBe("File import");
    expect(byWords({ source: "ai_manager" })).toBe("AI manager");
    expect(byWords({ source: "system" })).toBe("System");
    expect(byWords({ source: "copy" })).toBe("Store copy");
  });
});

describe("the context of a change", () => {
  it("gives the arguments of commerce.stock_context() in order, with a note trimmed and cut, and none for an empty one", () => {
    expect(stockContextArgs({ reason: "received", source: "inventory_page", accountId: id(1), note: "  a pallet  " })).toEqual(["received", "inventory_page", id(1), null, null, null, "a pallet"]);
    expect(stockContextArgs({ reason: "sale", source: "order", orderId: id(2) })).toEqual(["sale", "order", null, id(2), null, null, null]);
    expect(stockContextArgs({ reason: "return_restock", source: "return", orderId: id(2), returnId: id(3), jobId: id(4), note: "   " })).toEqual(["return_restock", "return", null, id(2), id(3), id(4), null]);
    expect(stockContextArgs({ reason: "count", source: "file", note: "x".repeat(300) })[6]).toHaveLength(NOTE_MAX);
  });
});

describe("what a typed figure makes of the current one", () => {
  it("sets a counted figure from 0 to 1,000,000 and works out the change", () => {
    expect(resultOf("set", 12, 5)).toEqual({ ok: true, next: 12, delta: 7 });
    expect(resultOf("set", 0, 5)).toEqual({ ok: true, next: 0, delta: -5 });
    expect(resultOf("set", STOCK_MAX, 0)).toEqual({ ok: true, next: STOCK_MAX, delta: STOCK_MAX });
    expect(resultOf("set", 5, 5)).toEqual({ ok: true, next: 5, delta: 0 });
    expect(resultOf("set", -1, 5)).toEqual({ ok: false, problem: "negative" });
    expect(resultOf("set", STOCK_MAX + 1, 5)).toEqual({ ok: false, problem: "too_high" });
  });

  it("adjusts by a signed change whose result is 0 to 1,000,000, and works from a negative figure", () => {
    expect(resultOf("adjust", -2, 5)).toEqual({ ok: true, next: 3, delta: -2 });
    expect(resultOf("adjust", -5, 5)).toEqual({ ok: true, next: 0, delta: -5 });
    expect(resultOf("adjust", -6, 5)).toEqual({ ok: false, problem: "too_low" });
    expect(resultOf("adjust", 3, -2)).toEqual({ ok: true, next: 1, delta: 3 });
    expect(resultOf("adjust", 1, -2)).toEqual({ ok: false, problem: "too_low" });
    expect(resultOf("adjust", 1, STOCK_MAX)).toEqual({ ok: false, problem: "too_high" });
    expect(resultOf("adjust", STOCK_MAX + 1, 0)).toEqual({ ok: false, problem: "adjust_range" });
    expect(resultOf("adjust", -STOCK_MAX - 1, 0)).toEqual({ ok: false, problem: "adjust_range" });
  });

  it("refuses a figure that is not whole, and has a sentence for every problem", () => {
    expect(resultOf("set", 1.5, 0)).toEqual({ ok: false, problem: "not_whole" });
    expect(resultOf("adjust", 1, 0.5)).toEqual({ ok: false, problem: "not_whole" });
    expect(resultOf("set", Number.NaN, 0)).toEqual({ ok: false, problem: "not_whole" });
    for (const problem of ["not_whole", "too_high", "too_low", "negative", "adjust_range"] as const) expect(ADJUST_PROBLEM_WORDS[problem]).toMatch(/\.$/);
  });
});

describe("a save of the Inventory page", () => {
  it("reads rows with a reason (default: correction) and an optional note", () => {
    const parsed = adjustInput.parse({ rows: [row()] });
    expect(parsed).toMatchObject({ reason: "correction", note: null });
    expect(parsed.rows[0]).toMatchObject({ mode: "set", value: 5, was: 3 });
    expect(adjustInput.parse({ reason: "damaged", note: "  dropped  ", rows: [row({ mode: "adjust", value: -2 })] })).toMatchObject({ reason: "damaged", note: "dropped" });
    expect(adjustInput.parse({ note: "   ", rows: [row()] }).note).toBeNull();
  });

  it("refuses an unknown reason, a long note, a figure out of range and a figure that is not whole", () => {
    expect(adjustInput.safeParse({ reason: "sale", rows: [row()] }).success).toBe(false);
    expect(adjustInput.safeParse({ note: "x".repeat(NOTE_MAX + 1), rows: [row()] }).success).toBe(false);
    expect(adjustInput.safeParse({ note: "x".repeat(NOTE_MAX), rows: [row()] }).success).toBe(true);
    expect(adjustInput.safeParse({ rows: [row({ mode: "set", value: -1 })] }).success).toBe(false);
    expect(adjustInput.safeParse({ rows: [row({ value: STOCK_MAX + 1 })] }).success).toBe(false);
    expect(adjustInput.safeParse({ rows: [row({ value: 1.5 })] }).success).toBe(false);
    expect(adjustInput.safeParse({ rows: [row({ mode: "add" })] }).success).toBe(false);
    expect(adjustInput.safeParse({ rows: [row({ variantId: "not-a-uuid" })] }).success).toBe(false);
  });

  it("takes 1 to 500 rows and no figure twice", () => {
    expect(adjustInput.safeParse({ rows: [] }).success).toBe(false);
    const many = Array.from({ length: ADJUST_ROWS_MAX }, (_, i) => row({ variantId: id(1000 + i) }));
    expect(adjustInput.safeParse({ rows: many }).success).toBe(true);
    expect(adjustInput.safeParse({ rows: [...many, row({ variantId: id(5000) })] }).success).toBe(false);
    expect(adjustInput.safeParse({ rows: [row(), row({ value: 9 })] }).success).toBe(false);
    // The same variant at another location is another figure.
    expect(adjustInput.safeParse({ rows: [row(), row({ locationId: id(3) })] }).success).toBe(true);
  });

  it("lets a bulk change set the policy with days, stop it, or set the warning level (or clear it)", () => {
    expect(bulkPolicyInput.safeParse({ variantIds: [id(1)], change: { kind: "continue", backorderDays: 7 } }).success).toBe(true);
    expect(bulkPolicyInput.safeParse({ variantIds: [id(1)], change: { kind: "continue" } }).success).toBe(false);
    expect(bulkPolicyInput.safeParse({ variantIds: [id(1)], change: { kind: "continue", backorderDays: 0 } }).success).toBe(false);
    expect(bulkPolicyInput.safeParse({ variantIds: [id(1)], change: { kind: "continue", backorderDays: BACKORDER_DAYS_MAX + 1 } }).success).toBe(false);
    expect(bulkPolicyInput.safeParse({ variantIds: [id(1)], change: { kind: "deny" } }).success).toBe(true);
    expect(bulkPolicyInput.safeParse({ variantIds: [id(1)], change: { kind: "threshold", lowStockThreshold: null } }).success).toBe(true);
    expect(bulkPolicyInput.safeParse({ variantIds: [id(1)], change: { kind: "threshold", lowStockThreshold: -1 } }).success).toBe(false);
    expect(bulkPolicyInput.safeParse({ variantIds: [], change: { kind: "deny" } }).success).toBe(false);
    expect(bulkPolicyInput.safeParse({ variantIds: [id(1), id(1)], change: { kind: "deny" } }).success).toBe(false);
  });
});

describe("a variant's policy, delivery time and warning level", () => {
  it("needs days from 1 to 90 with continue, and none without it", () => {
    expect(policyProblem({ stockPolicy: "deny", backorderDays: null })).toBeNull();
    expect(policyProblem({ stockPolicy: "continue", backorderDays: 7 })).toBeNull();
    expect(policyProblem({ stockPolicy: "continue", backorderDays: 1 })).toBeNull();
    expect(policyProblem({ stockPolicy: "continue", backorderDays: 90 })).toBeNull();
    expect(policyProblem({ stockPolicy: "continue", backorderDays: null })).toMatch(/within how many days/);
    expect(policyProblem({ stockPolicy: "continue", backorderDays: 0 })).toMatch(/1 to 90/);
    expect(policyProblem({ stockPolicy: "continue", backorderDays: 91 })).toMatch(/1 to 90/);
    expect(policyProblem({ stockPolicy: "continue", backorderDays: 2.5 })).toMatch(/within how many days/);
    expect(policyProblem({ stockPolicy: "deny", backorderDays: 7 })).toMatch(/only to a variant that keeps selling/);
  });

  it("is for goods only: a download or a service neither keeps selling nor has a warning level", () => {
    expect(policyProblem({ stockPolicy: "continue", backorderDays: 7 }, "digital")).toMatch(/shipped/);
    expect(policyProblem({ stockPolicy: "continue", backorderDays: 7 }, "service")).toMatch(/shipped/);
    expect(policyProblem({ stockPolicy: "deny", backorderDays: null, lowStockThreshold: 3 }, "digital")).toMatch(/low-stock level/);
    expect(policyProblem({ stockPolicy: "deny", backorderDays: null, lowStockThreshold: 3 }, "physical")).toBeNull();
    expect(policyProblem({ stockPolicy: "deny", backorderDays: null, lowStockThreshold: null }, "digital")).toBeNull();
  });

  it("keeps the warning level to a whole number from 0 to 1,000,000", () => {
    for (const level of [0, 1, 1_000_000]) expect(policyProblem({ stockPolicy: "deny", backorderDays: null, lowStockThreshold: level })).toBeNull();
    for (const level of [-1, 1_000_001, 1.5]) expect(policyProblem({ stockPolicy: "deny", backorderDays: null, lowStockThreshold: level })).toMatch(/0 to 1,000,000/);
  });

  it("is the same rule the product editor's input holds: variants carry the three fields with defaults", () => {
    const shape = productInput.shape.variants.element.shape;
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(["stockPolicy", "backorderDays", "lowStockThreshold"]));
    expect(shape.stockPolicy.safeParse(undefined)).toMatchObject({ success: true, data: "deny" });
    expect(shape.backorderDays.safeParse(undefined)).toMatchObject({ success: true, data: null });
    expect(shape.backorderDays.safeParse(0).success).toBe(false);
    expect(shape.backorderDays.safeParse(91).success).toBe(false);
    expect(shape.lowStockThreshold.safeParse(-1).success).toBe(false);
    expect(shape.stockPolicy.safeParse("sometimes").success).toBe(false);
  });

  it("words the policy for the page", () => {
    expect(policyWords("deny", null)).toBe("Stop selling at zero");
    expect(policyWords("continue", 7)).toBe("Keep selling: 7 days");
    expect(policyWords("continue", 1)).toBe("Keep selling: 1 day");
  });
});

describe("locations and their rank", () => {
  it("reads a name of 1 to 60 characters and a two-letter country in capitals", () => {
    expect(locationInput.parse({ name: "  Oslo  ", country: "no" })).toEqual({ name: "Oslo", country: "NO" });
    expect(locationInput.safeParse({ name: "", country: "NO" }).success).toBe(false);
    expect(locationInput.safeParse({ name: "   ", country: "NO" }).success).toBe(false);
    expect(locationInput.safeParse({ name: "x".repeat(61), country: "NO" }).success).toBe(false);
    expect(locationInput.safeParse({ name: "x".repeat(60), country: "NO" }).success).toBe(true);
    expect(locationInput.safeParse({ name: "Oslo", country: "NOR" }).success).toBe(false);
    expect(locationInput.safeParse({ name: "Oslo", country: "" }).success).toBe(false);
  });

  it("ranks by priority, then created_at, then id", () => {
    const a = { id: "b", priority: 1, createdAt: "2026-01-01T00:00:00Z" };
    const b = { id: "a", priority: 1, createdAt: "2026-01-02T00:00:00Z" };
    const c = { id: "c", priority: 0, createdAt: "2026-02-01T00:00:00Z" };
    const d = { id: "d", priority: 1, createdAt: "2026-01-01T00:00:00Z" };
    expect(inRankOrder([a, b, c, d]).map((l) => l.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("breaks a tie of priority and time by id, takes dates as dates, and does not change what it is given", () => {
    const first = { id: "a", priority: 0, createdAt: new Date("2026-01-01T00:00:00Z") };
    const second = { id: "b", priority: 0, createdAt: new Date("2026-01-01T00:00:00Z") };
    expect(compareRank(first, second)).toBeLessThan(0);
    expect(compareRank(second, first)).toBeGreaterThan(0);
    expect(compareRank(first, first)).toBe(0);
    const input = [second, first];
    expect(inRankOrder(input).map((l) => l.id)).toEqual(["a", "b"]);
    expect(input.map((l) => l.id)).toEqual(["b", "a"]);
    expect(compareRank({ id: "x", priority: 0, createdAt: 1000 }, { id: "y", priority: 0, createdAt: 2000 })).toBeLessThan(0);
  });

  it("moves a location up or down one place, and nowhere past an end", () => {
    const ids = ["a", "b", "c"];
    expect(moveInRank(ids, "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveInRank(ids, "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveInRank(ids, "a", "up")).toEqual(["a", "b", "c"]);
    expect(moveInRank(ids, "c", "down")).toEqual(["a", "b", "c"]);
    expect(moveInRank(ids, "zzz", "up")).toEqual(["a", "b", "c"]);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("words the deactivation: a refusal while checkouts hold stock, and what stops being for sale", () => {
    expect(deactivationWords({ units: 12, variants: 3, committedUnits: 0 })).toEqual({
      refusal: null,
      notice: "12 units across 3 variants are no longer for sale; reactivate the location to sell them again.",
    });
    expect(deactivationWords({ units: 1, variants: 1, committedUnits: 0 }).notice).toBe("1 unit across 1 variant is no longer for sale; reactivate the location to sell them again.");
    expect(deactivationWords({ units: 1200, variants: 4, committedUnits: 2 }).refusal).toBe("2 units are held by checkouts in progress; try again in a few minutes.");
    expect(deactivationWords({ units: 5, variants: 1, committedUnits: 1 }).refusal).toBe("1 unit is held by checkouts in progress; try again in a few minutes.");
  });
});
