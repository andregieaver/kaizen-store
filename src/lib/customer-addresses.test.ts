import { describe, expect, it } from "vitest";

import { addressLine, choicesFor, cleanAddress, cleanLabel, type SavedAddress } from "./customer-addresses";

const saved = (id: string, country: string, isDefaultShipping = false, label = ""): SavedAddress => ({
  id,
  label,
  address: { name: "Ola", line1: `Gate ${id}`, line2: null, postalCode: "0150", city: "Oslo", country },
  isDefaultShipping,
  isDefaultBilling: false,
});

describe("saved addresses", () => {
  it("cleans and names the first missing field", () => {
    expect(cleanAddress({ line1: " Storgata 1 ", postalCode: "0150", city: "Oslo", country: "no" })).toEqual({
      ok: true,
      address: { name: "", line1: "Storgata 1", line2: null, postalCode: "0150", city: "Oslo", country: "NO" },
    });
    expect(cleanAddress({ line1: "", postalCode: "1", city: "x", country: "NO" })).toEqual({ ok: false, missing: "line1" });
    expect(cleanAddress({ line1: "a", postalCode: "1", city: "x", country: "Norway" })).toEqual({ ok: false, missing: "country" });
  });

  it("keeps labels to one short line", () => {
    expect(cleanLabel("  Home\n\toffice ")).toBe("Home office");
    expect(cleanLabel("x".repeat(60))).toHaveLength(40);
  });

  it("writes an address on one line", () => {
    expect(addressLine({ line1: "Storgata 1", line2: "H0101", postalCode: "0150", city: "Oslo" })).toBe("Storgata 1, H0101, 0150 Oslo");
  });

  it("offers only the market's country, default first", () => {
    const choices = choicesFor([saved("a", "NO"), saved("b", "SE"), saved("c", "NO", true, "Home")], "no");
    expect(choices.map((c) => c.id)).toEqual(["c", "a"]);
    expect(choices[0].label).toBe("Home: Gate c, 0150 Oslo");
  });
});
