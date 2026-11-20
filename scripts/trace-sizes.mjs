// What a function carries (bloat review step 1.8): the megabytes traced beside each function in .next/server, from the *.nft.json files
// Next writes after a build. Run from the repository root after `pnpm build`.
//
//   node scripts/trace-sizes.mjs                  print the tables
//   node scripts/trace-sizes.mjs --check          also read scripts/trace-budgets.json; exit 1, naming the line, over a budget (CI's e2e job),
//                                                 or when a route that reads the product taxonomy lacks one of its files (TAXONOMY_ROUTES)
//   node scripts/trace-sizes.mjs --write          rewrite the budgets from this build: sizes as the measured megabytes times 1.04 rounded up to
//                                                 0.1, counts as measured; it refuses to raise any figure unless --first is given
//
// The review's own two summers (docs/audits/bloat-review-2026-11/scripts/trace-sizes.mjs and trace-packages.mjs) stay as the record of how
// the review counted; this is the CI version of both. The summing is pure (`summarise()`, `checkBudgets()`), tested by src/lib/trace-sizes.test.ts.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIB = 1048576;
const mb = (bytes) => (bytes / MIB).toFixed(1);

/** The figures held, each with the label the table and a breach use. */
export const SIZES = {
  median: "median trace",
  proxy: "the proxy's trace",
  storeHome: "the store home's trace",
  storeCheckout: "the store checkout's trace",
  health: "/api/health's trace",
  visit: "/api/visit's trace",
};
export const COUNTS = {
  sharp: "traces that carry sharp",
  taxonomy: "traces that carry the product taxonomy (src/data/product-taxonomy)",
  chromium: "traces that carry Chromium",
  reactDom: "traces that carry react-dom",
  publicFiles: "traces that carry a file under public/",
  maps: "traces that carry a .map file",
};

/** The one a trace is named by in the table: the trace of a page or route is `app/…/page.js.nft.json` (or `route.js`). */
const NAMED = {
  proxy: /^(?:middleware|proxy)\.js\.nft\.json$/,
  // A trace keeps the route's groups in its path: the store's pages sit in `(shop)`.
  storeHome: /^app\/s\/\[store\]\/\[market\]\/\(shop\)\/page\.js\.nft\.json$/,
  storeCheckout: /^app\/s\/\[store\]\/\[market\]\/\(shop\)\/checkout\/page\.js\.nft\.json$/,
  health: /^app\/api\/health\/route\.js\.nft\.json$/,
  visit: /^app\/api\/visit\/route\.js\.nft\.json$/,
};
const ENTRY = /^app\/.*(?:page|route)\.js\.nft\.json$/;

const CARRIES = {
  sharp: (file) => /node_modules\/\.pnpm\/(?:@img\+|sharp@)/.test(file) || /node_modules\/(?:sharp|@img)\//.test(file),
  taxonomy: (file) => file.includes("/src/data/product-taxonomy/"),
  chromium: (file) => file.includes("@sparticuz"),
  reactDom: (file) => /node_modules\/react-dom\//.test(file),
  publicFiles: (file) => /\/public\//.test(file) && !/node_modules\//.test(file),
  maps: (file) => file.endsWith(".map"),
};

/**
 * The taxonomy's files reach a function only through Turbopack's own trace of `src/server/product-taxonomy.ts`, which names each file
 * literally (bloat review step 2.23; next.config.ts has no include for them, since in Next 16.4 an exclude cannot take off what an include
 * adds). These routes read the taxonomy on purpose, so each trace must carry every file the reader opens, or the route fails with ENOENT.
 */
export const TAXONOMY_FILES = ["structure.json", "names-en.json", "names-nb.json", "names-sv.json", "names-da.json"];
export const TAXONOMY_ROUTES = {
  "app/s/[store]/[market]/(shop)/p/[handle]/page.js.nft.json": "the product page (its standard category and structured data)",
  "app/s/[store]/[market]/(shop)/page.js.nft.json": "the store home (a listing's attribute filters)",
  "app/s/[store]/[market]/(shop)/category/[slug]/page.js.nft.json": "a category's listing (attribute filters)",
  "app/s/[store]/[market]/(shop)/search/page.js.nft.json": "the store's search (attribute filters)",
  "app/admin/(gated)/[store]/products/[productId]/page.js.nft.json": "the admin's product editor (the category picker)",
  "app/admin/(gated)/[store]/products/new/page.js.nft.json": "the admin's new product (the category picker)",
  "app/admin/(gated)/[store]/products/import/page.js.nft.json": "the product import (Shopify's category paths)",
  "app/admin/(gated)/[store]/assistant/page.js.nft.json": "the AI manager (its product tools)",
  "app/api/admin/v1/[...path]/route.js.nft.json": "the admin API (its product tools)",
  "app/api/feeds/[token]/[file]/route.js.nft.json": "the product feeds (Google's category)",
  "app/api/cron/cart-reminders/route.js.nft.json": "the dispatcher (imports and product upkeep)",
};

