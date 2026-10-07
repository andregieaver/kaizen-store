import { describe, expect, it } from "vitest";

import {
  BULK_ACTIONS,
  BULK_ACTION_LABELS,
  BULK_ACTION_PERMISSION,
  BULK_MAX,
  BULK_PRINT_MAX,
  BULK_REASONS,
  BULK_REASON_TEXT,
  BULK_REQUEST_PROBLEMS,
  BULK_REQUEST_TEXT,
  bulkMaxFor,
  bulkSummary,
  checkBulkRequest,
  checkBulkSize,
  dedupeIds,
  groupRefusals,
  isBulkAction,
  markSentBlock,
  notifyText,
  slipSkip,
  type MarkSentFacts,
} from "./order-bulk";

const sendable = (over: Partial<MarkSentFacts> = {}): MarkSentFacts => ({
  status: "paid",
  paid: true,
  physical: true,
  copied: false,
  withdrawnInFull: false,
  backorderUnits: 0,
  deliveryUnpaid: false,
  ...over,
});

describe("the bulk actions", () => {
  it("are tag, untag, archive, unarchive, mark sent and print, each with words and a permission (printing is a read)", () => {
    expect([...BULK_ACTIONS]).toEqual(["add_tags", "remove_tags", "archive", "unarchive", "mark_sent", "print_slips", "print_pick_list"]);
    for (const a of BULK_ACTIONS) {
      expect(BULK_ACTION_LABELS[a].length, a).toBeGreaterThan(3);
      expect(BULK_ACTION_PERMISSION[a], a).toBe(a === "print_slips" || a === "print_pick_list" ? "orders:read" : "orders:write");
    }
    expect(isBulkAction("archive")).toBe(true);
    expect(isBulkAction("cancel")).toBe(false);
    expect(isBulkAction(undefined)).toBe(false);
  });

  it("name at most 250 orders, and 100 to print", () => {
    expect([BULK_MAX, BULK_PRINT_MAX]).toEqual([250, 100]);
    expect(bulkMaxFor("archive")).toBe(250);
    expect(bulkMaxFor("print_slips")).toBe(100);
  });

  it("has words for every reason and every request problem", () => {
    for (const r of BULK_REASONS) expect(BULK_REASON_TEXT[r].length, r).toBeGreaterThan(5);
    for (const p of BULK_REQUEST_PROBLEMS) expect(BULK_REQUEST_TEXT[p].length, p).toBeGreaterThan(5);
  });
});

describe("what a request names", () => {
  it("collapses duplicates, keeping the first of each in order, and ignores what is not an id", () => {
    expect(dedupeIds(["a", "b", "a", "", "c", "b"])).toEqual(["a", "b", "c"]);
    expect(dedupeIds([null as unknown as string, 5 as unknown as string, "x"])).toEqual(["x"]);
  });

  it("refuses none, and more than the action allows, before anything runs", () => {
    expect(checkBulkSize("archive", 0)).toBe("empty");
    expect(checkBulkSize("archive", 1)).toBeNull();
    expect(checkBulkSize("archive", 250)).toBeNull();
    expect(checkBulkSize("archive", 251)).toBe("too_many");
    expect(checkBulkSize("print_slips", 100)).toBeNull();
    expect(checkBulkSize("print_slips", 101)).toBe("too_many");
  });

  it("checks the part of a request that needs no database: a known action, ids that are not too many, tags for a tag action", () => {
    const ids = Array.from({ length: 251 }, (_, i) => `id${i}`);
    expect(checkBulkRequest({ action: "nope" })).toBe("unknown_action");
    expect(checkBulkRequest({ action: "archive", ids: [] })).toBe("empty");
    expect(checkBulkRequest({ action: "archive", ids })).toBe("too_many");
    // 251 ids that are one id repeated are one order.
    expect(checkBulkRequest({ action: "archive", ids: Array.from({ length: 251 }, () => "same") })).toBeNull();
    expect(checkBulkRequest({ action: "add_tags", ids: ["a"] })).toBe("no_tags");
    expect(checkBulkRequest({ action: "add_tags", ids: ["a"], tags: [] })).toBe("no_tags");
    expect(checkBulkRequest({ action: "add_tags", ids: ["a"], tags: ["vip"], invalidTags: 1 })).toBe("invalid_tag");
    expect(checkBulkRequest({ action: "remove_tags", ids: ["a"], tags: Array.from({ length: 51 }, (_, i) => `t${i}`) })).toBe("too_many_tags");
    expect(checkBulkRequest({ action: "add_tags", ids: ["a"], tags: ["vip"] })).toBeNull();
    // A matching selection has no ids to count here: the server counts what the query returns.
    expect(checkBulkRequest({ action: "archive" })).toBeNull();
  });
});

