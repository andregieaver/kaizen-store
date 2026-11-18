// What a server route loads (bloat review step 1.8, commit 4): run from the repository root after `pnpm build`, in CI's e2e job.
//
//   node scripts/route-budget.mjs                 print six parts as Markdown tables and hold them to scripts/route-budget.json
//   node scripts/route-budget.mjs --write         lower the budgets to this build; it refuses to raise any figure unless --first is given
//
// A: the bytes of the chunks a built entry lists at start (the strings of R.c("…")), the largest route of each kind held. B: the
// server-reference manifest's bytes, entries, entries per route and the milliseconds to read it. C: bytes of server chunk files that
// repeat (printed only). D: Vercel's routing rules, held below 1,600 (the cap is 2,048). E: the median of five cold loads of seven entries
// in fresh processes (step 0.1's scripts), printed beside /api/health's and the bars of phase 2, which are not enforced yet. F: no
// admin sentence in an entry outside the admin, and the storefront's messages behind the store layout.
//
// Exit 1 names each breach with the entry, the figure, the budget and what to do. A cold load that is over is run again once first.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { reach } from "./lib/import-walk.mjs";
import { ENTRIES } from "./lib/route-load.mjs";

const root = path.join(import.meta.dirname, "..");
const next = path.join(root, ".next");
const budgetFile = path.join(import.meta.dirname, "route-budget.json");
const REVIEW = path.join("docs", "audits", "bloat-review-2026-11", "scripts");
const ROOM = 1.04;
const RUNS = 5;
const RULE_CAP = 1600;
const MESSAGES_CAP = 590_000;

if (!existsSync(path.join(next, "server"))) {
  console.error("No .next/server here: run pnpm build first, from the repository root.");
  process.exit(1);
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};
const sizeOf = (file) => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

// ---- A: chunk bytes per kind -------------------------------------------------------------------------------------------------------

