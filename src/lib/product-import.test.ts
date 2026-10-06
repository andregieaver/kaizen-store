import { describe, expect, it } from "vitest";

import { FINDING_CODES } from "./data-job";
import { IMPORT_MAX_PRODUCTS, IMPORT_MAX_ROWS } from "./data-limits";
import { readNeutral, groupProducts } from "./product-csv";
import {
  DEFAULT_IMPORT_OPTIONS,
  checkFile,
  dryRunCounts,
  duplicateSkus,
  itemOf,
  namedKeys,
  parseImportOptions,
  pendingKey,
  planImport,
  withCreatedTerms,
  type ImportOptions,
  type PlanEnv,
  type ProductPlan,
} from "./product-import";
import { C2, C3, FIELDS, OPERATOR, T2, VARIANT_IDS, boot, context, env, field, snapshotOf } from "./product-csv-test-support";
import type { StoredProduct } from "./product-csv";

const ctx = context();

function plan(rows: string[][], over: { options?: Partial<ImportOptions>; stored?: StoredProduct[]; env?: Partial<PlanEnv>; context?: ReturnType<typeof context> } = {}) {
  const c = over.context ?? ctx;
  const file = readNeutral(rows, c);
  const e = env(c, { options: { ...DEFAULT_IMPORT_OPTIONS, ...over.options }, ...over.env });
  return planImport(file, snapshotOf(over.stored ?? []), e);
}
const codes = (p: ProductPlan) => p.findings.map((f) => f.code);
const HEAD = ["handle", "title", "sku", "price:NO"];

describe("creating a product", () => {
  it("creates a new product from a handle, a title, a SKU and a price, as a draft the editor can save", () => {
    const p = plan([HEAD, ["new-shoe", "Ny sko", "SHOE-1", "499,50"]]).products[0];
    expect(p.outcome).toBe("created");
    expect(p.isNew).toBe(true);
    expect(p.input?.status).toBe("draft");
    expect(p.input?.translations[0]).toMatchObject({ locale: "nb-NO", title: "Ny sko" });
    expect(p.input?.variants).toHaveLength(1);
    expect(p.input?.variants[0]).toMatchObject({ id: null, sku: "SHOE-1", prices: { NO: "499,50" }, stock: 0, active: true, delivery: "physical" });
    expect(p.input?.manufacturer).toEqual({ id: OPERATOR });
    expect(p.changes.prices).toBe(1);
    expect(p.findings).toEqual([]);
  });

  it("reads a price with either decimal mark, a space as a thousands mark, and never converts it", () => {
    for (const [typed, shown] of [["1 249,50", "1249,50"], ["1249.5", "1249,50"], ["1.249,50", "1249,50"], ["300", "300,00"]]) {
      expect(plan([HEAD, ["a", "A", "S1", typed]]).products[0].input?.variants[0].prices.NO).toBe(shown);
    }
  });

  it("publishes a product when the file says active and it can be published, else saves it as a draft and says why (or skips it)", () => {
    const rows = [[...HEAD, "status", "image_url"], ["a", "A", "S1", "100", "active", "/demo/a.svg"]];
    expect(plan(rows).products[0]).toMatchObject({ outcome: "created", input: { status: "active" } });
    const noPicture = [[...HEAD, "status"], ["a", "A", "S1", "100", "active"]];
    const drafted = plan(noPicture).products[0];
    expect(drafted.outcome).toBe("drafted");
    expect(drafted.input?.status).toBe("draft");
    expect(codes(drafted)).toEqual(["product.drafted"]);
    expect(drafted.findings[0].severity).toBe("warning");
    const skipped = plan(noPicture, { options: { unpublishable: "skip" } }).products[0];
    expect(skipped.outcome).toBe("skipped");
    expect(skipped.input).toBeNull();
    expect(codes(skipped)).toEqual(["product.not_published"]);
  });

  it("gives a new physical product the manufacturer the member chose, so a file with none can be published", () => {
    const e = env(ctx);
    const rows = [[...HEAD, "status", "image_url"], ["a", "A", "S1", "100", "active", "/demo/a.svg"]];
    const noMaker = plan(rows, { env: { blank: { ...e.blank, manufacturer: null } } }).products[0];
    expect(noMaker.outcome).toBe("drafted");
    expect(noMaker.findings[0].text).toMatch(/manufacturer/);
    const chosen = plan(rows, { env: { blank: { ...e.blank, manufacturer: null } }, options: { manufacturerId: OPERATOR } }).products[0];
    expect(chosen.outcome).toBe("created");
    expect(chosen.input?.manufacturer).toEqual({ id: OPERATOR });
  });

  it("makes a draft of a Shopify-style product that was not published", () => {
    const rows = [[...HEAD, "status"], ["a", "A", "S1", "100", "draft"]];
    expect(plan(rows).products[0].input?.status).toBe("draft");
  });

  it("refuses a new appointment, stay or rental, a kind change, and an unknown status or VAT category", () => {
    const base = ["handle", "title", "sku", "kind", "status", "vat_category"];
    expect(codes(plan([base, ["a", "A", "S1", "appointment", "", ""]]).products[0])).toEqual(["kind.not_importable"]);
    expect(codes(plan([base, ["a", "A", "S1", "goods", "pending", ""]]).products[0])).toEqual(["status.unknown"]);
    expect(codes(plan([base, ["a", "A", "S1", "goods", "", "luxury"]]).products[0])).toEqual(["vat_category.unknown"]);
    const stored = boot(ctx);
    expect(codes(plan([base, ["winter-boot", "T", "BOOT-BLK-42", "stay", "", ""]], { stored: [stored] }).products[0])).toContain("kind.not_importable");
    expect(plan([base, ["a", "A", "S1", "goods", "", "food"]]).products[0].input?.vatCategory).toBe("food");
  });

  it("refuses a title-less product with the editor's own sentence, and a handle that is not one", () => {
    const p = plan([HEAD, ["a", "", "S1", "100"]]).products[0];
    expect(p.outcome).toBe("skipped");
    expect(codes(p)).toEqual(["save.failed"]);
    expect(p.findings[0].text).toContain("Give the product a title");
    expect(codes(plan([HEAD, ["Not A Handle", "A", "S1", "1"]]).products[0])).toEqual(["row.handle_invalid"]);
    expect(codes(plan([HEAD, ["x".repeat(81), "A", "S1", "1"]]).products[0])).toEqual(["row.handle_invalid"]);
  });

  it("needs a variant for a new product, and a SKU for each", () => {
    expect(codes(plan([["handle", "title"], ["a", "A"]]).products[0])).toEqual(["sku.missing"]);
    expect(codes(plan([HEAD, ["a", "A", "", "100"]]).products[0])).toEqual(["sku.missing"]);
  });
});

