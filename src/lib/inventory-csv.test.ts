import { describe, expect, it } from "vitest";

import { parseCsv, recordsOf } from "./csv";
import { FINDING_CODES, FINDINGS, finding } from "./data-job";
import { FIX_FOR } from "./data-job-help";
import {
  DEFAULT_FILE_REASON,
  EXPORT_COLUMNS,
  IMPORT_COLUMNS,
  INVENTORY_FINDING_CODES,
  checkHeader,
  decideRow,
  dryRunRow,
  duplicateFlags,
  headerKey,
  matchLocation,
  parseInventoryRow,
  readHeader,
  rowKey,
  tooManyRows,
  writeInventoryCsv,
  type ExportRow,
  type LocationRef,
} from "./inventory-csv";

const locations: LocationRef[] = [
  { id: "loc-oslo", name: "Oslo", active: true },
  { id: "loc-bergen", name: "Bergen", active: true },
  { id: "loc-old", name: "Old shed", active: false },
];
const one: LocationRef[] = [{ id: "loc-main", name: "Main warehouse", active: true }];

const header = ["sku", "location", "on_hand", "on_hand_was", "reason", "note", "stock_policy", "backorder_days", "low_stock_threshold"];
const index = readHeader(header);
const parse = (cells: string[], where = locations) => parseInventoryRow(cells, index, where);
const codes = (result: ReturnType<typeof parse>) => result.findings.map((f) => f.code);

describe("the codes and the columns", () => {
  it("has a finding for every code, in the findings of data jobs, with a sentence and what to do", () => {
    for (const code of INVENTORY_FINDING_CODES) {
      expect(FINDING_CODES, code).toContain(code);
      expect(FIX_FOR[code].length, code).toBeGreaterThan(10);
      const f = finding(code, { sku: "TEE-1", n: 3, max: 200, was: 5, now: 3, reason: "a reason" });
      expect(f.text.length).toBeGreaterThan(15);
    }
  });

  it("keeps the export's columns and the import's apart, with the required two", () => {
    expect(EXPORT_COLUMNS).toEqual(["sku", "product", "options", "location", "on_hand", "committed", "available", "stock_policy", "backorder_days", "low_stock_threshold"]);
    expect(IMPORT_COLUMNS).toEqual(["sku", "location", "on_hand", "on_hand_was", "reason", "note", "stock_policy", "backorder_days", "low_stock_threshold"]);
  });

  it("makes a finding that names a SKU or a column and never quotes anything else", () => {
    for (const code of INVENTORY_FINDING_CODES) {
      const rule = FINDINGS[code];
      // A param that could carry a cell is not among the fields a sentence reads.
      const text = rule.sentence({ sku: "SKU-1", handle: "=HYPERLINK(1)", address: "=cmd|calc", reason: undefined } as never);
      expect(text, code).not.toContain("HYPERLINK");
      expect(text, code).not.toContain("cmd|calc");
    }
    expect(finding("stockfile.conflict", { sku: "TEE-1", was: 8, now: 5 }).text).toBe(
      'The stock of SKU "TEE-1" is 5 now, not 8 as in the file, so the row was skipped. Export again and count again.',
    );
    expect(finding("stockfile.days_required", { sku: "TEE-1" }).text).toContain("1 to 90");
  });
});

