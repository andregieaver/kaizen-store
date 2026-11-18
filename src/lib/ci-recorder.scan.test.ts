import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ceilingProblems, filesDiffer, overCeiling, parseVitestDuration, retriedTests, setupShareProblem } from "../../scripts/lib/timed.mjs";

/**
 * Every check and build of CI runs through the recorder, scripts/timed.mjs (bloat review step 1.20): it prints the seconds, fails above a
 * ceiling in scripts/ci-budgets.json, and keeps a failing command's exit code (it gates production deploys). A new step that runs outside
 * it fails here.
 */
const root = process.cwd();
const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

/** A workflow's jobs, each with its own text: a job starts at two spaces in, under `jobs:`. */
const jobsOf = (text: string) => {
  const body = text.slice(text.indexOf("\njobs:") + 1);
  return body.split(/\n(?=  [a-z][a-z0-9-]*:\n)/).slice(1).map((job) => ({ name: job.slice(2, job.indexOf(":")), text: job }));
};

/** The steps of a job: each starts with `- ` at six spaces in. */
const stepsOf = (jobText: string) => jobText.split(/\n(?= {6}- )/).slice(1);

/** The single-line `run:` command of a step, or null (a `uses:` step, or a multi-line shell block). */
const runOf = (step: string) => {
  const match = /^ {6,8}(?:- )?run: (?!\|)(.+)$/m.exec(step);
  return match ? match[1].trim() : null;
};

const RECORDED = "node scripts/timed.mjs ";

/** Commands that are not checks, each with its reason. */
const ALLOWED: { start: string; reason: string }[] = [
  { start: "pnpm exec playwright install", reason: "a browser download, not a check (src/lib/ci-playwright.scan.test.ts reads this line)" },
  { start: "node scripts/db-setup.mjs --seed", reason: "makes the database the tests read (also with the hosts seed after it)" },
  { start: "pnpm seed:themed", reason: "seeds the Orbit store before the build" },
  { start: "pnpm db:check", reason: "reads only the repository; one shard runs it (src/lib/ci-once.scan.test.ts)" },
];

/** The `run:` commands of the checked jobs that are neither recorded nor on the list. */
function unrecorded(text: string): string[] {
  const checked = jobsOf(text).filter((job) => ["static", "integration", "e2e", "hosts", "signed-in"].includes(job.name));
  const found: string[] = [];
  for (const job of checked) {
    for (const step of stepsOf(job.text)) {
      const run = runOf(step);
      if (run === null) continue;
      if (run.startsWith(RECORDED) || ALLOWED.some((entry) => run.startsWith(entry.start))) continue;
      found.push(`${job.name}: ${run}`);
    }
  }
  return found;
}

