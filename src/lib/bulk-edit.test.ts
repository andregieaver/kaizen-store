import { describe, expect, it } from "vitest";

import {
  NEGATIVE_PRICE,
  OMNIBUS_SENTENCE,
  STOCK_SENTENCES,
  applyPercent,
  auditActionOf,
  auditDetails,
  batchCounts,
  canUndo,
  cellValue,
  changePrice,
  matchingNote,
  parseDelta,
  parsePercentBp,
  parseStockChange,
  percentInRange,
  percentProblem,
  planArchive,
  planGrid,
  planPriceChanges,
  planStatus,
  planStockChanges,
  planTerms,
  pricePreview,
  selectionProblem,
  undoPlan,
  type GridRow,
  type RecordedItem,
} from "./bulk-edit";

describe("percentages in basis points", () => {
  it("reads at most two decimals with either mark and an optional sign", () => {
    expect(parsePercentBp("12.5")).toBe(1250);
    expect(parsePercentBp("12,25")).toBe(1225);
    expect(parsePercentBp("-10")).toBe(-1000);
    expect(parsePercentBp("+5")).toBe(500);
    expect(parsePercentBp(" 0,5 ")).toBe(50);
    expect(parsePercentBp("-0.01")).toBe(-1);
    for (const bad of ["", "abc", "1.234", "1e2", "--5", "5%", "1 000", "1000"]) expect([bad, parsePercentBp(bad)]).toEqual([bad, null]);
  });

  it("keeps a change between -90 % and +500 %", () => {
    expect(percentInRange(-9000)).toBe(true);
    expect(percentInRange(-9001)).toBe(false);
    expect(percentInRange(50_000)).toBe(true);
    expect(percentInRange(50_001)).toBe(false);
    expect(percentProblem("-10")).toBeNull();
    expect(percentProblem("-91")).toMatch(/at most -90/);
    expect(percentProblem("501")).toMatch(/at most/);
    expect(percentProblem("x")).toMatch(/Write a percentage/);
  });
});

describe("a percentage change is half up on integer minor units", () => {
  it("rounds .5 up, for a rise and for a fall", () => {
    // 10 % of 12.45 is 1.245: 12.45 -> 13.695 -> 13.70 (half up).
    expect(applyPercent(1245, 1000)).toBe(1370);
    // 10 % off 12.45 is 11.205 -> 11.21.
    expect(applyPercent(1245, -1000)).toBe(1121);
    // x.5 ties: 5 % of 10 (1000) is 50: exact. 5 % of 0.30 (30) is 1.5 -> 31.5 -> 32.
    expect(applyPercent(30, 500)).toBe(32);
    expect(applyPercent(10, 500)).toBe(11);
    expect(applyPercent(10, -500)).toBe(10);
    expect(applyPercent(9, -500)).toBe(9);
    expect(applyPercent(1, 5000)).toBe(2);
    expect(applyPercent(1, 4999)).toBe(1);
  });

  it("is exact where a float would not be, and lowers to 0 at the most", () => {
    expect(applyPercent(1000, 0)).toBe(1000);
    expect(applyPercent(1_000_000_007, 1)).toBe(1_000_100_007);
    expect(applyPercent(100, -9000)).toBe(10);
    expect(applyPercent(0, 500)).toBe(0);
    expect(applyPercent(Number.MAX_SAFE_INTEGER, 0)).toBe(Number.MAX_SAFE_INTEGER);
    // 33.33 % of 3 (minor) : 3 * 1.3333 = 3.9999 -> 4
    expect(applyPercent(3, 3333)).toBe(4);
  });

  it("agrees with a slow exact reference over many amounts and percentages", () => {
    for (const bp of [-9000, -2500, -1000, -333, -1, 1, 250, 1250, 5000, 50000]) {
      for (let a = 0; a < 400; a += 7) {
        const exactTwice = a * (10_000 + bp) * 2 + 10_000;
        expect([a, bp, applyPercent(a, bp)]).toEqual([a, bp, Math.floor(exactTwice / 20_000)]);
      }
    }
  });
});

