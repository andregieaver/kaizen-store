/**
 * The stock file (wave 3, D172, `docs/wave-3-inventory.md` 2.4): the columns of the export and the import, how one row of an
 * import is read and checked, and what a checked row comes to at apply time. Pure; a CSV is written only by `src/lib/csv.ts`
 * (`writeCsv()`, formula characters escaped) and read only by its `parseCsv()` / `recordsOf()`.
 *
 * A finding names a SKU or a column and NEVER quotes a cell (`finding()` in `data-job.ts` builds each sentence from names and
 * numbers). The dry run reads every row and changes nothing; the apply writes each row as one movement with `source = 'file'`
 * and the job's id. A row with `on_hand_was` that differs from the stock at apply time is a CONFLICT and is skipped: the file is a
 * count of the stock as it stood, and a sale since makes it stale. Without `on_hand_was` the row sets the figure as given.
 */

import { finding, type Finding, type FindingCode } from "./data-job";
import { parseInteger, unescapeText, writeCsv, type Cell, type DialectId } from "./csv";
import {
  ADJUST_REASONS,
  BACKORDER_DAYS_MAX,
  BACKORDER_DAYS_MIN,
  INVENTORY_FILE_ROWS_MAX,
  NOTE_MAX,
  STOCK_MAX,
  THRESHOLD_MAX,
  isAdjustReason,
  type AdjustReason,
  type StockPolicy,
} from "./inventory";

/** The columns of the export, in order. */
export const EXPORT_COLUMNS = ["sku", "product", "options", "location", "on_hand", "committed", "available", "stock_policy", "backorder_days", "low_stock_threshold"] as const;

/** The columns an import reads: `sku` and `on_hand` are required, the others optional. */
export const IMPORT_COLUMNS = ["sku", "location", "on_hand", "on_hand_was", "reason", "note", "stock_policy", "backorder_days", "low_stock_threshold"] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
/** A file row without a `reason` is a count: the figure was counted. */
export const DEFAULT_FILE_REASON: AdjustReason = "count";
export const REQUIRED_COLUMNS: readonly ImportColumn[] = ["sku", "on_hand"];

/** The stable codes of this file's findings (the sentences are in `FINDINGS`, `data-job.ts`). */
export const INVENTORY_FINDING_CODES = [
  "file.not_inventory",
  "stockfile.sku_missing",
  "stockfile.sku_unknown",
  "stockfile.sku_not_goods",
  "stockfile.location_unknown",
  "stockfile.location_required",
  "stockfile.on_hand_invalid",
  "stockfile.on_hand_was_invalid",
  "stockfile.reason_invalid",
  "stockfile.note_too_long",
  "stockfile.policy_invalid",
  "stockfile.days_required",
  "stockfile.days_invalid",
  "stockfile.days_ignored",
  "stockfile.threshold_invalid",
  "stockfile.duplicate",
  "stockfile.conflict",
  "stockfile.failed",
] as const satisfies readonly FindingCode[];

// ---------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------

/** One row of the export: a physical variant at a location (an active location with no level row is listed with 0). */
export type ExportRow = {
  sku: string;
  product: string;
  options: string;
  location: string;
  onHand: number;
  committed: number;
  available: number;
  stockPolicy: StockPolicy;
  backorderDays: number | null;
  lowStockThreshold: number | null;
};

/** The file's text. Titles and SKUs are text cells (a formula character is escaped by `writeCsv()`); every figure is an integer, so a negative figure is a number and stays one. */
export function writeInventoryCsv(rows: readonly ExportRow[], dialect: DialectId = "standard"): string {
  const header: Cell[] = [...EXPORT_COLUMNS];
  return writeCsv([header, ...rows.map(inventoryExportCells)], dialect);
}

/** One export row's cells in the order of `EXPORT_COLUMNS`: what the export job's reader hands the one CSV writer. */
export const inventoryExportCells = (r: ExportRow): Cell[] => [
  r.sku,
  r.product,
  r.options,
  r.location,
  r.onHand,
  r.committed,
  r.available,
  r.stockPolicy,
  r.backorderDays,
  r.lowStockThreshold,
];

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

