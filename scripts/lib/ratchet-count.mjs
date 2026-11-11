// What the ratchet of code review step 1.2 counts (findings FD6 and FH11), shared by `scripts/ratchet.mjs` (which writes the
// baseline) and `src/server/ratchet.scan.test.ts` (which holds the code to it): in every source file under `src`, tests and test
// support aside, the reads that are not checked (`execute<…>(`, never through `typedRows()`), and in total the casts through
// `unknown` (`as unknown as`) and the lines that switch off the linter's `any` rule.
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

/** The counts as they stand: untyped reads by file (only files that have one), and the two totals. */
export function ratchetCounts(root) {
  const untypedReads = {};
  let unknownCasts = 0;
  let anySuppressed = 0;
  for (const file of sources(root, "src").sort()) {
    const text = readFileSync(path.join(root, file), "utf8");
    const reads = count(text, UNTYPED_READ);
    if (reads > 0) untypedReads[file] = reads;
    unknownCasts += count(text, UNKNOWN_CAST);
    anySuppressed += count(text, ANY_SUPPRESSED);
  }
  return { unknownCasts, anySuppressed, untypedReads };
}
