// The pure parts of scripts/timed.mjs (bloat review step 1.20): the ceiling check, the readers of vitest's summary and report and
// Playwright's report, and the check on the ceilings themselves. Plain Node, so the recorder runs before anything is built.

/** `{ ceiling, over }` for the key from scripts/ci-budgets.json's `ceilings`, or null when the key has no ceiling yet. */
export function overCeiling(key, seconds, budgets) {
  const entry = budgets?.ceilings?.[key];
  if (!entry || typeof entry.seconds !== "number") return null;
  return { ceiling: entry.seconds, over: seconds > entry.seconds };
}

const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Vitest's summary line from its plain output: the whole duration and its `setup` phase. This vitest prints each phase as its share of the
 * summed worker time (`Duration 434.29s (tests 57%, import 28%, setup 8%, ...)`, so `setupPercent` is read as printed and `setupSeconds` is
 * null); older ones print seconds (`setup 4.2s`, then `setupPercent` is worked out against the whole). Null when there is no such line.
 */
export function parseVitestDuration(stdoutText) {
  const text = String(stdoutText ?? "").replace(ANSI, "");
  const line = /^\s*Duration\s+([\d.,]+)(ms|s)\b(?:\s*\(([^)\n]*)\))?/m.exec(text);
  if (!line) return null;
  const totalSeconds = line[2] === "ms" ? Number(line[1].replace(",", "")) / 1000 : Number(line[1].replace(",", ""));
  if (!Number.isFinite(totalSeconds)) return null;
  const setup = /\bsetup\s+([\d.,]+)(%|ms|s)/.exec(line[3] ?? "");
  if (!setup) return { totalSeconds, setupSeconds: null, setupPercent: null };
  const value = Number(setup[1].replace(",", ""));
  if (setup[2] === "%") return { totalSeconds, setupSeconds: null, setupPercent: value };
  const setupSeconds = setup[2] === "ms" ? value / 1000 : value;
  return { totalSeconds, setupSeconds, setupPercent: totalSeconds > 0 ? (setupSeconds / totalSeconds) * 100 : null };
}

/** The setup share to print as a problem: more than `limit` percent of the unit run, or null. */
export function setupShareProblem(parsed, limit = 10) {
  if (!parsed || parsed.setupPercent === null || parsed.setupPercent === undefined) return null;
  const percent = Math.round(parsed.setupPercent);
  return parsed.setupPercent > limit ? `timed: setup is ${percent}% of the unit run (limit ${limit}%)` : null;
}

const same = (path) => String(path).replaceAll("\\", "/");

/** Test files on disk that did not run (`notRun`) and files that ran and are not on disk (`notOnDisk`), each sorted. */
export function filesDiffer(ranFiles, diskFiles) {
  const ran = new Set(ranFiles.map(same));
  const disk = new Set(diskFiles.map(same));
  return {
    notRun: [...disk].filter((file) => !ran.has(file)).sort(),
    notOnDisk: [...ran].filter((file) => !disk.has(file)).sort(),
  };
}

/** The titles of the Playwright tests that failed and then passed: more than one result, the last 'passed'. */
export function retriedTests(playwrightJson) {
  const titles = [];
  const walk = (suite, path) => {
    const here = suite.title && !/\.(spec|test)\.[cm]?[jt]sx?$/.test(suite.title) ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        if (results.length > 1 && results[results.length - 1].status === "passed") {
          titles.push([...here, spec.title].join(" > ") + (test.projectName ? ` (${test.projectName})` : ""));
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of playwrightJson?.suites ?? []) walk(suite, []);
  return titles;
}

/**
 * What is wrong with the ceilings against the medians of ten runs: a ceiling more than 25% above its median (10% for a key ending in
 * `:memory`), and a release key over 600 seconds. `medians` maps a key to its median in seconds (a memory key, in GB).
 */
export function ceilingProblems(budgets, medians) {
  const problems = [];
  for (const [key, entry] of Object.entries(budgets?.ceilings ?? {})) {
    const median = medians?.[key];
    const allowed = key.endsWith(":memory") ? 1.1 : 1.25;
    if (typeof median === "number" && median > 0 && entry.seconds > median * allowed) {
      const percent = Math.round((entry.seconds / median - 1) * 100);
      problems.push(`${key}: ceiling ${entry.seconds} s is ${percent}% above its median of ${Math.round(median * 10) / 10} s (limit ${Math.round((allowed - 1) * 100)}%)`);
    }
    if (entry.release === true && entry.seconds > 600) problems.push(`${key}: a release key's ceiling of ${entry.seconds} s is over 600 s`);
  }
  for (const [key, entry] of Object.entries(budgets?.memory ?? {})) {
    const median = medians?.[key];
    if (typeof median === "number" && median > 0 && entry.gb > median * 1.1) {
      problems.push(`${key}: ceiling ${entry.gb} GB is ${Math.round((entry.gb / median - 1) * 100)}% above its median of ${Math.round(median * 10) / 10} GB (limit 10%)`);
    }
  }
  return problems;
}

/** The median of a list of numbers, or null when it is empty. */
export function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