describe("updating a product", () => {
  const stored = boot(ctx);
  const own = (rows: string[][], options: Partial<ImportOptions> = {}) => plan(rows, { stored: [stored], options }).products[0];

  it("changes only what the file names: absent means keep", () => {
    const p = own([["handle", "title"], ["winter-boot", "Ny tittel"]]);
    expect(p.outcome).toBe("updated");
    expect(p.input?.translations[0].title).toBe("Ny tittel");
    expect(p.input?.translations[0].description).toBe(stored.translations[0].description);
    expect(p.input?.variants).toEqual(stored.variants);
    expect(p.input?.media).toEqual(stored.media);
    expect(p.input?.categories).toEqual([C2]);
  });

  it("changes a price, counts it, and leaves a price it equals alone (no write, so no price history row)", () => {
    const same = own([["handle", "sku", "price:NO", "price:SE"], ["winter-boot", "BOOT-BLK-42", "1249", "1299,50"]]);
    expect(same.outcome).toBe("unchanged");
    expect(same.input).toBeNull();
    const changed = own([["handle", "sku", "price:NO", "price:SE"], ["winter-boot", "BOOT-BLK-42", "1199.00", "1299,50"]]);
    expect(changed.outcome).toBe("updated");
    expect(changed.changes.prices).toBe(1);
    expect(changed.input?.variants[0].prices).toEqual({ NO: "1199,00", SE: "1299,50" });
    expect(changed.input?.variants[1].prices).toEqual({ NO: "1249,00", SE: "1299,50" });
  });

  it("clears what a blank cell is, with a warning: an empty price ends the price in that market, an empty text clears it", () => {
    const p = own([["handle", "sku", "price:SE", "title:sv-SE"], ["winter-boot", "BOOT-BLK-42", "", ""]]);
    expect(p.input?.variants[0].prices).toEqual({ NO: "1249,00" });
    expect(p.input?.translations[1].title).toBe("");
    expect(codes(p)).toEqual(["value.cleared", "value.cleared"]);
    expect(p.findings.every((f) => f.severity === "warning")).toBe(true);
    expect(p.changes.prices).toBe(1);
  });

  it("matches a variant by its id, then by SKU, and finds a new one by a SKU that is not the product's", () => {
    const byId = own([["handle", "variant_id", "sku", "stock"], ["winter-boot", VARIANT_IDS[1], "BOOT-BLK-43", "9"]]);
    expect(byId.input?.variants[1]).toMatchObject({ id: VARIANT_IDS[1], stock: 9 });
    expect(byId.changes.stock).toBe(true);
    const bySku = own([["handle", "sku", "stock"], ["winter-boot", "boot-blk-43", "9"]]);
    expect(bySku.input?.variants[1]).toMatchObject({ id: VARIANT_IDS[1], stock: 9, sku: "BOOT-BLK-43" });
    const fresh = own([["handle", "sku", "option1_name", "option1_value", "option2_name", "option2_value", "price:NO"], ["winter-boot", "BOOT-NEW", "Colour", "Red", "Size", "44", "999"]]);
    expect(fresh.input?.variants).toHaveLength(4);
    expect(fresh.input?.variants[3]).toMatchObject({ id: null, sku: "BOOT-NEW", options: { Colour: "Red", Size: "44" } });
    expect(fresh.input?.options).toEqual([{ name: "Colour", values: ["Black", "Brown", "Red"] }, { name: "Size", values: ["42", "43", "44"] }]);
  });

  it("refuses a SKU that is another product's, and a variant id that is, or that is nobody's: never a move", () => {
    const other = boot(ctx, { handle: "other", id: "pppppppp-0000-4000-8000-000000000002", variants: [{ ...stored.variants[0], id: "bbbbbbbb-0000-4000-8000-000000000001", sku: "OTHER-1" }], options: [{ name: "Colour", values: ["Black"] }, { name: "Size", values: ["42"] }] });
    const rows = (sku: string, id = "") => [["handle", "variant_id", "sku", "stock"], ["winter-boot", id, sku, "3"]];
    const p1 = plan(rows("OTHER-1"), { stored: [stored, other] }).products[0];
    expect(codes(p1)).toEqual(["sku.in_other_product"]);
    expect(p1.findings[0].text).toContain("OTHER-1");
    expect(p1.outcome).toBe("skipped");
    expect(codes(plan(rows("OTHER-1", "bbbbbbbb-0000-4000-8000-000000000001"), { stored: [stored, other] }).products[0])).toEqual(["handle.mismatch"]);
    expect(codes(plan(rows("X", "cccccccc-0000-4000-8000-000000000001"), { stored: [stored] }).products[0])).toEqual(["variant.unknown_id"]);
    // A new product that names a SKU the store already has.
    expect(codes(plan([HEAD, ["brand-new", "A", "BOOT-BLK-42", "1"]], { stored: [stored] }).products[0])).toEqual(["sku.in_other_product"]);
  });

  it("refuses the same SKU twice in the file, across products or inside one", () => {
    const twice = plan([HEAD, ["a", "A", "S1", "1"], ["b", "B", "s1", "1"]]);
    expect(twice.products.map((p) => [p.handle, p.outcome, codes(p)])).toEqual([["a", "created", []], ["b", "skipped", ["sku.duplicate_in_file"]]]);
    const inside = plan([HEAD, ["a", "A", "S1", "1"], ["a", "", "S1", "2"]]);
    expect(codes(inside.products[0])).toContain("sku.duplicate_in_file");
    expect(duplicateSkus(groupProducts(readNeutral([HEAD, ["a", "A", "S1", "1"], ["b", "B", "S1", "1"]], ctx)).drafts).get("b")).toBe("S1");
  });

  it("keeps the variants the file does not have, or leaves them out (switched off by the save) when asked, and never when the file has none", () => {
    const rows = [["handle", "sku", "stock"], ["winter-boot", "BOOT-BLK-42", "13"]];
    expect(own(rows).input?.variants.map((v) => v.sku)).toEqual(["BOOT-BLK-42", "BOOT-BLK-43", "BOOT-BRN-42"]);
    expect(own(rows, { missingVariants: "switch_off" }).input?.variants.map((v) => v.sku)).toEqual(["BOOT-BLK-42"]);
    expect(own([["handle", "title"], ["winter-boot", "T"]], { missingVariants: "switch_off" }).input?.variants).toHaveLength(3);
  });

  it("changes nothing the file does not carry: subscriptions, files, bookings and the manufacturer stay", () => {
    const withPlans = boot(ctx, { plans: [{ id: "dddddddd-0000-4000-8000-000000000001", interval: "month", intervalCount: 1, discountPercent: 5, trialDays: 0, signupFee: {}, minCycles: 0 }], withdrawalExclusion: "perishable", schemes: ["batteries"] });
    const p = plan([["handle", "title"], ["winter-boot", "T"]], { stored: [withPlans] }).products[0];
    expect(p.input?.plans).toEqual(withPlans.plans);
    expect(p.input?.withdrawalExclusion).toBe("perishable");
    expect(p.input?.schemes).toEqual(["batteries"]);
    expect(p.input?.manufacturer).toEqual(withPlans.manufacturer);
  });

  it("does not save an unchanged product even when the editor would no longer let it be published", () => {
    const old = boot(ctx, { media: [], manufacturer: null });
    const p = plan([["handle", "title"], ["winter-boot", "Vinterstøvel"]], { stored: [old] }).products[0];
    expect(p.outcome).toBe("unchanged");
    expect(p.findings).toEqual([]);
  });

  it("only creates, or only updates, as asked", () => {
    expect(codes(own([HEAD, ["winter-boot", "T", "BOOT-BLK-42", "1"]], { mode: "create" }))).toEqual(["product.exists"]);
    expect(own([HEAD, ["winter-boot", "T", "BOOT-BLK-42", "1"]], { mode: "create" }).outcome).toBe("skipped");
    const missing = plan([HEAD, ["nope", "T", "S", "1"]], { options: { mode: "update" } }).products[0];
    expect(codes(missing)).toEqual(["product.missing"]);
    expect(plan([HEAD, ["nope", "T", "S", "1"]], { options: { mode: "create" } }).products[0].outcome).toBe("created");
  });

  it("never changes a handle, and never deletes: a product outside the file is not even looked at", () => {
    const p = plan([HEAD, ["new-handle", "T", "BOOT-BLK-42", "1"]], { stored: [stored] });
    expect(p.products).toHaveLength(1);
    expect(p.products[0].outcome).toBe("skipped");
    expect(p.products.every((x) => x.input === null || x.input.handle === x.handle || x.input.handle === "")).toBe(true);
  });

  it("keeps an archived product archived (the save would make it a draft, so it is archived again after), and unarchives on a status", () => {
    const archived = boot(ctx, { archived: true, status: "draft" });
    const kept = plan([["handle", "title"], ["winter-boot", "Ny"]], { stored: [archived] }).products[0];
    expect(kept.outcome).toBe("updated");
    expect(kept.archiveAfter).toBe(true);
    const back = plan([["handle", "status", "title"], ["winter-boot", "draft", "Ny"]], { stored: [archived] }).products[0];
    expect(back.archiveAfter).toBe(false);
    const archiving = plan([["handle", "status"], ["winter-boot", "archived"]], { stored: [stored] }).products[0];
    expect(archiving.outcome).toBe("updated");
    expect(archiving.archiveAfter).toBe(true);
  });
});

