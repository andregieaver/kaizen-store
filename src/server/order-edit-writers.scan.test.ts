import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The writers of a paid order's lines and money, and of parcels (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 6.4 (a) and (b)), read from the source:
 * - only `src/server/order-edits.ts` sets the edit context (`kaizen.order_edit`), without which the database refuses any change to a paid order's lines and
 *   amounts (`order_lines_settled_guard()`, `orders_settled_guard()`), so every change of a sold order goes through `applyOrderEdit()`'s writer;
 * - only `markSent()` (`src/server/order-admin.ts`) inserts a shipment, and it writes the parcel's lines in the same transaction.
 * Tests and fixtures are exempt (they are never imported by the app); the migrations are SQL, not read here.
 */
const ROOT = process.cwd();

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/fixture|test-support/.test(name)) out.push(full);
  }
  return out;
}

const files = sources(path.join(ROOT, "src"));
const code = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

describe("who writes a paid order's lines and money, and parcels", () => {
  it("finds the modules", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("sets the edit context only in order-edits.ts", () => {
    const setters = files.filter((f) => /set_config\(\s*'kaizen\.order_edit'/.test(code(f))).map((f) => path.relative(ROOT, f));
    expect(setters).toEqual(["src/server/order-edits.ts"]);
  });

  it("inserts shipments only in markSent(), which writes the parcel's lines with them", () => {
    const inserters = files.filter((f) => /insert\s+into\s+commerce\.shipments\b/i.test(code(f))).map((f) => path.relative(ROOT, f));
    expect(inserters).toEqual(["src/server/order-admin.ts"]);
    const admin = code(path.join(ROOT, "src/server/order-admin.ts"));
    const start = admin.indexOf("export async function markSent(");
    const end = admin.indexOf("\nexport ", start + 10);
    const body = admin.slice(start, end);
    expect(body).toMatch(/insert\s+into\s+commerce\.shipments\b/);
    expect(body).toMatch(/insert\s+into\s+commerce\.shipment_lines\b/);
    expect(admin.slice(0, start) + admin.slice(end)).not.toMatch(/insert\s+into\s+commerce\.shipments\b/);
  });

  it("writes order_edits and order_edit_lines only in order-edits.ts", () => {
    const writers = files.filter((f) => /insert\s+into\s+commerce\.order_edit(s|_lines)\b/i.test(code(f))).map((f) => path.relative(ROOT, f));
    expect(writers).toEqual(["src/server/order-edits.ts"]);
  });
});
