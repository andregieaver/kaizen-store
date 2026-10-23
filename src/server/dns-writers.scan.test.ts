import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The DNS Kaizena Flow keeps for stores (D315, `docs/domains.md` 5) changes only through `src/server/domain-dns.ts`: it is the one module that
 * writes records through `vercel-dns.ts` and the one writer of `commerce.dns_changes`, so every change is planned, kept and can be undone.
 * Health checks only read. A new reader of the zone is listed here on purpose.
 */

const root = process.cwd();

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const FILES = sources("src").map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));

const WRITER = "src/server/domain-dns.ts";
const READERS = ["src/server/domain-health.ts"];

describe("DNS writers (D315 5)", () => {
  it("reaches Vercel's DNS only from the writer and the listed readers", () => {
    // A type is no way in: only an import of the module's code counts.
    const users = FILES.filter((f) => /^import (?!type )[^;]*from "(\.\/|@\/server\/)vercel-dns"/m.test(f.text)).map((f) => f.path);
    expect(users.sort()).toEqual([...READERS, WRITER].sort());
  });

  it("never writes records from a reader", () => {
    for (const path of READERS) {
      const text = FILES.find((f) => f.path === path)!.text;
      expect([path, /\.(create|update|remove|addZone|removeZone)\(/.test(text)]).toEqual([path, false]);
    }
  });

  it("writes dns_changes only in the writer", () => {
    const writers = FILES.filter((f) => /(insert into|update|delete from)\s+commerce\.dns_changes/i.test(f.text)).map((f) => f.path);
    expect(writers).toEqual([WRITER]);
  });
});
