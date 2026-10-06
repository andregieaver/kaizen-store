import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { BACKORDER_LONG_HINT } from "./inventory";
import { TOOL_WORDS } from "./manager-tools";
import { approvalSummary, OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";
import { toolKey } from "./owner-tool-permissions";
import { can } from "./permissions";
import { STOCK_TOOLS, backorderSummary, dayBefore, pickLocation, setStockSummary, shapeLevel, shapeMovement, type LevelRow } from "./stock-tools";

const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);

describe("the stock tools in the owner assistant's catalogue (wave 3, D172)", () => {
  it("lets it read freely and keeps both changes for the owner's yes, as changes to what the site shows", () => {
    expect(OWNER_TOOLS_BY_NAME.stock_levels.gate).toBeUndefined();
    expect(OWNER_TOOLS_BY_NAME.stock_history.gate).toBeUndefined();
    expect(OWNER_TOOLS_BY_NAME.set_stock.gate).toBe("public");
    expect(OWNER_TOOLS_BY_NAME.set_backorder.gate).toBe("public");
    expect(OWNER_TOOLS_BY_NAME.set_stock.description).toContain("Needs the owner's approval");
    expect(OWNER_TOOLS_BY_NAME.set_backorder.description).toContain("Needs the owner's approval");
    expect(OWNER_TOOLS_BY_NAME.stock_levels.description).not.toContain("Needs the owner's approval");
  });

  it("has the four tools, and none that deletes or rewrites the history", () => {
    const names = OWNER_TOOLS.map((t) => t.name).filter((n) => /stock|backorder/.test(n) && n !== "low_stock" && n !== "restock_suggestions");
    expect(names.sort()).toEqual([...STOCK_TOOLS].sort());
    for (const bad of ["delete_stock_history", "edit_stock_history", "undo_stock_change", "set_stock_history"]) expect(OWNER_TOOLS_BY_NAME[bad], bad).toBeUndefined();
  });

  it("gives each words for the progress line and JSON Schema without refs", () => {
    for (const name of STOCK_TOOLS) {
      expect(TOOL_WORDS[name], name).toBeTruthy();
      const definition = toolDefinition(OWNER_TOOLS_BY_NAME[name]);
      expect(definition.description.length).toBeGreaterThan(60);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
  });

  it("asks the Products keys: reading to look, changing to set", () => {
    expect(toolKey("stock_levels")).toBe("products:read");
    expect(toolKey("stock_history")).toBe("products:read");
    expect(toolKey("set_stock")).toBe("products:write");
    expect(toolKey("set_backorder")).toBe("products:write");
    const reader = { role: "admin" as const, permissions: ["products:read"] };
    expect(can(reader, toolKey("stock_levels")!)).toBe(true);
    expect(can(reader, toolKey("set_backorder")!)).toBe(false);
    const orders = { role: "admin" as const, permissions: ["orders:read", "orders:write"] };
    expect(can(orders, toolKey("stock_levels")!)).toBe(false);
  });

  it("tells the model that the figures are the store's, that the days are the owner's to give, and that the history is read-only", () => {
    expect(OWNER_TOOLS_BY_NAME.stock_levels.description).toMatch(/counted by the store: repeat it, never add one/);
    expect(OWNER_TOOLS_BY_NAME.stock_history.description).toMatch(/Read-only/);
    expect(OWNER_TOOLS_BY_NAME.set_backorder.description).toMatch(/never choose them yourself: ask the owner/);
    expect(OWNER_TOOLS_BY_NAME.set_stock.description).toMatch(/not the number to add/);
    expect(OWNER_TOOLS_BY_NAME.set_stock.description).toMatch(/never about a person/);
  });
});

describe("the arguments", () => {
  it("set_stock keeps its old shape (sku and quantity) and adds a reason that defaults to a correction", () => {
    expect(read("set_stock", { sku: "MUG-1", quantity: 12 })).toEqual({ ok: true, input: { sku: "MUG-1", quantity: 12, reason: "correction" } });
    expect(read("set_stock", { sku: "MUG-1", quantity: 12, location: "Bergen", reason: "received", note: "Delivery from Oslo Glass" })).toMatchObject({ ok: true, input: { location: "Bergen", reason: "received" } });
  });

  it("set_stock refuses a figure that is not a whole number from 0 to a million, a reason it does not know and a long note", () => {
    expect(read("set_stock", { sku: "A", quantity: -1 }).ok).toBe(false);
    expect(read("set_stock", { sku: "A", quantity: 1.5 }).ok).toBe(false);
    expect(read("set_stock", { sku: "A", quantity: 1_000_001 }).ok).toBe(false);
    expect(read("set_stock", { sku: "A", quantity: 1, reason: "sale" }).ok).toBe(false);
    expect(read("set_stock", { sku: "A", quantity: 1, note: "x".repeat(201) }).ok).toBe(false);
    expect(read("set_stock", { sku: "A", quantity: 1_000_000 }).ok).toBe(true);
  });

  it("set_backorder needs the days with continue, and refuses them with deny", () => {
    expect(read("set_backorder", { sku: "A", policy: "continue", days: 7 })).toEqual({ ok: true, input: { sku: "A", policy: "continue", days: 7 } });
    expect(read("set_backorder", { sku: "A", policy: "deny" })).toEqual({ ok: true, input: { sku: "A", policy: "deny" } });
    const none = read("set_backorder", { sku: "A", policy: "continue" });
    expect(none.ok).toBe(false);
    expect(none.ok ? "" : none.problem).toContain("how many days");
    expect(read("set_backorder", { sku: "A", policy: "deny", days: 7 }).ok).toBe(false);
    expect(read("set_backorder", { sku: "A", policy: "continue", days: 0 }).ok).toBe(false);
    expect(read("set_backorder", { sku: "A", policy: "continue", days: 91 }).ok).toBe(false);
    expect(read("set_backorder", { sku: "A", policy: "continue", days: 90 }).ok).toBe(true);
  });

  it("the reads take a status, a limit and a period within their ranges", () => {
    expect(read("stock_levels", {})).toEqual({ ok: true, input: { status: "all", limit: 20 } });
    expect(read("stock_levels", { status: "backorder", location: "Oslo" }).ok).toBe(true);
    expect(read("stock_levels", { status: "everything" }).ok).toBe(false);
    expect(read("stock_levels", { limit: 51 }).ok).toBe(false);
    expect(read("stock_history", { sku: "A" })).toEqual({ ok: true, input: { sku: "A", days: 90, limit: 20 } });
    expect(read("stock_history", { sku: "A", reason: "damaged", days: 730 }).ok).toBe(true);
    expect(read("stock_history", { sku: "A", days: 731 }).ok).toBe(false);
    expect(read("stock_history", {}).ok).toBe(false);
  });
});

describe("what the owner is asked to approve", () => {
  it("says a figure, where and why, in words made from the arguments", () => {
    expect(approvalSummary("set_stock", { sku: "MUG-1", quantity: 12 })).toBe("Set the stock of MUG-1 to 12.");
    expect(approvalSummary("set_stock", { sku: "MUG-1", quantity: 12, location: "Bergen", reason: "received", note: "Delivery" })).toBe(
      'Set the stock of MUG-1 at Bergen to 12. Reason: Received. Note: "Delivery".',
    );
  });

  it("keeps a note to one line: the owner reads what the model gave, never a hidden line", () => {
    expect(setStockSummary({ sku: "A", quantity: 1, note: "first\nsecond third" })).toBe('Set the stock of A to 1. Note: "first second third".');
  });

  it("says what shoppers will be told when backorders are turned on, with the editor's reminder when the delivery may pass 30 days", () => {
    expect(approvalSummary("set_backorder", { sku: "MUG-1", policy: "continue", days: 7 })).toBe(
      "Keep selling MUG-1 when it is sold out. Shoppers are told, on the product page, in the cart, on the order and in the confirmation email, that it is expected to ship within 7 days.",
    );
    expect(backorderSummary({ sku: "A", policy: "continue", days: 1 })).toContain("within 1 day.");
    // The 30 days run until delivery, so the reminder comes when shipping plus the usual transport can pass them (review).
    expect(backorderSummary({ sku: "A", policy: "continue", days: 23 })).not.toContain(BACKORDER_LONG_HINT);
    expect(backorderSummary({ sku: "A", policy: "continue", days: 24 })).toContain(BACKORDER_LONG_HINT);
    expect(backorderSummary({ sku: "A", policy: "continue", days: 30 })).toContain(BACKORDER_LONG_HINT);
    expect(backorderSummary({ sku: "A", policy: "continue", days: 45 })).toContain(BACKORDER_LONG_HINT);
  });

  it("says that stopping leaves the orders already placed owing their units", () => {
    expect(approvalSummary("set_backorder", { sku: "MUG-1", policy: "deny" })).toBe("Stop selling MUG-1 when it is sold out. Orders already placed still owe the units they were sold on backorder.");
  });
});

describe("which location a figure is for", () => {
  const oslo = { id: "1", name: "Oslo", active: true };
  const bergen = { id: "2", name: "Bergen lager", active: true };
  const old = { id: "3", name: "Gammelt lager", active: false };

  it("is the one active location when none is named", () => {
    expect(pickLocation(undefined, [oslo, old])).toEqual({ ok: true, location: oslo });
    expect(pickLocation("  ", [oslo])).toEqual({ ok: true, location: oslo });
  });

  it("asks which, never guesses, when there are several or none", () => {
    const several = pickLocation(undefined, [oslo, bergen]);
    expect(several.ok).toBe(false);
    expect(!several.ok && several.problem).toBe("The store keeps stock at 2 locations: say which one (Oslo, Bergen lager).");
    expect(pickLocation(undefined, [old])).toEqual({ ok: false, problem: "The store has no active stock location." });
  });

  it("matches a name in any case, or as the start of exactly one name", () => {
    expect(pickLocation("oslo", [oslo, bergen])).toEqual({ ok: true, location: oslo });
    expect(pickLocation("Bergen", [oslo, bergen])).toEqual({ ok: true, location: bergen });
    expect(pickLocation("B", [oslo, bergen, { id: "4", name: "Bodø", active: true }]).ok).toBe(false);
  });

  it("can name an inactive location, since staff may still count what is left there", () => {
    expect(pickLocation("Gammelt lager", [oslo, old])).toEqual({ ok: true, location: old });
  });

  it("says what the store has when the name is wrong, and when two are called the same", () => {
    expect(pickLocation("Tromsø", [oslo, bergen])).toEqual({ ok: false, problem: "The store has no location called Tromsø. Its locations are Oslo, Bergen lager." });
    expect(pickLocation("Oslo", [oslo, { ...oslo, id: "9" }]).ok).toBe(false);
  });
});

describe("the history's range", () => {
  it("counts calendar days back, across months and years", () => {
    expect(dayBefore("2026-10-06", 0)).toBe("2026-10-06");
    expect(dayBefore("2026-10-06", 89)).toBe("2026-07-09");
    expect(dayBefore("2026-01-03", 5)).toBe("2025-12-29");
    expect(dayBefore("2024-03-01", 1)).toBe("2024-02-29");
  });
});

describe("what the model reads", () => {
  const row = (over: Partial<LevelRow> = {}): LevelRow => ({
    title: "Termokopp",
    sku: "DEMO-THERMOS",
    options: {},
    onHand: -3,
    committed: 0,
    available: -3,
    owed: 3,
    stockPolicy: "continue",
    backorderDays: 7,
    lowStockThreshold: null,
    locations: [{ name: "Oslo", active: true, hasLevel: true, onHand: -3, committed: 0, available: -3 }],
    ...over,
  });

  it("names a variant on backorder, with the days and what is owed, and never a stock it was not given", () => {
    expect(shapeLevel(row(), "/admin/s/products/p")).toEqual({
      product: "Termokopp",
      sku: "DEMO-THERMOS",
      options: {},
      on_hand: -3,
      committed_to_checkouts: 0,
      available: -3,
      owed_to_customers: 3,
      when_sold_out: "keeps selling on backorder",
      delivery_days: 7,
      warning_level: null,
      on_backorder_now: true,
      admin: "/admin/s/products/p",
    });
  });

  it("says a variant at or below its own level, and shows locations only when there are several", () => {
    const one = shapeLevel(row({ onHand: 4, available: 4, owed: 0, stockPolicy: "deny", backorderDays: null, lowStockThreshold: 5 }), null);
    expect(one).toMatchObject({ at_or_below_warning_level: true, when_sold_out: "stops selling" });
    expect(one).not.toHaveProperty("per_location");
    expect(one).not.toHaveProperty("delivery_days");
    expect(one).not.toHaveProperty("on_backorder_now");
    const two = shapeLevel(row({ locations: [{ name: "Oslo", active: true, hasLevel: true, onHand: 1, committed: 0, available: 1 }, { name: "Bergen", active: false, hasLevel: true, onHand: 2, committed: 1, available: 1 }] }), null);
    expect(two.per_location).toEqual([
      { location: "Oslo", active: true, on_hand: 1, committed_to_checkouts: 0 },
      { location: "Bergen", active: false, on_hand: 2, committed_to_checkouts: 1 },
    ]);
  });

  it("gives a movement in the words the history page uses", () => {
    expect(shapeMovement({ createdAt: "2026-10-06T10:00:00.000Z", location: "Oslo", delta: -2, onHandAfter: 8, reason: "sale", by: "Order 1042", note: null })).toEqual({
      when: "2026-10-06T10:00:00.000Z",
      location: "Oslo",
      change: -2,
      new_on_hand: 8,
      reason: "Sale",
      by: "Order 1042",
    });
    expect(shapeMovement({ createdAt: "x", location: "Oslo", delta: 5, onHandAfter: 5, reason: "received", by: "Kari", note: "Delivery" })).toMatchObject({ reason: "Received", note: "Delivery" });
  });
});

describe("the skills that use them", () => {
  const ids = new Set(ADMIN_PAGES.map((p) => p.id));
  const skill = (id: string) => ASSISTANT_SKILLS.find((s) => s.id === id)!;
  const toolNames = new Set(OWNER_TOOLS.map((t) => t.name));

  it("names only tools and pages that exist", () => {
    const known = new Set<string>([...toolNames, "open_admin_page", "owed_to_customers"]);
    for (const id of ["restock", "backorders"]) {
      const text = skill(id).steps.join("\n");
      // Every word that is written like a tool of this area is a tool of the catalogue (or one of the two known answers' fields).
      for (const m of text.matchAll(/\b((?:set|stock|restock)_[a-z_]+|open_admin_page|owed_to_customers)\b/g)) expect(known.has(m[1]), `${id}: ${m[1]}`).toBe(true);
      for (const m of text.matchAll(/open_admin_page, ([a-z.]+)/g)) expect(ids.has(m[1]), `${id}: ${m[1]}`).toBe(true);
    }
  });

  it("lets the owner, not the model, choose the delivery time, and says what happens when it is turned off", () => {
    const text = skill("backorders").steps.join("\n");
    expect(text).toMatch(/Never choose it yourself/);
    expect(text).toMatch(/already placed owing their units/);
    expect(skill("restock").steps.join("\n")).toMatch(/not the number received/);
  });
});