const BEACONS = new Set(["/api/visit/route", "/api/visit/touch/route", "/api/visit/speed/route", "/api/visit/speed/own/route", "/api/recommendations/events/route"]);
/** The kind of a route by its key in app-path-routes-manifest.json; null for a route no budget names. */
function kindOf(key) {
  if (BEACONS.has(key)) return "beacon";
  if (key.startsWith("/api/")) return "api";
  if (/^\/s\/\[store\]\/\[market\]\/(?:\(shop\)\/)?(?:cart|checkout|account)\//.test(key)) return "pay";
  if (key.startsWith("/s/[store]/[market]/")) return "store";
  if (key.startsWith("/(platform") || key.startsWith("/(docs")) return "site";
  if (key.startsWith("/admin/(gated)/platform/")) return "admin-platform";
  if (key.startsWith("/admin/(gated)/[store]/")) return "admin-store";
  return null;
}

/** The chunk files an entry lists at start, as paths under .next. */
function startChunks(entryFile) {
  return [...readFileSync(entryFile, "utf8").matchAll(/R\.c\("([^"]+)"\)/g)].map((match) => match[1]);
}
const chunkBytes = (entryFile) => [...new Set(startChunks(entryFile))].reduce((sum, chunk) => sum + sizeOf(path.join(next, chunk)), 0);

// The form this Next version writes: the health route's entry lists its chunks as R.c("server/chunks/…").
const healthEntry = path.join(next, "server", "app", "api", "health", "route.js");
if (startChunks(healthEntry).length === 0) {
  console.error("The built entry of /api/health does not list its chunks as R.c(\"…\"): this Next version writes entries another way. Update scripts/route-budget.mjs.");
  process.exit(1);
}

const routes = JSON.parse(readFileSync(path.join(next, "app-path-routes-manifest.json"), "utf8"));
const largest = {};
for (const key of Object.keys(routes)) {
  const kind = kindOf(key);
  const entry = path.join(next, "server", "app", `${key}.js`);
  if (!kind || !existsSync(entry)) continue;
  const bytes = chunkBytes(entry);
  if (!largest[kind] || bytes > largest[kind].bytes) largest[kind] = { route: key, bytes };
}
for (const [kind, file] of [["proxy", "middleware.js"], ["instrumentation", "instrumentation.js"]]) {
  const entry = path.join(next, "server", file);
  if (existsSync(entry)) largest[kind] = { route: `.next/server/${file}`, bytes: chunkBytes(entry) };
}

// ---- B: the server-reference manifest ----------------------------------------------------------------------------------------------

const manifestFile = path.join(next, "server", "server-reference-manifest.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const perRoute = {};
for (const action of Object.values({ ...manifest.node, ...manifest.edge })) for (const worker of Object.keys(action.workers ?? {})) perRoute[worker] = (perRoute[worker] ?? 0) + 1;
const routeEntries = (keys) => median(keys.map((key) => perRoute[`app${key}`] ?? 0));
const manifestNow = {
  bytes: statSync(manifestFile).size,
  entries: Object.keys(manifest.node ?? {}).length + Object.keys(manifest.edge ?? {}).length,
  perRoute: routeEntries(Object.keys(routes)),
  perAdminRoute: routeEntries(Object.keys(routes).filter((key) => key.startsWith("/admin/"))),
  perBeacon: routeEntries([...BEACONS]),
};
const readMs = median(
  Array.from({ length: RUNS }, () => {
    const run = spawnSync(process.execPath, [
      "-e",
      'const p=require("path").resolve(process.argv[1]);const t=process.hrtime.bigint();JSON.parse(require("fs").readFileSync(p,"utf8"));console.log(Number(process.hrtime.bigint()-t)/1e6)',
      path.relative(root, manifestFile),
    ], { cwd: root, encoding: "utf8" });
    return Number(run.stdout.trim());
  }),
);

// ---- C: server chunks that repeat --------------------------------------------------------------------------------------------------

function files(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files(file, found);
    else found.push(file);
  }
  return found;
}
const byHash = new Map();
for (const file of files(path.join(next, "server", "chunks"))) {
  const hash = createHash("sha1").update(readFileSync(file)).digest("hex");
  byHash.set(hash, [...(byHash.get(hash) ?? []), sizeOf(file)]);
}
const repeated = [...byHash.values()].filter((sizes) => sizes.length > 1);
const repeatedBytes = repeated.reduce((sum, sizes) => sum + sizes[0] * (sizes.length - 1), 0);

// ---- D: routing rules --------------------------------------------------------------------------------------------------------------

const routing = JSON.parse(readFileSync(path.join(next, "routes-manifest.json"), "utf8"));
const rewrites = Array.isArray(routing.rewrites) ? routing.rewrites.length : Object.values(routing.rewrites ?? {}).reduce((sum, list) => sum + list.length, 0);
const rules = (routing.headers?.length ?? 0) + (routing.redirects?.length ?? 0) + rewrites + (routing.dynamicRoutes?.length ?? 0) + (routing.staticRoutes?.length ?? 0);

// ---- E: cold loads -----------------------------------------------------------------------------------------------------------------

const app = (rel) => path.join(".next", "server", "app", rel);
const COLD = {
  health: { label: "/api/health", args: ["cold-load-route.cjs", app("api/health/route.js")], read: (json) => json.total_ms, bar: null },
  visit: { label: "/api/visit", args: ["cold-load-route.cjs", app("api/visit/route.js")], read: (json) => json.total_ms, bar: "beacon" },
  proxy: { label: "the proxy", args: ["cold-load-proxy.cjs"], read: (json) => (json.ok ? json.ms : undefined), bar: "proxy" },
  "start-hook": { label: "the start hook", args: ["cold-load-start-hook.cjs"], read: (json) => (json.ok ? json.ms : undefined), bar: null },
  "store-home": { label: "the store home", args: ["cold-load-page.cjs", app("s/[store]/[market]/(shop)/page.js")], read: (json) => (json.ok ? json.ms : undefined), bar: "storePage" },
  "store-product": { label: "the product page", args: ["cold-load-page.cjs", app("s/[store]/[market]/(shop)/p/[handle]/page.js")], read: (json) => (json.ok ? json.ms : undefined), bar: "storePage" },
  "admin-orders": { label: "the admin's orders page", args: ["cold-load-page.cjs", app("admin/(gated)/[store]/orders/page.js")], read: (json) => (json.ok ? json.ms : undefined), bar: "adminPage" },
};

/** One cold load in a fresh process: the milliseconds it prints, or `{ error }` for output that is not JSON, ok false or no figure. */
function coldOnce(spec) {
  const [script, ...rest] = spec.args;
  const run = spawnSync(process.execPath, [path.join(REVIEW, script), ...rest], { cwd: root, encoding: "utf8", timeout: 120_000 });
  const lines = run.stdout.trim().split("\n").filter(Boolean);
  let json;
  try {
    // The start hook may log a line before its own; its answer is the last.
    json = JSON.parse(lines[lines.length - 1]);
  } catch {
    return { error: `output that is not JSON${run.stderr ? `: ${run.stderr.trim().slice(0, 120)}` : ""}` };
  }
  const ms = spec.read(json);
  return typeof ms === "number" ? { ms } : { error: json.err || json.error || "no figure" };
}
/** The median of five cold loads of an entry, or the reason it was not measured. */
function cold(spec) {
  const results = Array.from({ length: RUNS }, () => coldOnce(spec));
  const failed = results.find((result) => result.error);
  return failed ? { error: failed.error } : { ms: median(results.map((result) => result.ms)) };
}

const measured = {};
for (const [name, spec] of Object.entries(COLD)) measured[name] = cold(spec);

// ---- F: words and messages ---------------------------------------------------------------------------------------------------------

/** A sentence of the builder's admin catalogue: it must be in no entry outside the admin. */
const SENTENCE = "En ikonliste: hver linje trenger ord.";
const words = spawnSync(process.execPath, [path.join(REVIEW, "words-in-entries.mjs"), SENTENCE], { cwd: root, encoding: "utf8" });
const outside = /^outside the admin: (\d+) of (\d+)$/m.exec(words.stdout);
const messagesBytes = [...reach(path.join(root, "src"), path.join(root, ENTRIES["store-layout"]), { dynamic: false, clientLeaf: true }).keys()]
  .filter((file) => file.startsWith(path.join(root, "src", "lib", "messages") + path.sep))
  .reduce((sum, file) => sum + sizeOf(file), 0);

// ---- the budgets -------------------------------------------------------------------------------------------------------------------

const KINDS = ["beacon", "api", "store", "pay", "site", "admin-store", "admin-platform", "proxy", "instrumentation"];
const BARS = { beacon: 100, proxy: 100, storePage: 300, adminPage: 450 };
const healthMs = measured.health.ms;
const distance = (name) => (typeof measured[name].ms === "number" && typeof healthMs === "number" ? measured[name].ms - healthMs : undefined);

/** The budgets this build supports. */
function budgetsNow() {
  // No cold-load budget is written: on the machine this was built on, the medians of five runs moved by up to 30% between runs of this script
  // and the distance from /api/health by more than 100% (step 1.8's stop rule). A budget goes here as { entry: { firstFigure, max } }, the
  // distance in milliseconds, once a quieter runner shows steady figures (`coldMsNote` says so); until then each median is printed with its distance.
  const coldMs = {};
  return {
    chunkBytes: Object.fromEntries(KINDS.filter((kind) => largest[kind]).map((kind) => [kind, { route: largest[kind].route, bytes: largest[kind].bytes, max: Math.ceil(largest[kind].bytes * ROOM) }])),
    manifest: { bytes: manifestNow.bytes, entries: manifestNow.entries },
    routingRules: { max: RULE_CAP },
    coldMs,
    coldMsNote: "not held yet: the medians wobbled by up to 30% between runs, the distance from /api/health by more than 100%; held at first figure + 25% once a runner shows steady figures",
    coldBarMs: BARS,
    coldBarFrom: "enforced when phase 2 is in (steps 2.20 to 2.24)",
    storefrontMessagesBytes: { max: MESSAGES_CAP },
  };
}

if (process.argv.includes("--write")) {
  const now = budgetsNow();
  let stored = null;
  try {
    stored = JSON.parse(readFileSync(budgetFile, "utf8"));
  } catch {
    // No budgets yet: --first writes the first.
  }
  if (stored && !process.argv.includes("--first")) {
    const up = [];
    for (const [kind, row] of Object.entries(now.chunkBytes)) if (stored.chunkBytes?.[kind] && row.bytes > stored.chunkBytes[kind].bytes) up.push(`${kind}: ${stored.chunkBytes[kind].bytes} → ${row.bytes} chunk bytes`);
    if (stored.manifest && now.manifest.bytes > stored.manifest.bytes) up.push(`manifest bytes: ${stored.manifest.bytes} → ${now.manifest.bytes}`);
    if (stored.manifest && now.manifest.entries > stored.manifest.entries) up.push(`manifest entries: ${stored.manifest.entries} → ${now.manifest.entries}`);
    if (up.length > 0) {
      console.error(`The route budget only falls. Not written:\n  ${up.join("\n  ")}\nLoad less at start, or accept it on purpose with --write --first (shown in the diff).`);
      process.exit(1);
    }
    // Only what fell is lowered: the cold-load figures and the caps stay as they were.
    for (const [kind, row] of Object.entries(now.chunkBytes)) if (stored.chunkBytes?.[kind]) stored.chunkBytes[kind] = row;
    stored.manifest = now.manifest;
    writeFileSync(budgetFile, `${JSON.stringify(stored, null, 2)}\n`);
  } else {
    writeFileSync(budgetFile, `${JSON.stringify(now, null, 2)}\n`);
  }
  console.log(`Wrote ${path.relative(root, budgetFile)}.`);
  process.exit(0);
}

// ---- print, then hold --------------------------------------------------------------------------------------------------------------

const budgets = existsSync(budgetFile) ? JSON.parse(readFileSync(budgetFile, "utf8")) : null;
const out = [];
out.push("### What a route loads", "", "**A. Chunk bytes listed at start, the largest route of each kind**", "", "| Kind | Largest route | Bytes | Budget |", "|---|---|---|---|");
for (const kind of KINDS) if (largest[kind]) out.push(`| ${kind} | ${largest[kind].route} | ${kb(largest[kind].bytes)} | ${budgets?.chunkBytes?.[kind] ? kb(budgets.chunkBytes[kind].max) : "none"} |`);
out.push("", "**B. The server-reference manifest**", "", "| Figure | Now | Budget |", "|---|---|---|");
out.push(`| bytes | ${manifestNow.bytes.toLocaleString("en")} | ${budgets?.manifest ? budgets.manifest.bytes.toLocaleString("en") : "none"} |`);
out.push(`| entries | ${manifestNow.entries.toLocaleString("en")} | ${budgets?.manifest?.entries ?? "none"} |`);
out.push(`| entries per route, median | ${manifestNow.perRoute} | |`, `| entries per admin route, median | ${manifestNow.perAdminRoute} | |`, `| entries per beacon, median | ${manifestNow.perBeacon} | |`);
out.push(`| milliseconds to read it, median of ${RUNS} | ${readMs.toFixed(1)} | |`);
out.push("", `**C. Server chunk files whose content repeats:** ${repeated.length} groups, ${kb(repeatedBytes)} more than one copy each (printed only).`);
out.push("", `**D. Routing rules:** ${rules} of ${budgets?.routingRules?.max ?? RULE_CAP} (Vercel's cap is 2,048).`);
out.push("", `**E. Cold load, median of ${RUNS} fresh processes**`, "", "| Entry | Median ms | From /api/health | Budget from /api/health | Bar |", "|---|---|---|---|---|");
for (const [name, spec] of Object.entries(COLD)) {
  const result = measured[name];
  if (result.error) {
    out.push(`| ${spec.label} | not measured: ${String(result.error).replaceAll("|", "/")} | | | |`);
    continue;
  }
  const bar = spec.bar ? `${budgets?.coldBarMs?.[spec.bar] ?? BARS[spec.bar]} ms` : "";
  out.push(`| ${spec.label} | ${result.ms} | ${name === "health" ? "" : `${distance(name) >= 0 ? "+" : ""}${distance(name)}`} | ${budgets?.coldMs?.[name] ? `+${budgets.coldMs[name].max}` : ""} | ${bar} |`);
}
out.push("", "The bars are printed, not enforced: they are held when phase 2 is in (steps 2.20 to 2.24).");
out.push("", "**F. Words and messages**", "", `- entries outside the admin that list a chunk with a builder sentence: ${outside ? `${outside[1]} of ${outside[2]}` : "not measured"}`);
out.push(`- bytes of src/lib/messages behind the store layout: ${messagesBytes.toLocaleString("en")} (at most ${(budgets?.storefrontMessagesBytes?.max ?? MESSAGES_CAP).toLocaleString("en")})`);
console.log(out.join("\n"));

const breaches = [];
if (!budgets) breaches.push("scripts/route-budget.json is missing: write it with node scripts/route-budget.mjs --write --first after pnpm build.");
else {
  for (const kind of KINDS) {
    const held = budgets.chunkBytes?.[kind];
    if (held && largest[kind] && largest[kind].bytes > held.max) breaches.push(`${kind} chunk bytes: ${largest[kind].route} lists ${largest[kind].bytes} bytes, budget ${held.max}. Load the new module with import() where it is used (node scripts/route-load.mjs says what the entry reaches).`);
  }
  // The manifest grows with every server action: room of 4 %, as the chunk bytes have.
  if (manifestNow.bytes > Math.ceil(budgets.manifest.bytes * ROOM)) breaches.push(`manifest bytes: ${manifestNow.bytes}, budget ${budgets.manifest.bytes}. Fewer server functions are exported to the browser; a new one is a deliberate step.`);
  if (manifestNow.entries > Math.ceil(budgets.manifest.entries * ROOM)) breaches.push(`manifest entries: ${manifestNow.entries}, budget ${budgets.manifest.entries}. A new "use server" export adds an entry to every route that imports it.`);
  if (rules > Math.min(budgets.routingRules.max, RULE_CAP)) breaches.push(`routing rules: ${rules}, budget ${budgets.routingRules.max} (Vercel's cap is 2,048). Fewer headers, redirects, rewrites or routes.`);
  for (const [name, held] of Object.entries(budgets.coldMs ?? {})) {
    if (!COLD[name] || measured[name]?.error || measured.health.error) continue;
    if (distance(name) <= held.max) continue;
    // A timing on a shared runner is noisy: the five runs of the entry (and of /api/health, its yardstick) are made once more before it fails.
    measured[name] = cold(COLD[name]);
    measured.health = cold(COLD.health);
    if (!measured[name].error && !measured.health.error && distance(name) > held.max)
      breaches.push(`cold load of ${COLD[name].label}: ${distance(name)} ms beyond /api/health (median ${measured[name].ms} ms against ${measured.health.ms} ms), budget ${held.max}. Find what it loads first (node scripts/route-load.mjs) and load it with import() where it is used.`);
  }
  if (outside && Number(outside[1]) > 0) breaches.push(`words: ${outside[1]} of ${outside[2]} entries outside the admin list a chunk with a builder sentence, budget 0. Import the admin's words only in the admin (src/lib/admin-messages).`);
  if (messagesBytes > budgets.storefrontMessagesBytes.max) breaches.push(`storefront messages: ${messagesBytes} bytes of src/lib/messages behind the store layout, budget ${budgets.storefrontMessagesBytes.max}. Load a language's catalogue with import() for the visitors who read it.`);
}
if (!outside) breaches.push("words: node docs/audits/bloat-review-2026-11/scripts/words-in-entries.mjs printed no 'outside the admin:' line. Step 0.1's script changed; read what it prints.");
if (breaches.length > 0) {
  console.log(`\n**Over budget**\n\n${breaches.map((line) => `- ${line}`).join("\n")}`);
  console.error(breaches.join("\n"));
  process.exit(1);
}
console.log("\nEvery figure is within its budget.");
