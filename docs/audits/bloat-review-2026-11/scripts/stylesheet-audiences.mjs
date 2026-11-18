// Whose classes the built stylesheet holds (bloat review step 1.23, GAP-styles-2). Run from the repository root after `pnpm build`:
//   node docs/audits/bloat-review-2026-11/scripts/stylesheet-audiences.mjs [--json]
// A class's audience is which root layouts can reach a file that names it (store pages, Kaizena Flow's own pages, other roots, the
// on-site editor, the admin). It prints the rules and bytes each audience alone names, and exits 1 above the two lines in LINES (and,
// once the admin has a sheet of its own, step 2.11, when that sheet holds any class only admin files name).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";
import postcss from "postcss";

import { reach, sourceFiles } from "../../../../scripts/lib/import-walk.mjs";

/**
 * The lines: classes no store page can draw (platform-only, editor-only, platform+editor), raw and Brotli bytes. The brief's lines were 17,000
 * and 2,000; on 18 November the build read 23,289 raw and 3,903 Brotli (the sheet grew from 183 KB to 219 KB with the admin's redesign), so
 * the lines hold today's figure with room for the daily work (the owner's rule from step 0.43: an exceeded ceiling holds today's figure plus
 * room, and only falls). Step 2.11 splits the sheet and takes the lines back to 17,000 and 2,000.
 */
export const LINES = { noStoreRaw: 25_000, noStoreBrotli: 4_200 };

/** The audience of a class from the audiences of the files that name it; 'unknown' when no file does. */
export function classAudience(set) {
  if (!set || set.size === 0) return "unknown";
  if (set.has("store")) return "store";
  if (set.size === 1 && set.has("admin")) return "admin-only";
  if ([...set].every((a) => a === "platform" || a === "other")) return "platform-only";
  if ([...set].every((a) => a === "editor" || a === "admin")) return "editor-only";
  return "platform+editor";
}

/** A reason for exit 1, or null. Before the sheet is split the admin's share is printed, not failed. */
export function overLine({ noStoreRaw, noStoreBrotli, adminOnlyRaw }, split) {
  if (noStoreRaw > LINES.noStoreRaw) return `classes no store page can draw are ${noStoreRaw} bytes raw, above ${LINES.noStoreRaw}`;
  if (noStoreBrotli > LINES.noStoreBrotli) return `classes no store page can draw are ${noStoreBrotli} bytes Brotli, above ${LINES.noStoreBrotli}`;
  if (split && adminOnlyRaw > 0) return `the site's sheet holds ${adminOnlyRaw} bytes of classes only the admin names: the admin has a sheet of its own`;
  return null;
}

export const brotli = (text) =>
  brotliCompressSync(Buffer.from(text), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

const AUDIENCES = ["store", "platform-only", "editor-only", "platform+editor", "admin-only", "unknown"];

/** The first class of a selector, unescaped. */
export function firstClass(selector) {
  const match = /\.((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[^\s.,:>+~[\]()\\#{}])+)/.exec(selector);
  if (!match) return null;
  return match[1].replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_, hex, ch) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : ch));
}

/** Each rule of the utilities layers with its text (a nested rule wrapped in its at-rules) and the class it names. */
export function utilityRules(sheetCss) {
  const rules = [];
  const visit = (node, wrap) => {
    for (const child of node.nodes ?? []) {
      if (child.type === "rule") {
        let text = child.toString();
        for (const at of [...wrap].reverse()) text = `${at}{${text}}`;
        rules.push({ text, cls: firstClass(child.selector) });
      } else if (child.type === "atrule" && child.nodes) visit(child, [...wrap, `@${child.name} ${child.params}`.trim()]);
    }
  };
  postcss.parse(sheetCss).walkAtRules("layer", (layer) => {
    if (layer.params.startsWith("utilities") && layer.nodes?.length) visit(layer, []);
  });
  return rules;
}

/** Steps (4) and (5): the rows by audience and the three figures. `tokens` maps a token to the Set of audiences that hold it. */
export function audienceTable(sheetCss, tokens) {
  const parts = new Map(AUDIENCES.map((a) => [a, []]));
  for (const { text, cls } of utilityRules(sheetCss)) parts.get(classAudience(cls === null ? null : tokens.get(cls))).push(text);
  const size = (audiences) => audiences.flatMap((a) => parts.get(a));
  const rows = AUDIENCES.map((audience) => {
    const texts = parts.get(audience);
    const joined = texts.join("");
    return { audience, rules: texts.length, raw: Buffer.byteLength(joined), brotli: texts.length ? brotli(joined) : 0 };
  });
  const noStore = size(["platform-only", "editor-only", "platform+editor"]).join("");
  return {
    rows,
    noStoreRaw: Buffer.byteLength(noStore),
    noStoreBrotli: noStore ? brotli(noStore) : 0,
    adminOnlyRaw: rows.find((r) => r.audience === "admin-only").raw,
  };
}

/** Every .css file under `dir`. */
function cssFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) cssFiles(file, found);
    else if (name.endsWith(".css")) found.push(file);
  }
  return found;
}

