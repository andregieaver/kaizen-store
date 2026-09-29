import { describe, expect, it } from "vitest";

import {
  chosenFilters,
  filterCount,
  isFiltered,
  listingQuery,
  NO_FILTERS,
  parseListingParams,
  toMinorUnits,
  withoutFilter,
} from "./listing-filters";

describe("listing filters (D78)", () => {
  it("reads the filters in an address, leaving out anything unknown or malformed", () => {
    const params = new URLSearchParams(
      "kind=stay&kind=rental&kind=spaceship&category=lamper&category=Not%20a%20slug&tag=nyhet&o.Farge=Bl%C3%A5&o.Farge=Hvit&o.St%C3%B8rrelse=M&o.=x&min=500&max=100&stock=1&sort=priceLow",
    );
    expect(parseListingParams(params)).toEqual({
      kinds: ["stay", "rental"],
      categories: ["lamper"],
      tags: ["nyhet"],
      options: [
        { name: "Farge", values: ["Blå", "Hvit"] },
        { name: "Størrelse", values: ["M"] },
      ],
      fields: [],
      // A reversed range is put right.
      minPrice: 100,
      maxPrice: 500,
      inStock: true,
      sort: "priceLow",
    });
    // Next.js hands pages their parameters as an object.
    expect(parseListingParams({ kind: "goods", min: "0", max: "12,5", sort: "cheapest", stock: "yes" })).toEqual({
      ...NO_FILTERS,
      kinds: ["goods"],
      maxPrice: 12.5,
    });
    expect(parseListingParams({ min: "-3", max: "1e12" })).toEqual(NO_FILTERS);
  });

  it("limits how much an address can ask for", () => {
    const params = new URLSearchParams();
    for (let i = 0; i < 100; i++) params.append("tag", `t${i}`);
    for (let i = 0; i < 10; i++) params.append(`o.n${i}`, "v");
    params.append("category", "x".repeat(200));
    const filters = parseListingParams(params);
    expect(filters.tags).toHaveLength(30);
    expect(filters.options).toHaveLength(6);
    expect(filters.categories).toEqual([]);
  });

  it("writes filters back into an address that reads the same, keeping the page's own parameters", () => {
    const filters = parseListingParams(new URLSearchParams("kind=appointment&o.Farge=Bl%C3%A5&min=10&stock=1&sort=title"));
    const query = listingQuery(filters, { q: "kopp", exact: "" });
    expect(query).toBe("?q=kopp&kind=appointment&o.Farge=Bl%C3%A5&min=10&stock=1&sort=title");
    expect(parseListingParams(new URLSearchParams(query))).toEqual(filters);
    expect(listingQuery(NO_FILTERS)).toBe("");
  });

  it("lists the chosen filters, counts them, and takes any one away", () => {
    const filters = parseListingParams(new URLSearchParams("kind=stay&tag=nyhet&o.Farge=Bl%C3%A5&o.Farge=Hvit&max=500&stock=1&sort=newest"));
    const chosen = chosenFilters(filters);
    expect(chosen).toEqual([
      { type: "kind", value: "stay" },
      { type: "tag", value: "nyhet" },
      { type: "option", name: "Farge", value: "Blå" },
      { type: "option", name: "Farge", value: "Hvit" },
      { type: "price" },
      { type: "stock" },
    ]);
    expect(filterCount(filters)).toBe(6);
    expect(withoutFilter(filters, { type: "option", name: "Farge", value: "Blå" }).options).toEqual([{ name: "Farge", values: ["Hvit"] }]);
    expect(withoutFilter(withoutFilter(filters, chosen[2]), chosen[3]).options).toEqual([]);
    expect(withoutFilter(filters, { type: "price" })).toMatchObject({ minPrice: null, maxPrice: null, sort: "newest" });
    const none = chosen.reduce(withoutFilter, filters);
    expect(filterCount(none)).toBe(0);
    // Another order still changes the page.
    expect(isFiltered(none)).toBe(true);
    expect(isFiltered(NO_FILTERS)).toBe(false);
  });

  it("turns whole units into minor units of the currency", () => {
    expect(toMinorUnits(12.5, 2)).toBe(1250);
    expect(toMinorUnits(500, 0)).toBe(500);
    expect(toMinorUnits(null, 2)).toBeNull();
  });

  it("reads custom fields by name, and writes them back into an address that reads the same (D118)", () => {
    const params = new URLSearchParams(
      "f.material=wool&f.material=cotton&f.organic=1&f.=x&f.Bad=y&f.with-dash=z&f.material.min=3&kind=goods",
    );
    const filters = parseListingParams(params);
    expect(filters.fields).toEqual([
      { name: "material", values: ["wool", "cotton"] },
      { name: "organic", values: ["1"] },
    ]);
    expect(filters.options).toEqual([]);
    const query = listingQuery(filters, { q: "kopp" });
    expect(query).toBe("?q=kopp&kind=goods&f.material=wool&f.material=cotton&f.organic=1");
    expect(parseListingParams(new URLSearchParams(query))).toEqual(filters);
    expect(parseListingParams({ "f.material": ["wool", "wool", " "], "f.organic": "" }).fields).toEqual([
      { name: "material", values: ["wool"] },
    ]);
  });

  it("limits the custom fields an address can ask for, as it limits options", () => {
    const params = new URLSearchParams();
    for (let i = 0; i < 10; i++) params.append(`f.field_${i}`, "v");
    for (let i = 0; i < 100; i++) params.append("f.many", `v${i}`);
    params.append(`f.${"a".repeat(41)}`, "v");
    const filters = parseListingParams(params);
    expect(filters.fields.length).toBeLessThanOrEqual(6);
    expect(filters.fields.find((field) => field.name === "many")?.values.length ?? 30).toBeLessThanOrEqual(30);
    expect(filters.fields.some((field) => field.name.length > 40)).toBe(false);
  });

  it("counts, lists and takes away chosen custom fields", () => {
    const filters = parseListingParams(new URLSearchParams("f.material=wool&f.material=cotton&f.organic=1&tag=nyhet"));
    const chosen = chosenFilters(filters);
    expect(chosen).toEqual([
      { type: "tag", value: "nyhet" },
      { type: "field", name: "material", value: "wool" },
      { type: "field", name: "material", value: "cotton" },
      { type: "field", name: "organic", value: "1" },
    ]);
    expect(filterCount(filters)).toBe(4);
    expect(withoutFilter(filters, chosen[1]).fields).toEqual([
      { name: "material", values: ["cotton"] },
      { name: "organic", values: ["1"] },
    ]);
    expect(withoutFilter(filters, chosen[3]).fields).toEqual([{ name: "material", values: ["wool", "cotton"] }]);
    expect(filterCount(chosen.reduce(withoutFilter, filters))).toBe(0);
  });
});