/** One line per route of TAXONOMY_ROUTES whose trace is missing, or lacks one of TAXONOMY_FILES. */
export function missingTaxonomy(traces) {
  const lines = [];
  for (const [name, what] of Object.entries(TAXONOMY_ROUTES)) {
    const trace = traces.find((t) => t.name === name);
    if (!trace) {
      lines.push(`${what}: no trace at .next/server/${name}. Name the route's trace again in TAXONOMY_ROUTES of scripts/trace-sizes.mjs.`);
      continue;
    }
    const lacks = TAXONOMY_FILES.filter((file) => !trace.files.some((f) => f.file.endsWith(`/src/data/product-taxonomy/${file}`)));
    if (lacks.length > 0)
      lines.push(`${what} (${name}): its trace lacks ${lacks.join(", ")}, so the route fails with ENOENT. Keep each read in src/server/product-taxonomy.ts a literal path.join(process.cwd(), "src/data/product-taxonomy", "<file>") (product-taxonomy.scan.test.ts).`);
  }
  return lines;
}

/** The package a file belongs to: the name after the last node_modules/ segment (two segments for a scoped one); null for a file of the repo. */
export function packageName(file) {
  const at = file.lastIndexOf("node_modules/");
  if (at < 0) return null;
  const parts = file.slice(at + "node_modules/".length).split("/");
  return parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[sorted.length >> 1];
};

/**
 * Traces in, table rows out. A trace is `{ name, files: [{ file, size }] }`: `name` is the trace's path under .next/server (for example
 * `app/api/health/route.js.nft.json`), each file listed once with its absolute path and its size in bytes. A file two traces share is counted
 * in both. Returns `{ sizes: { key: bytes }, counts: { key: n }, packages: [{ name, bytes, traces }] }`, where `packages` are the 15 heaviest
 * by bytes summed over every trace that carries them.
 * @param {{ name: string, files: { file: string, size: number }[] }[]} traces
 * @returns {{ sizes: Record<string, number | null>, counts: Record<string, number>, packages: { name: string, bytes: number, traces: number }[], traces: number }}
 */
export function summarise(traces) {
  const totals = traces.map((trace) => ({ name: trace.name, bytes: trace.files.reduce((sum, f) => sum + f.size, 0) }));
  /** @type {Record<string, number | null>} */
  const sizes = { median: median(totals.filter((t) => ENTRY.test(t.name)).map((t) => t.bytes)) };
  for (const [key, pattern] of Object.entries(NAMED)) sizes[key] = totals.find((t) => pattern.test(t.name))?.bytes ?? null;
  const counts = Object.fromEntries(Object.entries(CARRIES).map(([key, carries]) => [key, traces.filter((t) => t.files.some((f) => carries(f.file))).length]));
  const byPackage = new Map();
  for (const trace of traces) {
    const here = new Map();
    for (const { file, size } of trace.files) {
      const name = packageName(file);
      if (name) here.set(name, (here.get(name) ?? 0) + size);
    }
    for (const [name, bytes] of here) {
      const row = byPackage.get(name) ?? { name, bytes: 0, traces: 0 };
      row.bytes += bytes;
      row.traces += 1;
      byPackage.set(name, row);
    }
  }
  const packages = [...byPackage.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 15);
  return { sizes, counts, packages, traces: traces.length };
}

/** One line per figure over its budget: a size over its megabytes, a count over its number. A figure with no budget is not held. */
export function checkBudgets(summary, budgets) {
  const lines = [];
  for (const [key, label] of Object.entries(SIZES)) {
    const max = budgets.sizesMb?.[key];
    const now = summary.sizes[key];
    if (max !== undefined && now !== null && now / MIB > max) lines.push(`${label}: ${mb(now)} MB, budget ${max} MB. Find what the function now loads (node scripts/route-load.mjs names the imports) and load it with import() where it is used.`);
  }
  for (const [key, label] of Object.entries(COUNTS)) {
    const max = budgets.counts?.[key];
    // Counts that grow with every page (traces with sharp or the taxonomy) have room of max(20, 4 %); a small count fails on any rise.
    const room = max !== undefined && max >= 50 ? Math.max(20, Math.ceil(max * 0.04)) : 0;
    if (max !== undefined && summary.counts[key] > max + room) lines.push(`${label}: ${summary.counts[key]}, budget ${max}${room ? ` with room ${room}` : ""}. Keep the file out of this function's trace (outputFileTracingExcludes in next.config.ts) or load the module with import() where it is used.`);
  }
  return lines;
}

/**
 * The budgets this build supports: sizes as the measured megabytes times 1.04 rounded up to 0.1, counts as measured.
 * @returns {{ sizesMb: Record<string, number>, counts: Record<string, number> }}
 */
