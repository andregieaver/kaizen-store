import { describe, expect, it } from "vitest";

import { areaOfAction, explicitAreaOf } from "./audit";
import { EMAIL_KINDS, emailClassOf } from "./personal-data";
import * as limits from "./data-limits";
import {
  EMPTY_COUNTS,
  FINDINGS,
  FINDING_CODES,
  EXPORT_KINDS,
  IMPORT_KINDS,
  JOB_KINDS,
  JOB_STATUSES,
  STATUS_WORDS,
  canMove,
  finding,
  hasPersonalData,
  isActive,
  isExport,
  isImport,
  isEnded,
  progressPercent,
  startStatus,
  statusesOf,
  summariseCounts,
  worstOf,
} from "./data-job";

describe("the limits", () => {
  it("are the numbers of the spec, in one place", () => {
    expect(limits).toMatchObject({
      IMPORT_MAX_BYTES: 15_728_640,
      IMPORT_MAX_ROWS: 60_000,
      IMPORT_MAX_PRODUCTS: 5_000,
      DIRECT_EXPORT_MAX_ROWS: 2_000,
      EXPORT_MAX_ROWS: 500_000,
      EXPORT_PART_ROWS: 100_000,
      DATA_EXPORTS_ACTIVE_MAX: 3,
      BULK_MAX_PRODUCTS: 500,
      BULK_GRID_MAX_PRODUCTS: 50,
      BULK_UNDO_DAYS: 7,
      ORDER_SELECTION_MAX: 500,
      DATA_JOB_MAX_ATTEMPTS: 6,
      DATA_JOB_BUDGET_MS: 40_000,
      DATA_JOB_CLAIM_MINUTES: 5,
      EXPORT_KEEP_DAYS: 7,
      IMPORT_FILE_KEEP_DAYS: 30,
      DOWNLOAD_LINK_SECONDS: 60,
    });
    expect(limits).toMatchObject({
      REDIRECTS_MAX: 100_000,
      REDIRECT_IMPORT_MAX_ROWS: 100_000,
      REDIRECT_APPLY_CHUNK: 500,
      REDIRECT_BULK_DELETE_MAX: 200,
      REDIRECT_PAGE_SIZE: 50,
      REDIRECT_HOPS_MAX: 10,
      REDIRECT_EXPORT_DIRECT_MAX: 2_000,
      NOT_FOUND_DAY_CAP: 1_000,
      NOT_FOUND_KEEP_DAYS: 90,
      NOT_FOUND_SCREEN_ROWS: 500,
      NOT_FOUND_CSV_ROWS: 5_000,
      NOT_FOUND_IGNORED_MAX: 1_000,
      NOT_FOUND_THROTTLE_MS: 1_000,
      NOT_FOUND_SUGGESTIONS: 3,
    });
    expect(limits.REDIRECT_EXPORT_DIRECT_MAX).toBe(limits.DIRECT_EXPORT_MAX_ROWS);
    expect(limits.EXPORT_PART_ROWS).toBeLessThanOrEqual(limits.EXPORT_MAX_ROWS);
    expect(limits.DIRECT_EXPORT_MAX_ROWS).toBeLessThan(limits.EXPORT_PART_ROWS);
  });
});

