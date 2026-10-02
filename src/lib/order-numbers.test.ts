import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { auditProblems, type OrderNumberAudit } from "./order-numbers";

const sound: OrderNumberAudit = { orders: 3, firstNumber: 1001, lastNumber: 1003, missing: 0, firstMissing: null, offFormat: 0, nextNumber: 1004, ok: true };

describe("auditProblems", () => {
  it("says nothing of a sequence in order", () => {
    expect(auditProblems(sound)).toEqual([]);
  });
  it("names a gap, a foreign number and a series that is out of step", () => {
    expect(auditProblems({ ...sound, missing: 1, firstMissing: 1002 })[0]).toMatch(/1 order number\(s\) are missing.*1002/);
    expect(auditProblems({ ...sound, offFormat: 2 })[0]).toMatch(/2 order\(s\)/);
    expect(auditProblems({ ...sound, nextNumber: 1006 })[0]).toMatch(/next number.*1006.*1003/);
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    // Tests, and the fixtures integration tests build their stores with (`*-fixture.ts`, imported by tests only), are not the app.
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/-fixture\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("where orders are numbered", () => {
  it("only checkout and subscriptions insert orders, each taking the number from the store's series in the same transaction", () => {
    const inserting = sources("src").filter((file) => /insert\s+into\s+commerce\.orders\b/i.test(readFileSync(file, "utf8")));
    expect(inserting.sort()).toEqual(["src/server/checkout.ts", "src/server/subscriptions.ts"]);
    for (const file of inserting) expect(readFileSync(file, "utf8")).toMatch(/commerce\.next_document_number\([^)]*'order'\)/);
  });

  it("no code deletes or renumbers orders", () => {
    for (const file of sources("src")) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/delete\s+from\s+commerce\.orders\b/i);
      expect(text, file).not.toMatch(/update\s+commerce\.orders\s+set\s+number\b/i);
    }
  });
});