/** How a header cell is named in the file, taken as a name: lower case, spaces and hyphens as underscores. */
export const headerKey = (cell: string): string =>
  cell
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const ALIASES: Record<string, ImportColumn> = {
  sku: "sku",
  variant_sku: "sku",
  location: "location",
  location_name: "location",
  on_hand: "on_hand",
  onhand: "on_hand",
  on_hand_was: "on_hand_was",
  reason: "reason",
  note: "note",
  stock_policy: "stock_policy",
  backorder_days: "backorder_days",
  low_stock_threshold: "low_stock_threshold",
};

/** The index of each import column in the header (-1 when absent). A repeated column keeps the first. Unknown columns are ignored. */
export type HeaderIndex = Record<ImportColumn, number>;

export function readHeader(header: readonly string[]): HeaderIndex {
  const index = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, -1])) as HeaderIndex;
  header.forEach((cell, i) => {
    const column = ALIASES[headerKey(cell)];
    if (column && index[column] === -1) index[column] = i;
  });
  return index;
}

/** Whether the header names the required columns; when not, the finding that says so (`file.not_inventory`). */
export function checkHeader(index: HeaderIndex): Finding | null {
  return REQUIRED_COLUMNS.every((c) => index[c] >= 0) ? null : finding("file.not_inventory", { names: REQUIRED_COLUMNS });
}

/** Whether a file has more rows than an import takes (`file.too_many_rows`, shared with the product file's finding). */
export const tooManyRows = (rows: number): Finding | null => (rows > INVENTORY_FILE_ROWS_MAX ? finding("file.too_many_rows", { n: rows, max: INVENTORY_FILE_ROWS_MAX }) : null);

// ---------------------------------------------------------------------------
// A row
// ---------------------------------------------------------------------------

/** A location as the row's name is matched against: every location of the store, inactive ones too (staff can count them). */
export type LocationRef = { id: string; name: string; active: boolean };

export type ParsedRow = {
  sku: string;
  locationId: string;
  /** The count: the figure the variant should have at the location. */
  onHand: number;
  /** The figure the file was made from; null when the file does not say. */
  onHandWas: number | null;
  reason: AdjustReason;
  note: string | null;
  /** Null: the file does not say, so the policy is left as it is. */
  stockPolicy: StockPolicy | null;
  backorderDays: number | null;
  /** Null: the file does not say, so the level is left as it is (a level is cleared in the editor). */
  lowStockThreshold: number | null;
};

const cellOf = (cells: readonly string[], at: number): string => (at < 0 ? "" : unescapeText(cells[at] ?? "").trim());

/** A location by name, case-insensitively: an active one first, then an inactive one. Empty only when the store has exactly one active location. */
export function matchLocation(name: string, locations: readonly LocationRef[]): { ok: true; location: LocationRef } | { ok: false; reason: "required" | "unknown" } {
  const wanted = name.trim().toLowerCase();
  if (wanted === "") {
    const active = locations.filter((l) => l.active);
    return active.length === 1 ? { ok: true, location: active[0] } : { ok: false, reason: "required" };
  }
  const named = locations.filter((l) => l.name.trim().toLowerCase() === wanted);
  const found = named.find((l) => l.active) ?? named[0];
  return found ? { ok: true, location: found } : { ok: false, reason: "unknown" };
}

/** A whole number in a cell from `min` to `max`, or null. Blank is not a number here: the caller decides what blank means. */
function figure(text: string, min: number, max: number): number | null {
  const n = parseInteger(text);
  return n !== null && n >= min && n <= max ? n : null;
}

/**
 * One row of the file. `cells` are the raw cells of the row and `index` is `readHeader()`'s. Returns the row, or the findings that
 * made it unusable (more than one when several things are wrong), and any warnings with a usable row. Whether the SKU is a shipped
 * variant of the store is the server's (`stockfile.sku_unknown`, `stockfile.sku_not_goods`): it has the catalogue.
 */
