import { describe, expect, it } from "vitest";

import { ASSISTANT_SKILLS } from "./assistant-skills";
import { PICK_LIST_MAX } from "./fulfilment-limits";
import { MANAGER_TOOLS, TOOL_WORDS } from "./manager-tools";
import { TOOL_PERMISSIONS } from "./owner-tool-permissions";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";

/**
 * The AI manager and wave 3, run 3 (D174, `docs/wave-3-fulfilment.md` 2.5 and 5.5), the parts that need no database: `pick_list` is in the catalogue, ungated
 * and read-only with `orders:read`, its arguments are bounded by the pick list's own limit, `get_order` says it is read-only for changes, and no tool edits an
 * order, sends part of one or records a change's payment (section 7). The answers themselves are held by `analytics-edits.int.test.ts`.
 */

const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);

describe("pick_list in the owner assistant's catalogue", () => {
  it("is there, ungated, with the orders' read permission and words of its own", () => {
    expect(OWNER_TOOLS_BY_NAME.pick_list).toBeDefined();
    expect(OWNER_TOOLS_BY_NAME.pick_list.gate).toBeUndefined();
    expect(TOOL_PERMISSIONS.pick_list).toBe("orders:read");
    expect(TOOL_WORDS.pick_list).toBe("Making the pick list");
    expect(toolDefinition(OWNER_TOOLS_BY_NAME.pick_list).parameters).toMatchObject({ type: "object" });
  });

  it("takes the orders by number, everything to send when none are named, by product or by order, never more than the pick list's limit", () => {
    expect(read("pick_list", {})).toEqual({ ok: true, input: { by: "product", sort: "sku" } });
    expect(read("pick_list", { orders: ["1042", "1043"], by: "order", sort: "quantity" })).toMatchObject({ ok: true, input: { orders: ["1042", "1043"], by: "order" } });
    expect(read("pick_list", { orders: Array.from({ length: PICK_LIST_MAX }, (_, i) => String(1000 + i)) }).ok).toBe(true);
    expect(read("pick_list", { orders: Array.from({ length: PICK_LIST_MAX + 1 }, (_, i) => String(1000 + i)) }).ok).toBe(false);
    expect(read("pick_list", { orders: [] }).ok).toBe(false);
    expect(read("pick_list", { by: "location" }).ok).toBe(false);
  });

  it("promises no prices, names or addresses and nothing it does not do", () => {
    const text = OWNER_TOOLS_BY_NAME.pick_list.description;
    expect(text).toContain("No prices, names or addresses");
    expect(text).toContain("changes nothing and marks nothing sent");
    expect(text).not.toMatch(/location|bin|picture/i);
  });
});

describe("what the AI manager may not do with orders (D174, section 7)", () => {
  it("has no tool that changes an order's lines, sends part of one or records a change's payment", () => {
    const names = [...OWNER_TOOLS.map((t) => t.name), ...MANAGER_TOOLS.map((t) => t.name)];
    expect(names.filter((n) => /edit_order|order_edit|change_order|order_change|send_part|partial|record.*paid|paid_outside|mark_paid/.test(n))).toEqual([]);
  });

  it("says in get_order and mark_order_sent where those things are done", () => {
    expect(OWNER_TOOLS_BY_NAME.get_order.description).toMatch(/partly sent/);
    expect(OWNER_TOOLS_BY_NAME.get_order.description).toMatch(/done on the order's page/);
    expect(OWNER_TOOLS_BY_NAME.get_order.gate).toBeUndefined();
    expect(OWNER_TOOLS_BY_NAME.mark_order_sent.description).toMatch(/still has to send/);
    expect(OWNER_TOOLS_BY_NAME.mark_order_sent.gate).toBe("send");
  });

  it("teaches sending in parts and the pick list in the order playbooks", () => {
    const steps = (id: string) => ASSISTANT_SKILLS.find((s) => s.id === id)!.steps.join(" ");
    expect(steps("ship-orders")).toContain("pick_list");
    expect(steps("ship-orders")).toContain("partly_sent");
    expect(steps("tidy-orders")).toContain("Send in parts from the order's page");
    expect(steps("tidy-orders")).toContain("you cannot change an order");
  });
});
