import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Each check runs once per push (bloat review step 0.38): the whole program is type-checked by `static` and by the quick gate in
 * `pending`, never again inside a build; the schema check reads only the repository, so one shard runs it. Step 3.18 lowers these
 * counts; nothing may raise them.
 */
const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");
const ci = read(".github/workflows/ci.yml");
const nextConfig = read("next.config.ts");

/** A workflow's jobs, each with its own text: a job starts at two spaces in, under `jobs:`. */
const jobsOf = (text: string) => {
  const body = text.slice(text.indexOf("\njobs:") + 1);
  return body.split(/\n(?=  [a-z][a-z0-9-]*:\n)/).slice(1).map((job) => ({ name: job.slice(2, job.indexOf(":")), text: job }));
};

/** The jobs whose text has a line that runs the command. */
const jobsRunning = (text: string, command: RegExp) => jobsOf(text).filter((job) => command.test(job.text));

/** The build jobs that do not set the variable that skips the build's own type check. */
const buildsWithoutSkip = (text: string) =>
  jobsRunning(text, /run: pnpm build\b/).filter((job) => !job.text.includes('SKIP_BUILD_TYPECHECK: "1"')).map((job) => job.name);

describe("CI runs each check once", () => {
  it("runs the type check in two jobs", () => {
    expect(jobsRunning(ci, /run: pnpm typecheck\b/).map((job) => job.name).sort()).toEqual(["pending", "static"]);
  });

  it("type-checks in no build of CI", () => {
    expect(jobsRunning(ci, /run: pnpm build\b/).map((job) => job.name).sort()).toEqual(["e2e", "hosts", "signed-in"]);
    expect(buildsWithoutSkip(ci)).toEqual([]);
    expect(nextConfig).toContain('process.env.SKIP_BUILD_TYPECHECK === "1"');
    expect(nextConfig).toContain("ignoreBuildErrors: SKIP_TYPECHECK");
  });

  it("sets SKIP_BUILD_TYPECHECK in no job but the three that build", () => {
    expect(jobsOf(ci).filter((job) => job.text.includes("SKIP_BUILD_TYPECHECK: ")).map((job) => job.name).sort()).toEqual(["e2e", "hosts", "signed-in"]);
  });

  it("runs the schema check in one shard", () => {
    expect(ci.match(/pnpm db:check/g)).toHaveLength(1);
    const start = ci.indexOf("- name: Migrations match the schema");
    const step = ci.slice(start).split(/\n(?= {6}- )/)[0];
    expect(step).toContain("if: matrix.shard == 1");
  });

  it("lints with a cache that keeps results by content", () => {
    const lint = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts.lint;
    expect(lint).toContain("--cache");
    expect(lint).toContain("--cache-strategy content");
    expect(lint).toContain("--cache-location node_modules/.cache/eslint/");
  });

  it("restores the cache in both lint jobs", () => {
    const jobs = jobsRunning(ci, /run: pnpm lint\b/);
    expect(jobs.map((job) => job.name).sort()).toEqual(["pending", "static"]);
    for (const job of jobs) {
      expect(job.text, job.name).toContain("actions/cache@");
      expect(job.text, job.name).toContain("path: node_modules/.cache/eslint");
    }
  });

  it("keeps lint to rules that read one file, which a per-file cache stays right for", () => {
    const config = read("eslint.config.mjs");
    const message = "a type-aware or cross-file rule makes a per-file cache wrong: run such a rule in a second, uncached eslint call";
    expect(config, message).not.toMatch(/parserOptions[\s\S]{0,200}\bproject\b/);
    expect(config, message).not.toContain("import/no-cycle");
  });

  it("would notice a build without the variable", () => {
    expect(buildsWithoutSkip("jobs:\n  a:\n    steps:\n      - run: pnpm build\n")).toEqual(["a"]);
  });
});