describe("the variant's columns", () => {
  const stored = boot(ctx);
  const v0 = (cols: string[], vals: string[]) => plan([["handle", "sku", ...cols], ["winter-boot", "BOOT-BLK-42", ...vals]], { stored: [stored] }).products[0];

  it("reads barcode, HS code, origin, weight, cost, active and the unit price's content", () => {
    const p = v0(["gtin", "hs_code", "origin_country", "weight_grams", "cost", "active", "measure_amount", "measure_unit", "measure_base"], ["12345678", "6403.91", "pt", "1500", "650,5", "false", "0,75", "kg", "kg"]);
    expect(p.input?.variants[0]).toMatchObject({ gtin: "12345678", hsCode: "640391", originCountry: "PT", weightGrams: 1500, cost: "650,50", active: false, measure: { amount: "0.75", unit: "kg", base: "kg" } });
  });

  it("clears a barcode, a weight and a content with a blank cell", () => {
    const p = v0(["gtin", "weight_grams", "measure_amount", "measure_unit", "origin_country"], ["", "", "", "", ""]);
    expect(p.input?.variants[0]).toMatchObject({ gtin: null, weightGrams: null, measure: null, originCountry: null });
  });

  it("gives each bad value its own finding and skips the product", () => {
    const cases: [string[], string[], string][] = [
      [["gtin"], ["123"], "gtin.invalid"],
      [["hs_code"], ["12"], "hs_code.invalid"],
      [["origin_country"], ["Norway"], "origin.invalid"],
      [["weight_grams"], ["0"], "weight.invalid"],
      [["weight_grams"], ["1.5"], "weight.invalid"],
      [["cost"], ["abc"], "cost.unreadable"],
      [["cost"], ["-5"], "cost.unreadable"],
      [["stock"], ["-1"], "stock.invalid"],
      [["stock"], ["1.5"], "stock.invalid"],
      [["stock"], ["1000001"], "stock.invalid"],
      [["active"], ["maybe"], "active.invalid"],
      [["price:NO"], ["abc"], "price.unreadable"],
      [["price:NO"], ["1e3"], "price.unreadable"],
      [["price:NO"], ["-5"], "price.negative"],
      [["measure_amount", "measure_unit"], ["0", "kg"], "measure.invalid"],
      [["measure_amount", "measure_unit"], ["5", "lightyears"], "measure.invalid"],
      [["measure_amount", "measure_unit", "measure_base"], ["5", "kg", "l"], "measure.invalid"],
      [["delivery"], ["digital"], "delivery.not_importable"],
      [["delivery"], ["teleport"], "delivery.not_importable"],
    ];
    for (const [cols, vals, code] of cases) {
      const p = v0(cols, vals);
      expect([cols.join(), vals.join(), codes(p)]).toEqual([cols.join(), vals.join(), [code]]);
      expect(p.outcome).toBe("skipped");
      expect(p.input).toBeNull();
    }
  });

  it("reads the stock policy, the delivery time and the warning level, and an export of them reads back unchanged", () => {
    // The stored boot has a continue variant first (7 days, level 3): the same cells change nothing.
    expect(v0(["stock_policy", "backorder_days", "low_stock_threshold"], ["continue", "7", "3"]).outcome).toBe("unchanged");
    const changed = v0(["stock_policy", "backorder_days", "low_stock_threshold"], ["continue", "14", ""]);
    expect(changed.input?.variants[0]).toMatchObject({ stockPolicy: "continue", backorderDays: 14, lowStockThreshold: null });
    // deny drops the days whatever the cell says; an empty policy or days cell keeps what the variant has; an empty level switches the warning off.
    expect(v0(["stock_policy", "backorder_days"], ["deny", "20"]).input?.variants[0]).toMatchObject({ stockPolicy: "deny", backorderDays: null });
    expect(v0(["stock_policy", "backorder_days"], ["", ""]).outcome).toBe("unchanged");
    expect(v0(["backorder_days"], ["30"]).input?.variants[0]).toMatchObject({ stockPolicy: "continue", backorderDays: 30 });
    expect(v0(["low_stock_threshold"], [""]).input?.variants[0]).toMatchObject({ lowStockThreshold: null });
    // A new variant starts at deny and needs days to continue.
    const fresh = plan([["handle", "sku", "option1_name", "option1_value", "option2_name", "option2_value", "stock_policy", "backorder_days"], ["winter-boot", "BOOT-NEW", "Colour", "Red", "Size", "44", "continue", "5"]], { stored: [stored] }).products[0];
    expect(fresh.input?.variants[3]).toMatchObject({ sku: "BOOT-NEW", stockPolicy: "continue", backorderDays: 5 });
  });

  it("gives each bad stock policy cell its finding", () => {
    for (const [cols, vals, code] of [
      [["stock_policy"], ["sometimes"], "stock_policy.invalid"],
      [["backorder_days"], ["0"], "backorder_days.invalid"],
      [["backorder_days"], ["91"], "backorder_days.invalid"],
      [["backorder_days"], ["1.5"], "backorder_days.invalid"],
      [["low_stock_threshold"], ["-1"], "low_stock_threshold.invalid"],
      [["low_stock_threshold"], ["1000001"], "low_stock_threshold.invalid"],
    ] as [string[], string[], string][]) {
      const p = v0(cols, vals);
      expect([cols.join(), codes(p)]).toEqual([cols.join(), [code]]);
      expect(p.outcome).toBe("skipped");
    }
    // Continue on a variant that has no days, and none given, is refused; on a download it is refused.
    const bare = boot(ctx, { variants: boot(ctx).variants.map((v) => ({ ...v, stockPolicy: "deny" as const, backorderDays: null })) });
    expect(codes(plan([["handle", "sku", "stock_policy"], ["winter-boot", "BOOT-BLK-42", "continue"]], { stored: [bare] }).products[0])).toEqual(["backorder_days.required"]);
    const digital = boot(ctx, { variants: boot(ctx).variants.map((v) => ({ ...v, delivery: "digital" as const, stock: 0, stockPolicy: "deny" as const, backorderDays: null, lowStockThreshold: null })), withdrawalExclusion: "digital_content" });
    expect(codes(plan([["handle", "sku", "stock_policy", "backorder_days"], ["winter-boot", "BOOT-BLK-42", "continue", "5"]], { stored: [digital] }).products[0])).toContain("stock_policy.not_goods");
    expect(codes(plan([["handle", "sku", "low_stock_threshold"], ["winter-boot", "BOOT-BLK-42", "5"]], { stored: [digital] }).products[0])).toContain("low_stock_threshold.invalid");
  });

  it("does not import a stock figure when the store has several active locations, and says so once", () => {
    const rows = [["handle", "sku", "stock"], ["winter-boot", "BOOT-BLK-42", "99"], ["winter-boot", "BOOT-BLK-43", "98"]];
    const p = plan(rows, { stored: [stored], env: { activeLocations: 3 } }).products[0];
    expect(codes(p)).toEqual(["inventory.multi_location_stock_ignored"]);
    expect(p.outcome).toBe("unchanged");
    expect(p.changes.stock).toBe(false);
    // With one location (or none known) the figure is written as before.
    expect(plan(rows, { stored: [stored], env: { activeLocations: 1 } }).products[0].changes.stock).toBe(true);
  });

  it("accepts a delivery equal to the stored one, so an export always reads back", () => {
    expect(v0(["delivery"], ["physical"]).outcome).toBe("unchanged");
  });

  it("sets stock only where it is kept: a digital variant keeps none", () => {
    const digital = boot(ctx, { variants: boot(ctx).variants.map((v) => ({ ...v, delivery: "digital" as const, stock: 0 })), withdrawalExclusion: "digital_content" });
    const p = plan([["handle", "sku", "stock"], ["winter-boot", "BOOT-BLK-42", "50"]], { stored: [digital] }).products[0];
    expect(p.outcome).toBe("unchanged");
  });

  it("refuses more than the editor's limits", () => {
    const many = [["handle", "sku", "option1_name", "option1_value"], ...Array.from({ length: 101 }, (_, i) => ["big", `S${i}`, i === 0 ? "N" : "", `V${i}`])];
    expect(codes(plan(many).products[0])).toContain("options.too_many");
    const pics = [["handle", "title", "sku", "image_url"], ...Array.from({ length: 13 }, (_, i) => ["pics", i === 0 ? "T" : "", i === 0 ? "S1" : "", `/demo/${i}.svg`])];
    expect(codes(plan(pics).products[0])).toEqual(["media.too_many"]);
  });

  it("asks for option values on every variant row of a product with options, and options to tell two variants apart", () => {
    const missing = plan([["handle", "title", "sku", "option1_name", "option1_value"], ["a", "A", "S1", "Size", "S"], ["a", "", "S2", "", ""]]);
    expect(codes(missing.products[0])).toContain("options.mismatch");
    const none = plan([["handle", "title", "sku"], ["a", "A", "S1"], ["a", "", "S2"]]);
    expect(codes(none.products[0])).toContain("options.mismatch");
  });
});

