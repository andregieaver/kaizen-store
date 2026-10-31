import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { en } from "./en";

/**
 * One way of saying "it failed, try again" (PSI UX-02): plain and the same everywhere, "Try again." or "Try again in a moment." where it
 * may pass shortly, never "Please try again" or "try again shortly"; the cart's generic failure and the delivery list's are one text.
 */
describe("the wording of a retry (PSI UX-02)", () => {
  it("is the same for the two generic failures", () => {
    expect(en.deliveries.tryAgain).toBe(en.tryAgain);
  });

  it("never says please or shortly in the English texts people read", () => {
    const dir = path.join(process.cwd(), "src/lib/messages");
    const english = readdirSync(dir).filter((f) => /(^|-)en(-|\.ts$)|^platform-en\.ts$|^en-/.test(f) && f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const found = english.flatMap((file) =>
      readFileSync(path.join(dir, file), "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        .filter(({ line }) => /please try again|try again shortly/i.test(line))
        .map(({ at }) => at),
    );
    expect(found).toEqual([]);
  });
});
