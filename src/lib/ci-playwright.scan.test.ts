import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * CI's public end-to-end job runs in Playwright's own image, which carries the browsers and their libraries (no apt on the
 * runner: WebKit's 181 packages from a slow Ubuntu mirror twice ran the job out of time, CI #979 and #981). The image's
 * browsers belong to one Playwright version, so its tag must be the version the tests are pinned to: a bump of
 * `@playwright/test` fails here until the image is moved with it.
 */
const root = process.cwd();
const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
const pinned = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { devDependencies?: Record<string, string> })
  .devDependencies?.["@playwright/test"];

describe("CI's Playwright image", () => {
  it("is pinned to an exact version", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("names that version in every Playwright image the workflow runs in", () => {
    const tags = [...workflow.matchAll(/mcr\.microsoft\.com\/playwright:v([^\s"'-]+)(-[a-z]+)?/g)].map((match) => match[1]);
    expect(tags.length, "the e2e job runs in mcr.microsoft.com/playwright").toBeGreaterThan(0);
    for (const tag of tags) expect(tag, "ci.yml's Playwright image and package.json's @playwright/test").toBe(pinned);
  });

  it("installs no browser libraries with apt in the jobs that run in the image", () => {
    const e2e = workflow.slice(workflow.indexOf("\n  e2e:"), workflow.indexOf("\n  hosts:"));
    expect(e2e).toContain("mcr.microsoft.com/playwright:");
    expect(e2e).toMatch(/run: pnpm exec playwright install /);
    expect(e2e).not.toMatch(/playwright install[^\n]*--with-deps/);
  });
});
