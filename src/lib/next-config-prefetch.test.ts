import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The router's two settings are written in `next.config.ts` (bloat review step 0.14, `docs/performance.md`, D592). Delete case (a) together
 * with the flag when Next fixes the TODO in `optimistic-routes.js`; keep the e2e test.
 */
const config = fs.readFileSync(path.join(__dirname, "..", "..", "next.config.ts"), "utf8");

describe("next.config.ts states the router's settings", () => {
  it("(a) route guessing is off", () => {
    expect(config).toMatch(/^\s*optimisticRouting: false,$/m);
  });

  it("(b) partial prefetching is a recorded false", () => {
    expect(config).toMatch(/^\s*partialPrefetching: false,$/m);
  });

  it("(c) the comment names the test that says when the flag may go", () => {
    expect(config).toContain("e2e/prefetch.spec.ts");
  });
});
