import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { SRC, files } from "@/test/import-walk";

import baseline from "./message-keys.baseline.json";

/**
 * An interface key that nothing reads fails (bloat review step 1.4, `docs/rules/budgets.md`). The English catalogue files
 * (`src/lib/admin-messages/*.en.ts` and the storefront's English files) are read with the TypeScript parser: every leaf of an exported
 * object (a string, a template, a function) is a key, with its path from the exported constant. A key is named when its last name is an
 * identifier anywhere in the code outside the catalogue folders (a quoted key is searched as text). MATCHED_TABLES lists the groups
 * whose children are read by a computed key or by matching an English sentence: every leaf under such a parent is exempt, and a single
 * key is never listed.
 *
 * Keys that nothing reads and no table covers stood when this test was written (bloat review step 1.4, after step 0.36 had deleted the
 * ones it was sure of): they are held in `message-keys.baseline.json` (`unread`, as `file#path`), which only shrinks. A new unread key
 * fails: read it, or delete it from every language. Rewrite the list, once keys are deleted (or when growth is accepted on purpose,
 * shown in the diff), with `WRITE_MESSAGE_KEYS_BASELINE=1 pnpm exec vitest run src/lib/message-keys.scan.test.ts`.
 */
const WRITE = process.env.WRITE_MESSAGE_KEYS_BASELINE === "1";
const MESSAGES = join(SRC, "lib/messages");
const CATALOGUES = [
  ...files(join(SRC, "lib/admin-messages")).filter((file) => /\.en\.ts$/.test(file)),
  ...["en.ts", "en-browser.ts", "en-exchange.ts", "en-quotes.ts", "en-returns.ts", "en-reviews.ts", "platform-en.ts"].map((name) => join(MESSAGES, name)),
];

/**
 * `<file relative to src/lib>#<parent path>`: a group read by a computed key, with the file that reads it and what reads it. The path
 * starts at the exported constant, as the keys' own paths do.
 */
const MATCHED_TABLES: { path: string; readBy: string }[] = [
  { path: "admin-messages/discounts.en.ts#discountsEn.problems", readBy: "src/lib/discount-words.ts:discountProblemText() matches a server sentence to a template" },
  { path: "admin-messages/experiments.en.ts#experimentsEn.problems", readBy: "src/lib/experiment-words.ts:experimentProblems() matches a server sentence" },
  { path: "admin-messages/marketing.en.ts#marketingEn.problems", readBy: "src/lib/marketing-words.ts:marketingProblem() matches a server sentence" },
  { path: "admin-messages/payments.en.ts#paymentsEn.problems", readBy: "src/app/admin/(gated)/actions.ts:knownText() matches a server sentence" },
  { path: "admin-messages/tax.en.ts#taxEn.problems", readBy: "src/app/admin/(gated)/[store]/settings/tax/actions.ts:knownText() matches a server sentence" },
  { path: "admin-messages/tax-reports.en.ts#taxReportsEn.problems", readBy: "src/lib/tax-report-words.ts:rateProblemText() matches a server sentence" },
  { path: "admin-messages/payments.en.ts#paymentsEn.methods.reasons", readBy: "src/lib/payment-methods.ts:stateReason() reads Stripe's reason code" },
  { path: "admin-messages/work.en.ts#workEn.errors.messages", readBy: "src/server/work-errors.ts:WORK_ERROR_MESSAGES is read by the error's code" },
  { path: "admin-messages/books.en.ts#booksEn.vatReturn.tripletex.delivery", readBy: "src/app/admin/(gated)/[store]/settings/books/vat/[term]/page.tsx:t.delivery[status]" },
  { path: "admin-messages/screens.en.ts#screensEn.analyticsNotes.subscriptions.unconverted", readBy: "src/server/analytics-subscriptions-data.ts:NOTES.unconverted[key]" },
  { path: "admin-messages/platform.en.ts#platformEn.invoiceList.status", readBy: "src/components/admin/plan-invoices.tsx:words.status[invoice.status]" },
  { path: "admin-messages/order.en.ts#orderEn.events", readBy: "src/app/admin/(gated)/[store]/orders/[orderId]/page.tsx:words.events[event.type]" },
];

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

type Leaf = { path: string; last: string };

function unwrap(node: ts.Expression): ts.Expression {
  let at = node;
  while (ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isParenthesizedExpression(at)) at = at.expression;
  return at;
}
const nameOf = (name: ts.PropertyName) => (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : null);

/** The leaves of `text`'s exported constants that are object literals, as paths from the constant. */
function leavesOf(fileName: string, text: string): Leaf[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: Leaf[] = [];
  const walk = (object: ts.ObjectLiteralExpression, path: string) => {
    for (const property of object.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        found.push({ path: `${path}.${property.name.text}`, last: property.name.text });
      } else if (ts.isPropertyAssignment(property)) {
        const name = nameOf(property.name);
        if (name === null) continue;
        const value = unwrap(property.initializer);
        if (ts.isObjectLiteralExpression(value)) walk(value, `${path}.${name}`);
        else found.push({ path: `${path}.${name}`, last: name });
      }
    }
  };
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const value = declaration.initializer && unwrap(declaration.initializer);
      if (value && ts.isObjectLiteralExpression(value) && ts.isIdentifier(declaration.name)) walk(value, declaration.name.text);
    }
  }
  return found;
}

