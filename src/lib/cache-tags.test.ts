import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CATALOG_TAG,
  DESIGNS_TAG,
  PAGES_TAG,
  PLATFORM_NAVIGATION_TAG,
  SITE_STORE_TAG,
  STARTERS_TAG,
  STORES_TAG,
  affiliateTag,
  afterSaleTag,
  campaignsTag,
  catalogTag,
  chatTag,
  cookiesTag,
  experimentsTag,
  fieldsTag,
  pagesTag,
  recommendTag,
  storeTag,
  textStylesTag,
} from "./cache-tags";

/** The one file of cache tag names (bloat review step 2.20): it imports nothing, and every name keeps the string it had in its feature module. */
describe("cache tag names", () => {
  it("live in a file with no import", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/cache-tags.ts"), "utf8");
    expect(source.split("\n").filter((line) => line.startsWith("import"))).toEqual([]);
  });

  it("build today's strings", () => {
    expect(storeTag("x")).toBe("store:x");
    expect(catalogTag("s")).toBe("catalog:s");
    expect(pagesTag(null)).toBe("platform-pages");
    expect(pagesTag("s")).toBe("pages:s");
    expect(cookiesTag(null)).toBe("cookies:kaizen");
    expect(chatTag(null)).toBe("chat:kaizen");
    expect(textStylesTag(null)).toBe("text-styles:kaizen");
    expect(experimentsTag("s")).toBe("experiments:s");
    expect(affiliateTag("s")).toBe("affiliate:s");
    expect(afterSaleTag("s")).toBe("after-sale:s");
    expect(fieldsTag("s")).toBe("fields:s");
    expect(recommendTag("s")).toBe("recommend:s");
    expect(campaignsTag("s")).toBe("campaigns:s");
  });

  it("keep today's constants", () => {
    expect(STORES_TAG).toBe("stores");
    expect(CATALOG_TAG).toBe("catalog");
    expect(PAGES_TAG).toBe("platform-pages");
    expect(SITE_STORE_TAG).toBe("site-from-store");
    expect(DESIGNS_TAG).toBe("design-presets");
    expect(STARTERS_TAG).toBe("store-starters");
    expect(PLATFORM_NAVIGATION_TAG).toBe("platform-navigation");
  });
});