describe("the lifecycle", () => {
  it("moves forward only, with one move back (a checked import checked again)", () => {
    expect(canMove("uploaded", "checking")).toBe(true);
    expect(canMove("checking", "checked")).toBe(true);
    expect(canMove("checked", "queued")).toBe(true);
    expect(canMove("queued", "running")).toBe(true);
    expect(canMove("running", "done")).toBe(true);
    expect(canMove("checked", "checking")).toBe(true);
    // The rest of the moves back are refused.
    for (const [from, to] of [["checked", "uploaded"], ["queued", "checked"], ["running", "queued"], ["done", "running"], ["checking", "uploaded"], ["done", "queued"]] as const) {
      expect([from, to, canMove(from, to)]).toEqual([from, to, false]);
    }
  });

  it("never runs an ended job again: it can only expire", () => {
    for (const from of ["done", "failed", "cancelled", "expired"] as const) {
      for (const to of JOB_STATUSES) {
        const allowed = to === from || (to === "expired" && from !== "expired");
        expect([from, to, canMove(from, to)]).toEqual([from, to, allowed]);
      }
      expect(isEnded(from)).toBe(true);
    }
    expect(isEnded("running")).toBe(false);
  });

  it("lets a job stop or fail from any working state", () => {
    for (const from of ["uploaded", "checking", "checked", "queued", "running"] as const) {
      expect(canMove(from, "failed")).toBe(true);
      expect(canMove(from, "cancelled")).toBe(true);
    }
  });

  it("gives an export no upload or check step, and says which kind starts where", () => {
    expect(statusesOf("order_export")).toEqual(["queued", "running", "done", "failed", "cancelled", "expired"]);
    expect(statusesOf("product_import")).toEqual(JOB_STATUSES);
    expect(startStatus("product_import")).toBe("uploaded");
    for (const kind of ["product_export", "order_export", "customer_export"] as const) expect(startStatus(kind)).toBe("queued");
  });

  it("counts a job as active by its kind: an import from its upload, an export from its queue", () => {
    expect(isActive("product_import", "checked")).toBe(true);
    expect(isActive("order_export", "checked")).toBe(false);
    expect(isActive("order_export", "queued")).toBe(true);
    expect(isActive("product_import", "done")).toBe(false);
  });

  it("holds personal data only in order and customer files", () => {
    expect(JOB_KINDS.filter(hasPersonalData)).toEqual(["order_export", "customer_export"]);
  });

  it("has words for every status", () => {
    for (const s of JOB_STATUSES) expect(STATUS_WORDS[s].length).toBeGreaterThan(3);
  });

  it("shows progress as a whole percent that is 100 only when done", () => {
    expect(progressPercent(0, 10, "running")).toBe(0);
    expect(progressPercent(5, 10, "running")).toBe(50);
    expect(progressPercent(10, 10, "running")).toBe(99);
    expect(progressPercent(10, 10, "done")).toBe(100);
    expect(progressPercent(null, null, "queued")).toBe(0);
    expect(progressPercent(3, 0, "running")).toBe(0);
  });
});

describe("the findings", () => {
  const SPEC_CODES = [
    "file.too_large", "file.too_many_rows", "file.empty", "file.no_header", "file.unknown_format", "file.encoding_assumed", "file.delimiter",
    "price_basis.mismatch", "price_basis.required", "row.handle_missing", "row.handle_invalid", "handle.duplicate_in_file", "handle.mismatch",
    "sku.missing", "sku.duplicate_in_file", "sku.in_other_product", "variant.unknown_id", "options.mismatch", "options.too_many", "price.unreadable",
    "price.market_unknown", "price.negative", "cost.unreadable", "stock.invalid", "gtin.invalid", "hs_code.invalid", "origin.invalid", "measure.invalid",
    "delivery.not_importable", "kind.not_importable", "status.unknown", "status.draft_because_unpublished", "product.drafted", "value.cleared",
    "media.too_many", "media.address_invalid", "media.fetch_failed", "term.created", "field.unknown", "field.ambiguous", "field.invalid",
    "column.ignored", "giftcard.not_supported", "inventory.continue_selling_ignored", "tax.ignored", "compare_at.ignored", "save.failed",
  ];

  it("has every code of the spec (4.4), and each one a sentence", () => {
    for (const code of SPEC_CODES) expect(FINDING_CODES, code).toContain(code);
    for (const code of FINDING_CODES) {
      const f = finding(code, { column: "price:NO", handle: "tee", sku: "TEE-1", n: 3, max: 5, name: "SE", reason: "Give the product a title." });
      expect([code, f.text.length > 12, f.code]).toEqual([code, true, code]);
      expect(["error", "warning", "info"]).toContain(f.severity);
    }
  });

  it("has the severities of the spec", () => {
    const sev = (c: keyof typeof FINDINGS) => FINDINGS[c].severity;
    for (const c of ["file.encoding_assumed", "status.draft_because_unpublished", "product.drafted", "value.cleared", "media.fetch_failed", "inventory.continue_selling_ignored", "tax.ignored"] as const) expect(sev(c)).toBe("warning");
    for (const c of ["file.delimiter", "price.market_unknown", "term.created", "column.ignored", "compare_at.ignored"] as const) expect(sev(c)).toBe("info");
    for (const c of ["price_basis.mismatch", "price_basis.required", "handle.mismatch", "sku.in_other_product", "media.too_many", "giftcard.not_supported", "save.failed"] as const) expect(sev(c)).toBe("error");
    expect(finding("delivery.not_importable").severity).toBe("warning");
    expect(finding("delivery.not_importable", {}, "error").severity).toBe("error");
  });

  it("names a handle, a SKU or a column and never quotes a cell: a sentence is built from names and numbers only", () => {
    const f = finding("sku.in_other_product", { handle: "tee", sku: "TEE-1" });
    expect(f.text).toContain("TEE-1");
    expect(f.text).toContain('"tee"');
    expect(finding("price.unreadable", { column: "price:NO", handle: "tee" })).toMatchObject({ column: "price:NO", severity: "error" });
    expect(finding("file.too_many_rows", { n: 70000, max: 60000 }).text).toBe("The file has 70000 rows and an import takes at most 60000. Split it into smaller files.");
    // A param that could carry a cell is not among the fields a sentence reads.
    const loaded = finding("file.empty", { handle: "=HYPERLINK(1)" } as never);
    expect(loaded.text).not.toContain("HYPERLINK");
  });

  it("says why compare-at prices are never imported", () => {
    expect(finding("compare_at.ignored").text).toMatch(/lowest price of the last 30 days/);
  });

  it("finds the worst severity", () => {
    expect(worstOf([])).toBeNull();
    expect(worstOf([finding("column.ignored"), finding("value.cleared")])).toBe("warning");
    expect(worstOf([finding("column.ignored"), finding("sku.missing"), finding("value.cleared")])).toBe("error");
  });
});

