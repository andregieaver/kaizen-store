// What is static: after `pnpm build`, holds the render mode, the holes and the platform-wide tags of named routes, and what the demo
// store's resume data keeps (bloat review step 1.11, CA-16). It reads .next only: no server, no database.
//
//   node scripts/render-modes.mjs          check against scripts/render-modes.baseline.json (exit 1 on a regression, or on a gain not yet written)
//   node scripts/render-modes.mjs --write  write today's figures into the baseline (the rewrite is the deliberate step; read its diff)
//
// A route's compute only gets worse in the order static, resuming, blocking, per-request. A hole is a boundary (`<template id="B:n">`) whose
// content is not streamed into the prerendered file (no `<div hidden id="S:n">`). Totals over the whole manifest are printed, never held:
// the other work adds routes every day.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const NEXT = path.join(ROOT, ".next");
const BASELINE = path.join(ROOT, "scripts/render-modes.baseline.json");
const ROUTES = [
  "/",
  "/docs",
  "/docs/owners/getting-started/create-your-store",
  "/themes",
  "/s/demo/no",
  "/s/demo/no/om-oss",
  "/s/demo/no/blog/nye-produkter",
  "/s/demo/no/products",
  "/s/demo/no/category/belysning",
  "/s/demo/no/p/demo-keramikkopp",
  "/s/demo/no/search",
  "/s/demo/no/cart",
];
const ORDER = ["static", "resuming", "blocking", "per-request"];
const DEMO_DIR = path.join(NEXT, "server/app/s/demo");

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
const manifest = JSON.parse(read(path.join(NEXT, "prerender-manifest.json")) ?? "null");
if (!manifest?.routes) {
  console.error("render-modes: .next/prerender-manifest.json is missing: run pnpm build first");
  process.exit(1);
}

function measureRoute(route) {
  const entry = manifest.routes[route];
  const base = path.join(NEXT, "server/app", route === "/" ? "index" : route);
  const html = read(`${base}.html`);
  const meta = read(`${base}.meta`);
  if (!entry || !html) return { compute: "per-request", holes: 0, platformTags: [], revalidate: 0, titleInHead: false };
  if (entry.compute === undefined) throw new Error(`${route}: the manifest has no compute field: this Next version writes it another way`);
  const shown = new Set([...html.matchAll(/<div hidden id="S:(\d+)"/g)].map((m) => m[1]));
  const holes = [...html.matchAll(/<template id="B:(\d+)"/g)].filter((m) => !shown.has(m[1])).length;
  let tags = [];
  try {
    tags = String(JSON.parse(meta ?? "{}").headers?.["x-next-cache-tags"] ?? "").split(",").filter(Boolean);
  } catch {
    tags = [];
  }
  const platformTags = tags.filter((t) => !t.startsWith("_N_T_") && !t.includes(":")).sort();
  const head = html.slice(0, Math.max(html.indexOf("</head>"), 0));
  return {
    compute: entry.compute,
    holes,
    platformTags,
    revalidate: entry.initialRevalidateSeconds ?? 0,
    titleInHead: /<title[ >]/.test(head) && /property="og:title"/.test(head),
  };
}

/** The demo store's entries: resume data that keeps a list of page documents, tags with both pages tags, and the resume data's median size. */
function measureDemo() {
  let entries = 0;
  let withList = 0;
  let withBothTags = 0;
  const sizes = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.endsWith(".segments")) walk(p);
        continue;
      }
      if (!e.name.endsWith(".meta")) continue;
      let meta;
      try {
        meta = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        continue;
      }
      entries++;
      const tags = String(meta.headers?.["x-next-cache-tags"] ?? "").split(",");
      if (tags.some((t) => t.startsWith("pages:")) && tags.some((t) => /^page:/.test(t))) withBothTags++;
      const state = meta.postponed;
      if (!state) continue;
      sizes.push(state.length);
      const m = state.match(/^([0-9]*):/);
      if (!m) continue;
      const tail = state.slice(m[1].length + 1 + parseInt(m[1]));
      if (tail === "null") continue;
      let json;
      try {
        json = JSON.parse(zlib.inflateSync(Buffer.from(tail, "base64")).toString("utf8"));
      } catch {
        continue;
      }
      for (const v of Object.values(json.store?.cache ?? {})) {
        const val = Buffer.from(v.entry.value, "base64").toString("utf8");
        if (v.entry.tags.some((t) => t.startsWith("pages:")) && /^0:"\$@1"\s*1:\[\{"id":"[0-9a-f-]{36}","slug":"[^"]*","content":\{/.test(val)) {
          withList++;
          break;
        }
      }
    }
  };
  walk(DEMO_DIR);
  sizes.sort((a, b) => a - b);
  const medianBytes = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  return { entries, withList, withBothTags, medianBytes };
}

