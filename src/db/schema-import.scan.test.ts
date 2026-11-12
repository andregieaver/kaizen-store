// The schema is drizzle-kit's source only (drizzle.config.ts). Loaded at run time it costs every cold start 481 table objects (bloat review step 0.4, code review FD5). Tests may import it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** True when the file's text imports the schema as a value (a type-only import is allowed). */
export function valueImportsOfSchema(path: string, text: string): boolean {
  const source = path.startsWith("src/db/") ? /^(?:@\/db\/schema|\.\/schema)$/ : /^@\/db\/schema$/;
  const statements = text.match(/(?:^|\n)\s*(?:import|export)\b[^;]*?from\s*["'][^"']+["']/g) ?? [];
  return statements.some((statement) => {
    const from = /from\s*["']([^"']+)["']$/.exec(statement);
    if (!from || !source.test(from[1])) return false;
    return !/^\s*(?:import|export)\s+type\b/.test(statement);
  });
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("the schema at run time", () => {
  it("is imported as a value by no file outside tests", () => {
    const offenders = files("src")
      .filter((path) => !/\.(?:test|spec)\./.test(path) && path !== "src/db/schema.ts")
      .filter((path) => valueImportsOfSchema(path, readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("sees a planted value import and lets a type import pass", () => {
    expect(valueImportsOfSchema("src/db/client.ts", 'import * as schema from "./schema";')).toBe(true);
    expect(valueImportsOfSchema("src/server/x.ts", 'import { orders } from "@/db/schema";')).toBe(true);
    expect(valueImportsOfSchema("src/server/x.ts", 'import type { orders } from "@/db/schema";')).toBe(false);
  });
});