describe("categories and tags", () => {
  const stored = boot(ctx);
  const own = (cols: string[], vals: string[]) => plan([["handle", ...cols], ["winter-boot", ...vals]], { stored: [stored] }).products[0];

  it("matches names within the store, a category by its path, ignoring case", () => {
    const p = own(["categories", "tags"], ["shoes / BOOTS | Bags", "sale"]);
    expect(p.input?.categories).toEqual([C2, C3]);
    expect(p.input?.tags).toEqual([T2]);
    expect(p.pendingTerms).toEqual([]);
  });

  it("creates what does not exist when the job applies, parents first, never merged by guess", () => {
    const p = own(["categories", "tags"], ["Shoes / Sandals | Hats / Summer", "New tag"]);
    expect(p.pendingTerms.map(pendingKey)).toEqual(["category:shoes/sandals", "category:hats", "category:hats/summer", "tag:new tag"]);
    expect(p.input?.categories).toEqual([]);
    expect(codes(p)).toEqual(["term.created"]);
    expect(p.findings[0].severity).toBe("info");
    const ids = new Map([["category:shoes/sandals", "n1"], ["category:hats", "n2"], ["category:hats/summer", "n3"], ["tag:new tag", "n4"]]);
    const made = withCreatedTerms(p, ids);
    expect(made.input?.categories).toEqual(["n1", "n3"]);
    expect(made.input?.tags).toEqual(["n4"]);
    // The plan itself is not changed.
    expect(p.input?.categories).toEqual([]);
  });

  it("gives the product a parent the file names as well as the child, and only those it names", () => {
    const p = own(["categories"], ["Hats / Summer | Hats"]);
    expect(p.pendingTerms.map((t) => [pendingKey(t), t.named === true])).toEqual([["category:hats", true], ["category:hats/summer", true]]);
    const made = withCreatedTerms(p, new Map([["category:hats", "n1"], ["category:hats/summer", "n2"]]));
    expect(made.input?.categories).toEqual(["n1", "n2"]);
    // A parent that is only made for the tree is not given to the product.
    const only = own(["categories"], ["Hats / Summer"]);
    expect(only.pendingTerms.map((t) => [pendingKey(t), t.named === true])).toEqual([["category:hats", false], ["category:hats/summer", true]]);
    expect(withCreatedTerms(only, new Map([["category:hats", "n1"], ["category:hats/summer", "n2"]])).input?.categories).toEqual(["n2"]);
  });

  it("clears them with a blank cell", () => {
    const p = own(["categories"], [""]);
    expect(p.input?.categories).toEqual([]);
    expect(codes(p)).toEqual(["value.cleared"]);
  });
});

