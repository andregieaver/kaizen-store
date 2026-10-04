import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The retention schedule is read through one door (D162, `docs/wave-1g-gdpr.md` 3.1): `retentionRule()` and `retentionRules()` in
 * `src/server/retention.ts`, which ask `commerce.retention_rule()` and the table; the table is written only by `commerce.set_retention_rule()` and
 * reviewed only by `commerce.verify_retention_rule()`. A pruner that reads its own period from the table, or writes it, would make two answers to
 * "how long do we keep this", so this scan fails for any other reader or writer of `retention_rules` in the application source.
 */

const SRC = join(process.cwd(), "src");
const DOOR = "server/retention.ts";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("the retention schedule has one reader and one writer", () => {
  it("is queried only by src/server/retention.ts (the table by name, the SQL function by call)", () => {
    const strays: string[] = [];
    for (const file of sources(SRC)) {
      const rel = file.slice(SRC.length + 1).split("\\").join("/");
      if (rel === DOOR) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:\b(?:from|join|into|update)\s+commerce\.retention_rules?\b|\bselect\s+commerce\.(?:set|verify)_retention_rule\b)/gi)) {
        strays.push(`${rel}: ${m[0]}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it("is written only through the functions, never with an insert, update or delete", () => {
    const text = readFileSync(join(SRC, DOOR), "utf8");
    expect(text).not.toMatch(/insert\s+into\s+commerce\.retention_rules/i);
    expect(text).not.toMatch(/update\s+commerce\.retention_rules/i);
    expect(text).not.toMatch(/delete\s+from\s+commerce\.retention_rules/i);
    expect(text).toMatch(/commerce\.set_retention_rule\(/);
    expect(text).toMatch(/commerce\.verify_retention_rule\(/);
    expect(text).toMatch(/commerce\.retention_rule\(/);
  });

  it("keeps deletions out of the database's functions: the application deletes, the SQL only anonymises", () => {
    const migrations = join(process.cwd(), "supabase", "migrations");
    for (const name of readdirSync(migrations).filter((n) => /gdpr/.test(n) && n.endsWith(".sql"))) {
      const text = readFileSync(join(migrations, name), "utf8");
      // Function bodies are between $$ marks (or $patch$); none of them may delete, truncate or drop (the migration tool cancels them).
      for (const body of text.matchAll(/\$(\w*)\$([\s\S]*?)\$\1\$/g)) {
        expect(body[2], name).not.toMatch(/\b(delete\s+from|truncate\b|drop\s+(table|function|trigger|column))/i);
      }
    }
  });
});
