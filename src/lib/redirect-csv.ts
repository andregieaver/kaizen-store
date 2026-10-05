/**
 * The redirect file (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2.4, 2.2.5), pure: how a file is read into lines (Shopify's headings `Redirect from`
 * and `Redirect to`, and the aliases a spreadsheet or another shop may have), and how the redirects are written to one (the same two columns first, then
 * `type`, `created`, `used`, `last_used`). Every cell goes through `csv.ts` (`writeCsv()` and `parseCsv()`): a cell that starts like a formula is escaped on the
 * way out and unescaped on the way in, so a manual file exported here imports back unchanged.
 *
 * Reading never normalises an address: the lines carry the cells as typed (the plan reads them with `normaliseSource()` and `normaliseTarget()`, which is where
 * a finding about an address is made).
 */
import { DELIMITER_WORDS, parseCsv, recordsOf, unescapeText, writeCsv, type Cell, type DialectId, type ParsedCsv } from "./csv";
import { finding, type Finding } from "./data-job";
import { IMPORT_MAX_BYTES, REDIRECT_IMPORT_MAX_ROWS } from "./data-limits";
import type { FileFinding } from "./product-csv";

/** The headings of the export: the first two are Shopify's own. */
export const REDIRECT_HEADER = ["Redirect from", "Redirect to"] as const;
export const REDIRECT_EXPORT_COLUMNS = [...REDIRECT_HEADER, "type", "created", "used", "last_used"] as const;
/** Columns of our own export that an import ignores, without a word of surprise. */
const OWN_EXTRA = new Set(["type", "created", "used", "last_used"]);

/** What a column may be called, by what it is (lower case, spaces for hyphens and underscores). */
export const FROM_ALIASES: readonly string[] = ["redirect from", "from", "source", "old url", "path"];
export const TO_ALIASES: readonly string[] = ["redirect to", "to", "target", "new url", "destination"];

const headingKey = (cell: string): string => cell.replace(/^﻿/, "").trim().toLowerCase().replace(/[_\-\s]+/g, " ");

/** The accepted names of the two columns, for the sentence that refuses a file. */
export const ACCEPTED_NAMES: readonly string[] = ["Redirect from", "Redirect to"];

/** One data line: its row in the file (the header is row 1) and the two cells as typed (a formula escape undone). */
export type RedirectLine = { row: number; from: string; to: string };

export type RedirectFile = {
  lines: RedirectLine[];
  /** Findings about the file as a whole, and about a row of it (`rows`); none is an address finding (the plan makes those). */
  findings: FileFinding[];
  /** The columns left out (ours: `type`, `created`, `used`, `last_used`, and any other). */
  ignored: string[];
  delimiter: ParsedCsv["delimiter"];
  encoding: ParsedCsv["encoding"];
};

export type ReadRedirectFile = ({ ok: true } & RedirectFile) | { ok: false; problems: string[] };

/**
 * A file's bytes read into lines, or why it is refused: empty, over the size or the row limit (`file.too_large`, `file.too_many_rows`), ending inside a quoted
 * cell, or with no heading we know (`file.not_redirects`, naming the accepted ones). Blank lines are not rows. A line with neither cell is dropped as empty;
 * a line with one is kept (the plan says which is missing). A row with another number of cells than the header is a warning (`file.ragged_row`, the first 50).
 */
