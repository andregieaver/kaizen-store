import { describe, expect, it } from "vitest";

import { MANAGER_TOOLS, TOOL_WORDS } from "./manager-tools";
import { BULK_REASON_TEXT } from "./order-bulk";
import { ORDERS_PAGE_SIZE } from "./order-limits";
import { orderListQuery, parseOrderListParams } from "./order-list";
import {
  TOOL_ORDERS_MAX,
  archiveOrdersInput,
  batchAnswer,
  createDraftOrderInput,
  listDraftOrdersInput,
  listOrdersAddress,
  listOrdersInput,
  sendDraftOrderInput,
  sendDraftSummary,
  tagOrdersInput,
} from "./order-ops-tools";
import { TOOL_PERMISSIONS } from "./owner-tool-permissions";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME, approvalSummary, readToolInput, toolDefinition } from "./owner-tools";

/**
 * The AI manager's order tools (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.6 and 5.5), the parts that need no database: the arguments, how a list request becomes the Orders page's
 * own address (one parser for the tool and the page), the gate each tool carries, the words for a batch's answer, and what the catalogue promises (no tool records a payment).
 */

const NEW_TOOLS = ["list_draft_orders", "tag_orders", "archive_orders", "create_draft_order", "send_draft_order"] as const;
const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);