describe("what a bulk action says back", () => {
  it("writes how many it applied to", () => {
    expect(bulkSummary({ requested: 43, applied: 41 })).toBe("Applied to 41 of 43 orders");
    expect(bulkSummary({ requested: 1, applied: 1 })).toBe("Applied to 1 of 1 order");
  });

  it("groups the refusals by reason so one sentence covers many orders", () => {
    const groups = groupRefusals([
      { id: "1", number: "1001", reason: "unpaid" },
      { id: "2", number: "1002", reason: "copied" },
      { id: "3", number: "1003", reason: "unpaid" },
    ]);
    expect(groups.map((g) => [g.reason, g.orders.map((o) => o.number)])).toEqual([["unpaid", ["1001", "1003"]], ["copied", ["1002"]]]);
    expect(groups[0].text).toBe(BULK_REASON_TEXT.unpaid);
  });

  it("says how many customers will get an email", () => {
    expect(notifyText(37)).toBe("37 customers will get an email");
    expect(notifyText(1)).toBe("1 customer will get an email");
    expect(notifyText(0)).toBe("0 customers will get an email");
  });
});

describe("marking orders as sent in bulk: the pure pre-check", () => {
  it("sends a paid order with something to ship", () => {
    expect(markSentBlock(sendable())).toBeNull();
  });

  it("names each refusal", () => {
    expect(markSentBlock(sendable({ copied: true }))).toBe("copied");
    expect(markSentBlock(sendable({ status: "fulfilled" }))).toBe("already_sent");
    expect(markSentBlock(sendable({ status: "pending_payment", paid: false }))).toBe("unpaid");
    expect(markSentBlock(sendable({ status: "cancelled", paid: false }))).toBe("unpaid");
    expect(markSentBlock(sendable({ status: "cancelled", paid: true }))).toBe("nothing_to_send");
    expect(markSentBlock(sendable({ status: "closed" }))).toBe("nothing_to_send");
    expect(markSentBlock(sendable({ physical: false }))).toBe("nothing_to_send");
    expect(markSentBlock(sendable({ withdrawnInFull: true }))).toBe("withdrawn_in_full");
    expect(markSentBlock(sendable({ backorderUnits: 2 }))).toBe("waiting_for_stock");
    expect(markSentBlock(sendable({ deliveryUnpaid: true }))).toBe("delivery_unpaid");
  });

  it("names the first that holds: copied before everything, already sent before nothing to send", () => {
    expect(markSentBlock(sendable({ copied: true, status: "fulfilled", physical: false }))).toBe("copied");
    expect(markSentBlock(sendable({ status: "fulfilled", physical: false }))).toBe("already_sent");
    expect(markSentBlock(sendable({ withdrawnInFull: true, backorderUnits: 1, deliveryUnpaid: true }))).toBe("withdrawn_in_full");
  });

  it("skips copied history and orders with nothing physical when printing slips", () => {
    expect(slipSkip({ copied: false, physical: true })).toBeNull();
    expect(slipSkip({ copied: true, physical: true })).toBe("copied");
    expect(slipSkip({ copied: false, physical: false })).toBe("nothing_to_ship");
    expect(slipSkip({ copied: true, physical: false })).toBe("copied");
  });

  it("prints what is still to send (D174): a sent order is skipped as already sent, one withdrawn before sending as withdrawn", () => {
    expect(slipSkip({ copied: false, physical: true, state: "unsent" })).toBeNull();
    expect(slipSkip({ copied: false, physical: true, state: "partly_sent" })).toBeNull();
    expect(slipSkip({ copied: false, physical: true, state: "sent" })).toBe("already_sent");
    expect(slipSkip({ copied: false, physical: true, state: "withdrawn" })).toBe("withdrawn_in_full");
    expect(slipSkip({ copied: false, physical: true, state: "closed" })).toBe("nothing_to_send");
    expect(slipSkip({ copied: false, physical: true, state: "none" })).toBe("nothing_to_ship");
    expect(slipSkip({ copied: true, physical: true, state: "sent" })).toBe("copied");
  });

  it("refuses an order whose change waits for payment (D174), after the withdrawal and before the backorder", () => {
    expect(markSentBlock(sendable({ editPending: true }))).toBe("edit_pending");
    expect(markSentBlock(sendable({ editPending: true, backorderUnits: 2 }))).toBe("edit_pending");
    expect(markSentBlock(sendable({ editPending: true, withdrawnInFull: true }))).toBe("withdrawn_in_full");
  });
});