export function readRedirectFile(bytes: Uint8Array): ReadRedirectFile {
  if (bytes.length === 0) return { ok: false, problems: [finding("file.empty").text] };
  if (bytes.length > IMPORT_MAX_BYTES) return { ok: false, problems: [finding("file.too_large", { max: Math.floor(IMPORT_MAX_BYTES / 1024 / 1024) }).text] };
  const parsed = parseCsv(bytes);
  if (parsed.unterminated) return { ok: false, problems: ["The file ends inside a quoted cell. Check the quotes and try again."] };
  if (parsed.rows.length === 0) return { ok: false, problems: [finding("file.empty").text] };
  const header = parsed.rows[0].map(headingKey);
  const fromAt = header.findIndex((h) => FROM_ALIASES.includes(h));
  const toAt = header.findIndex((h) => TO_ALIASES.includes(h));
  if (fromAt < 0 || toAt < 0) return { ok: false, problems: [finding("file.not_redirects", { names: ACCEPTED_NAMES }).text] };
  if (parsed.rows.length - 1 > REDIRECT_IMPORT_MAX_ROWS) {
    return { ok: false, problems: [finding("file.too_many_rows", { n: parsed.rows.length - 1, max: REDIRECT_IMPORT_MAX_ROWS }).text] };
  }

  const findings: FileFinding[] = [];
  if (parsed.assumed) findings.push({ rows: [], finding: finding("file.encoding_assumed") });
  if (parsed.delimiter !== ",") findings.push({ rows: [], finding: finding("file.delimiter", { name: DELIMITER_WORDS[parsed.delimiter] }) });
  const ignored: string[] = [];
  parsed.rows[0].forEach((name, i) => {
    const shown = name.replace(/^﻿/, "").trim();
    if (i === fromAt || i === toAt || shown === "") return;
    ignored.push(shown);
    findings.push({
      rows: [],
      finding: finding("column.ignored", { column: shown, reason: OWN_EXTRA.has(headingKey(shown)) ? "A redirect file's other columns are not read" : "It is not a column of a redirect file" }),
    });
  });
  for (const row of parsed.ragged.slice(0, 50)) findings.push({ rows: [row], finding: finding("file.ragged_row") });

  const lines: RedirectLine[] = [];
  parsed.rows.slice(1).forEach((cells, i) => {
    const from = unescapeText(cells[fromAt] ?? "").trim();
    const to = unescapeText(cells[toAt] ?? "").trim();
    if (from === "" && to === "") return;
    lines.push({ row: i + 2, from, to });
  });
  return { ok: true, lines, findings, ignored, delimiter: parsed.delimiter, encoding: parsed.encoding };
}

/** The same, from a record list already read (for a test or a caller that has the records). */
export function linesOfRecords(rows: readonly (readonly string[])[]): RedirectLine[] {
  const { header, records } = recordsOf(rows);
  const fromName = header.find((h) => FROM_ALIASES.includes(headingKey(h)));
  const toName = header.find((h) => TO_ALIASES.includes(headingKey(h)));
  if (!fromName || !toName) return [];
  return records.flatMap((r, i) => {
    const from = unescapeText(r[fromName] ?? "").trim();
    const to = unescapeText(r[toName] ?? "").trim();
    return from === "" && to === "" ? [] : [{ row: i + 2, from, to }];
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** A redirect as the export reads it: the target of an automatic redirect is the thing's address now (the server fills it). */
export type ExportRedirect = {
  kind: "manual" | "product" | "category" | "tag";
  source: string;
  target: string | null;
  createdAt: Date;
  hits: number;
  lastHitAt: Date | null;
};

const day = (date: Date | null): Cell => (date ? date.toISOString().slice(0, 10) : null);

/** The rows of the file: the header, then each redirect (`Redirect from`, `Redirect to`, `type`, `created`, `used`, `last_used`); an automatic redirect with no live target has an empty `Redirect to`. */
export function redirectRows(redirects: readonly ExportRedirect[]): Cell[][] {
  return [[...REDIRECT_EXPORT_COLUMNS], ...redirects.map((r) => [r.source, r.target, r.kind, day(r.createdAt), r.hits, day(r.lastHitAt)] as Cell[])];
}

/** The file as text in a dialect. */
export const redirectCsv = (redirects: readonly ExportRedirect[], dialect: DialectId = "standard"): string => writeCsv(redirectRows(redirects), dialect);

/** The problems of a check as a file of their own: one row for each finding of a line with a finding, `row`, `from`, `to`, `severity`, `code`, `message`. Cells are the addresses as typed, escaped. */
export const PROBLEM_HEADER = ["row", "redirect_from", "redirect_to", "severity", "code", "message"] as const;
export function problemRows(items: readonly { rows: readonly number[]; from: string; to: string; messages: readonly Finding[] }[]): Cell[][] {
  return [
    [...PROBLEM_HEADER],
    ...items.flatMap((item) => item.messages.map((m) => [item.rows[0] ?? null, item.from, item.to, m.severity, m.code, m.text] as Cell[])),
  ];
}