export function parseInventoryRow(
  cells: readonly string[],
  index: HeaderIndex,
  locations: readonly LocationRef[],
): { row: ParsedRow | null; findings: Finding[] } {
  const findings: Finding[] = [];
  const sku = cellOf(cells, index.sku);
  if (sku === "") return { row: null, findings: [finding("stockfile.sku_missing")] };
  const bad = (code: FindingCode, extra: { max?: number; names?: readonly string[] } = {}) => findings.push(finding(code, { sku, ...extra }));

  const place = matchLocation(cellOf(cells, index.location), locations);
  if (!place.ok) bad(place.reason === "required" ? "stockfile.location_required" : "stockfile.location_unknown");

  const onHandText = cellOf(cells, index.on_hand);
  const onHand = onHandText === "" ? null : figure(onHandText, 0, STOCK_MAX);
  if (onHand === null) bad("stockfile.on_hand_invalid");

  const wasText = cellOf(cells, index.on_hand_was);
  let onHandWas: number | null = null;
  if (wasText !== "") {
    onHandWas = figure(wasText, -STOCK_MAX, STOCK_MAX);
    if (onHandWas === null) bad("stockfile.on_hand_was_invalid");
  }

  const reasonText = cellOf(cells, index.reason).toLowerCase();
  let reason: AdjustReason = DEFAULT_FILE_REASON;
  if (reasonText !== "") {
    if (isAdjustReason(reasonText)) reason = reasonText;
    else bad("stockfile.reason_invalid", { names: ADJUST_REASONS });
  }

  const noteText = cellOf(cells, index.note);
  if (noteText.length > NOTE_MAX) bad("stockfile.note_too_long", { max: NOTE_MAX });

  const policyText = cellOf(cells, index.stock_policy).toLowerCase();
  let stockPolicy: StockPolicy | null = null;
  if (policyText !== "") {
    if (policyText === "deny" || policyText === "continue") stockPolicy = policyText;
    else bad("stockfile.policy_invalid");
  }

  const daysText = cellOf(cells, index.backorder_days);
  let backorderDays: number | null = null;
  if (daysText !== "") {
    backorderDays = figure(daysText, BACKORDER_DAYS_MIN, BACKORDER_DAYS_MAX);
    if (backorderDays === null) bad("stockfile.days_invalid");
  }
  if (stockPolicy === "continue" && daysText === "") bad("stockfile.days_required");
  if (daysText !== "" && backorderDays !== null && stockPolicy !== "continue") {
    findings.push(finding("stockfile.days_ignored", { sku }));
    backorderDays = null;
  }

  const thresholdText = cellOf(cells, index.low_stock_threshold);
  let lowStockThreshold: number | null = null;
  if (thresholdText !== "") {
    lowStockThreshold = figure(thresholdText, 0, THRESHOLD_MAX);
    if (lowStockThreshold === null) bad("stockfile.threshold_invalid");
  }

  if (findings.some((f) => f.severity === "error") || !place.ok || onHand === null) return { row: null, findings };
  return {
    row: {
      sku,
      locationId: place.location.id,
      onHand,
      onHandWas,
      reason,
      note: noteText === "" ? null : noteText,
      stockPolicy,
      backorderDays,
      lowStockThreshold,
    },
    findings,
  };
}

/** The key a row is unique by: the SKU (case-insensitively) at a location. */
export const rowKey = (row: Pick<ParsedRow, "sku" | "locationId">): string => `${row.sku.toLowerCase()}\u0000${row.locationId}`;

/** For each row (in order), whether an earlier row has the same SKU at the same location: the later row is skipped (`stockfile.duplicate`). */
export function duplicateFlags(rows: readonly (Pick<ParsedRow, "sku" | "locationId"> | null)[]): boolean[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (!row) return false;
    const key = rowKey(row);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

/** What an apply does with a checked row against the stock as it is now. */
export type RowDecision = { kind: "conflict"; was: number; now: number } | { kind: "unchanged" } | { kind: "change"; delta: number; from: number; to: number };

export function decideRow(row: Pick<ParsedRow, "onHand" | "onHandWas">, current: number): RowDecision {
  if (row.onHandWas !== null && row.onHandWas !== current) return { kind: "conflict", was: row.onHandWas, now: current };
  if (row.onHand === current) return { kind: "unchanged" };
  return { kind: "change", delta: row.onHand - current, from: current, to: row.onHand };
}

/** The dry run's line for a row: the variant, the location, the figure now, the new figure and the change. */
export type DryRunRow = { sku: string; location: string; current: number; next: number; change: number; conflict: boolean };

export function dryRunRow(row: ParsedRow, location: string, current: number): DryRunRow {
  const decision = decideRow(row, current);
  return { sku: row.sku, location, current, next: decision.kind === "change" ? decision.to : current, change: decision.kind === "change" ? decision.delta : 0, conflict: decision.kind === "conflict" };
}