describe("the header", () => {
  it("reads names as names: case, spaces, hyphens and a byte order mark do not matter, and an alias is the column", () => {
    expect(headerKey("﻿ On Hand ")).toBe("on_hand");
    expect(headerKey("Low-stock threshold")).toBe("low_stock_threshold");
    const read = readHeader(["﻿SKU", "Product", "Location Name", "On hand", "Reason", "Variant SKU"]);
    expect(read).toMatchObject({ sku: 0, location: 2, on_hand: 3, reason: 4, note: -1, on_hand_was: -1 });
  });

  it("needs sku and on_hand, and says so with the names", () => {
    expect(checkHeader(readHeader(["sku", "on_hand"]))).toBeNull();
    const finding1 = checkHeader(readHeader(["sku", "count"]));
    expect(finding1).toMatchObject({ code: "file.not_inventory", severity: "error" });
    expect(finding1?.text).toContain('"sku" and "on_hand"');
    expect(checkHeader(readHeader(["product", "options"]))?.code).toBe("file.not_inventory");
  });

  it("refuses a file of more than 20,000 rows", () => {
    expect(tooManyRows(20_000)).toBeNull();
    expect(tooManyRows(20_001)).toMatchObject({ code: "file.too_many_rows", severity: "error" });
    expect(tooManyRows(20_001)?.text).toContain("20000");
  });

  it("takes an export as an import: the same file is read back unchanged", () => {
    const rows: ExportRow[] = [
      { sku: "A-1", product: "Mug", options: "white", location: "Oslo", onHand: 10, committed: 2, available: 8, stockPolicy: "continue", backorderDays: 7, lowStockThreshold: 3 },
      { sku: "A-2", product: "Mug", options: "black", location: "Bergen", onHand: -3, committed: 0, available: -3, stockPolicy: "deny", backorderDays: null, lowStockThreshold: null },
    ];
    const csv = writeInventoryCsv(rows);
    const { header: head, records } = recordsOf(parseCsv(csv).rows);
    expect(head).toEqual([...EXPORT_COLUMNS]);
    const idx = readHeader(head);
    expect(checkHeader(idx)).toBeNull();
    const cells = parseCsv(csv).rows.slice(1);
    // A positive count reads back as it was; a negative one (owed) is not a count and is refused with the sentence, never rewritten.
    const first = parseInventoryRow(cells[0], idx, locations);
    expect(first.row).toMatchObject({ sku: "A-1", locationId: "loc-oslo", onHand: 10, stockPolicy: "continue", backorderDays: 7, lowStockThreshold: 3, reason: DEFAULT_FILE_REASON });
    expect(records).toHaveLength(2);
    expect(parseInventoryRow(cells[1], idx, locations).findings.map((f) => f.code)).toEqual(["stockfile.on_hand_invalid"]);
  });
});