const today = { routes: Object.fromEntries(ROUTES.map((r) => [r, measureRoute(r)])), meta: measureDemo() };
const byCompute = {};
for (const r of Object.values(manifest.routes)) byCompute[r.compute ?? "unknown"] = (byCompute[r.compute ?? "unknown"] ?? 0) + 1;
const noFallback = Object.values(manifest.dynamicRoutes ?? {}).filter((r) => r.fallback === null).length;
const totals = { routesByCompute: byCompute, dynamicPatternsWithoutFallback: noFallback };

const table = [
  "| Route | Compute | Holes | Revalidate (s) | Platform tags | Title in head |",
  "|---|---|---|---|---|---|",
  ...ROUTES.map((r) => {
    const m = today.routes[r];
    return `| ${r} | ${m.compute} | ${m.holes} | ${m.revalidate} | ${m.platformTags.join(", ") || "none"} | ${m.titleInHead ? "yes" : "NO"} |`;
  }),
].join("\n");
console.log(table);
console.log(
  `\nDemo store: ${today.meta.entries} entries; ${today.meta.withList} keep a list of page documents; ${today.meta.withBothTags} carry both the pages tag and a page's own; median resume data ${today.meta.medianBytes} bytes.`,
);
console.log(`Whole manifest (noted, not held): routes by compute ${JSON.stringify(byCompute)}; dynamic patterns without a fallback ${noFallback}.`);

if (process.argv.includes("--write")) {
  fs.writeFileSync(BASELINE, JSON.stringify({ routes: today.routes, meta: today.meta, totals }, null, 2) + "\n");
  console.log(`\nWrote ${path.relative(ROOT, BASELINE)}: today's figures. Read its diff: a worse figure is accepted only with a reason in the commit.`);
  process.exit(0);
}

const base = JSON.parse(read(BASELINE) ?? "null");
if (!base) {
  console.error("render-modes: scripts/render-modes.baseline.json is missing: run node scripts/render-modes.mjs --write after pnpm build");
  process.exit(1);
}
const worse = [];
const better = [];
for (const route of ROUTES) {
  const was = base.routes[route];
  const now = today.routes[route];
  if (!was) {
    better.push(`${route} is not in the baseline`);
    continue;
  }
  const a = ORDER.indexOf(was.compute);
  const b = ORDER.indexOf(now.compute);
  if (b > a) worse.push(`${route}: compute went from ${was.compute} to ${now.compute}`);
  if (b < a) better.push(`${route}: compute went from ${was.compute} to ${now.compute}`);
  if (now.holes > was.holes) worse.push(`${route}: holes rose from ${was.holes} to ${now.holes}`);
  if (now.holes < was.holes) better.push(`${route}: holes fell from ${was.holes} to ${now.holes}`);
  const added = now.platformTags.filter((t) => !was.platformTags.includes(t));
  const gone = was.platformTags.filter((t) => !now.platformTags.includes(t));
  if (added.length) worse.push(`${route}: a platform-wide tag appeared: ${added.join(", ")}`);
  if (gone.length) better.push(`${route}: platform-wide tags went: ${gone.join(", ")}`);
  if (now.revalidate < was.revalidate) worse.push(`${route}: revalidate fell from ${was.revalidate} to ${now.revalidate} seconds`);
  if (now.revalidate > was.revalidate) better.push(`${route}: revalidate rose from ${was.revalidate} to ${now.revalidate} seconds`);
  if (was.titleInHead && !now.titleInHead) worse.push(`${route}: lost its <title> or og:title in the head`);
  if (!was.titleInHead && now.titleInHead) better.push(`${route}: has its title in the head now`);
}
for (const key of ["withList", "withBothTags"]) {
  if (today.meta[key] > base.meta[key]) worse.push(`demo store ${key} rose from ${base.meta[key]} to ${today.meta[key]}`);
  if (today.meta[key] < base.meta[key]) better.push(`demo store ${key} fell from ${base.meta[key]} to ${today.meta[key]}`);
}
const was = base.meta.medianBytes;
const now = today.meta.medianBytes;
if (was > 0 && Math.abs(now - was) / was > 0.05) {
  (now > was ? worse : better).push(`demo store median resume data moved from ${was} to ${now} bytes (more than 5%)`);
}
if (worse.length) {
  console.error(`\nrender-modes: ${worse.length} figure(s) got worse:\n- ${worse.join("\n- ")}`);
  console.error(
    "A new cookies(), headers(), connection() or searchParams read in a layout or a shared part moves every page under it. Fix it, or if the change is meant, run node scripts/render-modes.mjs --write and say why in the commit.",
  );
}
if (better.length) {
  console.error(`\nrender-modes: ${better.length} figure(s) got better or are new:\n- ${better.join("\n- ")}\nLock the gain in: node scripts/render-modes.mjs --write`);
}
// A gain or a new route is a note, so the other work's improvements never hold back a release (reviewed 17 November 2026).
process.exit(worse.length ? 1 : 0);
