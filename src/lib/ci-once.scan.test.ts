import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/** The jobs whose text has a line that runs the command, bare or through the recorder (`node scripts/timed.mjs <label> ... -- `, step 1.20). */
const jobsRunning = (text: string, command: RegExp) => {
  const recorded = new RegExp(`run: (?:node scripts/timed\\.mjs [^\\n]*?-- )?${command.source.replace(/^run: /, "")}`);
  return jobsOf(text).filter((job) => recorded.test(job.text));
};

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

type Project = { test: { name: string; include: string[]; exclude?: string[]; setupFiles?: string[]; globalSetup?: string[]; isolate?: boolean } };

/** Every file under a folder whose name ends in the suffix. */
const walk = (dir: string, suffix: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path, suffix);
    return entry.name.endsWith(suffix) ? [path] : [];
  });

describe("the unit tests load only what they use (bloat review 0.39)", async () => {
  // The path is held in a variable: tsconfig does not allow a `.mts` extension in an import path.
  const configPath = "../../vitest.config.mts";
  const config = (await import(/* @vite-ignore */ configPath)).default as {
    test?: { projects?: Project[]; setupFiles?: unknown; globalSetup?: unknown; include?: unknown };
  };
  const projects = config.test?.projects ?? [];
  const named = (name: string) => projects.find((project) => project.test.name === name)?.test;

  it("sets up nothing at the root", () => {
    expect(config.test?.setupFiles).toBeUndefined();
    expect(config.test?.globalSetup).toBeUndefined();
    expect(config.test?.include).toBeUndefined();
  });

  it("loads the admin's English only where parts are drawn", () => {
    const withEnglish = projects.filter((project) => project.test.setupFiles?.includes("src/test/admin-english.ts"));
    expect(withEnglish.map((project) => project.test.name)).toEqual(["components"]);
  });

  it("builds the test database only for the tests that open it", () => {
    expect(projects.filter((project) => project.test.globalSetup).map((project) => project.test.name)).toEqual(["db"]);
    const outside = walk("src", ".test.ts").filter((file) => !file.startsWith("src/db/"));
    for (const file of outside) {
      const text = readFileSync(join(root, file), "utf8");
      // This file names the words it looks for.
      if (file === "src/lib/ci-once.scan.test.ts") continue;
      expect(text.includes("createTestDatabase") || text.includes("test-db-template"), file).toBe(false);
    }
  });

  it("puts every unit test file in exactly one project", () => {
    expect(named("components")?.include).toEqual(["src/components/**/*.test.ts"]);
    expect(named("db")?.include).toEqual(["src/db/**/*.test.ts"]);
    expect(named("unit")?.include).toEqual(["src/**/*.test.ts"]);
    expect(named("unit")?.exclude).toEqual(expect.arrayContaining(["src/components/**", "src/db/**"]));
    for (const project of projects) expect(project.test.exclude, project.test.name).toContain("src/**/*.int.test.ts");
    const files = walk("src", ".test.ts").filter((file) => !file.endsWith(".int.test.ts"));
    expect(files.length).toBeGreaterThan(1000);
    for (const file of files) {
      const takers = [file.startsWith("src/components/") && "components", file.startsWith("src/db/") && "db", !file.startsWith("src/components/") && !file.startsWith("src/db/") && "unit"].filter(Boolean);
      expect(takers, file).toHaveLength(1);
    }
    expect(existsSync(join(root, "vitest.config.mts"))).toBe(true);
  });

  it("has no test that reads the archived migrations", () => {
    expect(existsSync(join(root, "src/db/migration-files.ts"))).toBe(false);
    for (const file of walk("src", ".test.ts")) {
      const text = readFileSync(join(root, file), "utf8");
      // The words are split here so that a search for them finds no test, this one included.
      for (const word of ["read" + "Migration", "find" + "Migration", "migration" + "History", "supabase/" + "archive"]) expect(text.includes(word), `${file}: ${word}`).toBe(false);
    }
  });
});
