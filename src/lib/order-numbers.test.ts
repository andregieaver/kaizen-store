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
  it("orders are inserted and numbered only in order-insert.ts, which checkout, the subscription renewal and draft orders call", () => {
    const inserting = sources("src").filter((file) => /insert\s+into\s+commerce\.orders\b/i.test(readFileSync(file, "utf8")));
    expect(inserting.sort()).toEqual(["src/server/order-insert.ts"]);
    expect(readFileSync("src/server/order-insert.ts", "utf8")).toMatch(/commerce\.next_document_number\([^)]*'order'\)/);
    // Nothing else takes an order's number.
    const numbering = sources("src").filter((file) => /next_document_number\([^)]*'order'\)/.test(readFileSync(file, "utf8")));
    expect(numbering.sort()).toEqual(["src/server/order-insert.ts"]);
    // The three callers go through it.
    for (const caller of ["src/server/checkout.ts", "src/server/subscriptions.ts", "src/server/draft-orders.ts"]) {
      expect(readFileSync(caller, "utf8"), caller).toMatch(/\binsertOrder\(/);
    }
  });

  it("no code deletes or renumbers orders", () => {
    for (const file of sources("src")) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/delete\s+from\s+commerce\.orders\b/i);
      expect(text, file).not.toMatch(/update\s+commerce\.orders\s+set\s+number\b/i);
    }
  });
});

describe("where the order operations write (wave 3, D173)", () => {
  const writers = (pattern: RegExp) => sources("src").filter((file) => pattern.test(readFileSync(file, "utf8"))).sort();

  it("an order is archived and unarchived only in order-archive.ts", () => {
    expect(writers(/update\s+commerce\.orders\s+set\s+archived_at\b/i)).toEqual(["src/server/order-archive.ts"]);
  });

  it("order tags are written only in order-tags.ts (and the anonymising prune beside them), and a draft only in the draft modules", () => {
    expect(writers(/insert\s+into\s+commerce\.order_tags\b/i)).toEqual(["src/server/order-tags.ts"]);
    // The draft modules: the editor, the send, the jobs; the pay link and the email only read; the erasure deletes the draft's copy of a person's data.
    const draftWriters = writers(/(insert\s+into|update|delete\s+from)\s+commerce\.draft_orders\b/i);
    expect(draftWriters).toEqual(["src/server/draft-orders.ts", "src/server/privacy-erasure.ts"]);
  });

  it("a payment taken outside Kaizen is inserted only by the draft's paid-outside function and an order change's (D174)", () => {
    expect(writers(/insert\s+into\s+commerce\.payments[^;]*?'manual'/i)).toEqual(["src/server/draft-orders.ts", "src/server/order-edits.ts"]);
  });
});