describe("a row of an import", () => {
  it("reads a count, the figure it was made from, a reason, a note and the policy columns", () => {
    const result = parse(["MUG-1", "Oslo", "12", "10", "Received", "pallet 4", "continue", "7", "3"]);
    expect(result.findings).toEqual([]);
    expect(result.row).toEqual({
      sku: "MUG-1",
      locationId: "loc-oslo",
      onHand: 12,
      onHandWas: 10,
      reason: "received",
      note: "pallet 4",
      stockPolicy: "continue",
      backorderDays: 7,
      lowStockThreshold: 3,
    });
  });

  it("is a count with no reason, and leaves the policy and the level alone when the file does not say", () => {
    const result = parse(["MUG-1", "Oslo", "12", "", "", "", "", "", ""]);
    expect(result.row).toEqual({ sku: "MUG-1", locationId: "loc-oslo", onHand: 12, onHandWas: null, reason: "count", note: null, stockPolicy: null, backorderDays: null, lowStockThreshold: null });
  });

  it("matches a location by name in any case, an active one before an inactive one of the same name, and an inactive one to count it", () => {
    expect(matchLocation("  oslo ", locations)).toEqual({ ok: true, location: locations[0] });
    expect(matchLocation("Old shed", locations)).toEqual({ ok: true, location: locations[2] });
    const twins: LocationRef[] = [{ id: "x", name: "Same", active: false }, { id: "y", name: "same", active: true }];
    expect(matchLocation("SAME", twins)).toEqual({ ok: true, location: twins[1] });
    expect(matchLocation("Trondheim", locations)).toEqual({ ok: false, reason: "unknown" });
  });

  it("lets the location be empty only when the store has exactly one active location", () => {
    expect(parse(["A", "", "5", "", "", "", "", "", ""], one).row?.locationId).toBe("loc-main");
    expect(codes(parse(["A", "", "5", "", "", "", "", "", ""], locations))).toEqual(["stockfile.location_required"]);
    expect(codes(parse(["A", "", "5", "", "", "", "", "", ""], [...one, { id: "off", name: "Off", active: false }]))).toEqual([]);
    expect(codes(parse(["A", "Narnia", "5", "", "", "", "", "", ""]))).toEqual(["stockfile.location_unknown"]);
  });

  it("finds every problem of a row, by code, and never quotes a cell", () => {
    const bad = parse(["=EVIL()", "Oslo", "12.5", "x", "theft", "x".repeat(201), "sometimes", "100", "-4"]);
    expect(bad.row).toBeNull();
    expect(codes(bad)).toEqual([
      "stockfile.on_hand_invalid",
      "stockfile.on_hand_was_invalid",
      "stockfile.reason_invalid",
      "stockfile.note_too_long",
      "stockfile.policy_invalid",
      "stockfile.days_invalid",
      "stockfile.threshold_invalid",
    ]);
    for (const f of bad.findings) {
      expect(f.text).not.toContain("12.5");
      expect(f.text).not.toContain("theft");
      expect(f.text).not.toContain("sometimes");
    }
    // The SKU is named, because a finding is about a SKU; a formula in it is not run: findings are text.
    expect(bad.findings[0].text).toContain("=EVIL()");
  });

  it("refuses a missing SKU, a missing or negative or too large count, and a count that is not a whole number", () => {
    expect(codes(parse(["", "Oslo", "5", "", "", "", "", "", ""]))).toEqual(["stockfile.sku_missing"]);
    for (const bad of ["", "-1", "1000001", "5.5", "5,5", "abc", "1e3"]) expect(codes(parse(["A", "Oslo", bad, "", "", "", "", "", ""])), bad).toEqual(["stockfile.on_hand_invalid"]);
    for (const good of ["0", "1000000", "007"]) expect(parse(["A", "Oslo", good, "", "", "", "", "", ""]).row, good).not.toBeNull();
  });

  it("needs days with continue (1 to 90), and ignores days without it with a warning", () => {
    expect(codes(parse(["A", "Oslo", "5", "", "", "", "continue", "", ""]))).toEqual(["stockfile.days_required"]);
    expect(codes(parse(["A", "Oslo", "5", "", "", "", "continue", "0", ""]))).toEqual(["stockfile.days_invalid"]);
    expect(codes(parse(["A", "Oslo", "5", "", "", "", "continue", "91", ""]))).toEqual(["stockfile.days_invalid"]);
    expect(parse(["A", "Oslo", "5", "", "", "", "continue", "90", ""]).row).toMatchObject({ stockPolicy: "continue", backorderDays: 90 });
    const ignored = parse(["A", "Oslo", "5", "", "", "", "deny", "7", ""]);
    expect(ignored.row).toMatchObject({ stockPolicy: "deny", backorderDays: null });
    expect(ignored.findings.map((f) => [f.code, f.severity])).toEqual([["stockfile.days_ignored", "warning"]]);
    expect(parse(["A", "Oslo", "5", "", "", "", "", "7", ""]).findings.map((f) => f.code)).toEqual(["stockfile.days_ignored"]);
  });

  it("reads a threshold from 0 to 1,000,000", () => {
    expect(parse(["A", "Oslo", "5", "", "", "", "", "", "0"]).row?.lowStockThreshold).toBe(0);
    expect(parse(["A", "Oslo", "5", "", "", "", "", "", "1000000"]).row?.lowStockThreshold).toBe(1_000_000);
    expect(codes(parse(["A", "Oslo", "5", "", "", "", "", "", "1000001"]))).toEqual(["stockfile.threshold_invalid"]);
  });

  it("reads the cells of a file the way a file is read: an escaped formula character is unescaped", () => {
    // `writeCsv()` escapes a text cell that starts with a formula character with a leading quote; the reader undoes exactly that.
    const result = parse(["'-ODD-SKU", "Oslo", "5", "", "", "'=note", "", "", ""]);
    expect(result.row).toMatchObject({ sku: "-ODD-SKU", note: "=note" });
  });

  it("treats a missing cell as empty (a short row)", () => {
    expect(parse(["A", "Oslo", "5"]).row).toMatchObject({ onHand: 5, reason: "count" });
  });
});