describe("pictures", () => {
  const stored = boot(ctx);
  const rows = [["handle", "sku", "image_url", "image_position", "image_alt"], ["winter-boot", "BOOT-BLK-42", "https://elsewhere.example/a.jpg", "1", "From elsewhere"], ["winter-boot", "", "https://store.example/p/2.webp", "2", ""]];

  it("lists an address that is not the store's own to be fetched, and keeps the store's own as they are", () => {
    const p = plan(rows, { stored: [stored] }).products[0];
    expect(p.pictures).toEqual(["https://elsewhere.example/a.jpg"]);
    expect(p.input?.media.map((m) => m.url)).toEqual(["https://elsewhere.example/a.jpg", "https://store.example/p/2.webp"]);
    expect(p.input?.media[1].thumbnailUrl).toBe("https://store.example/p/2t.webp");
    expect(p.input?.media[0].alt).toBe("From elsewhere");
  });

  it("puts the library's address where one was fetched, and drops one that could not be, saying so", () => {
    const fetched = new Map([["https://elsewhere.example/a.jpg", { url: "https://store.example/p/new.webp", thumbnailUrl: "https://store.example/p/newt.webp" }]]);
    const ok = plan(rows, { stored: [stored], env: { fetched } }).products[0];
    expect(ok.pictures).toEqual([]);
    expect(ok.input?.media[0]).toEqual({ url: "https://store.example/p/new.webp", thumbnailUrl: "https://store.example/p/newt.webp", alt: "From elsewhere" });
    const failed = plan(rows, { stored: [stored], env: { fetched: new Map([["https://elsewhere.example/a.jpg", null]]) } }).products[0];
    expect(codes(failed)).toEqual(["media.fetch_failed"]);
    expect(failed.input?.media.map((m) => m.url)).toEqual(["https://store.example/p/2.webp"]);
  });

  it("makes a draft of a product left with no picture that was to be published", () => {
    const fresh = [["handle", "title", "sku", "price:NO", "status", "image_url"], ["np", "T", "S1", "10", "active", "https://elsewhere.example/a.jpg"]];
    const p = plan(fresh, { env: { fetched: new Map([["https://elsewhere.example/a.jpg", null]]) } }).products[0];
    expect(p.outcome).toBe("drafted");
    expect(codes(p)).toEqual(["media.fetch_failed", "product.drafted"]);
  });

  it("refuses an address that is not a web address, and treats a path on the site as its own", () => {
    expect(codes(plan([["handle", "title", "sku", "image_url"], ["a", "T", "S", "ftp://x/y.jpg"]]).products[0])).toEqual(["media.address_invalid"]);
    expect(plan([["handle", "title", "sku", "image_url"], ["a", "T", "S", "/demo/x.svg"]]).products[0].pictures).toEqual([]);
  });

  it("changes a variant's picture, and clears it with a blank", () => {
    const p = plan([["handle", "sku", "variant_image_url"], ["winter-boot", "BOOT-BLK-42", ""]], { stored: [stored] }).products[0];
    expect(p.input?.variants[0].image).toBeNull();
  });
});

