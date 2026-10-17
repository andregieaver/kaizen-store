import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * One concept, themes (D273, `docs/themes-unified.md`): a person or an assistant reads *theme*, *preset* and *demo store*, never the names
 * the same things had before (design profile, store template), which stay in code names only (`design_presets`, `starters`). This
 * walks the source's string literals, template text and JSX text (never identifiers, property names or comments) and fails on the old
 * words, in the four hand-written languages too.
 */
const ROOT = process.cwd();
const OLD = [/design[ -]profiles?/i, /store[ -]templates?/i, /\bbutikkmal/i, /\bbutiksmall/i, /\bbutiksskabelon/i];

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
  });
}

const TEXT = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);

/** Inside the admin map's search words (`keywords`), where the old names stay so that a person searching for them finds the page. */
function inKeywords(node: ts.Node): boolean {
  const list = node.parent;
  return ts.isArrayLiteralExpression(list) && ts.isPropertyAssignment(list.parent) && list.parent.name.getText() === "keywords";
}

/** A string that is a name in code, not words: a path, an import, a key, a type or an identifier-like token. */
function isCode(node: ts.Node, text: string): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isLiteralTypeNode(parent) || inKeywords(node)) return true;
  // A single token: an audit action, a type, a key, a path (`store_starter`, `starter_id`, `/design-profiles/`).
  return !/\s/.test(text.replace(/^[`'"]|[`'"]$/g, "").trim());
}

function oldWords(file: string): string[] {
  const src = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (TEXT.has(node.kind)) {
      // A SQL text's comments are code comments, read by nobody using the site.
      const text = node.getText(sf).replace(/--[^\n]*/g, "");
      if (!isCode(node, text) && OLD.some((re) => re.test(text))) found.push(`${relative(ROOT, join(ROOT, file))}: ${text.slice(0, 140)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("themes, presets and demo stores in what people read (D273)", () => {
  const files = sources("src");

  it("walks the app's source", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("never says design profile or store template", () => {
    expect(files.flatMap(oldWords)).toEqual([]);
  });
});
