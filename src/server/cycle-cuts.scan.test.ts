import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The cuts of the import cycle in src/server (bloat review step 0.6), held by reading files as text so they cannot come back by habit
 * until the cycle's size is held itself. An `import type` line is allowed.
 */
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

/** Whether a file has a static (value) import from the module. */
function importsFrom(file: string, from: string): boolean {
  const text = read(file);
  const statements = text.match(/^import\s[^;]*?from\s+["'][^"']+["'];?/gm) ?? [];
  return statements.some((s) => !/^import\s+type\s/.test(s) && new RegExp(`from\\s+["']${from.replace(/[./]/g, "\\$&")}["']`).test(s));
}

describe("the cuts of the server's import cycle (bloat review step 0.6)", () => {
  it.each([
    ["src/server/customers.ts", "./privacy-erasure"],
    ["src/server/orders.ts", "./payment-providers"],
    ["src/server/store-features.ts", "./store-closure"],
    ["src/server/visibility.ts", "./customer-admin"],
    ["src/server/wishlist-admin.ts", "./customer-admin"],
    ["src/server/customer-timeline.ts", "./customer-admin"],
  ])("%s has no static import from %s", (file, from) => {
    expect(importsFrom(file, from)).toBe(false);
  });

  it("settings.ts does not define encryptionKey (it lives in encryption-key.ts)", () => {
    expect(read("src/server/settings.ts")).not.toContain("export function encryptionKey");
  });
});
