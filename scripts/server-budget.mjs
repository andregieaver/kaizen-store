// Statements per store page on the built app (bloat review step 1.11, SD-13). Run after `pnpm build`, with DATABASE_URL set, on its own:
// nothing else may be sending statements to the server while it runs.
//
//   node scripts/server-budget.mjs                 check every page against scripts/server-budget.json (exit 1 when one is over its max)
//   node scripts/server-budget.mjs --write         lower each max to the measured count + 2 (it refuses to raise one; --first writes them all)
//   node scripts/server-budget.mjs --write --first write the first budgets
//   node scripts/server-budget.mjs --doc           also rewrite the table in docs/performance.md
//
// The count is the server's own statement log (STATEMENT_LOG=1, src/db/statement-log.ts): CI's Postgres image does not load
// pg_stat_statements. A page's count is its warm count: it is requested once unmeasured, then again, and the statements the server logs
// until it has been quiet for two seconds are counted. The statements the server sends by itself in its first quiet seconds (the start
// hook's poll) are background and never counted.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { seedLargeStore } from "./lib/budget-seed.mjs";

const ROOT = process.cwd();
const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const FILE = path.join(ROOT, "scripts/server-budget.json");
const DOC = path.join(ROOT, "docs/performance.md");
const ARGS = new Set(process.argv.slice(2));
const MARGIN = 2;
const QUIET_MS = 2000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

if (!process.env.DATABASE_URL) {
  console.error("server-budget: DATABASE_URL is not set");
  process.exit(1);
}

let server = null;
let arrivals = [];
const background = new Set();
// Statements no request asked for, which land on whichever page is in flight: the cache-event flush (step 1.25) and the house store's
// lookup that a cached read repeats when its lifetime ends (it came and went between runs on the same build and database).
const NOISE = [/^insert into commerce\.cache_events_daily\b/, /^select s\.slug from commerce\.platform_settings p join commerce\.stores s on s\.house\b/];

