/**
 * The one CSV writer and reader of data in and out (D165, `docs/wave-2-data.md` 4.1.3, 4.6, 2.7). Pure.
 *
 * Writing (`writeCsv()`): RFC 4180 quoting with CRLF, and OWASP's list of characters that make a spreadsheet run a cell as a
 * formula (`=`, `+`, `-`, `@`, tab, carriage return, line feed, <https://community.owasp.org/attacks/CSV_Injection>): a TEXT cell
 * that starts with one gets a leading `'`. A NUMBER cell (an integer, or a `{ num }` already formatted by `decimalAmount()`) is
 * not text and is never prefixed, so `-12.50` stays `-12.50`; a `{ num }` that is not a plain decimal is refused, so a cell cannot
 * reach a file as a "number" without being one. The escape is exact in both directions (`escapeText()` / `unescapeText()`): a text
 * that really starts with `'` followed by a trigger character is written with a second `'`, so reading undoes precisely one.
 *
 * Reading (`parseCsv()`): quotes, `""`, embedded newlines, LF, CRLF or lone CR, a byte order mark, a delimiter of comma, semicolon
 * or tab found from the header row, and the encoding found from the bytes (UTF-8, UTF-16, else Windows-1252 and said so, because
 * Excel in Norwegian, Swedish and Danish saves a plain CSV in Windows-1252 with semicolons and decimal commas).
 *
 * Every module that writes a CSV goes through `writeCsv()` (or the older `toCsv()` of `dac7.ts`, which keeps its output): a scan test
 * fails for a module that joins cells with a delimiter by hand.
 */

import { amountText } from "./field-money";

/** A cell: text (escaped), an integer, a decimal already formatted (`{ num: "12.50" }`), or empty. */
export type Cell = string | number | null | { num: string };

export type DialectId = "standard" | "excel_nordic";
export type Dialect = {
  id: DialectId;
  label: string;
  delimiter: "," | ";";
  /** The mark in a `{ num }` cell: a point, or a comma (so Excel in Norwegian, Swedish and Danish reads a number). */
  decimal: "." | ",";
  /** A byte order mark first, so Excel reads UTF-8 (æ, ø, å) instead of Windows-1252. */
  bom: boolean;
};

export const DIALECTS: Record<DialectId, Dialect> = {
  standard: { id: "standard", label: "Standard (comma, decimal point, UTF-8)", delimiter: ",", decimal: ".", bom: false },
  excel_nordic: { id: "excel_nordic", label: "Excel (Nordic: semicolon, decimal comma, UTF-8 with a byte order mark)", delimiter: ";", decimal: ",", bom: true },
};
export const DIALECT_IDS = Object.keys(DIALECTS) as DialectId[];
export const isDialect = (value: unknown): value is DialectId => typeof value === "string" && Object.hasOwn(DIALECTS, value);

/** The characters a spreadsheet treats as the start of a formula (OWASP): `=`, `+`, `-`, `@`, tab, carriage return, line feed. */
export const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r", "\n"] as const;
const LEADS = /^'*[=+\-@\t\r\n]/;
const ESCAPED = /^'+[=+\-@\t\r\n]/;

/** Whether a text would be read by a spreadsheet as a formula. */
export const startsLikeFormula = (text: string): boolean => /^[=+\-@\t\r\n]/.test(text);

/** A text as it is written: one `'` in front of a text that starts with a trigger character, or with `'` and then one. */
export function escapeText(text: string): string {
  return LEADS.test(text) ? `'${text}` : text;
}

