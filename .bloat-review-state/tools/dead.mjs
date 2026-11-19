#!/usr/bin/env node
// Finds files and exports nothing uses (bloat review). Own script on the repo's TypeScript; no outside tool.
//   node dead.mjs <outDir>
// Method: parse every source file, resolve its imports (tsconfig paths), then
//  - files: walk from the production entry points (Next's file conventions under src/app, src/proxy.ts, next.config.ts,
//    scripts/, config files). A file no walk reaches is "unreachable"; one reached only from tests is "tests only".
//  - exports: an export is "unused" when no other file imports that name from that file (a namespace import, an
//    `export *` or a dynamic import() of the file counts as using every export). "tests only" when only test files do.
//    "own file only" when the name is used inside its own file (the export keyword is unneeded).
// Blind spots are written to dead-notes.txt.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const REPO = "/home/user/kaizen-store";
const require = createRequire(REPO + "/");
const ts = require("typescript");
const out = process.argv[2];

const walk = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".git")) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, acc);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name) && !name.endsWith(".d.ts")) acc.push(path);
  }
  return acc;
};
const files = [...walk(join(REPO, "src")), ...walk(join(REPO, "scripts")), ...walk(join(REPO, "e2e")), ...walk(join(REPO, "e2e-live")), ...(existsSync(join(REPO, "test")) ? walk(join(REPO, "test")) : [])];
for (const f of ["next.config.ts", "drizzle.config.ts", "playwright.config.ts", "playwright.live.config.ts", "vitest.config.mts", "vitest.integration.config.mts", "eslint.config.mjs", "postcss.config.mjs"]) if (existsSync(join(REPO, f))) files.push(join(REPO, f));
const fileSet = new Set(files);
const rel = (p) => relative(REPO, p);
const isTest = (p) => /\.(test|spec)\.(ts|tsx|mts)$/.test(p) || p.includes("/e2e/") || p.includes("/e2e-live/") || p.includes("/src/test/") || p.startsWith(join(REPO, "test") + "/") || /\/(test-support|testing|fixtures)\//.test(p);
const CONVENTION = /\/(page|layout|route|loading|error|not-found|default|template|global-error|global-not-found|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest|forbidden|unauthorized)\.(ts|tsx)$/;
const isConvention = (p) => p.startsWith(join(REPO, "src/app") + "/") && CONVENTION.test(p);
const isEntry = (p) => isConvention(p) || p === join(REPO, "src/proxy.ts") || p === join(REPO, "src/instrumentation.ts") || p.startsWith(join(REPO, "scripts") + "/") || !p.startsWith(join(REPO, "src") + "/") && !isTest(p);

const tsconfig = ts.readConfigFile(join(REPO, "tsconfig.json"), ts.sys.readFile).config;
const options = ts.parseJsonConfigFileContent(tsconfig, ts.sys, REPO).options;
const cache = ts.createModuleResolutionCache(REPO, (x) => x, options);
const resolveImport = (spec, from) => {
  if (!spec.startsWith(".") && !spec.startsWith("@/") && !spec.startsWith("~/")) return null;
  const r = ts.resolveModuleName(spec, from, options, ts.sys, cache).resolvedModule;
  if (r && fileSet.has(r.resolvedFileName)) return r.resolvedFileName;
  // .mjs scripts importing with an extension, or a file the resolver does not take.
  for (const ext of ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"]) {
    const p = resolve(dirname(from), spec + ext);
    if (fileSet.has(p)) return p;
  }
  return null;
};

