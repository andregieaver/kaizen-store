import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { en } from "./en";

/**
 * One way of saying "it failed, try again" (PSI UX-02): plain and the same everywhere, "Try again." or "Try again in a moment." where it
 * may pass shortly, never "Please try again" or "try again shortly"; the cart's generic failure and the delivery list's are one text.
 */
/** The lines of a file that say "please try again" or "try again shortly". */
const retries = (file: string, at: string): string[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, i) => (/please try again|try again shortly/i.test(line) ? [`${at}:${i + 1}`] : []));

/** Every source file under a folder, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("the wording of a retry (PSI UX-02)", () => {
  it("is the same for the two generic failures", () => {
    expect(en.deliveries.tryAgain).toBe(en.tryAgain);
  });

  it("never says please or shortly in the English texts people read", () => {
    const dir = path.join(process.cwd(), "src/lib/messages");
    const english = readdirSync(dir).filter((f) => /(^|-)en(-|\.ts$)|^platform-en\.ts$|^en-/.test(f) && f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const found = english.flatMap((file) => retries(path.join(dir, file), file));
    expect(found).toEqual([]);
  });

  it("never says it in the admin's texts or in a message the server or a page writes", () => {
    const root = process.cwd();
    const files = ["src/lib/admin-messages", "src/server", "src/app"].flatMap((dir) => sources(path.join(root, dir)));
    expect(files.flatMap((file) => retries(file, path.relative(root, file)))).toEqual([]);
  });
});
