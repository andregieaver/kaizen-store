import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DIR = __dirname;
const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
const source = (f: string) => readFileSync(join(DIR, f), "utf8");

describe("scrolling boxes", () => {
  // Tailwind's `sr-only` is `position: absolute`. In a scroller that is not positioned, the text keeps its place in the table but the
  // scroller does not contain it, so a table wider than a phone widens the whole page (finding 17: 463 px against 360 px).
  it("are positioned, so the screen-reader-only text inside a table is contained and clipped by them", () => {
    let found = 0;
    for (const f of files) {
      for (const m of source(f).matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const classes = m[1] ?? m[2] ?? "";
        if (!/(^|\s)overflow-(x-)?auto(\s|$)/.test(classes)) continue;
        found += 1;
        expect(classes, `${f}: ${classes}`).toMatch(/(^|\s)relative(\s|$)/);
      }
    }
    expect(found).toBeGreaterThanOrEqual(6);
  });
});

describe("figure formats", () => {
  // Every figure is written by analytics-core.ts, analytics-format.ts or money.ts, never by a format of the view's own.
  it("are not written with a local number format", () => {
    for (const f of files) {
      const text = source(f);
      expect(text, `${f} formats a number itself`).not.toMatch(/\.toFixed\(|\.toLocaleString\(|Intl\.NumberFormat/);
    }
  });
});