/** Undoes `escapeText()`: one leading `'` is removed when the quotes are followed by a trigger character. Anything else is as it is. */
export function unescapeText(text: string): string {
  return ESCAPED.test(text) ? text.slice(1) : text;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

function cellText(cell: Cell, dialect: Dialect): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") {
    if (!Number.isSafeInteger(cell)) throw new Error("csv: a number cell is an integer; write an amount as { num } from decimalAmount()");
    return String(cell);
  }
  if (typeof cell === "object") {
    if (typeof cell.num !== "string" || !NUMBER.test(cell.num)) throw new Error("csv: a { num } cell must be a plain decimal such as 12.50");
    return dialect.decimal === "." ? cell.num : cell.num.replace(".", ",");
  }
  const text = escapeText(cell);
  return /["\r\n]/.test(text) || text.includes(dialect.delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows as CSV text: CRLF between rows and after the last, the dialect's delimiter, a byte order mark first when it asks for one. */
export function writeCsv(rows: readonly (readonly Cell[])[], dialect: DialectId | Dialect = "standard"): string {
  const d = typeof dialect === "string" ? DIALECTS[dialect] : dialect;
  const body = rows.map((row) => row.map((cell) => cellText(cell, d)).join(d.delimiter)).join("\r\n");
  return `${d.bom ? "﻿" : ""}${body}${rows.length > 0 ? "\r\n" : ""}`;
}

/**
 * An amount in minor units as a number cell, with the currency's own digits (`minorUnitDigits()`, the storage unit: HUF is counted in
 * hundredths too). Not `decimalAmount()` of `dac7.ts`, which reads Intl's display digits and would write a HUF amount a hundred times
 * too big. Null for no amount.
 */
export function amountCell(minor: number | null | undefined, currency: string): Cell {
  if (minor === null || minor === undefined) return null;
  return { num: amountText(minor, currency) };
}

/** The bytes of a CSV to store: UTF-8 (the byte order mark of the Nordic dialect is part of the text). */
export const csvBytes = (text: string): Uint8Array => new TextEncoder().encode(text);

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type CsvEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
export type Decoded = {
  text: string;
  encoding: CsvEncoding;
  /** The file began with a byte order mark (removed from `text`). */
  bom: boolean;
  /** Not UTF-8 or UTF-16: read as Windows-1252, which the import says as a warning (`file.encoding_assumed`). */
  assumed: boolean;
};

/** Text from bytes: a byte order mark decides, else valid UTF-8, else Windows-1252 (flagged `assumed`). */
export function decodeCsv(bytes: Uint8Array): Decoded {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8", bom: true, assumed: false };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le", bom: true, assumed: false };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be", bom: true, assumed: false };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8", bom: false, assumed: false };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252", bom: false, assumed: true };
  }
}

export const DELIMITERS = [",", ";", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];
export const DELIMITER_WORDS: Record<Delimiter, string> = { ",": "commas", ";": "semicolons", "\t": "tabs" };

/** The delimiter of a file, from its first record (outside quotes): the one that occurs most, a comma on a tie or when none does. */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (!quoted) {
      if (ch === "\n" || ch === "\r") break;
      if (ch === "," || ch === ";" || ch === "\t") counts[ch] += 1;
    }
  }
  let best: Delimiter = ",";
  for (const d of DELIMITERS) if (counts[d] > counts[best]) best = d;
  return best;
}

export type ParsedCsv = {
  /** Every record, the header first; blank lines are dropped. A record's number for the member is its index + 1 (the header is row 1). */
  rows: string[][];
  delimiter: Delimiter;
  encoding: CsvEncoding;
  bom: boolean;
  assumed: boolean;
  /** The record numbers (1-based, the header being 1) whose cell count differs from the header's. */
  ragged: number[];
  /** A quote was opened and never closed: the file ends inside a cell. */
  unterminated: boolean;
};

/** Splits text into records and cells. No unescaping of formulas here: `unescapeText()` is the reader's, per text cell. */
export function parseCsvText(text: string, delimiter: Delimiter): { rows: string[][]; unterminated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let cellStarted = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    // A line with nothing on it is not a record.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && !cellStarted) {
      quoted = true;
      cellStarted = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
    } else {
      cell += ch;
      cellStarted = true;
    }
  }
  const unterminated = quoted;
  if (cellStarted || cell !== "" || row.length > 0) endRow();
  return { rows, unterminated };
}

/** A file's text or bytes read into records, with what was found out about it. `delimiter` forces one. */
export function parseCsv(input: string | Uint8Array, options: { delimiter?: Delimiter } = {}): ParsedCsv {
  const decoded: Decoded =
    typeof input === "string"
      ? { text: input.charCodeAt(0) === 0xfeff ? input.slice(1) : input, encoding: "utf-8", bom: input.charCodeAt(0) === 0xfeff, assumed: false }
      : decodeCsv(input);
  const delimiter = options.delimiter ?? detectDelimiter(decoded.text);
  const { rows, unterminated } = parseCsvText(decoded.text, delimiter);
  const width = rows[0]?.length ?? 0;
  const ragged = rows.flatMap((r, i) => (i > 0 && r.length !== width ? [i + 1] : []));
  return { rows, delimiter, encoding: decoded.encoding, bom: decoded.bom, assumed: decoded.assumed, ragged, unterminated };
}

/** The records after the header as objects by header name (a repeated name keeps the first). Short rows read missing cells as empty. */
export function recordsOf(rows: readonly (readonly string[])[]): { header: string[]; records: Record<string, string>[] } {
  const header = (rows[0] ?? []).map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      if (name !== "" && !Object.hasOwn(record, name)) record[name] = r[i] ?? "";
    });
    return record;
  });
  return { header, records };
}

/**
 * A number typed in a spreadsheet: an integer with an optional sign, no decimals. Used for the file's other numbers (a quantity, a
 * stock figure); an amount is read by the editor's own `parsePrice()`, which takes either decimal mark.
 */
export function parseInteger(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?\d{1,15}$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}
