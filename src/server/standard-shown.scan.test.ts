import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A product's page reads what it shows of its standard category from `products.standard_shown` (bloat review step 2.23), never from the
 * taxonomy's files. The dispatcher's `standardShown` job derives the words of a product whose words are missing or from an older release,
 * and only asks for those: so every statement that writes a product's `standard_category` or `standard_attributes` writes `standard_shown`
 * in the same statement (a new row without it leaves it null, which the job finds). A statement that changed the category alone would
 * leave the old words with the current release's key, and the page would show the old category for good.
 */

const ROOT = process.cwd();
const WRITES_PRODUCTS = /\bupdate\s+commerce\.products\b|\binsert\s+into\s+commerce\.products\b/i;
const NAMES_CATEGORY = /\bstandard_(?:category|attributes)\b/;
const NAMES_SHOWN = /\bstandard_shown\b/;
const WHY =
  "a statement that writes the standard category must write standard_shown in the same statement (or the dispatcher's job will never see the change): see src/server/products.ts";

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every sql`…` template in `text`, whole: its nested `${…}` and the templates inside them included. */
function sqlTemplates(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\bsql`/g)) {
    const start = match.index + match[0].length;
    // A stack of what is open: "`" a template, "{" a brace inside `${…}`.
    const open: string[] = ["`"];
    let at = start;
    while (at < text.length && open.length > 0) {
      const ch = text[at];
      const top = open[open.length - 1];
      if (ch === "\\") at++;
      else if (top === "`") {
        if (ch === "`") open.pop();
        else if (ch === "$" && text[at + 1] === "{") {
          open.push("{");
          at++;
        }
      } else if (ch === "{") open.push("{");
      else if (ch === "}") open.pop();
      else if (ch === "`") open.push("`");
      at++;
    }
    found.push(text.slice(start, at - 1));
  }
  return found;
}

/** The statements of `text` that write a product's standard category without writing standard_shown. */
function blindWriters(text: string): string[] {
  return sqlTemplates(text).filter((statement) => WRITES_PRODUCTS.test(statement) && NAMES_CATEGORY.test(statement) && !NAMES_SHOWN.test(statement));
}

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const files = sources("src").map((path) => relative(ROOT, join(ROOT, path)));
const writers = files
  .map((path) => ({ path, statements: sqlTemplates(read(path)).filter((s) => WRITES_PRODUCTS.test(s) && NAMES_CATEGORY.test(s)) }))
  .filter((file) => file.statements.length > 0);

describe("every writer of a product's standard category also writes standard_shown (bloat review 2.23)", () => {
  it("every writer of a product's standard category also writes standard_shown", () => {
    const blind = files.flatMap((path) => blindWriters(read(path)).map(() => path));
    expect(blind, WHY).toEqual([]);
  });

  it("finds today's writer: the update and the insert of saveProduct()", () => {
    console.info(`standard-shown: ${writers.map((w) => `${w.path} (${w.statements.length})`).join(", ")}`);
    expect(writers.map((w) => w.path)).toEqual(["src/server/products.ts"]);
    expect(writers[0].statements).toHaveLength(2);
  });

  it("notices a statement that writes standard_attributes without standard_shown", () => {
    const planted =
      "await tx.execute(sql`update commerce.products set standard_attributes = ${sql`${json}::jsonb`} where id = ${id}::uuid`);\n" +
      "await tx.execute(sql`update commerce.products set standard_category = ${c}, standard_shown = null where id = ${id}::uuid`);";
    expect(blindWriters(planted)).toHaveLength(1);
    expect(blindWriters(planted)[0]).toContain("standard_attributes");
  });
});
