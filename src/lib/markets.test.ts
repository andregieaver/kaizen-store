import { describe, expect, it } from "vitest";

import { getMarket, marketForCountry } from "./markets";

describe("markets", () => {
  it("resolves a URL slug to its market", () => {
    expect(getMarket("se")).toMatchObject({ code: "SE", currency: "SEK", slug: "se" });
    expect(getMarket("de")).toBeNull();
  });

  it("suggests a market from a visitor's country", () => {
    expect(marketForCountry("dk")?.slug).toBe("dk");
    expect(marketForCountry("DE")).toBeNull();
    expect(marketForCountry(null)).toBeNull();
  });
});