describe("amounts per market", () => {
  it("parses a signed amount in the market's currency as the editor reads a price", () => {
    expect(parseDelta("5", "NOK")).toBe(500);
    expect(parseDelta("+5,50", "NOK")).toBe(550);
    expect(parseDelta("-20", "SEK")).toBe(-2000);
    expect(parseDelta("-1.249,50", "EUR")).toBe(-124950);
    expect(parseDelta("abc", "NOK")).toBeNull();
    expect(parseDelta("1.234", "NOK")).toBe(123400);
    expect(parseDelta("", "NOK")).toBeNull();
  });

  it("changes a price by an amount of its own market only, and refuses one below 0", () => {
    const change = { kind: "amount", deltaByMarket: { NO: -500, SE: 1000 } } as const;
    expect(changePrice(1249_00, change, "NO")).toEqual({ ok: true, minor: 1244_00 });
    expect(changePrice(300, change, "SE")).toEqual({ ok: true, minor: 1300 });
    expect(changePrice(300, change, "NO")).toEqual({ ok: false, reason: NEGATIVE_PRICE });
    expect(changePrice(500, change, "NO")).toEqual({ ok: true, minor: 0 });
    // A market with no amount asked for is left as it is: never one amount across currencies.
    expect(changePrice(500, change, "DK")).toEqual({ ok: true, minor: 500 });
    expect(changePrice(1000, { kind: "percent", bp: -10_000 }, "NO")).toMatchObject({ ok: true });
  });
});

describe("planning a price change", () => {
  const v = (n: number, prices: Record<string, number | null>) => ({ productId: `p${n}`, variantId: `v${n}`, sku: `S${n}`, prices });
  const variants = [v(1, { NO: 100_00, SE: 90_00 }), v(2, { NO: 5_00 }), v(3, { SE: 40_00 }), v(4, { NO: null }), v(5, { NO: 1245 })];

  it("changes the chosen markets only (the main market by default is the caller's), with before and after, and leaves variants without a price alone", () => {
    const plan = planPriceChanges(variants, { kind: "percent", bp: -1000 }, ["NO"]);
    expect(plan.changes).toEqual([
      { productId: "p1", variantId: "v1", field: "price:NO", before: 10_000, after: 9_000 },
      { productId: "p2", variantId: "v2", field: "price:NO", before: 500, after: 450 },
      { productId: "p5", variantId: "v5", field: "price:NO", before: 1245, after: 1121 },
    ]);
    expect(plan.unchanged).toBe(2);
    expect(plan.failures).toEqual([]);
  });

  it("changes several markets, each in its own currency", () => {
    const plan = planPriceChanges(variants.slice(0, 1), { kind: "amount", deltaByMarket: { NO: 1000, SE: -500 } }, ["NO", "SE"]);
    expect(plan.changes.map((c) => [c.field, c.before, c.after])).toEqual([["price:NO", 10_000, 11_000], ["price:SE", 9_000, 8_500]]);
  });

  it("fails a variant whose result would be below 0, whole (none of its markets changes), and goes on with the rest", () => {
    const plan = planPriceChanges([v(1, { NO: 100_00, SE: 3_00 }), v(2, { NO: 100_00 })], { kind: "amount", deltaByMarket: { NO: -500, SE: -500 } }, ["NO", "SE"]);
    expect(plan.failures).toEqual([{ productId: "p1", variantId: "v1", sku: "S1", reason: NEGATIVE_PRICE }]);
    expect(plan.changes.map((c) => c.productId)).toEqual(["p2"]);
  });

  it("calls a change of 0 unchanged and writes nothing", () => {
    const plan = planPriceChanges(variants, { kind: "percent", bp: 0 }, ["NO", "SE"]);
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(5);
    expect(planPriceChanges([v(9, { NO: 1 })], { kind: "percent", bp: -4999 }, ["NO"]).changes).toEqual([]);
  });

  it("previews the first five figures", () => {
    const many = Array.from({ length: 9 }, (_, i) => v(i, { NO: 1000 + i }));
    const plan = planPriceChanges(many, { kind: "percent", bp: 1000 }, ["NO"]);
    expect(pricePreview(plan.changes)).toHaveLength(5);
    expect(pricePreview(plan.changes, 2)[0]).toEqual({ productId: "p0", variantId: "v0", market: "NO", before: 1000, after: 1100 });
    expect(OMNIBUS_SENTENCE).toBe("Lowering a price shows shoppers a reduction against the lowest price of the last 30 days.");
  });
});