async function start() {
  // A server left over from an earlier run would answer without the log switch and every count would read 0.
  const taken = await fetch(`${BASE}/api/health`).then(() => true, () => false);
  if (taken) throw new Error(`Something already answers on port ${PORT}: stop it first.`);
  arrivals = [];
  server = spawn("pnpm", ["-s", "start", "-p", String(PORT)], {
    env: { ...process.env, STATEMENT_LOG: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let rest = "";
  server.stdout.on("data", (chunk) => {
    rest += chunk;
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("{")) continue;
      try {
        const row = JSON.parse(line);
        if (row.event === "db.statement" && typeof row.text === "string") arrivals.push({ at: performance.now(), text: row.text });
      } catch {
        // not a log line
      }
    }
  });
  server.stderr.on("data", () => {});
}

function stop() {
  if (!server) return;
  try {
    process.kill(-server.pid);
  } catch {
    // already gone
  }
  server = null;
}

async function waitForServer() {
  for (let tries = 0; tries < 240; tries++) {
    try {
      await fetch(`${BASE}/api/health`); // any answer: a 503 here only says the health checks lack production settings
      return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`The app did not answer on port ${PORT}: build it first (pnpm build).`);
}

/** Waits until the server has logged nothing for `ms`. */
async function quiet(ms = QUIET_MS) {
  for (;;) {
    const last = arrivals.length ? arrivals[arrivals.length - 1].at : 0;
    const wait = ms - (performance.now() - last);
    if (wait <= 0) return;
    await sleep(Math.min(wait, 250) + 10);
  }
}

async function boot() {
  await start();
  await waitForServer();
  await sleep(5000);
  for (const a of arrivals) background.add(a.text);
  await quiet();
}

const get = (url, cookie) => fetch(`${BASE}${url}`, { headers: cookie ? { cookie } : {}, redirect: "manual" }).then((r) => r.arrayBuffer().then(() => r.status));

/** The statements a request sent, background left out. */
async function count(url, cookie, { warm }) {
  if (warm) {
    await get(url, cookie);
    await quiet();
  }
  // A warm page is measured twice and the smaller count kept: a cached read whose lifetime ends repeats its statement on one request,
  // and it would not do so on the next.
  let best = null;
  for (let pass = 0; pass < (warm ? 2 : 1); pass++) {
    const mark = arrivals.length;
    const status = await get(url, cookie);
    await quiet();
    const texts = arrivals.slice(mark).map((a) => a.text).filter((t) => !background.has(t) && !NOISE.some((n) => n.test(t)));
    if (!best || texts.length < best.statements) best = { statements: texts.length, texts, status };
  }
  return best;
}

function top(texts) {
  const counts = new Map();
  for (const t of texts) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `  ${n} x ${t}`).join("\n");
}

async function cartCookie() {
  const require = createRequire(`${ROOT}/`);
  const { chromium } = require("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let lines = 0;
    for (const handle of ["demo-notatbok", "demo-handlenett", "demo-keramikkopp"]) {
      await page.goto(`${BASE}/s/demo/no/p/${handle}`);
      await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
      lines++;
      await page.getByRole("link", { name: new RegExp(`Handlekurv \\(${lines}\\)`) }).waitFor({ timeout: 20000 });
    }
    return (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  } finally {
    await browser.close();
  }
}

const budgetNow = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {};
const big = await seedLargeStore(process.env.DATABASE_URL, { slug: "budget-500", products: 500 });
const bigBase = `/s/${big.slug}`;
const results = {};
let failed = false;

try {
  await boot();
  const cookie = await cartCookie();
  await quiet();
  const pages = [
    ["home", "/s/demo/no"],
    ["product", "/s/demo/no/p/demo-keramikkopp"],
    ["all products", "/s/demo/no/products"],
    ["category", "/s/demo/no/category/belysning"],
    ["search", "/s/demo/no/search?q=lampe"],
    ["home with a cart cookie", "/s/demo/no", cookie],
    ["cart with three lines", "/s/demo/no/cart", cookie],
    ["checkout at its first step", "/s/demo/no/checkout", cookie],
    ["large store home", bigBase],
    ["large store product", `${bigBase}/p/${big.handle}`],
  ];
  for (const [name, url, cookieHeader] of pages) {
    let one = await count(url, cookieHeader, { warm: true });
    // A page over its max is measured once more before it fails.
    if (budgetNow[name] && one.statements > budgetNow[name].max) one = await count(url, cookieHeader, { warm: true });
    results[name] = { statements: one.statements, texts: one.texts, status: one.status };
  }
  for (const [name, url] of [
    ["large store home, cold", bigBase],
    ["large store product, cold", `${bigBase}/p/${big.handle}`],
  ]) {
    // Each cold count starts from a fresh server.
    stop();
    await sleep(1000);
    await boot();
    const one = await count(url, undefined, { warm: false });
    results[name] = { statements: one.statements, texts: one.texts, status: one.status };
  }
} finally {
  stop();
}

if (process.env.SERVER_BUDGET_DUMP) fs.writeFileSync(process.env.SERVER_BUDGET_DUMP, JSON.stringify(results, null, 1));
const budget = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {};
const next = {};
const rows = [];
for (const [name, r] of Object.entries(results)) {
  const was = budget[name];
  const entry = { statements: r.statements, max: r.statements + MARGIN };
  if (was?.bar !== undefined) entry.bar = was.bar;
  if (name === "cart with three lines" && entry.bar === undefined) entry.bar = 12;
  if (ARGS.has("--write") && was && !ARGS.has("--first")) {
    if (entry.max > was.max) console.error(`server-budget: ${name} is ${r.statements}, over its max ${was.max}: --write lowers a budget, it never raises one (--first writes the first)`);
    entry.max = Math.min(was.max, entry.max);
  }
  if (!ARGS.has("--write")) entry.max = was?.max ?? entry.max;
  next[name] = entry;
  const over = was ? r.statements > was.max : false;
  rows.push({ name, ...entry, over, status: r.status, missing: !was });
  if (r.status !== 200 && !name.includes("checkout")) {
    console.error(`server-budget: ${name} answered ${r.status}, not 200`);
    failed = true;
  }
  if (over) {
    failed = true;
    console.error(`\nserver-budget: ${name} sent ${r.statements} statements, over its max of ${was.max}. The ten most repeated:\n${top(r.texts)}`);
  }
  if (!was && !ARGS.has("--write")) console.error(`server-budget: ${name} has no budget yet: run node scripts/server-budget.mjs --write --first`);
}

const table = [
  "| Page | Statements | Max | Bar |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.name} | ${r.statements} | ${r.max} | ${r.bar !== undefined ? `${r.bar} or fewer` : ""} |`),
].join("\n");
console.log(table);

if (ARGS.has("--write")) {
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n");
  console.log(`\nWrote ${path.relative(ROOT, FILE)}.`);
  failed = false;
}
if (ARGS.has("--doc")) {
  const doc = fs.readFileSync(DOC, "utf8");
  const a = "<!-- server-budget:start -->";
  const b = "<!-- server-budget:end -->";
  const i = doc.indexOf(a);
  const j = doc.indexOf(b);
  if (i < 0 || j < i) {
    console.error("server-budget: the markers are missing from docs/performance.md");
    failed = true;
  } else {
    fs.writeFileSync(DOC, `${doc.slice(0, i + a.length)}\n${table}\n${doc.slice(j)}`);
  }
}
process.exit(failed ? 1 : 0);
