// What a production build reports and what its ceiling is (bloat review step 1.21, docs/build-memory.md). Plain Node, no dependencies:
// `scripts/next-build.mjs` writes build-stats.json with it on Vercel's build machine, and `scripts/await-deploy.mjs` judges it in CI.

/** The 75% line: the share of the build machine's memory a build may peak at. Raised only by a decision row (docs/build-memory.md). */
export const MACHINE_SHARE = 0.75;
/** The growth a build may show over the median of the builds before it. */
export const MEDIAN_GROWTH = 1.1;

/** The middle of the numbers (the mean of the two middle ones for an even count); null for an empty list. */
export function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The build machine's memory in kB: MemTotal from /proc/meminfo's text, or the cgroup's limit (memory.max's text, bytes) when that is smaller. 0 when unknown. */
export function machineKb(meminfoText, cgroupMaxText) {
  const match = /^MemTotal:\s+(\d+)\s+kB/m.exec(String(meminfoText ?? ""));
  const total = match ? Number(match[1]) : 0;
  const limit = String(cgroupMaxText ?? "").trim();
  if (/^\d+$/.test(limit)) {
    const limitKb = Number(limit) / 1024;
    return total > 0 ? Math.min(total, limitKb) : limitKb;
  }
  return total;
}

/** The peak a build may reach, in kB: 75% of the machine, or when five or more earlier builds are known, the median of them plus 10% if that is smaller. */
export function ceilingKb({ machineKb: machine, history }) {
  const line = MACHINE_SHARE * machine;
  const past = (history ?? []).filter((n) => Number.isFinite(n) && n > 0);
  return past.length >= 5 ? Math.min(line, MEDIAN_GROWTH * median(past)) : line;
}

const gb = (kb) => (kb / 1048576).toFixed(1);

/** `{ ceilingKb, over, line }` for a build's peak; `history` is the peaks of the earlier production builds, newest last, this one not among them. */
export function buildVerdict({ peakKb, machineKb: machine, history, seconds = 0 }) {
  const ceiling = ceilingKb({ machineKb: machine, history });
  const time = Number.isFinite(seconds) && seconds > 0 ? `${seconds} s, ` : "";
  return {
    ceilingKb: ceiling,
    over: peakKb > ceiling,
    line: `Build: ${time}peak ${gb(peakKb)} GB of ${gb(machine)} GB; ceiling ${gb(ceiling)} GB (median of the last 10 builds plus 10%, never above 75% of the machine)`,
  };
}