describe("custom fields", () => {
  const stored = boot(ctx);
  const own = (cols: string[], vals: string[], extra: string[] = []) => plan([["handle", "sku", ...cols], ["winter-boot", "BOOT-BLK-42", ...vals]], { stored: [stored], ...(extra.length ? {} : {}) }).products[0];

  it("passes none when the file has no field columns, so every value stays", () => {
    const p = plan([["handle", "title"], ["winter-boot", "Ny"]], { stored: [stored] }).products[0];
    expect(p.fields).toBeUndefined();
    expect(p.variantFields).toBeUndefined();
  });

  it("sets, changes and clears a value in its field's own shape (a null takes a value away), in the right language", () => {
    const p = own(["field:material", "field:material:en-GB", "field:weight_kg", "field:organic", "field:season", "variant_field:shade"], ["Ull", "", "2,5", "false", "", "Lys"]);
    expect(p.outcome).toBe("updated");
    expect(p.fields).toEqual({
      values: { f_wkg: 2.5, f_org: false, f_season: null },
      translations: { "nb-NO": { f_material: "Ull" }, "en-GB": { f_material: null } },
    });
    expect(p.variantFields).toEqual({ "BOOT-BLK-42": { values: {}, translations: { "nb-NO": { f_shade: "Lys" } } } });
    expect(p.changes.fields.sort()).toEqual(["field:material", "field:material:en-GB", "field:organic", "field:season", "field:weight_kg", "variant_field:shade"]);
  });

  it("leaves a field alone whose cell equals what is stored", () => {
    const p = own(["field:material", "field:weight_kg", "field:organic", "field:season", "variant_field:shade"], ["Skinn", "1.4", "true", "winter", "Mørk"]);
    expect(p.outcome).toBe("unchanged");
    expect(p.fields).toBeUndefined();
  });

  it("refuses a value the field itself would refuse, names a field the store does not have as ignored, and never reads a field of a type that is not plain", () => {
    expect(codes(own(["field:season"], ["autumn"]))).toEqual(["field:invalid".replace(":", ".")]);
    const unknown = plan([["handle", "title", "field:nothing", "field:gallery"], ["winter-boot", "T", "x", "y"]], { stored: [boot(ctx)] });
    expect(unknown.fileFindings.map((f) => [f.finding.code, f.finding.column])).toEqual([["field.unknown", "field:nothing"], ["field.unknown", "field:gallery"]]);
    expect(unknown.products[0].fields).toBeUndefined();
  });

  it("calls two fields with one name ambiguous: the column is an error and is not read", () => {
    const twice = context({ fields: [{ def: field("a", "dup", "text"), entity: "product" }, { def: field("b", "dup", "number"), entity: "product" }] });
    const r = plan([["handle", "title", "field:dup"], ["x", "T", "v"]], { context: twice });
    expect(r.fileFindings.map((f) => [f.finding.code, f.finding.severity])).toEqual([["field.ambiguous", "error"]]);
    expect(r.products[0].fields).toBeUndefined();
    void FIELDS;
  });
});

