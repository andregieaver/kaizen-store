import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { normaliseEmail, sameEmail } from "./email-address";

/** Every source file under `src`, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * An address is trimmed and lower-cased in one place (PSI DATA-04): `normaliseEmail()`. Lower-casing a value named like an email by hand
 * elsewhere fails here; the password check, which reads the address's local part to refuse a password made of it, is the one exception.
 */
const HAND = /[eE]mail\w*\)?\??\.(?:trim\(\)\.)?toLowerCase\(\)/;
const EXCEPT = new Set(["src/lib/email-address.ts", "src/lib/password.ts"]);

describe("one way to normalise an email address (PSI DATA-04)", () => {
  it("trims and lower-cases, and compares by it", () => {
    expect(normaliseEmail("  Kari.Nordmann@Example.NO ")).toBe("kari.nordmann@example.no");
    expect(sameEmail("KARI@example.no", " kari@EXAMPLE.no")).toBe(true);
    expect(sameEmail("kari@example.no", "kari2@example.no")).toBe(false);
  });

  it("is not done by hand anywhere else", () => {
    const root = process.cwd();
    const found = sources(path.join(root, "src")).flatMap((file) => {
      const rel = path.relative(root, file);
      if (EXCEPT.has(rel)) return [];
      return readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (HAND.test(line) ? [`${rel}:${i + 1}`] : []));
    });
    expect(found).toEqual([]);
  });
});
