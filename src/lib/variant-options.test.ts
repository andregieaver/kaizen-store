import { describe, expect, it } from "vitest";

import { buyableValues, nearestVariant, optionsOf, type PickVariant } from "./variant-options";

let n = 0;
const v = (colour: string, size: string, buyable = true): PickVariant => ({ id: `v${(n += 1)}`, options: { Farge: colour, Str: size }, buyable });

// Red comes in S and M; blue in S, M and L, but blue M is sold out; green L only, sold out.
const variants = [v("Rød", "S"), v("Rød", "M"), v("Blå", "S"), v("Blå", "M", false), v("Blå", "L"), v("Grønn", "L", false)];

describe("the options of a product", () => {
  it("are named in the order its variants name them, with values in the order they first appear", () => {
    expect(optionsOf(variants)).toEqual([
      { name: "Farge", values: ["Rød", "Blå", "Grønn"] },
      { name: "Str", values: ["S", "M", "L"] },
    ]);
  });
});

describe("which values make a buyable variant", () => {
  it("counts only buyable variants, the other chosen values holding", () => {
    // Nothing chosen: every value that can be bought in some variant; green cannot.
    expect(buyableValues(variants, {})).toEqual({ Farge: new Set(["Rød", "Blå"]), Str: new Set(["S", "M", "L"]) });
    // Blue chosen: sizes S and L (M is sold out); the colours are judged against the size chosen, none here.
    const blue = buyableValues(variants, { Farge: "Blå" });
    expect(blue.Str).toEqual(new Set(["S", "L"]));
    expect(blue.Farge).toEqual(new Set(["Rød", "Blå"]));
    // Blue and M: no colour but red has M to buy, and the sizes are blue's.
    const blueM = buyableValues(variants, { Farge: "Blå", Str: "M" });
    expect(blueM.Farge).toEqual(new Set(["Rød"]));
    expect(blueM.Str).toEqual(new Set(["S", "L"]));
    // L chosen: only blue.
    expect(buyableValues(variants, { Str: "L" }).Farge).toEqual(new Set(["Blå"]));
  });

  it("is empty for a product that cannot be bought at all", () => {
    expect(buyableValues([v("Rød", "S", false)], {})).toEqual({ Farge: new Set(), Str: new Set() });
  });
});

describe("the variant shown after a value is chosen", () => {
  it("is the one with every value chosen when it can be bought", () => {
    expect(nearestVariant(variants, { Farge: "Blå", Str: "L" }, "Farge")?.options).toEqual({ Farge: "Blå", Str: "L" });
  });

  it("keeps the new value and as many others as it can among the buyable ones, else shows the exact one sold out", () => {
    // Red chosen while L was: no red L, so red keeps none of the others; the first buyable red.
    expect(nearestVariant(variants, { Farge: "Rød", Str: "L" }, "Farge")?.options).toEqual({ Farge: "Rød", Str: "S" });
    // Blue M is sold out: another blue that can be bought.
    expect(nearestVariant(variants, { Farge: "Blå", Str: "M" }, "Farge")?.options).toEqual({ Farge: "Blå", Str: "S" });
    // Green L is sold out and no green can be bought: shown as it is, sold out.
    expect(nearestVariant(variants, { Farge: "Grønn", Str: "L" }, "Farge")?.options).toEqual({ Farge: "Grønn", Str: "L" });
    expect(nearestVariant(variants, { Farge: "Gul" }, "Farge")).toBeNull();
  });
});
