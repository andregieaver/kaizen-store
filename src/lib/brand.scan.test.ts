import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The platform is Kaizena Flow (D240, `docs/theme-store.md` 8): every word a person or an assistant reads says so. This walks the source's string literals,
 * template text and JSX text (never identifiers, property names or comments, which keep `Kaizen` in their names) and fails on the old name or the old domains. Kaizen Life is
 * another product and keeps its name; the retention seed keeps the words its migration stored, since the two are compared (`src/db/privacy.test.ts`).
 */
const ROOT = process.cwd();
const ALLOWED_FILES = new Set(["src/lib/retention.ts"]);
const OLD = [/\bKaizen(?:s|'s)?\b(?! Life)(?!a)/, /kaizenstore\.cloud/, /kaizenalabs\.com/];

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

function oldNames(file: string): string[] {
  const src = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (TEXT.has(node.kind)) {
      const parent = node.parent;
      const isImport = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent);
      // A property name is a key, not words: HTTP headers such as `X-Kaizen-Event` are read by receivers' own setups and keep their names.
      const isKey = ts.isPropertyAssignment(parent) && parent.name === node;
      const text = node.getText(sf);
      if (!isImport && !isKey && OLD.some((re) => re.test(text))) found.push(`${relative(ROOT, join(ROOT, file))}: ${text.slice(0, 120)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("the platform's name in what people read (D240)", () => {
  const files = sources("src").filter((file) => !ALLOWED_FILES.has(file));

  it("walks the app's source", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("never says Kaizen or an old domain where Kaizena Flow is meant", () => {
    expect(files.flatMap(oldNames)).toEqual([]);
  });
});