describe("the order tools in the owner assistant's catalogue", () => {
  it("has them all, with a permission each: a read for the lists, a write for the rest", () => {
    for (const name of NEW_TOOLS) expect(OWNER_TOOLS_BY_NAME[name], name).toBeDefined();
    expect(TOOL_PERMISSIONS.list_draft_orders).toBe("orders:read");
    for (const name of ["tag_orders", "archive_orders", "create_draft_order", "send_draft_order"] as const) expect(TOOL_PERMISSIONS[name], name).toBe("orders:write");
  });

  it("gates only what emails a customer and holds stock: a send; tagging, archiving and writing a draft are internal and run freely", () => {
    expect(OWNER_TOOLS_BY_NAME.send_draft_order.gate).toBe("send");
    for (const name of ["list_orders", "list_draft_orders", "tag_orders", "archive_orders", "create_draft_order"]) expect(OWNER_TOOLS_BY_NAME[name].gate, name).toBeUndefined();
    expect(OWNER_TOOLS_BY_NAME.send_draft_order.description).toContain("Needs the owner's approval");
    expect(OWNER_TOOLS_BY_NAME.create_draft_order.description).toContain("nothing is sent");
  });

  it("has NO tool that records a payment, takes money outside Kaizen, deletes a draft or refunds a draft: the catalogue holds no such name", () => {
    const names = OWNER_TOOLS.map((t) => t.name);
    expect(names.filter((n) => /paid_outside|record_payment|mark_(draft_)?paid|delete_draft|manual_payment|manual_refund/.test(n))).toEqual([]);
    // The one refund tool says a payment taken outside Kaizen is not refunded from here.
    expect(OWNER_TOOLS_BY_NAME.refund_order.description).toMatch(/paid outside Kaizen/);
    // No new tool is a manager's or a platform's: the store's MCP server serves them with the other owner tools.
    for (const name of NEW_TOOLS) expect(MANAGER_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
  });

  it("gives every tool words for the progress line and JSON Schema without refs", () => {
    for (const name of [...NEW_TOOLS, "list_orders"]) {
      expect(TOOL_WORDS[name], name).toBeTruthy();
      const definition = toolDefinition(OWNER_TOOLS_BY_NAME[name]);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
  });

  it("says in the descriptions that the figures are the store's own, and that the gift message is not given to the model", () => {
    expect(OWNER_TOOLS_BY_NAME.list_orders.description).toMatch(/Read-only: every figure is the page's own/);
    expect(OWNER_TOOLS_BY_NAME.create_draft_order.description).toMatch(/worked out by the store, never by you/);
    expect(OWNER_TOOLS_BY_NAME.get_order.description).toMatch(/message is the customer's own words to a third party and is not given here/);
    expect(OWNER_TOOLS_BY_NAME.list_orders.description).toMatch(/never named or found by name/);
  });

  it("has a playbook for finding and tagging orders and one for draft orders, and neither promises what is not built", () => {
    const skills = ASSISTANT_SKILLS.filter((s) => s.area === "store");
    const tidy = skills.find((s) => s.id === "tidy-orders")!;
    const draft = skills.find((s) => s.id === "draft-order")!;
    expect(tidy.steps.join(" ")).toContain("tag_orders");
    expect(tidy.steps.join(" ")).toContain("archive_orders");
    expect(tidy.steps.join(" ")).toMatch(/Nothing is deleted/);
    expect(draft.steps.join(" ")).toContain("create_draft_order");
    expect(draft.steps.join(" ")).toContain("send_draft_order");
    expect(draft.steps.join(" ")).toMatch(/you cannot record a payment, ever/);
    expect(new Set(ASSISTANT_SKILLS.map((s) => s.id)).size).toBe(ASSISTANT_SKILLS.length);
  });
});

describe("list_orders", () => {
  it("keeps its old arguments and defaults: all orders, ten of them", () => {
    expect(read("list_orders", {})).toMatchObject({ ok: true, input: { which: "all", limit: 10 } });
    expect(read("list_orders", { which: "to_send", search: "1042" })).toMatchObject({ ok: true, input: { which: "to_send", search: "1042" } });
  });

  it("takes the Orders page's own filters, and nothing that page does not know", () => {
    const ok = read("list_orders", { show: "archived", pay: ["paid", "refunded"], ship: ["to_send"], status: ["paid"], tag: ["VIP"], range: "30d", market: "NO", source: "draft", gift: true, archived: "all", sort: "total_desc", limit: 50 });
    expect(ok).toMatchObject({ ok: true });
    for (const bad of [{ show: "everything" }, { pay: ["half"] }, { sort: "random" }, { limit: ORDERS_PAGE_SIZE + 1 }, { from: "yesterday" }, { source: "wholesale" }, { market: "NOR" }]) {
      expect(read("list_orders", bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("becomes the page's own address: the one parser reads both, and what it makes is stable", () => {
    const input = listOrdersInput.parse({ search: "#1042 mug", pay: ["paid"], tag: ["VIP", "Gift Wrap"], from: "2026-09-01", to: "2026-09-30", market: "NO", source: "draft", gift: true, archived: "yes", sort: "total_asc", after: "abc_DEF-123" });
    const params = parseOrderListParams(listOrdersAddress(input));
    expect(params).toMatchObject({ q: "1042 mug", pay: ["paid"], tag: ["vip", "gift wrap"], from: "2026-09-01", to: "2026-09-30", market: "NO", source: "draft", gift: true, archived: "yes", sort: "total_asc", after: "abc_DEF-123" });
    expect(parseOrderListParams(Object.fromEntries(new URLSearchParams(orderListQuery(params))))).toEqual(params);
  });

  it("says the older `which` as the built-in view, and lets `show` win", () => {
    expect(parseOrderListParams(listOrdersAddress(listOrdersInput.parse({ which: "to_send" }))).show).toBe("to-send");
    expect(parseOrderListParams(listOrdersAddress(listOrdersInput.parse({ which: "unpaid" }))).show).toBe("unpaid");
    expect(parseOrderListParams(listOrdersAddress(listOrdersInput.parse({ which: "to_send", show: "waiting" }))).show).toBe("waiting");
    expect(parseOrderListParams(listOrdersAddress(listOrdersInput.parse({}))).show).toBeNull();
  });

  it("drops a filter that means nothing instead of failing the page's way (an inverted date range is turned round, a junk cursor is the first page)", () => {
    const params = parseOrderListParams(listOrdersAddress(listOrdersInput.parse({ from: "2026-09-30", to: "2026-09-01", after: "not a cursor!" })));
    expect([params.from, params.to]).toEqual(["2026-09-01", "2026-09-30"]);
    expect(params.after).toBeNull();
  });
});

describe("tag_orders and archive_orders", () => {
  it("name up to 25 orders, and tags that are text (the rules of a tag are the page's: tagsOf() judges them)", () => {
    expect(tagOrdersInput.safeParse({ orders: ["1042"], add: ["vip"] }).success).toBe(true);
    expect(tagOrdersInput.safeParse({ orders: Array.from({ length: TOOL_ORDERS_MAX }, (_, i) => String(1000 + i)), add: ["x"] }).success).toBe(true);
    expect(tagOrdersInput.safeParse({ orders: Array.from({ length: TOOL_ORDERS_MAX + 1 }, (_, i) => String(1000 + i)), add: ["x"] }).success).toBe(false);
    expect(tagOrdersInput.safeParse({ orders: [], add: ["x"] }).success).toBe(false);
    expect(tagOrdersInput.safeParse({ orders: ["1042"], add: [""] }).success).toBe(false);
    expect(tagOrdersInput.parse({ orders: ["1042"] })).toMatchObject({ add: [], remove: [] });
    expect(archiveOrdersInput.parse({ orders: ["1042"] })).toMatchObject({ archived: true });
    expect(archiveOrdersInput.parse({ orders: ["1042"], archived: false })).toMatchObject({ archived: false });
  });

  it("answers a batch in plain words: what was done, and each refusal with its reason, never the model's own", () => {
    const answer = batchAnswer("Archived", { requested: 3, applied: 1, refused: [{ number: "1001", reason: "needs_sending" }, { number: null, reason: "not_found" }] });
    expect(answer.done).toBe("Archived 1 of 3 orders.");
    expect(answer.not_done).toEqual([
      { order: "1001", why: BULK_REASON_TEXT.needs_sending },
      { order: "(not found)", why: BULK_REASON_TEXT.not_found },
    ]);
    expect(batchAnswer("Tagged", { requested: 1, applied: 1, refused: [] }).done).toBe("Tagged 1 of 1 order.");
  });
});

describe("the draft order tools", () => {
  it("write a draft from SKUs and quantities, an email, a market and an optional discount; nothing else (no price, no address, no note)", () => {
    const ok = createDraftOrderInput.safeParse({ email: "kari@example.com", lines: [{ sku: "DEMO-MUG-WHITE", quantity: 2 }], market: "no-en", discount_percent: "10", discount_label: "Loyal customer" });
    expect(ok.success).toBe(true);
    expect(Object.keys(createDraftOrderInput.shape).sort()).toEqual(["discount_label", "discount_percent", "email", "lines", "market"]);
    for (const bad of [
      { email: "not an email", lines: [{ sku: "A", quantity: 1 }] },
      { email: "a@b.no", lines: [] },
      { email: "a@b.no", lines: [{ sku: "A", quantity: 0 }] },
      { email: "a@b.no", lines: [{ sku: "A", quantity: 1 }], market: "Norway" },
    ]) expect(createDraftOrderInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("send a draft by its number or id for 1 to 30 days, and the list is of any status", () => {
    expect(sendDraftOrderInput.safeParse({ draft: "D-12" }).success).toBe(true);
    expect(sendDraftOrderInput.safeParse({ draft: "D-12", valid_days: 30 }).success).toBe(true);
    expect(sendDraftOrderInput.safeParse({ draft: "D-12", valid_days: 31 }).success).toBe(false);
    expect(sendDraftOrderInput.safeParse({ draft: "D-12", valid_days: 0 }).success).toBe(false);
    expect(listDraftOrdersInput.parse({})).toMatchObject({ status: "all", limit: 15 });
    for (const status of ["open", "sent", "paid", "expired", "cancelled", "all"]) expect(listDraftOrdersInput.safeParse({ status }).success, status).toBe(true);
    expect(listDraftOrdersInput.safeParse({ status: "deleted" }).success).toBe(false);
  });

  it("keeps a send for the owner's yes with words made from its arguments", () => {
    expect(approvalSummary("send_draft_order", { draft: "D-12" })).toBe(sendDraftSummary("D-12", null));
    expect(approvalSummary("send_draft_order", { draft: "D-12", valid_days: 14 })).toContain("14 days");
    expect(sendDraftSummary("D-12", 1)).toContain("(1 day)");
    expect(sendDraftSummary("D-12")).toMatch(/Email the pay link of draft order D-12/);
    expect(sendDraftSummary("D-12")).toMatch(/goods are held until the link ends/);
  });
});
