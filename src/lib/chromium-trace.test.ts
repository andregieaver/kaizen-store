import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Chromium is read from disk on Vercel, so the files must be traced into every route that launches it (D58, D150): a
 * route missing from `outputFileTracingIncludes` fails in production with "Cannot find module …/browsers.json".
 */
const root = path.join(__dirname, "..", "..");
const config = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");

/** The route files that start a browser, directly or through the replicator's engine. */
const ROUTES: Record<string, string> = {
  "/api/cron/cookie-scan": "src/app/api/cron/cookie-scan/route.ts",
  // A glob: `[store]` would be a set of characters, and the route group is part of the path that is matched.
  "/admin/**/replicate/**/tick": "src/app/admin/(gated)/[store]/pages/ai/replicate/[jobId]/tick/route.ts",
};

describe("Chromium's files are traced into the routes that launch it", () => {
  for (const [route, file] of Object.entries(ROUTES)) {
    it(route, () => {
      expect(fs.existsSync(path.join(root, file)), `${file} exists`).toBe(true);
      expect(config).toContain(`"${route}": CHROMIUM_FILES`);
    });
  }

  it("names the browser's binary and the files Playwright reads at run time", () => {
    expect(config).toContain("@sparticuz/chromium/bin/**");
    expect(config).toContain("{browsers,package}.json");
  });
});