describe("stock", () => {
  const s = (n: number, stock: number, delivery: "physical" | "digital" | "service" = "physical") => ({ productId: `p${n}`, variantId: `v${n}`, sku: `S${n}`, stock, delivery });

  it("reads a number as a set and a signed number as an adjustment", () => {
    expect(parseStockChange("12")).toEqual({ kind: "set", value: 12 });
    expect(parseStockChange("0")).toEqual({ kind: "set", value: 0 });
    expect(parseStockChange("+5")).toEqual({ kind: "adjust", delta: 5 });
    expect(parseStockChange("-3")).toEqual({ kind: "adjust", delta: -3 });
    for (const bad of ["", "1.5", "abc", "1 000", "--1", "12345678"]) expect(parseStockChange(bad)).toBeNull();
  });

  it("sets, adjusts, leaves what is equal, fails below 0 and above a million, and skips a download with the reason", () => {
    const set = planStockChanges([s(1, 5), s(2, 10), s(3, 7, "digital")], { kind: "set", value: 10 });
    expect(set.changes).toEqual([{ productId: "p1", variantId: "v1", field: "stock", before: 5, after: 10 }]);
    expect(set.unchanged).toBe(1);
    expect(set.skipped).toEqual([{ productId: "p3", variantId: "v3", sku: "S3", reason: STOCK_SENTENCES.digital }]);
    const adjust = planStockChanges([s(1, 5), s(2, 2), s(3, 999_999)], { kind: "adjust", delta: -3 });
    expect(adjust.changes.map((c) => c.after)).toEqual([2, 999_996]);
    expect(adjust.failures).toEqual([{ productId: "p2", variantId: "v2", sku: "S2", reason: STOCK_SENTENCES.negative }]);
    const over = planStockChanges([s(1, 999_999)], { kind: "adjust", delta: 5 });
    expect(over.failures[0].reason).toBe(STOCK_SENTENCES.over);
    expect(planStockChanges([s(1, 5)], { kind: "adjust", delta: 0 }).unchanged).toBe(1);
  });
});

describe("status, archive and terms", () => {
  const p = (n: number, status: "draft" | "active", archived = false) => ({ productId: `p${n}`, status, archived });

  it("sets a status, leaving what has it; an archived product asked to be a draft or active is a change from archived", () => {
    const plan = planStatus([p(1, "draft"), p(2, "active"), p(3, "draft", true)], "active");
    expect(plan.changes.map((c) => [c.productId, c.before, c.after])).toEqual([["p1", "draft", "active"], ["p3", "archived", "active"]]);
    expect(plan.unchanged).toBe(1);
  });

  it("archives and unarchives, leaving what already is", () => {
    expect(planArchive([p(1, "active"), p(2, "draft", true)], true).changes.map((c) => c.productId)).toEqual(["p1"]);
    expect(planArchive([p(1, "active"), p(2, "draft", true)], false).changes.map((c) => c.productId)).toEqual(["p2"]);
    expect(planArchive([p(1, "active")], false).unchanged).toBe(1);
  });

  it("adds and removes categories and tags, recording the whole sorted lists, and leaves what is already so", () => {
    const products = [{ productId: "p1", categories: ["b", "a"], tags: [] }, { productId: "p2", categories: ["c"], tags: ["t"] }];
    const add = planTerms(products, "add", { categories: ["c"], tags: ["t"] });
    expect(add.changes).toEqual([{ productId: "p1", variantId: null, field: "terms", before: { categories: ["a", "b"], tags: [] }, after: { categories: ["a", "b", "c"], tags: ["t"] } }]);
    expect(add.unchanged).toBe(1);
    const remove = planTerms(products, "remove", { categories: ["a", "c"], tags: [] });
    expect(remove.changes.map((c) => [c.productId, (c.after as { categories: string[] }).categories])).toEqual([["p1", ["b"]], ["p2", []]]);
    expect(planTerms(products, "remove", { categories: ["zz"], tags: [] }).unchanged).toBe(2);
  });
});

describe("limits", () => {
  it("allow 500 products in a list action and 50 in the grid, and refuse one more with the numbers", () => {
    expect(selectionProblem(500, "list")).toBeNull();
    expect(selectionProblem(501, "list")).toMatch(/501 products.*at most 500/);
    expect(selectionProblem(50, "grid")).toBeNull();
    expect(selectionProblem(51, "grid")).toMatch(/51 products.*at most 50/);
    expect(selectionProblem(0, "list")).toBe("Choose at least one product.");
    expect(matchingNote(500)).toBeNull();
    expect(matchingNote(731)).toMatch(/731 products match.*first 500/);
  });
});