const info = new Map(); // file -> { exports: Map(name -> {line, kind, lines}), imports: [{to, names:Set|"*"}], localUses: Map(name->count), lines }
const packages = new Map(); // bare package -> Set(files)
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : undefined);
  const exports = new Map();
  const imports = [];
  const idCount = new Map();
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const linesOf = (node) => sf.getLineAndCharacterOfPosition(node.getEnd()).line - sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const addExport = (name, node, kind) => exports.set(name, { line: lineOf(node), kind, lines: linesOf(node) });
  const addImport = (spec, names, node) => {
    const to = resolveImport(spec, file);
    if (to) imports.push({ to, names });
    else if (!spec.startsWith(".") && !spec.startsWith("@/")) {
      const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (!packages.has(pkg)) packages.set(pkg, new Set());
      packages.get(pkg).add(rel(file));
    }
  };
  const hasMod = (node, kind) => (ts.getModifiers?.(node) ?? node.modifiers ?? []).some((m) => m.kind === kind);
  const visit = (node) => {
    if (ts.isIdentifier(node)) idCount.set(node.text, (idCount.get(node.text) ?? 0) + 1);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      let names = new Set();
      if (!clause) names = "*"; // side-effect import: the module runs
      else {
        if (clause.name) names.add("default");
        const b = clause.namedBindings;
        if (b && ts.isNamespaceImport(b)) names = "*";
        else if (b && ts.isNamedImports(b)) for (const el of b.elements) names.add((el.propertyName ?? el.name).text);
      }
      addImport(node.moduleSpecifier.text, names, node);
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        // A re-export uses the names it passes on, and exposes them from this file too.
        if (!node.exportClause) { addImport(node.moduleSpecifier.text, "*", node); exports.set("*:" + node.moduleSpecifier.text, { line: lineOf(node), kind: "export *", lines: 1 }); }
        else if (ts.isNamedExports(node.exportClause)) {
          const names = new Set();
          for (const el of node.exportClause.elements) { names.add((el.propertyName ?? el.name).text); addExport(el.name.text, el, "re-export"); }
          addImport(node.moduleSpecifier.text, names, node);
        } else addImport(node.moduleSpecifier.text, "*", node);
      } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) addExport(el.name.text, el, "named");
      }
    } else if (ts.isExportAssignment(node)) addExport("default", node, "default");
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      addImport(node.arguments[0].text, "*", node);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      addImport(node.arguments[0].text, "*", node);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      addImport(node.argument.literal.text, "*", node);
    }
    if (hasMod(node, ts.SyntaxKind.ExportKeyword)) {
      const isDefault = hasMod(node, ts.SyntaxKind.DefaultKeyword);
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) addExport(d.name.text, node, "const");
          else d.name.elements?.forEach((el) => ts.isIdentifier(el.name) && addExport(el.name.text, node, "const"));
        }
      } else if (ts.isFunctionDeclaration(node)) addExport(isDefault ? "default" : node.name?.text ?? "default", node, "function");
      else if (ts.isClassDeclaration(node)) addExport(isDefault ? "default" : node.name?.text ?? "default", node, "class");
      else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) addExport(node.name.text, node, "type");
      else if (ts.isEnumDeclaration(node)) addExport(node.name.text, node, "enum");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  info.set(file, { exports, imports, idCount, lines: text.split("\n").length, useClient: /^\s*["']use client["']/.test(text), useServer: /^\s*["']use server["']/.test(text) });
}

// ---- Files: reachability.
const reach = (roots) => {
  const seen = new Set(roots);
  const queue = [...roots];
  while (queue.length) {
    const f = queue.pop();
    for (const imp of info.get(f)?.imports ?? []) if (!seen.has(imp.to)) { seen.add(imp.to); queue.push(imp.to); }
  }
  return seen;
};
const prodRoots = files.filter((f) => isEntry(f) && !isTest(f));
const prod = reach(prodRoots);
const withTests = reach(files.filter((f) => isEntry(f) || isTest(f)));
const src = files.filter((f) => f.startsWith(join(REPO, "src") + "/") && !isTest(f));
const unreachable = src.filter((f) => !withTests.has(f));
const testsOnly = src.filter((f) => !prod.has(f) && withTests.has(f));
// A test whose subject is not reachable from production tests dead code.
const lines = (list) => list.reduce((n, f) => n + info.get(f).lines, 0);

// ---- Exports: who imports which name from which file.
const usedBy = new Map(); // file -> Map(name -> {prod: n, test: n}); "*" marks everything used
const mark = (to, name, test) => {
  if (!usedBy.has(to)) usedBy.set(to, new Map());
  const m = usedBy.get(to);
  const e = m.get(name) ?? { prod: 0, test: 0 };
  if (test) e.test++; else e.prod++;
  m.set(name, e);
};
for (const [file, { imports }] of info) {
  const test = isTest(file);
  for (const imp of imports) {
    if (imp.names === "*") mark(imp.to, "*", test);
    else for (const name of imp.names) mark(imp.to, name, test);
  }
}
const deadExports = [], testOnlyExports = [], ownFileOnly = [], testAndOwnFile = [];
let totalExports = 0;
for (const file of src) {
  const { exports, idCount } = info.get(file);
  if (isConvention(file) || file === join(REPO, "src/proxy.ts")) continue; // Next reads these exports itself
  const uses = usedBy.get(file) ?? new Map();
  const star = uses.get("*");
  for (const [name, e] of exports) {
    if (name.startsWith("*:")) continue;
    totalExports++;
    const u = uses.get(name);
    if (u?.prod || star?.prod) continue;
    const row = { file: rel(file), name, line: e.line, kind: e.kind, lines: e.lines };
    if (u?.test || star?.test) { ((idCount.get(name) ?? 0) > 1 && name !== "default" ? testAndOwnFile : testOnlyExports).push(row); continue; }
    // Used inside its own file beyond its declaration?
    if ((idCount.get(name) ?? 0) > 1 && name !== "default") ownFileOnly.push(row);
    else deadExports.push(row);
  }
}
const folder = (f) => f.split("/").slice(0, 2).join("/");
const tally = (rows) => { const t = {}; for (const r of rows) { const k = folder(r.file); (t[k] ??= { n: 0, lines: 0 }); t[k].n++; t[k].lines += r.lines; } return t; };

writeFileSync(join(out, "dead.json"), JSON.stringify({
  counts: { files: files.length, srcNonTest: src.length, srcLines: lines(src), unreachableFiles: unreachable.length, unreachableLines: lines(unreachable), testsOnlyFiles: testsOnly.length, testsOnlyLines: lines(testsOnly), totalExports, deadExports: deadExports.length, deadExportLines: deadExports.reduce((n, r) => n + r.lines, 0), testAndOwnFile: testAndOwnFile.length, testOnlyExports: testOnlyExports.length, testOnlyExportLines: testOnlyExports.reduce((n, r) => n + r.lines, 0), ownFileOnlyExports: ownFileOnly.length },
  unreachableFiles: unreachable.map((f) => ({ file: rel(f), lines: info.get(f).lines })).sort((a, b) => b.lines - a.lines),
  testsOnlyFiles: testsOnly.map((f) => ({ file: rel(f), lines: info.get(f).lines })).sort((a, b) => b.lines - a.lines),
  deadExports: deadExports.sort((a, b) => b.lines - a.lines),
  testOnlyExports: testOnlyExports.sort((a, b) => b.lines - a.lines),
  ownFileOnly: ownFileOnly.sort((a, b) => b.lines - a.lines),
  packages: Object.fromEntries([...packages.entries()].map(([k, v]) => [k, { files: v.size, sample: [...v].slice(0, 6), prodFiles: [...v].filter((f) => !isTest(join(REPO, f))).length }]).sort((a, b) => a[1].files - b[1].files)),
}, null, 1));

const kinds = (rows) => { const t = {}; for (const r of rows) t[r.kind] = (t[r.kind] ?? 0) + 1; return t; };
let md = `# Code nothing uses: suspects (own scan, 11 Nov 2026)

Made by \`work/dead.mjs\` (the repo's own TypeScript parser; see \`dead-notes.txt\` for the method and its blind spots). These
are SUSPECTS to check, not findings. Full lists: \`dead.json\`.

| Measure | Count | Lines |
|---|---|---|
| Source files (src, tests aside) | ${src.length} | ${lines(src)} |
| Files no entry point or test reaches | ${unreachable.length} | ${lines(unreachable)} |
| Files only tests reach | ${testsOnly.length} | ${lines(testsOnly)} |
| Exports in src (tests and Next's own files aside) | ${totalExports} | |
| Exports nothing imports and their own file does not use | ${deadExports.length} | ${deadExports.reduce((n, r) => n + r.lines, 0)} |
| Exports only tests import, unused in their own file (dead but for a test) | ${testOnlyExports.length} | ${testOnlyExports.reduce((n, r) => n + r.lines, 0)} |
| Exports their own file uses and tests import (alive; exported for the test) | ${testAndOwnFile.length} | |
| Exports used only inside their own file (the export is unneeded) | ${ownFileOnly.length} | |

Dead exports by kind: ${JSON.stringify(kinds(deadExports))}. Tests-only exports by kind: ${JSON.stringify(kinds(testOnlyExports))}.

## Files no entry point or test reaches (largest first)

${unreachable.map((f) => `${rel(f)} (${info.get(f).lines})`).sort((a, b) => Number(b.match(/\((\d+)\)$/)[1]) - Number(a.match(/\((\d+)\)$/)[1])).slice(0, 150).join("\n")}

## Files only tests reach (largest first, first 150)

${testsOnly.map((f) => ({ f: rel(f), n: info.get(f).lines })).sort((a, b) => b.n - a.n).slice(0, 150).map((x) => `${x.f} (${x.n})`).join("\n")}

## Dead exports by folder

${Object.entries(tally(deadExports)).sort((a, b) => b[1].lines - a[1].lines).map(([k, v]) => `- ${k}: ${v.n} exports, ${v.lines} lines`).join("\n")}

## Largest dead exports (first 120; types aside)

${deadExports.filter((r) => r.kind !== "type").slice(0, 120).map((r) => `${r.file}:${r.line} ${r.name} (${r.kind}, ${r.lines} lines)`).join("\n")}

## Largest exports only tests import (first 80; types aside)

${testOnlyExports.filter((r) => r.kind !== "type").slice(0, 80).map((r) => `${r.file}:${r.line} ${r.name} (${r.kind}, ${r.lines} lines)`).join("\n")}

## Packages by number of importing files (fewest first)

${[...packages.entries()].map(([k, v]) => [k, v.size, [...v].filter((f) => !isTest(join(REPO, f))).length, [...v].slice(0, 3)]).sort((a, b) => a[1] - b[1]).slice(0, 70).map(([k, n, p, s]) => `- ${k}: ${n} files (${p} outside tests): ${s.join(", ")}`).join("\n")}
`;
writeFileSync(join(out, "dead.md"), md);
writeFileSync(join(out, "dead-notes.txt"), `How dead.md and dead.json were made (work/dead.mjs)

Every .ts/.tsx/.mjs file under src, scripts, e2e, e2e-live and test, plus the config files, was parsed with the repo's
TypeScript. Imports were resolved with tsconfig's paths. Entry points: Next's file conventions under src/app (page, layout,
route, loading, error, not-found, default, template, sitemap, robots, manifest, icons), src/proxy.ts, scripts/**, the config
files. Tests: *.test.*, *.spec.*, e2e/**, src/test/**.

Blind spots (a suspect may be alive because of these):
- Files read from disk by path, not imported: src/server/document-html.tsx is said to be loaded at run time; anything named in
  next.config.ts outputFileTracingIncludes; service worker routes; .sql, .json and .css files are not in the graph at all.
- Names reached by string: registries keyed by string, SQL, cron job names, server actions passed by reference are fine
  (they are imported), but a module referenced only in a string is not seen.
- An export used through a namespace import, export * or a dynamic import() marks EVERY export of that file as used, so dead
  exports of such files are missed (under-count).
- "Own file only" is decided by the identifier appearing more than once in its file, which can be a coincidence of names.
- Type-only usage counts as usage. Overloads and declaration merging count once.
- Exports of Next's convention files are skipped (Next reads them).
- Members of exported objects (a method nothing calls, a key nothing reads) are not checked at all.
`);
console.log(md.split("\n").slice(5, 18).join("\n"));
