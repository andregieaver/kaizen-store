// What the unused-code budget of bloat review step 1.17 counts (findings DD-4, GAP-code-2 and GAP-code-3), shared by `scripts/unused.mjs`
// (which writes `src/server/unused.baseline.json`) and `src/server/unused.scan.test.ts` (which holds the code to it). It is the review's
// own scan (docs/audits/bloat-review-2026-11/scripts/unused-code.mjs, the repo's TypeScript parser, no outside tool) as a library, with
// the same rules and without writing a file:
//   unusedScan(root)           { unusedExports, testOnlyExports, testOnlyFiles }: 'file#name' lists and paths, sorted;
//   unreferencedPublic(root)   the files under public/ nothing in the code names;
//   unreferencedApiRoutes(root) the route handlers under src/app/api whose URL nothing names.
// Entry points are Next's convention files under src/app, src/proxy.ts, src/instrumentation.ts, scripts/** and the config files. Tests
// are *.test.*, *.spec.*, e2e/**, e2e-live/**, src/test/** and test support (`TEST_SUPPORT`). The exports of convention files, of
// src/proxy.ts and `register` of src/instrumentation.ts are skipped (Next reads them); a namespace import, an `export *` or an import() of a file marks all its exports used.
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { TEST_SUPPORT } from "./ratchet-count.mjs";

const CONVENTION = /\/(page|layout|route|loading|error|not-found|default|template|global-error|global-not-found|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest|forbidden|unauthorized)\.(ts|tsx)$/;
const CONFIG_FILES = ["next.config.ts", "drizzle.config.ts", "playwright.config.ts", "playwright.live.config.ts", "vitest.config.mts", "vitest.integration.config.mts", "eslint.config.mjs", "postcss.config.mjs"];

function walkFiles(root, dir, accept, acc = []) {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return acc;
  for (const name of readdirSync(abs).sort()) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".git")) continue;
    const rel = path.posix.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) walkFiles(root, rel, accept, acc);
    else if (accept(name)) acc.push(rel);
  }
  return acc;
}