/** The quick gate's steps in `pending` whose command is not recorded. */
function gateUnrecorded(text: string): string[] {
  const pending = jobsOf(text).find((job) => job.name === "pending");
  if (!pending) return ["no job named pending"];
  const gate = stepsOf(pending.text).filter((step) => /- name: "Quick gate:/.test(step));
  const problems = gate.filter((step) => !(runOf(step) ?? "").startsWith(RECORDED)).map((step) => runOf(step) ?? "(no command)");
  return gate.length === 3 ? problems : [...problems, `the quick gate has ${gate.length} steps, not 3`];
}

/** The labels a job's recorded commands use: the word after `scripts/timed.mjs`. */
function labelsOf(jobText: string): string[] {
  return [...jobText.matchAll(/node scripts\/timed\.mjs ([^\s]+)/g)].map((match) => match[1]);
}

describe("CI runs every check through the recorder", () => {
  it("has no step of a checked job outside it", () => {
    expect(
      unrecorded(ci),
      "a CI step runs outside the recorder: wrap it with node scripts/timed.mjs <label> -- ..., or list it here with its reason",
    ).toEqual([]);
  });

  it("records the quick gate's three steps", () => {
    expect(gateUnrecorded(ci)).toEqual([]);
  });

  it("would notice a step outside the recorder", () => {
    const planted = ci.replace("      - run: node scripts/timed.mjs lint -- pnpm lint\n", "      - run: node scripts/timed.mjs lint -- pnpm lint\n      - run: pnpm lint\n");
    expect(planted).not.toBe(ci);
    expect(unrecorded(planted)).toEqual(["static: pnpm lint"]);
  });

  it("would notice an unrecorded quick-gate step", () => {
    const planted = ci.replace("run: node scripts/timed.mjs gate-smoke -- pnpm test:smoke", "run: pnpm test:smoke");
    expect(planted).not.toBe(ci);
    expect(gateUnrecorded(planted)).toEqual(["pnpm test:smoke"]);
  });

  it("uses each label once in a job", () => {
    for (const job of jobsOf(ci)) {
      const labels = labelsOf(job.text);
      expect(labels.filter((label, index) => labels.indexOf(label) !== index), job.name).toEqual([]);
    }
  });

  it("names the build and the Playwright runs of the three browser jobs", () => {
    for (const name of ["e2e", "hosts", "signed-in"]) {
      const job = jobsOf(ci).find((j) => j.name === name)!;
      const labels = labelsOf(job.text);
      expect(labels, name).toContain(`build-${name}`);
      expect(labels, name).toContain(name);
      expect(job.text, name).toContain("PLAYWRIGHT_JSON_OUTPUT_NAME: playwright-report.json");
    }
  });

  it("uploads each wrapped job's timings", () => {
    for (const name of ["static", "integration", "e2e", "hosts", "signed-in", "pending", "release"]) {
      const job = jobsOf(ci).find((j) => j.name === name)!;
      expect(job.text, name).toMatch(/name: timings-/);
    }
    expect(ci).toContain("TIMINGS_FILE: timings.jsonl");
  });
});

describe("the recorder's pure parts", () => {
  const budgets = { ceilings: { unit: { seconds: 100, release: true } } };

  it("finds a run one second over its ceiling over", () => {
    expect(overCeiling("unit", 101, budgets)).toEqual({ ceiling: 100, over: true });
    expect(overCeiling("unit", 100, budgets)).toEqual({ ceiling: 100, over: false });
  });

  it("has no ceiling for a key that has none yet", () => {
    expect(overCeiling("e2e", 9999, budgets)).toBeNull();
  });

  it("reports vitest's setup at 12% of the unit run, in either of its two forms", () => {
    expect(setupShareProblem(parseVitestDuration("   Duration  434.29s (tests 57%, import 20%, setup 12%, transform 6%)"))).toBe(
      "timed: setup is 12% of the unit run (limit 10%)",
    );
    expect(setupShareProblem(parseVitestDuration("   Duration  100.00s (transform 1s, setup 12s, collect 10s, tests 50s)"))).toBe(
      "timed: setup is 12% of the unit run (limit 10%)",
    );
    expect(setupShareProblem(parseVitestDuration("   Duration  434.29s (tests 57%, setup 8%)"))).toBeNull();
    expect(parseVitestDuration("no summary here")).toBeNull();
  });

  it("reports a test file on disk that did not run", () => {
    expect(filesDiffer(["src/a.test.ts"], ["src/a.test.ts", "src/b.test.ts"])).toEqual({ notRun: ["src/b.test.ts"], notOnDisk: [] });
    expect(filesDiffer(["src/a.test.ts", "src/gone.test.ts"], ["src/a.test.ts"])).toEqual({ notRun: [], notOnDisk: ["src/gone.test.ts"] });
  });

  it("lists a Playwright test that failed and then passed", () => {
    const report = {
      suites: [
        {
          title: "cart.spec.ts",
          specs: [
            { title: "adds a line", tests: [{ projectName: "chromium", results: [{ status: "failed" }, { status: "passed" }] }] },
            { title: "removes a line", tests: [{ projectName: "chromium", results: [{ status: "passed" }] }] },
            { title: "always fails", tests: [{ projectName: "chromium", results: [{ status: "failed" }, { status: "failed" }] }] },
          ],
        },
      ],
    };
    expect(retriedTests(report)).toEqual(["adds a line (chromium)"]);
  });

  it("calls a ceiling 30% above its median of ten a problem, and a release key over 600 s", () => {
    expect(ceilingProblems({ ceilings: { unit: { seconds: 130 } } }, { unit: 100 })).toHaveLength(1);
    expect(ceilingProblems({ ceilings: { unit: { seconds: 124 } } }, { unit: 100 })).toEqual([]);
    expect(ceilingProblems({ ceilings: { e2e: { seconds: 601, release: true } } }, {})).toHaveLength(1);
    expect(ceilingProblems({ memory: { "build:memory": { gb: 8.0 } } }, { "build:memory": 7.0 })).toHaveLength(1);
  });
});

describe("the recorder gates deploys, so a failing command stays failed", () => {
  const env = { ...process.env };
  delete env.GITHUB_STEP_SUMMARY;
  delete env.TIMINGS_FILE;
  const run = (args: string[]) => spawnSync(process.execPath, ["scripts/timed.mjs", ...args], { cwd: root, env, encoding: "utf8" });

  it("exits with the command's own code", () => {
    expect(run(["planted", "--", process.execPath, "-e", "process.exit(3)"]).status).toBe(3);
  });

  it("does the same for the unit run, whatever its output", () => {
    expect(run(["planted", "--unit", "--", process.execPath, "-e", "process.exit(3)"]).status).toBe(3);
  });

  it("passes a command that succeeds", () => {
    expect(run(["planted", "--", process.execPath, "-e", "process.exit(0)"]).status).toBe(0);
  });

  it("exits 1 for a command that cannot start", () => {
    expect(run(["planted", "--", "no-such-command-for-the-recorder"]).status).toBe(1);
  });

  it("only prints the setup share and the file comparison in this step", () => {
    const result = run(["planted", "--unit", "--", process.execPath, "-e", "console.log('Duration  10.00s (setup 40%)')"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("setup is 40% of the unit run");
  });
});