/** The sheets of the build: the site's file name, its text and whether the admin has a sheet of its own. */
export function findSheet(staticDir) {
  const candidates = cssFiles(staticDir)
    .map((file) => ({ file, text: readFileSync(file, "utf8") }))
    .filter((c) => c.text.includes(".checkout-look"));
  if (candidates.length === 0 || candidates.length > 2) throw new Error(`${candidates.length} stylesheets under ${staticDir} hold .checkout-look`);
  const split = candidates.length === 2;
  const site = split ? (candidates.find((c) => !c.text.includes("[data-builder-item]")) ?? candidates[0]) : candidates[0];
  return { ...site, split };
}

const EDITOR = [path.join("src", "components", "admin") + path.sep, path.join("src", "components", "inline-edit") + path.sep];

/** The root layouts' groups: the files each group starts from. */
export function groups(srcDir) {
  const app = path.join(srcDir, "app");
  const folders = (names) => names.flatMap((n) => sourceFiles(path.join(app, n)));
  const top = readdirSync(app, { withFileTypes: true });
  const platformFolders = ["(platform)", "(platform-nb)", "(docs)", "(docs-nb)", "(theme-preview)", "(theme-preview-nb)"];
  const known = new Set(["s", "admin", "api", ...platformFolders]);
  const otherFolders = top.filter((d) => d.isDirectory() && !known.has(d.name)).map((d) => d.name);
  const otherFiles = top.filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\./.test(d.name)).map((d) => path.join(app, d.name));
  return {
    store: folders(["s"]),
    platform: folders(platformFolders),
    other: [...folders(otherFolders), ...otherFiles],
    admin: folders(["admin"]),
  };
}

/** Step (3): a Map from token to the Set of audiences of the files that hold it. */
export function tokenAudiences(srcDir) {
  const memo = new Map();
  const reached = new Map(); // file -> Set of groups that reach it
  for (const [group, entries] of Object.entries(groups(srcDir))) {
    for (const entry of entries) {
      for (const file of reach(srcDir, entry, { dynamic: true, memo }).keys()) {
        if (!reached.has(file)) reached.set(file, new Set());
        reached.get(file).add(group);
      }
    }
  }
  const tokens = new Map();
  for (const [file, groupSet] of reached) {
    const rel = path.relative(path.dirname(srcDir), file);
    const editorFile = EDITOR.some((prefix) => rel.startsWith(prefix));
    const audiences = new Set([...groupSet].map((g) => (editorFile && g !== "admin" ? "editor" : g)));
    for (const token of readFileSync(file, "utf8").split(/[\s"'`<>{}()=;,]+/)) {
      if (!token || token.length > 120) continue;
      let set = tokens.get(token);
      if (!set) tokens.set(token, (set = new Set()));
      for (const a of audiences) set.add(a);
    }
  }
  return tokens;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { file, text, split } = findSheet(path.resolve(".next", "static"));
  const tokens = tokenAudiences(path.resolve("src"));
  const table = audienceTable(text, tokens);
  const sheet = { file: path.basename(file), raw: Buffer.byteLength(text), brotli: brotli(text), split };
  const reason = overLine(table, split);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ sheet, ...table }, null, 2));
  } else {
    console.log(`Site sheet ${sheet.file}: ${sheet.raw} raw, ${sheet.brotli} Brotli${split ? " (the admin has its own sheet)" : ""}`);
    console.log("\n| audience | rules | raw bytes | Brotli bytes |\n|---|---|---|---|");
    for (const r of table.rows) console.log(`| ${r.audience} | ${r.rules} | ${r.raw} | ${r.brotli} |`);
    console.log(`\nno store page can draw: ${table.noStoreRaw} raw, ${table.noStoreBrotli} Brotli`);
    console.log(`only admin files name: ${table.adminOnlyRaw} raw`);
  }
  if (reason) {
    console.error(`FAIL: ${reason}`);
    if (split && table.adminOnlyRaw > 0) {
      const names = utilityRules(text)
        .filter((r) => r.cls !== null && classAudience(tokens.get(r.cls)) === "admin-only")
        .slice(0, 20)
        .map((r) => r.cls);
      console.error(`first classes: ${names.join(" ")}`);
    }
    process.exit(1);
  }
}