describe("the grid", () => {
  const markets = [{ code: "NO", currency: "NOK" }, { code: "SE", currency: "SEK" }];
  const cells = (over: Partial<{ sku: string; stock: string; cost: string; NO: string; SE: string }> = {}) => ({ sku: over.sku ?? "S1", stock: over.stock ?? "5", cost: over.cost ?? "40,00", prices: { NO: over.NO ?? "100,00", SE: over.SE ?? "90,00" } });
  const row = (edited: ReturnType<typeof cells>, current = cells(), loaded = cells()): GridRow => ({ productId: "p1", variantId: "v1", loaded, current, edited });

  it("looks only at cells that were edited, and records the loaded value and the typed one as figures", () => {
    const plan = planGrid([row(cells({ NO: "120", stock: "9", cost: "", sku: "S1-NEW" }))], markets, "NOK");
    expect(plan.changes).toEqual([
      { productId: "p1", variantId: "v1", field: "sku", before: "S1", after: "S1-NEW" },
      { productId: "p1", variantId: "v1", field: "stock", before: 5, after: 9 },
      { productId: "p1", variantId: "v1", field: "cost", before: 4000, after: null },
      { productId: "p1", variantId: "v1", field: "price:NO", before: 10_000, after: 12_000 },
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.invalid).toEqual([]);
  });

  it("calls an edit that comes to the stored value unchanged (a comma for a point, a trailing zero)", () => {
    const plan = planGrid([row(cells({ NO: "100.00", SE: "90" }))], markets, "NOK");
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(2);
  });

  it("lists an unreadable price, a negative stock, a missing SKU and a bad cost as invalid, with the reason, and changes nothing for them", () => {
    const plan = planGrid([row(cells({ NO: "abc", SE: "-5", stock: "-1", sku: "", cost: "x" }))], markets, "NOK");
    expect(plan.changes).toEqual([]);
    expect(plan.invalid.map((i) => i.field)).toEqual(["sku", "stock", "cost", "price:NO", "price:SE"]);
    expect(plan.invalid.find((i) => i.field === "stock")?.reason).toMatch(/whole number from 0/);
    // No reason quotes what was typed.
    for (const i of plan.invalid) expect(i.reason).not.toMatch(/abc|x"/);
  });

  it("makes a conflict of a cell whose stored value changed since the page loaded, and does not overwrite it", () => {
    const plan = planGrid([row(cells({ NO: "120", stock: "9" }), cells({ NO: "110,00" }))], markets, "NOK");
    expect(plan.conflicts).toEqual([{ productId: "p1", variantId: "v1", field: "price:NO", current: 11_000 }]);
    expect(plan.changes.map((c) => c.field)).toEqual(["stock"]);
  });

  it("clears a price with an empty cell, as the editor does", () => {
    const plan = planGrid([row(cells({ SE: "" }))], markets, "NOK");
    expect(plan.changes).toEqual([{ productId: "p1", variantId: "v1", field: "price:SE", before: 9000, after: null }]);
  });

  it("reads each cell as the editor does", () => {
    expect(cellValue("price:NO", "1 249,50", markets, "NOK")).toBe(124_950);
    expect(cellValue("price:XX", "1", markets, "NOK")).toBeUndefined();
    expect(cellValue("cost", "", markets, "NOK")).toBeNull();
    expect(cellValue("stock", "1000001", markets, "NOK")).toBeUndefined();
    expect(cellValue("sku", "x".repeat(65), markets, "NOK")).toBeUndefined();
  });
});

describe("undo", () => {
  const items: RecordedItem[] = [
    { productId: "p1", variantId: "v1", field: "price:NO", before: 10_000, after: 9_000, outcome: "changed" },
    { productId: "p2", variantId: "v2", field: "price:NO", before: 500, after: 450, outcome: "changed" },
    { productId: "p3", variantId: "v3", field: "price:NO", before: 700, after: 630, outcome: "changed" },
    { productId: "p4", variantId: "v4", field: "price:NO", before: 700, after: 700, outcome: "unchanged" },
    { productId: "p5", variantId: "v5", field: "price:NO", before: 700, after: null, outcome: "failed" },
    { productId: "p6", variantId: null, field: "status", before: "draft", after: "active", outcome: "changed" },
  ];
  const now: Record<string, unknown> = { "p1|v1|price:NO": 9_000, "p2|v2|price:NO": 480, "p6||status": "active" };
  const current = (p: string, v: string | null, f: string) => now[`${p}|${v ?? ""}|${f}`];

  it("puts a cell back only where it is still the batch's after, lists the rest as conflicts, and says what is gone", () => {
    const plan = undoPlan(items, current);
    expect(plan.restores).toEqual([
      { productId: "p1", variantId: "v1", field: "price:NO", before: 9_000, after: 10_000 },
      { productId: "p6", variantId: null, field: "status", before: "active", after: "draft" },
    ]);
    expect(plan.conflicts).toEqual([{ productId: "p2", variantId: "v2", field: "price:NO", current: 480 }]);
    expect(plan.gone).toEqual([{ productId: "p3", variantId: "v3", field: "price:NO" }]);
  });

  it("restores a term list exactly, and never a cell that did not change", () => {
    const terms: RecordedItem = { productId: "p1", variantId: null, field: "terms", before: { categories: ["a"], tags: [] }, after: { categories: ["a", "b"], tags: [] }, outcome: "changed" };
    expect(undoPlan([terms], () => ({ categories: ["a", "b"], tags: [] })).restores).toHaveLength(1);
    expect(undoPlan([terms], () => ({ categories: ["a", "b", "c"], tags: [] })).conflicts).toHaveLength(1);
    expect(undoPlan([{ ...terms, outcome: "undone" }], () => terms.after).restores).toEqual([]);
  });

  it("is open for seven days, once, and never for an undo", () => {
    const made = new Date("2026-10-01T12:00:00Z");
    expect(canUndo({ action: "price", createdAt: made, undoneAt: null }, new Date("2026-10-08T12:00:00Z"))).toBe(true);
    expect(canUndo({ action: "price", createdAt: made, undoneAt: null }, new Date("2026-10-08T12:00:01Z"))).toBe(false);
    expect(canUndo({ action: "price", createdAt: made, undoneAt: new Date() }, made)).toBe(false);
    expect(canUndo({ action: "undo", createdAt: made, undoneAt: null }, made)).toBe(false);
  });
});

describe("counts and the audit entry", () => {
  it("counts products: changed, unchanged and failed, a product failing when any cell of it failed", () => {
    const changes = [{ productId: "p1", variantId: "v1", field: "stock" as const, before: 1, after: 2 }, { productId: "p1", variantId: "v2", field: "stock" as const, before: 1, after: 2 }, { productId: "p2", variantId: null, field: "status" as const, before: "draft", after: "active" }];
    const counts = batchCounts(["p1", "p2", "p3", "p4"], changes, [{ productId: "p2", reason: "x" }, { productId: "p4", reason: "y" }]);
    expect(counts).toEqual({ products: 4, changed: 1, unchanged: 1, failed: 2 });
  });

  it("writes one entry of figures and a batch id, never a title, a SKU or a price, and an undo has its own action", () => {
    const d = auditDetails("price", { products: 25, changed: 20, unchanged: 3, failed: 2 }, "batch-1");
    expect(d).toEqual({ action: "price", products: 25, succeeded: 23, changed: 20, failed: 2, batchId: "batch-1" });
    expect(Object.keys(d).sort()).toEqual(["action", "batchId", "changed", "failed", "products", "succeeded"]);
    expect(auditActionOf("price")).toBe("products.bulk_edited");
    expect(auditActionOf("grid")).toBe("products.bulk_edited");
    expect(auditActionOf("undo")).toBe("products.bulk_undone");
  });
});

describe("a value read back from the record", () => {
  it("is the same whatever order jsonb lists an object's keys in", () => {
    const items = [{ productId: "p1", variantId: null, field: "terms" as const, before: { categories: [], tags: [] }, after: { tags: [], categories: ["c1"] }, outcome: "changed" as const }];
    // The product's terms as the editor lists them: categories first.
    const plan = undoPlan(items, () => ({ categories: ["c1"], tags: [] }));
    expect(plan.restores).toHaveLength(1);
    expect(plan.conflicts).toEqual([]);
  });
});
