#!/usr/bin/env node
/**
 * Lighthouse on a page, as PageSpeed Insights runs it (D211, `docs/performance.md`): the four scores, the measures behind
 * Performance and the largest scripts, for a phone (simulated slow 4G and CPU) and a computer.
 *
 *   pnpm perf                                   # starts the built app on port 3100 and checks the demo store's front page
 *   pnpm perf https://kaizenalabs.com/          # any address (nothing is started)
 *   pnpm perf --form=mobile --min=90            # one form factor; exit 1 if any score is under 90
 *
 * Lighthouse is fetched by npx at a fixed version and drives the Chromium Playwright uses (PLAYWRIGHT_CHROMIUM_PATH or CHROME_PATH).
 * Build first (`pnpm build`) for a local run. Scores move a few points between runs; the steady numbers are held by
 * `e2e/performance.spec.ts`.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIGHTHOUSE = "lighthouse@12.8.2";
const PORT = 3100;

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const target = args.find((arg) => !arg.startsWith("--"));
const forms = option("form") ? [option("form")] : ["mobile", "desktop"];
const min = option("min") ? Number(option("min")) : null;
const chrome = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? process.env.CHROME_PATH;

async function serve() {
  const server = spawn("pnpm", ["-s", "start", "-p", String(PORT)], { stdio: "ignore", detached: true });
  const url = `http://localhost:${PORT}/s/demo/no`;
  for (let tries = 0; tries < 120; tries++) {
    try {
      if ((await fetch(url)).ok) {
        await fetch(url); // once more, so the page is made before it is measured
        return { url, stop: () => process.kill(-server.pid) };
      }
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  process.kill(-server.pid);
  throw new Error(`The app did not answer on port ${PORT}: build it first (pnpm build).`);
}

function lighthouse(url, form) {
  const out = join(mkdtempSync(join(tmpdir(), "perf-")), "report.json");
  execFileSync(
    "npx",
    [
      "-y",
      LIGHTHOUSE,
      url,
      ...(form === "desktop" ? ["--preset=desktop"] : []),
      "--only-categories=performance,accessibility,best-practices,seo",
      "--output=json",
      `--output-path=${out}`,
      "--quiet",
      "--chrome-flags=--headless=new --no-sandbox",
    ],
    { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) } },
  );
  return JSON.parse(readFileSync(out, "utf8"));
}

const { url, stop } = target ? { url: target, stop: () => {} } : await serve();
let failed = false;
try {
  for (const form of forms) {
    const report = lighthouse(url, form);
    const audits = report.audits;
    const scores = Object.fromEntries(Object.entries(report.categories).map(([id, category]) => [id, Math.round((category.score ?? 0) * 100)]));
    console.log(`\n${form} ${url}`);
    console.log(Object.entries(scores).map(([id, score]) => `  ${id}: ${score}`).join("\n"));
    for (const id of ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"]) {
      console.log(`  ${audits[id].title}: ${audits[id].displayValue}`);
    }
    const scripts = (audits["network-requests"].details?.items ?? []).filter((item) => item.resourceType === "Script");
    const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
    console.log(`  Scripts: ${kb(scripts.reduce((sum, item) => sum + (item.transferSize ?? 0), 0))} in ${scripts.length} files`);
    for (const item of scripts.sort((a, b) => (b.transferSize ?? 0) - (a.transferSize ?? 0)).slice(0, 5)) console.log(`    ${kb(item.transferSize ?? 0)}  ${item.url}`);
    const failing = Object.values(report.categories)
      .flatMap((category) => category.auditRefs.map((ref) => ({ category: category.id, ref, audit: audits[ref.id] })))
      .filter(({ ref, audit }) => ref.weight > 0 && audit.score !== null && audit.score < 1);
    for (const { category, audit } of failing) console.log(`  [${category}] ${audit.title}${audit.displayValue ? `: ${audit.displayValue}` : ""}`);
    if (min !== null && Object.values(scores).some((score) => score < min)) failed = true;
  }
} finally {
  stop();
}
if (failed) {
  console.error(`\nA score is under ${min}.`);
  process.exit(1);
}
