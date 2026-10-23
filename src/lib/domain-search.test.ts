import { describe, expect, it } from "vitest";

import { labelOf, searchNames, SEARCH_NAMES_MAX } from "./domain-search";

describe("the names a domain search asks about (D315 4.2)", () => {
  it("makes one label of what was typed, Nordic letters spelled out", () => {
    expect(labelOf("Nordisk Butikk")).toBe("nordiskbutikk");
    expect(labelOf("Blåbær & Søt")).toBe("blabaersot");
    expect(labelOf("---")).toBe("");
  });

  it("asks the exact name first, then the label under each ending", () => {
    expect(searchNames("nordiskbutikk.shop", ["com", "shop"])).toEqual(["nordiskbutikk.shop", "nordiskbutikk.com"]);
    expect(searchNames("https://www.nordiskbutikk.no/products", ["com"])).toEqual(["nordiskbutikk.no", "nordiskbutikk.com"]);
    expect(searchNames("Nordisk Butikk", ["com", "store"])).toEqual(["nordiskbutikk.com", "nordiskbutikk.store"]);
    expect(searchNames("", ["com"])).toEqual([]);
    expect(searchNames("!!!", ["com"])).toEqual([]);
  });

  it("asks at most a dozen names", () => {
    const tlds = Array.from({ length: 30 }, (_, i) => `t${String.fromCharCode(97 + (i % 26))}${i}`);
    expect(searchNames("x", tlds).length).toBe(SEARCH_NAMES_MAX);
  });
});