/** The unused-code scan: exports nothing imports, exports only tests import, files only tests reach. */
export function unusedScan(root) {
  const ts = createRequire(`${root}/`)("typescript");
  const code = (name) => /\.(ts|tsx|mts|mjs|js)$/.test(name) && !name.endsWith(".d.ts");
  const files = [
    ...walkFiles(root, "src", code),
    ...walkFiles(root, "scripts", code),
    ...walkFiles(root, "e2e", code),
    ...walkFiles(root, "e2e-live", code),
    ...walkFiles(root, "test", code),
    ...CONFIG_FILES.filter((f) => existsSync(path.join(root, f))),
  ];
  const fileSet = new Set(files);
  const isTest = (p) =>
    /\.(test|spec)\.(ts|tsx|mts)$/.test(p) || p.startsWith("e2e/") || p.startsWith("e2e-live/") || p.startsWith("src/test/") || p.startsWith("test/") || /\/(test-support|testing|fixtures)\//.test(`/${p}`) || TEST_SUPPORT.test(p);
  const isConvention = (p) => p.startsWith("src/app/") && CONVENTION.test(`/${p}`);
  const isEntry = (p) => isConvention(p) || p === "src/proxy.ts" || p === "src/instrumentation.ts" || p.startsWith("scripts/") || (!p.startsWith("src/") && !isTest(p));

  const tsconfig = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile).config;
  const options = ts.parseJsonConfigFileContent(tsconfig, ts.sys, root).options;
  const moduleCache = ts.createModuleResolutionCache(root, (x) => x, options);
  const resolveImport = (spec, from) => {
    if (!spec.startsWith(".") && !spec.startsWith("@/") && !spec.startsWith("~/")) return null;
    const r = ts.resolveModuleName(spec, path.join(root, from), options, ts.sys, moduleCache).resolvedModule;
    if (r) {
      const rel = path.relative(root, r.resolvedFileName).split(path.sep).join("/");
      if (fileSet.has(rel)) return rel;
    }
    for (const ext of ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"]) {
      const rel = path.posix.join(path.posix.dirname(from), spec + ext);
      if (fileSet.has(rel)) return rel;
    }
    return null;
  };

  const info = new Map();
  for (const file of files) {
    const text = readFileSync(path.join(root, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : undefined);
    const exports = new Map();
    const imports = [];
    const idCount = new Map();
    const addExport = (name) => exports.set(name, true);
    const addImport = (spec, names) => {
      const to = resolveImport(spec, file);
      if (to) imports.push({ to, names });
    };
    const hasMod = (node, kind) => (ts.getModifiers?.(node) ?? node.modifiers ?? []).some((m) => m.kind === kind);
    const visit = (node) => {
      if (ts.isIdentifier(node)) idCount.set(node.text, (idCount.get(node.text) ?? 0) + 1);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        let names = new Set();
        if (!clause) names = "*";
        else {
          if (clause.name) names.add("default");
          const b = clause.namedBindings;
          if (b && ts.isNamespaceImport(b)) names = "*";
          else if (b && ts.isNamedImports(b)) for (const el of b.elements) names.add((el.propertyName ?? el.name).text);
        }
        addImport(node.moduleSpecifier.text, names);
      } else if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          if (!node.exportClause) {
            addImport(node.moduleSpecifier.text, "*");
            exports.set(`*:${node.moduleSpecifier.text}`, true);
          } else if (ts.isNamedExports(node.exportClause)) {
            const names = new Set();
            for (const el of node.exportClause.elements) {
              names.add((el.propertyName ?? el.name).text);
              addExport(el.name.text);
            }
            addImport(node.moduleSpecifier.text, names);
          } else addImport(node.moduleSpecifier.text, "*");
        } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) addExport(el.name.text);
        }
      } else if (ts.isExportAssignment(node)) addExport("default");
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        addImport(node.arguments[0].text, "*");
      } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        addImport(node.arguments[0].text, "*");
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        addImport(node.argument.literal.text, "*");
      }
      if (hasMod(node, ts.SyntaxKind.ExportKeyword)) {
        const isDefault = hasMod(node, ts.SyntaxKind.DefaultKeyword);
        if (ts.isVariableStatement(node)) {
          for (const d of node.declarationList.declarations) {
            if (ts.isIdentifier(d.name)) addExport(d.name.text);
            else d.name.elements?.forEach((el) => ts.isIdentifier(el.name) && addExport(el.name.text));
          }
        } else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) addExport(isDefault ? "default" : (node.name?.text ?? "default"));
        else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) addExport(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    info.set(file, { exports, imports, idCount });
  }

  const reach = (roots) => {
    const seen = new Set(roots);
    const queue = [...roots];
    while (queue.length) {
      const f = queue.pop();
      for (const imp of info.get(f)?.imports ?? []) {
        if (!seen.has(imp.to)) {
          seen.add(imp.to);
          queue.push(imp.to);
        }
      }
    }
    return seen;
  };
  const prod = reach(files.filter((f) => isEntry(f) && !isTest(f)));
  const withTests = reach(files.filter((f) => isEntry(f) || isTest(f)));
  const src = files.filter((f) => f.startsWith("src/") && !isTest(f));
  const testOnlyFiles = src.filter((f) => !prod.has(f) && withTests.has(f));

  const usedBy = new Map();
  const mark = (to, name, test) => {
    if (!usedBy.has(to)) usedBy.set(to, new Map());
    const m = usedBy.get(to);
    const e = m.get(name) ?? { prod: 0, test: 0 };
    if (test) e.test++;
    else e.prod++;
    m.set(name, e);
  };
  for (const [file, { imports }] of info) {
    const test = isTest(file);
    for (const imp of imports) {
      if (imp.names === "*") mark(imp.to, "*", test);
      else for (const name of imp.names) mark(imp.to, name, test);
    }
  }
  const unusedExports = [];
  const testOnlyExports = [];
  for (const file of src) {
    if (isConvention(file) || file === "src/proxy.ts") continue;
    const { exports, idCount } = info.get(file);
    if (file === "src/instrumentation.ts") exports.delete("register"); // Next calls it by name
    const uses = usedBy.get(file) ?? new Map();
    const star = uses.get("*");
    for (const name of exports.keys()) {
      if (name.startsWith("*:")) continue;
      const u = uses.get(name);
      if (u?.prod || star?.prod) continue;
      const usedInside = (idCount.get(name) ?? 0) > 1 && name !== "default";
      if (u?.test || star?.test) {
        if (!usedInside) testOnlyExports.push(`${file}#${name}`);
        continue;
      }
      if (!usedInside) unusedExports.push(`${file}#${name}`);
    }
  }
  return { unusedExports: unusedExports.sort(), testOnlyExports: testOnlyExports.sort(), testOnlyFiles: testOnlyFiles.sort() };
}

