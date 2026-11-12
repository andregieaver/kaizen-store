// Every built route loads on its own (bloat review step 0.6). A lazy import changes the order modules load in (D440): a route
// that is the first to load a module in an import cycle can meet a value not yet made ("Cannot access … before initialization")
// while the same module loads fine behind another route. A server that has answered other requests hides that, and so do the
// deploy's page checks; a Vercel function starts cold, one route at a time. So each built route and page is loaded here in a
// fresh process, as the first request to a cold function loads it, and any error in loading fails the run.
//
//   node scripts/cold-load-routes.mjs            after `pnpm build`, from the repository root
//   node scripts/cold-load-routes.mjs api/mollie only the entries whose path contains a filter
import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";

const root = path.resolve(".next/server/app");
const filters = process.argv.slice(2);

/** The built entries: each route.js and page.js under .next/server/app. */
function entries(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return entries(full);
    return d.name === "route.js" || d.name === "page.js" ? [full] : [];
  });
}

// In the child: require the entry, then load the route's own module graph as the first request does.
const child = `
const path = require("node:path");
process.env.NODE_ENV = "production"; process.env.NEXT_RUNTIME = "nodejs";
// As Next's server sets up its node environment before it loads a page.
globalThis.AsyncLocalStorage = require("node:async_hooks").AsyncLocalStorage;
const load = require("node:module").createRequire(path.join(process.cwd(), "package.json"));
(async () => {
  // A page lists its layouts and page as loaders ([load, path]) in a tree: called in order, outer layouts first, as a render does.
  async function walk(tree) {
    const [, children, files] = tree;
    for (const value of Object.values(files ?? {})) if (Array.isArray(value) && typeof value[0] === "function") await value[0]();
    for (const child of Object.values(children ?? {})) await walk(child);
  }
  try {
    const route = load(process.argv[1]).routeModule;
    if (typeof route.ensureUserland === "function") await route.ensureUserland();
    else await walk(route.userland.loaderTree);
  }
  catch (e) { console.log(String(e && e.message || e).slice(0, 400)); process.exit(1); }
  process.exit(0);
})();
`;

function loadOne(file) {
  return new Promise((resolve) => {
    execFile(process.execPath, ["-e", child, file], { timeout: 60_000, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      const text = (stdout || stderr || error?.message || "").trim();
      resolve(error ? { file, message: text.split("\n").find((l) => /Error|Cannot|before initialization/.test(l)) ?? text.split("\n")[0] } : null);
    });
  });
}

const all = entries(root).filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)));
if (all.length === 0) {
  console.error("No built route found under .next/server/app: run pnpm build first.");
  process.exit(1);
}
const failures = [];
let next = 0;
const workers = Array.from({ length: Math.max(1, Math.min(8, availableParallelism())) }, async () => {
  while (next < all.length) {
    const failed = await loadOne(all[next++]);
    if (failed) failures.push(failed);
  }
});
await Promise.all(workers);
for (const f of failures) console.error(`${path.relative(root, f.file)}: ${f.message}`);
console.log(`${all.length - failures.length} of ${all.length} built routes and pages load on their own.`);
process.exit(failures.length ? 1 : 0);