describe("the redirect kinds (wave 2, second run, D168)", () => {
  it("add an import and an export to the four of the first run, and the imports are the kinds that read a file", () => {
    // The first four are the first run's, the redirect pair wave 2's second, the stock pair wave 3's (D172).
    expect(JOB_KINDS).toEqual(["product_import", "product_export", "order_export", "customer_export", "redirect_import", "redirect_export", "inventory_import", "inventory_export"]);
    expect(IMPORT_KINDS).toEqual(["product_import", "redirect_import", "inventory_import"]);
    expect(EXPORT_KINDS).toEqual(["product_export", "order_export", "customer_export", "redirect_export", "inventory_export"]);
    for (const kind of JOB_KINDS) expect(isImport(kind) !== isExport(kind)).toBe(true);
    expect(isImport("redirect_import")).toBe(true);
    expect(isExport("redirect_export")).toBe(true);
    expect(isImport("inventory_import")).toBe(true);
    expect(isExport("inventory_export")).toBe(true);
    // A stock file holds no shopper's data.
    expect(hasPersonalData("inventory_export")).toBe(false);
    expect(statusesOf("inventory_import")).toEqual(JOB_STATUSES);
    expect(statusesOf("inventory_export")).not.toContain("checked");
    expect(startStatus("inventory_import")).toBe("uploaded");
    expect(startStatus("inventory_export")).toBe("queued");
  });

  it("give a redirect import the import steps, a redirect export the export's, and no personal data", () => {
    expect(statusesOf("redirect_import")).toEqual(JOB_STATUSES);
    expect(statusesOf("redirect_export")).not.toContain("checked");
    expect(startStatus("redirect_import")).toBe("uploaded");
    expect(startStatus("redirect_export")).toBe("queued");
    expect(isActive("redirect_import", "checked")).toBe(true);
    expect(isActive("redirect_export", "checked")).toBe(false);
    expect(isActive("redirect_export", "running")).toBe(true);
    expect(hasPersonalData("redirect_import")).toBe(false);
    expect(hasPersonalData("redirect_export")).toBe(false);
  });

  it("have the findings of the spec (4.4), with the severities it gives", () => {
    const codes = [
      "file.not_redirects", "source.missing", "source.invalid", "source.external", "source.market_prefix", "source.reserved", "source.live", "source.root", "source.query_dropped",
      "target.missing", "target.invalid", "target.external", "target.market_removed", "target.self", "target.loop", "target.chain", "target.not_found", "duplicate.in_file",
      "exists.update", "exists.same", "exists.skipped", "exists.replaced_automatic", "limit.reached",
    ] as const;
    for (const code of codes) expect(FINDING_CODES, code).toContain(code);
    const severity: Record<string, string[]> = {
      error: ["file.not_redirects", "source.missing", "source.invalid", "source.external", "source.market_prefix", "source.reserved", "source.live", "source.root", "target.missing", "target.invalid", "target.external", "target.self", "target.loop", "duplicate.in_file", "limit.reached"],
      warning: ["target.chain", "target.not_found"],
      info: ["source.query_dropped", "target.market_removed", "exists.update", "exists.same", "exists.skipped", "exists.replaced_automatic"],
    };
    for (const [level, list] of Object.entries(severity)) for (const code of list) expect([code, FINDINGS[code as keyof typeof FINDINGS].severity]).toEqual([code, level]);
    expect(Object.values(severity).flat().sort()).toEqual([...codes].sort());
  });

  it("name an address in a sentence and never a cell: an address is given in its normal form, and a loop names at most five", () => {
    expect(finding("source.live", { address: "/p/lamp" }).text).toContain('"/p/lamp"');
    expect(finding("target.loop", { address: "/a", addresses: ["/b", "/c"] }).text).toBe('"/a" would close a loop through "/b" and "/c", so the shopper would never arrive.');
    const long = finding("target.chain", { addresses: ["/1", "/2", "/3", "/4", "/5", "/6", "/7"] }).text;
    expect(long).toContain('"/5" and 2 more');
    expect(long).not.toContain('"/6"');
    expect(finding("limit.reached", { max: 100000 }).text).toContain("100000");
    expect(finding("file.not_redirects", { names: ["Redirect from", "Redirect to"] }).text).toContain('"Redirect from" and "Redirect to"');
    const loaded = finding("source.root", { address: "=HYPERLINK(1)" } as never);
    expect(loaded.text).not.toContain("HYPERLINK");
  });
});

