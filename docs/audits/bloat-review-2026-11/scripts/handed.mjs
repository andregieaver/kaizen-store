// node docs/audits/bloat-review-2026-11/scripts/handed.mjs, from the repository root: for three admin screens, the bytes of English
// interface text the server hands the browser, against what the screen's client parts name. The import graph is built in-process
// (import-reach.mjs) and the catalogue is src/lib/admin-text.ts bundled with the esbuild that drizzle-kit brings.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { createRequire } from "node:module";
import { buildGraph, reachFrom } from "./import-reach.mjs";

const repo = process.cwd();
const viaDrizzleKit = createRequire(createRequire(path.join(repo, "package.json")).resolve("drizzle-kit"));
const esbuildModule = await import(url.pathToFileURL(viaDrizzleKit.resolve("esbuild")).href);
const esbuild = esbuildModule.default ?? esbuildModule;
const built = await esbuild.build({
  entryPoints: [path.join(repo, "src/lib/admin-text.ts")], bundle: true, format: "esm", platform: "node", write: false,
  alias: { "@": path.join(repo, "src") }, logLevel: "warning",
});
const tmp = path.join(mkdtempSync(path.join(os.tmpdir(), "handed-")), "admin.min.mjs");
writeFileSync(tmp, built.outputFiles[0].text);
const a = await import(url.pathToFileURL(tmp).href);
const graph = buildGraph(repo);
const reach = (entry) => reachFrom(graph, entry.replace(/^src\//, ""));
const A = "src/app/admin/(gated)/[store]/";
const pages = {
  "product editor": [A + "products/[productId]/page.tsx", ["product", "products", "fields", "builder", "website"]],
  "order": [A + "orders/[orderId]/page.tsx", ["order", "drafts", "privacy", "builder"]],
  "customer": [A + "customers/[customerId]/page.tsx", ["customers", "privacy", "loyalty", "builder"]],
};
const size = (o) => JSON.stringify(o).length;
for (const [name, [page, areas]] of Object.entries(pages)) {
  const seen = reach(page);
  let handed = 0, read = 0; const lines = [];
  for (const area of areas) {
    const words = a.adminText("en", area); handed += size(words);
    const groups = new Set(); let whole = false; const files = new Set();
    for (const f of seen) { if (!/\.tsx?$/.test(f)) continue; const text = readFileSync(path.join(repo, "src", f), "utf8"); if (!/^\s*["']use client["']/.test(text.slice(0, 300))) continue; for (const m of text.matchAll(new RegExp(`useAdminText\\("${area}"\\)(\\.([a-zA-Z]+))?`, "g"))) { files.add(f); if (m[2]) groups.add(m[2]); else whole = true; } }
    const readBytes = whole ? size(words) : [...groups].reduce((n, g) => n + (words[g] === undefined ? 0 : size(words[g])), 0);
    read += readBytes;
    lines.push(`   ${area}: handed ${size(words)} | client files reading ${files.size} | ${whole ? "WHOLE area read by a part (needs a closer look)" : "groups " + ([...groups].join(",") || "none")} -> ${readBytes}`);
  }
  console.log(`== ${name}: handed ${handed} bytes of English JSON | named by its client parts: ${read} (upper bound where a part takes the whole area)`); console.log(lines.join("\n"));
}
