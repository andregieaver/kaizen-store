// `pnpm build` (docs/build-memory.md): `next build`, with a 7 GB heap for its type check everywhere but Vercel. Vercel's build machine
// has 8 GB and skips the type check (next.config.ts, `ON_VERCEL`), so a heap that size there only lets the compile hold more.
// It ends with one line, `Build: <seconds> s, peak memory <x.x> GB (<source>)` (bloat review step 1.20), after a failed build too: on Vercel
// that line is the last of the build log. GITHUB_STEP_SUMMARY gets the same line; BUILD_REPORT names a file for { seconds, peakBytes, source }.
// On Vercel's production build it also writes build-stats.json (step 1.21: seconds, peak, the machine's memory and the ten builds before, only
// numbers and the commit): the health route is traced with it, so /api/health tells CI what this build peaked at.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { machineKb } from "./lib/build-stats.mjs";
import { formatGb, startPeakSampler } from "./lib/peak-memory.mjs";

const env = { ...process.env };
if (!env.VERCEL && !/max-old-space-size/.test(env.NODE_OPTIONS ?? "")) {
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --max-old-space-size=7168`.trim();
}

const STATS_FILE = path.join(import.meta.dirname, "..", "build-stats.json");
const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || null;

/** The peaks of the earlier production builds, from production's own /api/health (its build.history and build.peakKb); [] on any failure. */
async function earlierPeaks() {
  if (process.env.VERCEL_ENV !== "production" && !process.env.BUILD_STATS_FROM) return [];
  try {
    const response = await fetch(`${process.env.BUILD_STATS_FROM || "https://kaizenaflow.com"}/api/health`, { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    return [
      ...(Array.isArray(body.build?.history) ? body.build.history : []),
      ...(typeof body.build?.peakKb === "number" && body.build.peakKb > 0 ? [body.build.peakKb] : []),
    ]
      .filter((n) => typeof n === "number")
      .slice(-10);
  } catch {
    return [];
  }
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

const history = await earlierPeaks();
// The file exists while next traces the health route; a good build overwrites it with its figures when it ends.
try {
  writeFileSync(STATS_FILE, JSON.stringify({ commit, seconds: 0, peakKb: 0, machineKb: 0, history }));
} catch {
  // Without it the health route reports no build; the build itself goes on.
}

const started = Date.now();
const sampler = startPeakSampler();
let finished = false;

function finish(code) {
  if (finished) return;
  finished = true;
  const peak = sampler.stop();
  const seconds = Math.round((Date.now() - started) / 1000);
  const memory = peak.peakBytes === null ? "peak memory not measured" : `peak memory ${formatGb(peak.peakBytes)} (${peak.source})`;
  const line = `Build: ${seconds} s, ${memory}`;
  console.log(line);
  try {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
    if (process.env.BUILD_REPORT) {
      writeFileSync(process.env.BUILD_REPORT, JSON.stringify({ seconds, peakBytes: peak.peakBytes, source: peak.source ?? null }));
    }
  } catch (error) {
    console.error(`Build: the report could not be written (${error instanceof Error ? error.message : "unknown"})`);
  }
  if (code === 0) {
    try {
      writeFileSync(
        STATS_FILE,
        JSON.stringify({
          commit,
          seconds,
          peakKb: peak.peakBytes === null ? 0 : Math.round(peak.peakBytes / 1024),
          machineKb: machineKb(readText("/proc/meminfo") ?? "", readText("/sys/fs/cgroup/memory.max")),
          history,
        }),
      );
    } catch (error) {
      console.error(`Build: build-stats.json could not be written (${error instanceof Error ? error.message : "unknown"})`);
    }
  }
  process.exit(code);
}

const child = spawn("next", ["build", ...process.argv.slice(2)], { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("error", () => finish(1));
child.on("close", (code) => finish(code ?? 1));
