import { describe, expect, it } from "vitest";

import { areaOfAction, explicitAreaOf } from "./audit";
import { EMAIL_KINDS, emailClassOf } from "./personal-data";
import * as limits from "./data-limits";
import {
  EMPTY_COUNTS,
  FINDINGS,
  FINDING_CODES,
  JOB_KINDS,
  JOB_STATUSES,
  STATUS_WORDS,
  canMove,
  finding,
  hasPersonalData,
  isActive,
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