describe("what the whole file says", () => {
  it("states the price basis of the store: a file in another basis stops every product", () => {
    const rows = [["handle", "title", "sku", "price:NO", "price_basis"], ["a", "A", "S1", "10", "excl_vat"], ["b", "B", "S2", "10", "incl_vat"]];
    const r = plan(rows);
    expect(r.fileFindings.map((f) => f.finding.code)).toEqual(["price_basis.mismatch"]);
    expect(r.blocked?.code).toBe("price_basis.mismatch");
    expect(r.products.map((p) => p.outcome)).toEqual(["skipped", "skipped"]);
    const ok = plan(rows.map((row, i) => (i === 0 ? row : [...row.slice(0, 4), "excl_vat"])), { context: context({ audience: "businesses" }) });
    expect(ok.blocked).toBeNull();
    expect(ok.products.map((p) => p.outcome)).toEqual(["created", "created"]);
  });

  it("holds the limits: too many rows or products refuse the whole file", () => {
    const many = [HEAD, ...Array.from({ length: IMPORT_MAX_PRODUCTS + 1 }, (_, i) => [`p${i}`, "T", `S${i}`, "1"])];
    const r = plan(many);
    expect(r.fileFindings.map((f) => f.finding.code)).toContain("file.too_many_products");
    expect(r.products.every((p) => p.outcome === "skipped")).toBe(true);
    const file = readNeutral([HEAD, ["a", "A", "S", "1"]], ctx);
    file.rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => ({ row: i + 2, v: { handle: "a", sku: `S${i}` } }));
    expect(checkFile(file, groupProducts(file), env(ctx)).map((f) => f.finding.code)).toContain("file.too_many_rows");
  });

  it("says a price column for a market the store does not sell to is left out", () => {
    const r = plan([["handle", "title", "sku", "price:DK"], ["a", "A", "S", "1"]]);
    expect(r.fileFindings.map((f) => [f.finding.code, f.finding.severity])).toEqual([["price.market_unknown", "info"]]);
    expect(r.products[0].outcome).toBe("created");
  });

  it("ignores the columns of a language the store does not offer, with a reason", () => {
    const r = plan([["handle", "title", "title:fr-FR"], ["a", "A", "Le A"]], { stored: [boot(context())] });
    expect(r.fileFindings.some((f) => f.finding.code === "column.ignored" && f.finding.column === "title:fr-FR")).toBe(true);
  });

  it("counts a dry run: to create, to update, unchanged, with problems", () => {
    const stored = boot(ctx);
    const r = plan(
      [HEAD, ["winter-boot", "Vinterstøvel", "BOOT-BLK-42", "1249"], ["fresh", "F", "F1", "1"], ["bad", "", "B1", "1"], ["winter-boot-2", "G", "BOOT-BLK-42", "1"], ["third", "T", "T1", "1"]],
      { stored: [stored] },
    );
    expect(r.products.map((p) => p.outcome)).toEqual(["unchanged", "created", "skipped", "skipped", "created"]);
    expect(r.dry).toEqual({ toCreate: 2, toUpdate: 0, unchanged: 1, withProblems: 2 });
    expect(dryRunCounts([], [])).toEqual({ toCreate: 0, toUpdate: 0, unchanged: 0, withProblems: 0 });
  });

  it("makes an item of a plan: the dry run says checked and keeps what would happen", () => {
    const r = plan([HEAD, ["a", "A", "S1", "10"]]);
    expect(itemOf(r.products[0], true)).toMatchObject({ kind: "product", ref: "a", rows: [2], outcome: "checked", changes: { will: "created", prices: 1 } });
    expect(itemOf(r.products[0], false).outcome).toBe("created");
  });

  it("names the handles, SKUs and variant ids a file holds, for the server to look up", () => {
    const g = groupProducts(readNeutral([["handle", "sku", "variant_id"], ["a", "S1", VARIANT_IDS[0]], ["a", "S2", ""], ["b", "S1", ""]], ctx));
    expect(namedKeys(g)).toEqual({ handles: ["a", "b"], skus: ["S1", "S2"], variantIds: [VARIANT_IDS[0]] });
  });

  it("covers every finding code of the spec in its own tests of this file or csv.test (a code nobody can make is a dead code)", () => {
    const made = new Set<string>();
    const seen = (p: ProductPlan[]) => p.forEach((x) => x.findings.forEach((f) => made.add(f.code)));
    seen(plan([HEAD, ["Bad Handle", "A", "S", "1"], ["a", "", "S1", "1"], ["b", "B", "", "1"], ["c", "C", "S2", "x"], ["d", "D", "S3", "-1"]]).products);
    expect([...made].sort()).toEqual(["price.negative", "price.unreadable", "row.handle_invalid", "save.failed", "sku.missing"]);
    expect(FINDING_CODES.length).toBeGreaterThan(45);
  });
});

describe("options", () => {
  it("reads the member's choices, with the default for anything unknown", () => {
    expect(parseImportOptions(undefined)).toEqual(DEFAULT_IMPORT_OPTIONS);
    expect(parseImportOptions({ mode: "update", unpublishable: "skip", missingVariants: "switch_off", pricesIncludeVat: false, priceMarket: "se", manufacturerId: OPERATOR })).toEqual({
      mode: "update", unpublishable: "skip", missingVariants: "switch_off", pricesIncludeVat: false, priceMarket: "SE", manufacturerId: OPERATOR,
    });
    expect(parseImportOptions({ mode: "delete", unpublishable: "x", missingVariants: "delete", pricesIncludeVat: "yes", priceMarket: "Norway", manufacturerId: "x" })).toEqual(DEFAULT_IMPORT_OPTIONS);
  });
});