export function budgetsFrom(summary) {
  const sizesMb = {};
  for (const key of Object.keys(SIZES)) if (summary.sizes[key] !== null) sizesMb[key] = Math.ceil((summary.sizes[key] / MIB) * 1.04 * 10) / 10;
  return { sizesMb, counts: { ...summary.counts } };
}

/** What `--write` would raise: a size or a count above the stored budget. */
export function raised(budgets, stored) {
  const lines = [];
  for (const [key, max] of Object.entries(budgets.sizesMb)) if (stored.sizesMb?.[key] !== undefined && max > stored.sizesMb[key]) lines.push(`${SIZES[key]}: ${stored.sizesMb[key]} MB → ${max} MB`);
  for (const [key, n] of Object.entries(budgets.counts)) if (stored.counts?.[key] !== undefined && n > stored.counts[key]) lines.push(`${COUNTS[key]}: ${stored.counts[key]} → ${n}`);
  return lines;
}

function traceFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) traceFiles(file, found);
    else if (entry.name.endsWith(".nft.json")) found.push(file);
  }
  return found;
}

/** Every trace under .next/server, each listed file resolved against the json's folder and its size read once. */
export function readTraces(root) {
  const server = path.join(root, ".next", "server");
  const sizes = new Map();
  const sizeOf = (file) => {
    if (!sizes.has(file)) {
      try {
        const stat = statSync(file);
        sizes.set(file, stat.isFile() ? stat.size : 0);
      } catch {
        sizes.set(file, 0);
      }
    }
    return sizes.get(file);
  };
  return traceFiles(server).map((nft) => {
    const listed = JSON.parse(readFileSync(nft, "utf8")).files ?? [];
    const files = [...new Set(listed.map((f) => path.resolve(path.dirname(nft), f)))].map((file) => ({ file, size: sizeOf(file) }));
    return { name: path.relative(server, nft).split(path.sep).join("/"), files };
  });
}

function print(summary) {
  const out = [];
  out.push("### What a function carries", "", `Traced beside ${summary.traces} functions in .next/server.`, "", "| Trace | MB |", "|---|---|");
  for (const [key, label] of Object.entries(SIZES)) out.push(`| ${label} | ${summary.sizes[key] === null ? "not found" : mb(summary.sizes[key])} |`);
  out.push("", "| Carried by | Traces |", "|---|---|");
  for (const [key, label] of Object.entries(COUNTS)) out.push(`| ${label} | ${summary.counts[key]} |`);
  out.push("", "| Heaviest packages (bytes times traces) | MB summed over traces | Traces |", "|---|---|---|");
  for (const row of summary.packages) out.push(`| ${row.name} | ${mb(row.bytes)} | ${row.traces} |`);
  console.log(out.join("\n"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const budgetFile = path.join(root, "scripts", "trace-budgets.json");
  if (!existsSync(path.join(root, ".next", "server"))) {
    console.error("No .next/server here: run pnpm build first, from the repository root.");
    process.exit(1);
  }
  const traces = readTraces(root);
  const summary = summarise(traces);
  print(summary);
  const stored = existsSync(budgetFile) ? JSON.parse(readFileSync(budgetFile, "utf8")) : null;
  if (process.argv.includes("--write")) {
    const next = budgetsFrom(summary);
    const up = stored && !process.argv.includes("--first") ? raised(next, stored) : [];
    if (up.length > 0) {
      console.error(`\nThe trace budgets only fall. Not written:\n  ${up.join("\n  ")}\nFind what the function now carries, or accept it on purpose with --write --first (shown in the diff).`);
      process.exit(1);
    }
    writeFileSync(budgetFile, `${JSON.stringify({ comment: "Written by node scripts/trace-sizes.mjs --write after pnpm build; sizes are the build's megabytes times 1.04, rounded up to 0.1. Held by CI's e2e job (node scripts/trace-sizes.mjs --check).", ...next }, null, 2)}\n`);
    console.log(`\nWrote ${path.relative(root, budgetFile)}.`);
  } else if (process.argv.includes("--check")) {
    if (!stored) {
      console.log("\nNo scripts/trace-budgets.json: write it with node scripts/trace-sizes.mjs --write --first after pnpm build.");
      process.exit(1);
    }
    const breaches = [...checkBudgets(summary, stored), ...missingTaxonomy(traces)];
    if (breaches.length > 0) {
      console.log(`\n**Over budget**\n\n${breaches.map((line) => `- ${line}`).join("\n")}`);
      console.error(breaches.join("\n"));
      process.exit(1);
    }
    console.log(`\nEvery figure is within its budget, and the ${Object.keys(TAXONOMY_ROUTES).length} routes that read the taxonomy carry its ${TAXONOMY_FILES.length} files.`);
  }
}