describe("duplicates and decisions", () => {
  it("flags a later row of the same SKU at the same location, in any case, and not the same SKU elsewhere", () => {
    const rows = [
      { sku: "A", locationId: "x" },
      { sku: "a", locationId: "x" },
      { sku: "A", locationId: "y" },
      null,
      { sku: "A", locationId: "x" },
    ];
    expect(duplicateFlags(rows)).toEqual([false, true, false, false, true]);
    expect(rowKey({ sku: "Ab", locationId: "x" })).toBe(rowKey({ sku: "aB", locationId: "x" }));
  });

  it("is a conflict when the figure the file was made from is not the stock now, and sets the figure otherwise", () => {
    expect(decideRow({ onHand: 8, onHandWas: 10 }, 10)).toEqual({ kind: "change", delta: -2, from: 10, to: 8 });
    expect(decideRow({ onHand: 8, onHandWas: 10 }, 9)).toEqual({ kind: "conflict", was: 10, now: 9 });
    expect(decideRow({ onHand: 10, onHandWas: 10 }, 10)).toEqual({ kind: "unchanged" });
    expect(decideRow({ onHand: 10, onHandWas: 10 }, 7)).toEqual({ kind: "conflict", was: 10, now: 7 });
    expect(decideRow({ onHand: 8, onHandWas: null }, 3)).toEqual({ kind: "change", delta: 5, from: 3, to: 8 });
    expect(decideRow({ onHand: 3, onHandWas: null }, 3)).toEqual({ kind: "unchanged" });
    // A negative stock (owed) is a figure like any other: a count of 0 sets it to 0.
    expect(decideRow({ onHand: 0, onHandWas: -3 }, -3)).toEqual({ kind: "change", delta: 3, from: -3, to: 0 });
  });

  it("describes a row for the dry run: the figure now, the new figure and the change, and marks a conflict", () => {
    const row = parse(["A", "Oslo", "8", "10", "", "", "", "", ""]).row!;
    expect(dryRunRow(row, "Oslo", 10)).toEqual({ sku: "A", location: "Oslo", current: 10, next: 8, change: -2, conflict: false });
    expect(dryRunRow(row, "Oslo", 9)).toEqual({ sku: "A", location: "Oslo", current: 9, next: 9, change: 0, conflict: true });
  });
});

describe("the export", () => {
  it("writes a header and a row for each variant and location, with a negative figure as a number and a formula in a title escaped", () => {
    const csv = writeInventoryCsv([
      { sku: "A-1", product: "=SUM(1)", options: "white / large", location: "Oslo", onHand: -2, committed: 1, available: -3, stockPolicy: "continue", backorderDays: 7, lowStockThreshold: null },
    ]);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe(EXPORT_COLUMNS.join(","));
    expect(lines[1]).toBe("A-1,'=SUM(1),white / large,Oslo,-2,1,-3,continue,7,");
  });

  it("is only a header for no rows, and uses the Nordic dialect when asked", () => {
    expect(writeInventoryCsv([])).toBe(`${EXPORT_COLUMNS.join(",")}\r\n`);
    const nordic = writeInventoryCsv([{ sku: "A", product: "Krus", options: "", location: "Oslo", onHand: 1, committed: 0, available: 1, stockPolicy: "deny", backorderDays: null, lowStockThreshold: null }], "excel_nordic");
    expect(nordic.startsWith("﻿")).toBe(true);
    expect(nordic).toContain(";");
  });
});
