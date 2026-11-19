// What the ratchet of code review step 1.2 counts (findings FD6 and FH11), shared by `scripts/ratchet.mjs` (which writes the
// baseline) and `src/server/ratchet.scan.test.ts` (which holds the code to it): in every source file under `src`, tests and test
// support aside, the reads that are not checked (`execute<…>(`, never through `typedRows()`), the writes that address a store's row
// by its id alone (code review step 1.3, FV5: `update`/`delete` of a table with a `store_id` whose `where` names the id and not the
// store), and in total the casts through `unknown` (`as unknown as`) and the lines that switch off the linter's `any` rule.
// Two more totals (bloat review step 1.24): the source files over 100 KB and over 2,000 lines. A file this large is read by window,
// so the counts only fall; splitting a file belongs to the code area, never to the step that holds the count.
// Two lists by file (code review step 1.12, D818, `adminFiles`): the admin's field boxes and pill links written out by hand, in place of the kit.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** An unchecked read: `execute<…>(` on `db()`, a transaction or any other executor. */
export const UNTYPED_READ = /\.execute<[^(]*>\(/g;
export const UNKNOWN_CAST = /\bas unknown as\b/g;
/** A store filter an index cannot serve (`store_id is not distinct from`, step 0.23): filter with `owned(storeId)` (`src/server/owned.ts`). */
export const NOT_DISTINCT_STORE = /store_id\s+is\s+not\s+distinct\s+from/gi;
export const ANY_SUPPRESSED = /eslint-disable(?:-next-line|-line)?[^\n]*no-explicit-any/g;
/**
 * A statement that selects the column `draft` or `published`, a page's whole document, from `commerce.pages` (bloat review step 1.3): a list reads
 * the columns it shows, or one page by its id. `published_at`, `published is not null` and `published -> 'x'` do not count.
 */
export const PAGE_DOCUMENT_READ =
  /\bselect\b(?:(?!`|\bselect\b)[\s\S])*?(?<![\w.])(?:\w+\.)?(?:draft|published)\b(?!_|\s+is\b|\s*->)(?:(?!`|\bselect\b)[\s\S])*?\bfrom\s+commerce\.pages\b/gi;
/** A place that makes every built page of a store stale: refresh the page's own tag instead. */
export const PAGES_TAG_REFRESH = /\b(?:refreshTag|refreshTagNow|invalidate|revalidateTag|updateTag)\(\s*pagesTag\(/g;

/** A source file over this many bytes, or over this many lines, is counted (bloat review step 1.24). */
export const BIG_FILE_BYTES = 100_000;
export const LONG_FILE_LINES = 2_000;

/** Tests, and what only tests use, are not held to it. */
export const TEST_SUPPORT = /(fixtures?|test-support|testing|test-helper|test-days)\.tsx?$/;
const NOT_COUNTED = new RegExp(`(\\.test\\.tsx?$|^src/test/|${TEST_SUPPORT.source})`);

function sources(root, dir) {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.posix.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) return sources(root, rel);
    return /\.tsx?$/.test(name) && !NOT_COUNTED.test(rel) ? [rel] : [];
  });
}

const count = (text, pattern) => (text.match(pattern) ?? []).length;

/** The tables that belong to a store: those `src/db/schema.ts` gives a `store_id` column (`storeId()` or `"store_id"`). */
export function storeTables(root) {
  const schema = readFileSync(path.join(root, "src", "db", "schema.ts"), "utf8");
  const tables = new Set();
  for (const m of schema.matchAll(/commerce\.table\(\s*"(\w+)",\s*\{([\s\S]*?)\n  \}/g)) {
    if (/"store_id"|\bstoreId\(/.test(m[2])) tables.add(m[1]);
  }
  return tables;
}

const WRITE = /(?:update\s+commerce\.(\w+)\b|delete\s+from\s+commerce\.(\w+)\b)([\s\S]*?)(?=`)/gi;
const BY_ID = /(?<![\w])(?:\w+\.)?id\s*(?:=|in\b)/i;
const SCOPED = /store_id|\bowned\(/i;

/** `text` with every backtick inside a `${…}` blanked, so a template nested in a statement (`sql.join(ids.map((id) => sql\`…\`))`) does not end it. */
function flatInterpolations(text) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "$" && text[i + 1] === "{") {
      depth++;
      out += "${";
      i++;
      continue;
    }
    if (depth > 0 && c === "{") depth++;
    else if (depth > 0 && c === "}") depth--;
    out += depth > 0 && c === "`" ? " " : c;
  }
  return out;
}

/** Writes in `text` to one of `tables` that pick their rows by an id and never say the store. */
export function unscopedWrites(text, tables) {
  let n = 0;
  for (const m of flatInterpolations(text).matchAll(WRITE)) {
    if (!tables.has(m[1] ?? m[2])) continue;
    const where = /\bwhere\b([\s\S]*)/i.exec(m[3]);
    if (where && BY_ID.test(where[1]) && !SCOPED.test(where[1])) n++;
  }
  return n;
}

/** The admin's hand-made repeats (bloat review step 1.17, FM-8): five patterns, counted by `adminRepeats()`. */
export const USE_SERVER_FIRST = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*(["'])use server\1/;
export const WRAPPED_ACTION = /\b(?:storeAction|platformAction)\(/;
export const TABLE_TAG = /<table\b/g;
export const SELECT_TAG = /<select\b/g;
export const OSLO_ZONE = "Europe/Oslo";
export const CONFIRM_CALL = /\bconfirm\(/;

/** The admin's kit (code review step 1.12, D818): the one place a field's box, a native `<select>` and a pill are written out. */
export const ADMIN_KIT = "src/components/admin/ui/";

/** The admin's source files the repeats are counted in: every page, layout and part of the three levels (`src/app/admin`, the platform's `P/` and the owner's level included) and `src/components/admin`. */
export function adminSources(root) {
  return [...sources(root, "src/app/admin"), ...sources(root, "src/components/admin")];
}

/** Counts the admin's action files off the shared wrapper, `<table>`s, native `<select>`s (the kit's `Select` aside), files with a literal Oslo zone and files calling `confirm(`. */
export function adminRepeats(root) {
  /** @type {Record<string, number>} */
  const out = { unwrappedActionFiles: 0, tables: 0, nativeSelects: 0, osloFiles: 0, confirmFiles: 0 };
  for (const file of adminSources(root)) {
    const text = readFileSync(path.join(root, file), "utf8");
    if (USE_SERVER_FIRST.test(text) && !WRAPPED_ACTION.test(text)) out.unwrappedActionFiles++;
    if (CONFIRM_CALL.test(text)) out.confirmFiles++;
    if (!file.endsWith(".tsx")) continue;
    out.tables += count(text, TABLE_TAG);
    if (!file.startsWith(ADMIN_KIT)) out.nativeSelects += count(text, SELECT_TAG);
    if (text.includes(OSLO_ZONE)) out.osloFiles++;
  }
  return out;
}

/**
 * A field's box written out by hand (code review step 1.12, FS4): the class string `TextInput`, `Select` and `TextArea` draw
 * (`min-h-10 rounded-md border border-line bg-card px-3`, a width between, or the dense `min-h-9 … px-2`).
 */
export const RAW_FIELD = /\bmin-h-(?:9|10|11)\s+(?:(?:w-\S+|max-w-\S+)\s+)*rounded-md\s+border\s+border-(?:line|edge)\s+bg-card\s+px-[23]\b/g;
const LINK_OPEN = /<(?:Link|AdminLink|a)(?=[\s>/])/g;
const PILL_CLASS = /\bclassName=[\s\S]*\brounded-(?:pill|full)\b/;

/** The opening tag that starts at `start`: up to its `>`, past the `>` of an arrow or a comparison inside `{…}` and of a quoted value. */
function openingTag(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/**
 * Links in `text` made into a pill by hand: a `Link`, `AdminLink` or `a` whose own class string says `rounded-pill` or `rounded-full`
 * (code review step 1.12; the admin audit's phase 3 lint rule for pills). A link that is a button is `ButtonLink` (`buttonClass()`), a
 * state is a `Chip`.
 */
export function handMadePills(text) {
  let n = 0;
  for (const m of text.matchAll(LINK_OPEN)) if (PILL_CLASS.test(openingTag(text, m.index))) n++;
  return n;
}

/** The admin's hand-made field boxes and pill links, by file (only files that have one), the kit aside (code review step 1.12). */
export function adminFiles(root) {
  /** @type {Record<string, number>} */
  const rawFields = {};
  /** @type {Record<string, number>} */
  const pillLinks = {};
  for (const file of adminSources(root).sort()) {
    if (file.startsWith(ADMIN_KIT)) continue;
    const text = readFileSync(path.join(root, file), "utf8");
    const fields = count(text, RAW_FIELD);
    if (fields > 0) rawFields[file] = fields;
    if (!file.endsWith(".tsx")) continue;
    const pills = handMadePills(text);
    if (pills > 0) pillLinks[file] = pills;
  }
  return { rawFields, pillLinks };
}

/** The counts as they stand: untyped reads, writes by id alone and `store_id is not distinct from` uses, by file (only files that have one), and the totals. */
export function ratchetCounts(root) {
  /** @type {Record<string, number>} */
  const untypedReads = {};
  /** @type {Record<string, number>} */
  const byIdWrites = {};
  /** @type {Record<string, number>} */
  const notDistinctStore = {};
  /** @type {Record<string, number>} */
  const pageDocumentReads = {};
  /** @type {Record<string, number>} */
  const pagesTagRefreshes = {};
  const tables = storeTables(root);
  let unknownCasts = 0;
  let anySuppressed = 0;
  let filesOver100Kb = 0;
  let filesOver2000Lines = 0;
  for (const file of sources(root, "src").sort()) {
    const text = readFileSync(path.join(root, file), "utf8");
    const reads = count(text, UNTYPED_READ);
    if (reads > 0) untypedReads[file] = reads;
    const writes = unscopedWrites(text, tables);
    if (writes > 0) byIdWrites[file] = writes;
    const notDistinct = count(text, NOT_DISTINCT_STORE);
    if (notDistinct > 0) notDistinctStore[file] = notDistinct;
    const documents = count(text, PAGE_DOCUMENT_READ);
    if (documents > 0) pageDocumentReads[file] = documents;
    const refreshes = count(text, PAGES_TAG_REFRESH);
    if (refreshes > 0) pagesTagRefreshes[file] = refreshes;
    if (Buffer.byteLength(text) > BIG_FILE_BYTES) filesOver100Kb++;
    if (text.split("\n").length > LONG_FILE_LINES) filesOver2000Lines++;
    unknownCasts += count(text, UNKNOWN_CAST);
    anySuppressed += count(text, ANY_SUPPRESSED);
  }
  return { unknownCasts, anySuppressed, filesOver100Kb, filesOver2000Lines, untypedReads, byIdWrites, notDistinctStore, pageDocumentReads, pagesTagRefreshes, adminRepeats: adminRepeats(root), adminFiles: adminFiles(root) };
}