describe("the audit areas of the redirects (wave 2, second run, D168)", () => {
  it("are Website's, by three new prefixes", () => {
    const actions = ["redirect.created", "redirect.updated", "redirect.deleted", "redirects.import_started", "redirects.import_applied", "redirects.import_cancelled", "redirects.export_made", "redirects.export_downloaded", "not_found.ignored", "not_found.restored", "not_found.exported"];
    for (const action of actions) expect([action, explicitAreaOf(action), areaOfAction(action)]).toEqual([action, "website", "website"]);
    // The old prefix a redirect might be taken for is still Orders'.
    expect(explicitAreaOf("return.refunded")).toBe("orders");
  });
});

describe("counts", () => {
  it("add up outcomes, warnings, errors, prices, pictures and terms; the dry run's checked outcome is not a count", () => {
    const counts = summariseCounts([
      { outcome: "created", messages: [{ severity: "warning" }], changes: { prices: 2, pictures: 1, terms: 1 } },
      { outcome: "updated", messages: [], changes: { prices: 1 } },
      { outcome: "unchanged", messages: [{ severity: "info" }] },
      { outcome: "failed", messages: [{ severity: "error" }, { severity: "warning" }] },
      { outcome: "checked", messages: [{ severity: "warning" }] },
      { outcome: "drafted", messages: [] },
      { outcome: "skipped", messages: [] },
    ]);
    expect(counts).toEqual({ ...EMPTY_COUNTS, created: 1, updated: 1, unchanged: 1, failed: 1, drafted: 1, skipped: 1, warnings: 3, errors: 1, pricesChanged: 3, picturesFetched: 1, termsCreated: 1 });
    expect(summariseCounts([])).toEqual(EMPTY_COUNTS);
  });
});

describe("the registries this unit uses", () => {
  it("gives every audit action of the unit an area by an existing prefix, so no new prefix is needed", () => {
    const expected: Record<string, string> = {
      "products.import_started": "products",
      "products.import_applied": "products",
      "products.import_cancelled": "products",
      "products.export_made": "products",
      "products.export_downloaded": "products",
      "products.bulk_edited": "products",
      "products.bulk_undone": "products",
      "order.exported": "orders",
      "order.export_downloaded": "orders",
      "customer.exported": "customers",
      "customer.export_downloaded": "customers",
      "analytics.table_exported": "analytics",
    };
    for (const [action, area] of Object.entries(expected)) expect([action, explicitAreaOf(action), areaOfAction(action)]).toEqual([action, area, area]);
  });

  it("classifies the staff email that says a file is ready", () => {
    expect(EMAIL_KINDS["data_job.ready"]).toBe("staff");
    expect(emailClassOf("data_job.ready")).toBe("staff");
  });
});
