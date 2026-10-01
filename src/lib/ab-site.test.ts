import { describe, expect, it } from "vitest";

import { pageTypeOfKind, splitSiteVersions, targetKindOf, testToken, withSiteVersions } from "./ab-site";

describe("the versions of site-wide tests in a market address", () => {
  it("names a test by the start of its id", () => {
    expect(testToken("3FA9C1D2-1111-4111-8111-111111111111")).toBe("3fa9c1d2");
  });

  it("adds a visitor's versions to the market, in a fixed order, and leaves the original out", () => {
    expect(withSiteVersions("no", {})).toBe("no");
    expect(withSiteVersions("no", { "3fa9c1d2": "a" })).toBe("no");
    expect(withSiteVersions("no", { "3fa9c1d2": "b" })).toBe("no~3fa9c1d2b");
    expect(withSiteVersions("no-en-eur", { "7b21aa90": "c", "3fa9c1d2": "b" })).toBe("no-en-eur~3fa9c1d2b_7b21aa90c");
    // Anything that is not a token or a version is left out.
    expect(withSiteVersions("no", { "short": "b", "3fa9c1d2": "z" })).toBe("no");
  });

  it("takes them off again, and leaves a param that is not well formed whole so it finds no market", () => {
    expect(splitSiteVersions("no")).toEqual({ market: "no", versions: {} });
    expect(splitSiteVersions("no~3fa9c1d2b")).toEqual({ market: "no", versions: { "3fa9c1d2": "b" } });
    expect(splitSiteVersions("no-en~3fa9c1d2b_7b21aa90c")).toEqual({ market: "no-en", versions: { "3fa9c1d2": "b", "7b21aa90": "c" } });
    for (const odd of ["no~", "no~x", "no~3fa9c1d2a", "no~3fa9c1d2b_", "no~3fa9c1d2b~7b21aa90c", "no~3FA9C1D2b", "no~3fa9c1d2b_7b21aa90c_aaaaaaaab_bbbbbbbbb_cccccccc_ddddddddb_eeeeeeeeb"]) {
      expect(splitSiteVersions(odd), odd).toEqual({ market: odd, versions: {} });
    }
  });

  it("round trips", () => {
    const versions = { "3fa9c1d2": "b", "7b21aa90": "d" };
    expect(splitSiteVersions(withSiteVersions("se", versions))).toEqual({ market: "se", versions });
  });
});

describe("what a test is of", () => {
  it("is a page, a product layout, a header or a footer", () => {
    expect(targetKindOf("page")).toBe("page");
    expect(targetKindOf("product_layout")).toBe("layout");
    expect(targetKindOf("header")).toBe("header");
    expect(targetKindOf("footer")).toBe("footer");
    expect(targetKindOf("article")).toBeNull();
    expect(targetKindOf("variant")).toBeNull();
    expect(pageTypeOfKind("layout")).toBe("product_layout");
    expect(pageTypeOfKind("header")).toBe("header");
  });
});
