// `pnpm build` (docs/build-memory.md): `next build`, with a 7 GB heap for its type check everywhere but Vercel. Vercel's build machine
// has 8 GB and skips the type check (next.config.ts, `ON_VERCEL`), so a heap that size there only lets the compile hold more.
// It ends with one line, `Build: <seconds> s, peak memory <x.x> GB (<source>)` (bloat review step 1.20), after a failed build too: on Vercel
// that line is the last of the build log. GITHUB_STEP_SUMMARY gets the same line; BUILD_REPORT names a file for { seconds, peakBytes, source }.
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

import { formatGb, startPeakSampler } from "./lib/peak-memory.mjs";

const env = { ...process.env };
if (!env.VERCEL && !/max-old-space-size/.test(env.NODE_OPTIONS ?? "")) {
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --max-old-space-size=7168`.trim();
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
  process.exit(code);
}

const child = spawn("next", ["build", ...process.argv.slice(2)], { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("error", () => finish(1));
child.on("close", (code) => finish(code ?? 1));