/** The text of every file under `dirs` (a folder or a file) that `accept`s its name, as [path, text]. */
function textsOf(root, dirs, accept) {
  const out = [];
  for (const d of dirs) {
    const abs = path.join(root, d);
    if (!existsSync(abs)) continue;
    const list = statSync(abs).isDirectory() ? walkFiles(root, d, accept) : [d];
    for (const rel of list) out.push([rel, readFileSync(path.join(root, rel), "utf8")]);
  }
  return out;
}

const isTextName = (name) => /\.(ts|tsx|mts|mjs|cjs|js|json|md|mdx|php|css|sql|html|txt|xml|yml|yaml|webmanifest)$/.test(name);

/**
 * Every file under public/ whose path from public/ (with a leading slash) or whose file name appears in no file under src, scripts, e2e (a file a Playwright test loads is in use), content,
 * wordpress-plugin, next.config.ts or vercel.json. A folder whose files are addressed by a built name is matched by its folder: if the text
 * '/flags/' appears in src, every file under public/flags is referenced.
 */
export function unreferencedPublic(root) {
  // One pass over the text with every file name as one alternation, instead of searching megabytes of text once per file.
  const publicFiles = walkFiles(root, "public", () => true);
  const names = [...new Set(publicFiles.map((rel) => path.posix.basename(rel)))];
  const named = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const seen = new Set();
  const folders = new Set(publicFiles.map((rel) => path.posix.dirname(rel.slice("public".length))).filter((f) => f !== "/"));
  const folderSeen = new Set();
  const texts = textsOf(root, ["src", "scripts", "e2e", "content", "wordpress-plugin", "next.config.ts", "vercel.json"], isTextName);
  for (const [, text] of texts) {
    for (const m of text.matchAll(named)) seen.add(m[0]);
    for (const f of folders) if (!folderSeen.has(f) && text.includes(`${f}/`)) folderSeen.add(f);
  }
  // An alternation takes the first name at a place, so a name inside a longer one ("a.png" in "big-a.png") is looked for on its own, but
  // only where its folder is not already named.
  const open = publicFiles.filter((rel) => !seen.has(path.posix.basename(rel)) && !folderSeen.has(path.posix.dirname(rel.slice("public".length))));
  for (const rel of open) {
    const name = path.posix.basename(rel);
    if (texts.some(([, text]) => text.includes(name))) seen.add(name);
  }
  return publicFiles
    .filter((rel) => !seen.has(path.posix.basename(rel))) // the file name is part of its path, so this covers the path too
    .filter((rel) => !folderSeen.has(path.posix.dirname(rel.slice("public".length))))
    .sort();
}

/**
 * Every route.ts under src/app/api whose URL path (dynamic segments cut at the first '[') appears in no non-test file under src but itself, in
 * no file under scripts, e2e, wordpress-plugin, content or docs/rules, in vercel.json or in supabase/migrations/*.sql (the scheduler calls
 * /api/cron/<name> from SQL).
 */
export function unreferencedApiRoutes(root) {
  const routes = walkFiles(root, "src/app/api", (name) => /^route\.tsx?$/.test(name));
  const inSrc = textsOf(root, ["src"], (name) => /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name) && !TEST_SUPPORT.test(name));
  const elsewhere = textsOf(root, ["scripts", "e2e", "wordpress-plugin", "content", "docs/rules", "vercel.json", "supabase/migrations"], (name) => isTextName(name));
  return routes
    .filter((route) => {
      const url = `/${path.posix.dirname(route).slice("src/app/".length)}`.replace(/\/\([^/]+\)/g, "");
      const cut = url.includes("[") ? url.slice(0, url.indexOf("[")) : url;
      const needle = cut;
      if (inSrc.some(([file, text]) => file !== route && text.includes(needle))) return false;
      return !elsewhere.some(([, text]) => text.includes(needle));
    })
    .map((route) => {
      const url = `/${path.posix.dirname(route).slice("src/app/".length)}`.replace(/\/\([^/]+\)/g, "");
      return url;
    })
    .sort();
}
