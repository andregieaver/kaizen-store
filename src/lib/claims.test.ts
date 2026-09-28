import { describe, expect, it } from "vitest";

import { findClaims } from "./claims";

const kinds = (text: string) => findClaims(text).map((f) => `${f.kind}:${f.phrase.toLowerCase()}`);

describe("claims filter (D76)", () => {
  it("finds generic environmental claims in every language, with their endings", () => {
    expect(kinds("En miljøvennlig kopp i bærekraftige materialer.")).toEqual(["green:miljøvennlig", "green:bærekraftige"]);
    expect(kinds("Hållbar och klimatneutral.")).toEqual(["green:hållbar", "green:klimatneutral"]);
    expect(kinds("Bæredygtig og CO2-neutral")).toEqual(["green:bæredygtig", "green:co2-neutral"]);
    expect(kinds("An eco-friendly, sustainably made, carbon neutral mug")).toEqual([
      "green:eco-friendly",
      "green:sustainably",
      "green:carbon neutral",
    ]);
    expect(kinds("Environmentally   friendly")).toEqual(["green:environmentally   friendly"]);
  });

  it("leaves words that only start the same alone", () => {
    expect(findClaims("Grønnsaksbrett i eik, med grønnkål-motiv.")).toEqual([]);
    expect(findClaims("Greenland wool and a Greenwich-style clock")).toEqual([]);
    // A colour is still flagged: staff decide, the filter only lists.
    expect(kinds("En grønn kopp")).toEqual(["green:grønn"]);
    // An alt text (D89) names colours; the stems still count there.
    expect(findClaims("En grønn kopp", { colours: false })).toEqual([]);
    expect(findClaims("En grønn og bærekraftig kopp", { colours: false }).map((f) => f.phrase)).toEqual(["bærekraftig"]);
  });

  it("finds false urgency and scarcity", () => {
    expect(kinds("Kun i dag! Skynd deg, begrenset antall.")).toEqual(["urgency:kun i dag", "urgency:skynd deg", "urgency:begrenset antall"]);
    expect(kinds("Only 3 left, hurry")).toEqual(["urgency:only 3 left", "urgency:hurry"]);
    expect(kinds("Bare 2 igjen")).toEqual(["urgency:bare 2 igjen"]);
  });

  it("finds best-price claims, amounts of money and stock levels", () => {
    expect(kinds("Markedets laveste pris – billigste i Norge.")).toEqual(["bestPrice:laveste pris", "bestPrice:billigste"]);
    expect(kinds("Nå 299 kr, før kr 399,-. Also €45 or 12,95 EUR.")).toEqual([
      "price:299 kr",
      "price:kr 399,-",
      "price:€45",
      "price:12,95 eur",
    ]);
    expect(kinds("Varen er på lager og sendes i dag.")).toEqual(["stock:på lager"]);
    expect(kinds("Sold out soon")).toEqual(["stock:sold out"]);
  });

  it("finds nothing in plain, factual copy, and gives positions", () => {
    expect(findClaims("Keramikkopp i steingods, 3 dl, tåler oppvaskmaskin. Laget i Portugal.")).toEqual([]);
    expect(findClaims("A5 notebook with 120 pages")).toEqual([]);
    const [finding] = findClaims("Very sustainable.");
    expect(finding).toEqual({ kind: "green", phrase: "sustainable", index: 5 });
  });
});
