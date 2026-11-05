import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * CI's public end-to-end job runs in Playwright's own image, which carries the browsers and their libraries (no apt on the
 * runner: WebKit's 181 packages from a slow Ubuntu mirror twice ran the job out of time, CI #979 and #981), and so do the other
 * browser jobs and the daily live accessibility scan. The image's
 * browsers belong to one Playwright version, so its tag must be the version the tests are pinned to: a bump of
 * `@playwright/test` fails here until the image is moved with it.
 */
const root = process.cwd();
const workflows = [".github/workflows/ci.yml", ".github/workflows/live-a11y.yml"].map((file) => ({ file, text: readFileSync(join(root, file), "utf8") }));
const pinned = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { devDependencies?: Record<string, string> })
  .devDependencies?.["@playwright/test"];

/** A workflow's jobs, each with its own text: a job starts at two spaces in, under `jobs:`. */
const jobsOf = (text: string) => {
  const body = text.slice(text.indexOf("\njobs:") + 1);
  return body.split(/\n(?=  [a-z][a-z0-9-]*:\n)/).slice(1).map((job) => ({ name: job.slice(2, job.indexOf(":")), text: job }));
};

describe("CI's Playwright image", () => {
  it("is pinned to an exact version", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("names that version in every Playwright image the workflows run in", () => {
    const tags = workflows.flatMap((w) => [...w.text.matchAll(/mcr\.microsoft\.com\/playwright:v([^\s"'-]+)(-[a-z]+)?/g)].map((match) => match[1]));
    expect(tags.length, "the browser jobs run in mcr.microsoft.com/playwright").toBeGreaterThanOrEqual(4);
    for (const tag of tags) expect(tag, "a Playwright image and package.json's @playwright/test").toBe(pinned);
  });

  it("runs every job that installs a browser in the image, with no browser libraries from apt", () => {
    const browserJobs = workflows.flatMap((w) => jobsOf(w.text).filter((job) => /playwright install/.test(job.text)).map((job) => ({ ...job, file: w.file })));
    expect(browserJobs.map((job) => job.name).sort()).toEqual(["e2e", "hosts", "scan", "signed-in"]);
    for (const job of browserJobs) {
      expect(job.text, `${job.file} ${job.name}`).toContain("mcr.microsoft.com/playwright:");
      expect(job.text, `${job.file} ${job.name}`).not.toMatch(/playwright install[^\n]*--with-deps/);
      // In the container the database is the service's name.
      if (job.text.includes("DATABASE_URL: postgres://")) expect(job.text, `${job.file} ${job.name}`).toContain("@postgres:5432/");
    }
  });
});
