import { describe, expect, it } from "vitest";

import {
  chosenFilters,
  filterCount,
  isFiltered,
  listingQuery,
  NO_FILTERS,
  parseListingParams,
  parseRangeNumber,
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
      ranges: [],
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
      "f.material=wool&f.material=cotton&f.organic=1&f.=x&f.Bad=y&f.with-dash=z&f.material.step=3&kind=goods",
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

  it("reads number and measurement fields as ranges, and writes them back into an address that reads the same (D120)", () => {
    const params = new URLSearchParams(
      "f.weight.min=100&f.weight.max=500&f.length.max=2,5&f.temp.min=-10&f.reversed.min=9&f.reversed.max=3&f.material=wool&kind=goods",
    );
    const filters = parseListingParams(params);
    expect(filters.ranges).toEqual([
      { name: "weight", min: 100, max: 500 },
      { name: "length", min: null, max: 2.5 },
      { name: "temp", min: -10, max: null },
      // A reversed range is put right.
      { name: "reversed", min: 3, max: 9 },
    ]);
    // A choice named the same is another filter; a range key does not make a choice.
    expect(filters.fields).toEqual([{ name: "material", values: ["wool"] }]);
    const query = listingQuery(filters, { q: "kopp" });
    expect(query).toBe(
      "?q=kopp&kind=goods&f.material=wool&f.weight.min=100&f.weight.max=500&f.length.max=2.5&f.temp.min=-10&f.reversed.min=3&f.reversed.max=9",
    );
    expect(parseListingParams(new URLSearchParams(query))).toEqual(filters);
    // Next.js hands pages their parameters as an object.
    expect(parseListingParams({ "f.weight.min": "1.5", "f.weight.max": ["4", "5"] }).ranges).toEqual([{ name: "weight", min: 1.5, max: 4 }]);
  });

  it("leaves out ranges that are malformed, unbounded or for names a field cannot have", () => {
    const bad = parseListingParams(
      new URLSearchParams(
        "f.a.min=abc&f.b.max=Infinity&f.c.min=1e3&f.d.min=0x10&f.e.max=99999999999999999&f.F.min=1&f.with-dash.min=1&f.g.min=&f.h.step=1&f.i.min.max=1&f.j.min=1+2",
      ),
    );
    expect(bad.ranges).toEqual([]);
    expect(parseRangeNumber("12.5")).toBe(12.5);
    expect(parseRangeNumber(" -3,25 ")).toBe(-3.25);
    expect(parseRangeNumber("0.0000001")).toBe(0);
    expect(parseRangeNumber("")).toBeNull();
    expect(parseRangeNumber("-")).toBeNull();
    expect(parseRangeNumber("1.")).toBeNull();
    expect(parseRangeNumber("1000000000001")).toBeNull();
    expect(parseRangeNumber("1000000000000")).toBe(1_000_000_000_000);
    // One good end is enough, the bad one is dropped.
    expect(parseListingParams({ "f.w.min": "5", "f.w.max": "lots" }).ranges).toEqual([{ name: "w", min: 5, max: null }]);
  });

  it("limits how many ranges an address can ask for", () => {
    const params = new URLSearchParams();
    for (let i = 0; i < 20; i++) params.append(`f.field_${i}.min`, "1");
    expect(parseListingParams(params).ranges).toHaveLength(6);
  });

  it("counts, lists and takes away chosen ranges", () => {
    const filters = parseListingParams(new URLSearchParams("f.weight.min=100&f.weight.max=500&f.length.max=3&tag=nyhet&max=50"));
    const chosen = chosenFilters(filters);
    expect(chosen).toEqual([
      { type: "tag", value: "nyhet" },
      { type: "range", name: "weight" },
      { type: "range", name: "length" },
      { type: "price" },
    ]);
    // A range is one filter, whatever its ends.
    expect(filterCount(filters)).toBe(4);
    expect(withoutFilter(filters, { type: "range", name: "weight" }).ranges).toEqual([{ name: "length", min: null, max: 3 }]);
    expect(withoutFilter(filters, { type: "range", name: "weight" }).tags).toEqual(["nyhet"]);
    expect(filterCount(chosen.reduce(withoutFilter, filters))).toBe(0);
    expect(isFiltered(parseListingParams({ "f.weight.min": "1" }))).toBe(true);
  });
});
