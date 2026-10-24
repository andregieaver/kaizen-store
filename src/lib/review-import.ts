/**
 * Reading a file of reviews written on another service (D301 G3b, `docs/wave-5-marketing.md` 9.6), pure: the columns, each row's words cleaned
 * as a buyer's are, and every row refused with its line and the column at fault. A sentence about a row names its line and its column and never
 * quotes a cell (a file's cells can hold anything). No zod and no server imports.
 */

import { parseCsv, recordsOf, unescapeText } from "./csv";
import { IMPORTED_FROM_MAX, REVIEW_BODY_MAX, REVIEW_NAME_MAX, REVIEW_TITLE_MAX } from "./review-status";
import { cleanLine, cleanText } from "./reviews";

/** The columns a file has (Shopify's Product Reviews export and Judge.me's use the same handle, rating, title, body, author and date). */
export const REVIEW_COLUMNS = ["product_handle", "rating", "title", "body", "author", "date", "source"] as const;
export const REVIEW_REQUIRED = ["product_handle", "rating", "author", "date"] as const;
/** At most this many reviews a file. */
export const REVIEW_IMPORT_MAX = 10_000;
/** At most this many bytes a file (a server action takes 4 MB in all). */
export const REVIEW_IMPORT_BYTES = 3_500_000;
/** A review written before this is refused as a mistyped date. */
const EARLIEST = "2000-01-01";

export const ROW_PROBLEMS = ["handle", "rating", "author", "title", "body", "date", "source"] as const;
export type RowProblem = (typeof ROW_PROBLEMS)[number] | "product" | "duplicate";

export type ReviewRow = {
  /** The line in the file (the header is line 1). */
  line: number;
  handle: string;
  rating: number;
  title: string | null;
  body: string | null;
  author: string;
  /** `yyyy-mm-dd`. */
  date: string;
  /** Where it was written; the import's own name when the row has none. */
  source: string;
};

export type FileProblem = "empty" | "columns" | "too_many" | "unterminated" | "too_big";

export type ReadFile =
  | { ok: false; problem: FileProblem; missing?: string[] }
  | { ok: true; rows: ReviewRow[]; refused: { line: number; problem: RowProblem }[] };

/** A date as written in the file, in the forms the services write it (`2025-03-01`, `2025-03-01T10:00:00Z`, `01.03.2025`, `1/3/2025` is not taken). */
export function readDate(text: string, today: string): string | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(t);
  let iso: string | null = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  if (!iso) {
    m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
    if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
  }
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return iso >= EARLIEST && iso <= today ? iso : null;
}

/**
 * The file's reviews and the rows refused, by line. `from` names where reviews come from when a row has no `source`; `today` is the store's day
 * (no review is written in the future).
 */
export function readReviewFile(input: string | Uint8Array, from: string, today: string): ReadFile {
  if (typeof input !== "string" && input.byteLength > REVIEW_IMPORT_BYTES) return { ok: false, problem: "too_big" };
  const parsed = parseCsv(input);
  if (parsed.unterminated) return { ok: false, problem: "unterminated" };
  if (parsed.rows.length < 2) return { ok: false, problem: "empty" };
  const { header, records } = recordsOf(parsed.rows);
  const names = header.map((h) => h.toLowerCase());
  const missing = REVIEW_REQUIRED.filter((c) => !names.includes(c));
  if (missing.length > 0) return { ok: false, problem: "columns", missing };
  if (records.length > REVIEW_IMPORT_MAX) return { ok: false, problem: "too_many" };
  const fallback = cleanLine(from, IMPORTED_FROM_MAX);
  const rows: ReviewRow[] = [];
  const refused: { line: number; problem: RowProblem }[] = [];
  records.forEach((record, i) => {
    const line = i + 2;
    const cell = (name: string) => {
      const key = header.find((h) => h.toLowerCase() === name);
      return key ? unescapeText(record[key] ?? "") : "";
    };
    const refuse = (problem: RowProblem) => refused.push({ line, problem });
    const handle = cell("product_handle").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(handle)) return refuse("handle");
    const ratingText = cell("rating").trim().replace(",", ".");
    const rating = Number(ratingText);
    if (!/^\d(\.0+)?$/.test(ratingText) || rating < 1 || rating > 5) return refuse("rating");
    const author = cleanLine(cell("author"), REVIEW_NAME_MAX);
    if (!author) return refuse("author");
    const title = cleanLine(cell("title"), REVIEW_TITLE_MAX);
    if (title === false) return refuse("title");
    const body = cleanText(cell("body"), REVIEW_BODY_MAX);
    if (body === false) return refuse("body");
    const date = readDate(cell("date"), today);
    if (!date) return refuse("date");
    const own = cleanLine(cell("source"), IMPORTED_FROM_MAX);
    const source = own || fallback;
    if (!source) return refuse("source");
    rows.push({ line, handle, rating: Math.round(rating), title, body, author, date, source });
  });
  return { ok: true, rows, refused };
}

export type ImportOutcome =
  | { ok: false; problem: FileProblem | "closed"; missing?: string[] }
  | {
      ok: true;
      /** Only checked: nothing was written. */
      checked: boolean;
      rows: number;
      /** Written (or, when only checked, that would be written). */
      imported: number;
      published: boolean;
      duplicates: number;
      refusedCount: number;
      refused: { line: number; problem: RowProblem }[];
    };

/** What the import page's form shows after a press, and its action as the form calls it. */
export type ImportState = ImportOutcome | { ok: false; problem: "noFile" | "forbidden" } | null;
export type ImportAction = (state: ImportState, form: FormData) => Promise<ImportState>;

/** The key two imports of the same review share, so a file imported twice adds nothing the second time. */
export const importKey = (r: Pick<ReviewRow, "handle" | "rating" | "author" | "date" | "source" | "body">) =>
  [r.handle, r.rating, r.author.toLowerCase(), r.date, r.source.toLowerCase(), (r.body ?? "").slice(0, 200)].join("\u0000");
