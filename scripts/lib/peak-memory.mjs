// What a build peaked at (bloat review step 1.20): the container's own peak where the kernel keeps one, else the highest used memory
// sampled from /proc/meminfo. Plain Node, no dependencies, so `scripts/next-build.mjs` can load it on Vercel's build machine.
import { readFileSync } from "node:fs";

/** The text of /sys/fs/cgroup/memory.peak (bytes and a newline) as a number, or null when it is empty or not a number. */
export function readCgroupPeak(text) {
  const trimmed = String(text ?? "").trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Bytes in use from the text of /proc/meminfo (MemTotal minus MemAvailable, both in kB there), or null when either line is missing. */
export function usedFromMeminfo(text) {
  const kb = (name) => {
    const match = new RegExp(`^${name}:\\s+(\\d+)\\s+kB`, "m").exec(String(text ?? ""));
    return match ? Number(match[1]) : null;
  };
  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  if (total === null || available === null) return null;
  return (total - available) * 1024;
}

/** `7.2 GB`: one decimal. */
export function formatGb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function readFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Starts sampling /proc/meminfo now (the base) and every `everyMs`, keeping the highest used figure. `stop()` ends the timer and returns
 * `{ peakBytes, baseBytes, source }`: the cgroup's own peak (source 'cgroup') where /sys/fs/cgroup/memory.peak exists and parses, else the
 * highest sample (source 'meminfo'); `{ peakBytes: null }` where neither file exists (macOS, Windows).
 */
export function startPeakSampler({ everyMs = 2000 } = {}) {
  const sample = () => {
    const text = readFile("/proc/meminfo");
    return text === null ? null : usedFromMeminfo(text);
  };
  const baseBytes = sample();
  let highest = baseBytes;
  const timer = setInterval(() => {
    const used = sample();
    if (used !== null && (highest === null || used > highest)) highest = used;
  }, everyMs);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
      const last = sample();
      if (last !== null && (highest === null || last > highest)) highest = last;
      const cgroup = readCgroupPeak(readFile("/sys/fs/cgroup/memory.peak"));
      if (cgroup !== null) return { peakBytes: cgroup, baseBytes, source: "cgroup" };
      if (highest === null) return { peakBytes: null };
      return { peakBytes: highest, baseBytes, source: "meminfo" };
    },
  };
}
