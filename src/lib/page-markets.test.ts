import { describe, expect, it } from "vitest";

import { cleanLabels, countryLabelKey, menuLabel, type MenuItem } from "./navigation";
import { ownMarkets, pageInMarket } from "./page-markets";

/** Each country's own content (D338): which countries a page is for, and a menu label for one country over its language's. */
describe("a page's countries", () => {
  it("is for every country without countries of its own", () => {
    expect(pageInMarket({}, "SE")).toBe(true);
    expect(pageInMarket({ markets: [] }, "SE")).toBe(true);
    expect(pageInMarket({ markets: ["SE"] }, "se")).toBe(true);
    expect(pageInMarket({ markets: ["SE"] }, "NO")).toBe(false);
  });

  it("keeps the store's own countries only, and none when that is every one", () => {
    expect(ownMarkets(["SE", "ZZ", "se"], ["NO", "SE", "DK"])).toEqual(["SE"]);
    expect(ownMarkets(["NO", "SE", "DK"], ["NO", "SE", "DK"])).toBeUndefined();
    expect(ownMarkets(["ZZ"], ["NO", "SE"])).toBeUndefined();
    expect(ownMarkets(undefined, ["NO", "SE"])).toBeUndefined();
  });
});

describe("a menu label for one country", () => {
  const item: MenuItem = { label: { "de-DE": "Laden", [countryLabelKey("de-DE", "at")]: "Geschäft" }, link: { kind: "products" } };
  const builtIn = { home: "Home", account: "Account", cart: "Cart" };

  it("is read first in that country, the language's elsewhere", () => {
    expect(menuLabel(item, "de-DE", builtIn, undefined, "AT")).toBe("Geschäft");
    expect(menuLabel(item, "de-DE", builtIn, undefined, "DE")).toBe("Laden");
    expect(menuLabel(item, "de-DE", builtIn)).toBe("Laden");
  });

  it("is kept on save for the store's countries in their own language only", () => {
    expect(cleanLabels({ ...item.label, "de-DE@CH": "x", "fr-FR@AT": "y" }, ["de-DE"], { AT: "de-DE" })).toEqual(item.label);
  });
});
