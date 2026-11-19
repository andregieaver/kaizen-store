// Per-route composition of client and server bundles from `next analyze export` (bloat review).
//   node chunks.mjs <outDir>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2];
mkdirSync(`${out}/analyze`, { recursive: true });
const REPO = "/home/user/kaizen-store";
const stats = JSON.parse(readFileSync(`${REPO}/.next/diagnostics/route-bundle-stats.json`, "utf8"));
const ROUTES = [
  "/s/[store]/[market]", "/s/[store]/[market]/p/[handle]", "/s/[store]/[market]/category/[slug]", "/s/[store]/[market]/cart", "/s/[store]/[market]/checkout",
  "/", "/docs", "/admin/sign-in",
  "/admin/[store]", "/admin/[store]/orders", "/admin/[store]/products/[productId]", "/admin/[store]/pages/[pageId]", "/admin/[store]/settings", "/admin/platform",
  "/api/visit", "/api/health", "/api/cron/cart-reminders", "/api/cron/page-jobs", "/api/shop/tiles",
];
const kb = (n) => (n / 1024).toFixed(0);
const pkgOf = (path) => {
  const m = path.match(/node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (m) return m[1];
  const s = path.match(/\[project\]\/src\/([^/]+)(?:\/([^/]+))?/);
  if (s) return `src/${s[1]}${s[2] && !s[2].includes(".") ? "/" + s[2] : ""}`;
  return path.includes("[project]/") ? "(project, other)" : "(runtime)";
};
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const add = (map, key, n) => map.set(key, (map.get(key) ?? 0) + n);
let md = `# What is inside each route's bundles (from \`next analyze\`, production build of commit 0bd814c)

Sizes are bytes of each source module as it sits in the built output (minified), from Next's bundle analyzer
(\`next analyze --output\`, then \`next analyze export --route\`). "First load" is the client chunks every page of the route loads; "later" is client code loaded only when a client component is
drawn on the page (the analyzer's render-dependent groups) or by an import() or next/dynamic (its async groups). The analyzer's
build has its own chunk names, so they do not match .next/static. A catch-all route that can draw any component of the page
builder has a large "later" set of which one page loads a small part.
"Server (loaded with the route)" is every module in the server chunks the route's entry loads; "behind a dynamic import" is server code in chunks that only an import() loads; "traced" is files copied beside the function (native libraries, JSON data). Package rows group
node_modules by package and src by folder. The full per-module lists are in \`analyze/<route>.json\`.

`;
const summary = [];
for (const route of ROUTES) {
  let raw;
  try {
    raw = execFileSync(`${REPO}/node_modules/.bin/next`, ["analyze", "export", "--route", route], { cwd: REPO, maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) { md += `## ${route}\n\nexport failed: ${String(error.message).slice(0, 120)}\n\n`; continue; }
  const parts = [];
  const lazyOutputs = new Set(), eagerOutputs = new Set(), drawnOutputs = new Set();
  for (const line of raw.split("\n")) {
    if (line.startsWith('{"type":"part"')) parts.push(JSON.parse(line));
    else if (line.startsWith('{"type":"group"')) { const g = JSON.parse(line); for (const o of g.outputs) (g.kind === "bootstrap" ? eagerOutputs : lazyOutputs).add(o); if (g.kind === "render_dependent") for (const o of g.outputs) drawnOutputs.add(o); }
  }
  const first = new Set((stats.find((r) => r.route === route)?.firstLoadChunkPaths ?? []).map((p) => `[client-fs]/_next/${p.replace(/^\.next\//, "")}`));
  const buckets = { first: new Map(), later: new Map(), server: new Map(), serverLazy: new Map(), traced: new Map() };
  const files = { first: new Map(), later: new Map(), server: new Map(), serverLazy: new Map(), traced: new Map() };
  const totals = { first: 0, later: 0, server: 0, serverLazy: 0, traced: 0 };
  const gz = { first: 0, later: 0, server: 0, serverLazy: 0, traced: 0 };
  for (const p of parts) {
    if (p.filename.endsWith(".css") || p.filename.endsWith(".map")) continue;
    let where;
    if (p.filename.startsWith("[client-fs]/")) where = lazyOutputs.has(p.filename) && !eagerOutputs.has(p.filename) ? "later" : "first";
    else if (p.filename.startsWith("[output]/.next/server/")) where = lazyOutputs.has(p.filename) && !eagerOutputs.has(p.filename) ? "serverLazy" : "server";
    else where = "traced"; // files copied beside the function: native libraries, data files
    totals[where] += p.size; gz[where] += p.compressed_size;
    add(buckets[where], pkgOf(p.source_path), p.size);
    add(files[where], p.source_path.replace("[project]/", "").replace(/node_modules\/\.pnpm\/[^/]+\/node_modules\//, "~/"), p.size);
  }
  const name = route === "/" ? "root" : route.replace(/^\//, "").replace(/[\/\[\]]+/g, "_").replace(/_+$/, "");
  writeFileSync(`${out}/analyze/${name}.json`, JSON.stringify({ route, totals, compressed: gz, first: top(files.first, 400), later: top(files.later, 400), server: top(files.server, 600), serverLazy: top(files.serverLazy, 300), traced: top(files.traced, 60), byPackage: { first: top(buckets.first, 80), later: top(buckets.later, 80), server: top(buckets.server, 120), serverLazy: top(buckets.serverLazy, 80) } }, null, 1));
  summary.push({ route, ...totals, serverModules: files.server.size });
  md += `## ${route}\n\nClient: first load ${kb(totals.first)} KB (${kb(gz.first)} KB compressed), loadable later ${kb(totals.later)} KB. Server: ${kb(totals.server)} KB in ${files.server.size} modules loaded with the route, ${kb(totals.serverLazy)} KB more behind a dynamic import. Files traced beside the function (native libraries, data): ${kb(totals.traced)} KB.\n\n`;
  if (totals.first) {
    md += `First load by package or folder: ${top(buckets.first, 22).map(([k, v]) => `${k} ${kb(v)}`).join(", ")}.\n\n`;
    md += `Largest first-load modules: ${top(files.first, 28).map(([k, v]) => `\`${k}\` ${kb(v)}`).join(", ")}.\n\n`;
  }
  if (totals.later) md += `Loadable later, by package or folder: ${top(buckets.later, 14).map(([k, v]) => `${k} ${kb(v)}`).join(", ")}.\n\n`;
  md += `Server (loaded with the route) by package or folder: ${top(buckets.server, 26).map(([k, v]) => `${k} ${kb(v)}`).join(", ")}.\n\n`;
  md += `Largest server modules loaded with the route: ${top(files.server, 26).map(([k, v]) => `\`${k}\` ${kb(v)}`).join(", ")}.\n\n`;
  if (totals.serverLazy) md += `Server, behind a dynamic import: ${top(buckets.serverLazy, 12).map(([k, v]) => `${k} ${kb(v)}`).join(", ")}.\n\n`;
  md += `Traced files: ${top(files.traced, 8).map(([k, v]) => `\`${k}\` ${kb(v)}`).join(", ")}.\n\n`;
  console.log(route.padEnd(40), "first", kb(totals.first).padStart(5), "later", kb(totals.later).padStart(5), "| server", kb(totals.server).padStart(6), "KB in", String(files.server.size).padStart(4), "modules, lazy", kb(totals.serverLazy).padStart(6), "| traced", kb(totals.traced).padStart(6));
}
writeFileSync(`${out}/chunks.md`, md);
writeFileSync(`${out}/analyze/summary.json`, JSON.stringify(summary, null, 1));
