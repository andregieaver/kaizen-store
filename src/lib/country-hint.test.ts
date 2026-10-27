import { describe, expect, it } from "vitest";

import { hintCountry, hintHref } from "./country-hint";

/** The country suggestion (D338): which country, and the same page there; never for a country the store does not sell to. */
describe("which country to suggest", () => {
  const offered = ["NO", "SE", "DK"];

  it("is the visitor's when the store sells there and it is not the one shown", () => {
    expect(hintCountry("SE", "NO", offered)).toBe("SE");
    expect(hintCountry("se", "no", offered)).toBe("SE");
  });

  it("is none in the visitor's own country, an unknown or unsold one, or a store in one country", () => {
    expect(hintCountry("NO", "NO", offered)).toBeNull();
    expect(hintCountry("US", "NO", offered)).toBeNull();
    expect(hintCountry(null, "NO", offered)).toBeNull();
    expect(hintCountry("XX1", "NO", offered)).toBeNull();
    expect(hintCountry("SE", "NO", ["SE"])).toBeNull();
  });
});

describe("the same page in the other country", () => {
  it("lays the path after this market's base onto the other's", () => {
    expect(hintHref("/s/demo/no/p/cup", "/s/demo/no", "/s/demo/se")).toBe("/s/demo/se/p/cup");
    expect(hintHref("/no", "/no", "/se")).toBe("/se");
    expect(hintHref("/no/", "/no", "/se")).toBe("/se");
    // From a country's own domain (an empty base), and to one on another origin.
    expect(hintHref("/p/cup", "", "https://nordic.com/no")).toBe("https://nordic.com/no/p/cup");
    expect(hintHref("/no/p/cup", "/no", "https://nordic.se")).toBe("https://nordic.se/p/cup");
    expect(hintHref("/", "", "/dk")).toBe("/dk");
  });
});