/** The unnamed leaves of `text`, each as `<file>#<path>`, outside the matched tables. */
function unnamed(fileName: string, text: string, words: Set<string>, code: string, matched: string[]): string[] {
  return leavesOf(fileName, text)
    .filter((leaf) => !words.has(leaf.last) && !(!IDENTIFIER.test(leaf.last) && code.includes(leaf.last)))
    .map((leaf) => `${fileName}#${leaf.path}`)
    .filter((key) => !matched.some((table) => key.startsWith(`${table}.`)));
}

function codeWords(): { words: Set<string>; code: string } {
  const words = new Set<string>();
  const texts: string[] = [];
  const folders = [join(SRC, "lib/admin-messages") + "/", MESSAGES + "/"];
  for (const file of files(SRC)) {
    if (folders.some((folder) => file.startsWith(folder))) continue;
    const text = readFileSync(file, "utf8");
    texts.push(text);
    for (const match of text.matchAll(/[A-Za-z_$][\w$]*/g)) words.add(match[0]);
  }
  return { words, code: texts.join("\n") };
}

const short = (file: string) => file.slice(join(SRC, "lib").length + 1);
const allUnnamed = (words: Set<string>, code: string, matched: string[]) =>
  CATALOGUES.flatMap((file) => unnamed(short(file), readFileSync(file, "utf8"), words, code, matched)).sort();
const ENGLISH = codeWords();
const MATCHED = MATCHED_TABLES.map((table) => table.path);

describe.runIf(WRITE)("the baseline writer", () => {
  it("writes the baseline", () => {
    writeFileSync(join(SRC, "lib/message-keys.baseline.json"), JSON.stringify({ unread: allUnnamed(ENGLISH.words, ENGLISH.code, MATCHED) }, null, 2) + "\n");
  });
});

describe.skipIf(WRITE)("interface keys that nothing reads (bloat review step 1.4)", () => {
  it("finds the English catalogue files", () => {
    expect(CATALOGUES.length).toBeGreaterThan(70);
    expect(leavesOf("x.en.ts", "export const a = { b: { c: 'x' } } as const;").map((leaf) => leaf.path)).toEqual(["a.b.c"]);
  });

  it("every key is named in code or sits in a table read by matching", () => {
    const known = new Set(baseline.unread);
    expect(
      allUnnamed(ENGLISH.words, ENGLISH.code, MATCHED).filter((key) => !known.has(key)),
      "Nothing reads this key: delete it from every language, or, if a table is read by a computed key, add its parent to MATCHED_TABLES with the file that reads it.",
    ).toEqual([]);
  });

  it("the list of unread keys is as short as the code", () => {
    const now = new Set(allUnnamed(ENGLISH.words, ENGLISH.code, MATCHED));
    expect(
      baseline.unread.filter((key) => !now.has(key)),
      "These keys are read or deleted now: rewrite the list with WRITE_MESSAGE_KEYS_BASELINE=1 pnpm exec vitest run src/lib/message-keys.scan.test.ts",
    ).toEqual([]);
  });

  it("every matched table is still there and still read", () => {
    for (const table of MATCHED_TABLES) {
      const [file, path] = table.path.split("#");
      const leaves = leavesOf(file, readFileSync(join(SRC, "lib", file), "utf8")).map((leaf) => leaf.path);
      expect(leaves.some((leaf) => leaf.startsWith(`${path}.`)), `${table.path} is gone: take it off MATCHED_TABLES`).toBe(true);
      const reader = table.readBy.split(":")[0];
      const last = path.split(".").at(-1)!;
      expect(readFileSync(join(process.cwd(), reader), "utf8"), `${reader} no longer names ${last}: take ${table.path} off MATCHED_TABLES`).toContain(last);
    }
  });

  it("no single key is a matched table", () => {
    for (const table of MATCHED_TABLES) {
      const [file, path] = table.path.split("#");
      const leaves = leavesOf(file, readFileSync(join(SRC, "lib", file), "utf8")).map((leaf) => leaf.path);
      expect(leaves, `${table.path} is a key, not a group of keys`).not.toContain(path);
    }
  });

  it("would notice: a made-up catalogue", () => {
    const text = 'export const xEn = { used: "a", neverReadKeyQq: "b", table: { a: "x" } } as const;';
    const known = new Set(["used"]);
    expect(unnamed("x", text, known, "", [])).toEqual(["x#xEn.neverReadKeyQq", "x#xEn.table.a"]);
    expect(unnamed("x", text, known, "", ["x#xEn.table"])).toEqual(["x#xEn.neverReadKeyQq"]);
  });
});
