import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A standalone account's workspace (D748 E7, `docs/extensions.md` 7) is no store: the places that list a person's stores, count them against
 * `stores_owned` or serve a storefront leave it out (each names `workspace`). Its jobs and emails need nothing: `commerce.store_is_active()`
 * and `email.ts` hold back only templates, demo stores and sandboxes. A new place that lists, counts or serves stores joins this list.
 */
const LEAVES_IT_OUT: Record<string, string> = {
  "src/server/auth.ts": "listStores() and listClosedStores(): the admin's store list, switcher and every page that offers a person's stores.",
  "src/server/control-center.ts": "The cards on /admin, one per store.",
  "src/server/limits.ts": "ownedStoreCount(): what counts against stores_owned (its use still counts towards the account's other limits).",
  "src/server/platform.ts": "createStoreForOwner(): the stores an owner may have.",
  "src/server/store-copy.ts": "A copy's count of the stores an owner may have.",
  "src/server/stores.ts": "getOpenStore(): the storefront, its chooser and robots.txt.",
  "src/server/store-facts.ts": "storeFactsOf(): what the proxy serves for a store's address.",
  "src/server/seo.ts": "listPublicStores(): the sitemaps, robots and llms.txt.",
};

const code = (file: string) =>
  readFileSync(path.join(process.cwd(), file), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

describe("a workspace is no store (D748 E7)", () => {
  it("is left out wherever stores are listed, counted against the limit or served", () => {
    const missing = Object.keys(LEAVES_IT_OUT).filter((file) => !/\bworkspace\b/.test(code(file)));
    expect(missing).toEqual([]);
  });

  it("still runs its jobs and sends its emails", () => {
    expect(code("src/server/email.ts")).not.toMatch(/\bworkspace\b/);
  });
});
