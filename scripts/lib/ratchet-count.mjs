// What the ratchet of code review step 1.2 counts (findings FD6 and FH11), shared by `scripts/ratchet.mjs` (which writes the
// baseline) and `src/server/ratchet.scan.test.ts` (which holds the code to it): in every source file under `src`, tests and test
// support aside, the reads that are not checked (`execute<…>(`, never through `typedRows()`), the writes that address a store's row
// by its id alone (code review step 1.3, FV5: `update`/`delete` of a table with a `store_id` whose `where` names the id and not the
// store), and in total the casts through `unknown` (`as unknown as`) and the lines that switch off the linter's `any` rule.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** An unchecked read: `execute<…>(` on `db()`, a transaction or any other executor. */
export const UNTYPED_READ = /\.execute<[^(]*>\(/g;
export const UNKNOWN_CAST = /\bas unknown as\b/g;
export const ANY_SUPPRESSED = /eslint-disable(?:-next-line|-line)?[^\n]*no-explicit-any/g;

/** Tests, and what only tests use, are not held to it. */
const NOT_COUNTED = /(\.test\.tsx?$|^src\/test\/|fixture\.ts$|test-support\.ts$)/;

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

/** The counts as they stand: untyped reads and writes by id alone, by file (only files that have one), and the two totals. */
export function ratchetCounts(root) {
  const untypedReads = {};
  const byIdWrites = {};
  const tables = storeTables(root);
  let unknownCasts = 0;
  let anySuppressed = 0;
  for (const file of sources(root, "src").sort()) {
    const text = readFileSync(path.join(root, file), "utf8");
    const reads = count(text, UNTYPED_READ);
    if (reads > 0) untypedReads[file] = reads;
    const writes = unscopedWrites(text, tables);
    if (writes > 0) byIdWrites[file] = writes;
    unknownCasts += count(text, UNKNOWN_CAST);
    anySuppressed += count(text, ANY_SUPPRESSED);
  }
  return { unknownCasts, anySuppressed, untypedReads, byIdWrites };
}
