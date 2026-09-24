import { describe, expect, it } from "vitest";

import {
  combineOptions,
  formatPriceInput,
  parsePrice,
  productInput,
  productProblems,
  variantLabel,
  type ProductInput,
} from "./product-input";

describe("parsePrice", () => {
  it("reads prices the way people type them", () => {
    expect(parsePrice("249", "NOK")).toBe(24900);
    expect(parsePrice("249,00", "NOK")).toBe(24900);
    expect(parsePrice("249.5", "SEK")).toBe(24950);
    expect(parsePrice("1 249,50", "DKK")).toBe(124950);
    expect(parsePrice("1.249,50", "EUR")).toBe(124950);
    expect(parsePrice("1,249", "EUR")).toBe(124900);
    expect(parsePrice("0,99", "EUR")).toBe(99);
  });

  it("refuses what is not a price", () => {
    expect(parsePrice("", "NOK")).toBeNull();
    expect(parsePrice("abc", "NOK")).toBeNull();
    expect(parsePrice("-5", "NOK")).toBeNull();
    expect(parsePrice("12,345,67x", "NOK")).toBeNull();
  });

  it("round-trips with formatPriceInput", () => {
    for (const minor of [0, 5, 99, 24900, 124950]) {
      expect(parsePrice(formatPriceInput(minor, "NOK"), "NOK")).toBe(minor);
    }
  });
});

describe("options and variants", () => {
  it("offers every combination of option values", () => {
    const combos = combineOptions([
      { name: "Colour", values: ["White", "Black"] },
      { name: "Size", values: ["S", "M"] },
    ]);
    expect(combos).toEqual([
      { Colour: "White", Size: "S" },
      { Colour: "White", Size: "M" },
      { Colour: "Black", Size: "S" },
      { Colour: "Black", Size: "M" },
    ]);
    expect(combineOptions([])).toEqual([{}]);
    expect(variantLabel({ Colour: "White", Size: "M" })).toBe("White / M");
    expect(variantLabel({})).toBe("Default");
  });
});

describe("productInput", () => {
  it("accepts optional fields left empty as null, as the editor sends them", () => {
    const parsed = productInput.safeParse({
      handle: "kopp",
      status: "draft",
      translations: [{ locale: "nb-NO", title: "Kopp", description: "", safetyInformation: "" }],
      media: [],
      options: [],
      variants: [
        {
          id: null,
          options: {},
          sku: "K-1",
          gtin: null,
          prices: {},
          stock: 0,
          active: true,
          weightGrams: null,
          hsCode: null,
          originCountry: null,
        },
      ],
      taxCode: "txcd_99999999",
      withdrawalExclusion: "none",
      schemes: ["packaging"],
      manufacturer: null,
      responsiblePerson: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("productProblems", () => {
  const base: ProductInput = productInput.parse({
    handle: "mug",
    status: "active",
    translations: [{ locale: "nb-NO", title: "Kopp", description: "", safetyInformation: "" }],
    media: [{ url: "https://example.com/a.webp", thumbnailUrl: null, alt: "" }],
    options: [],
    variants: [
      {
        id: null,
        options: {},
        sku: "MUG-1",
        gtin: "",
        prices: { NO: "249", SE: "" },
        stock: 3,
        active: true,
        weightGrams: null,
        hsCode: "",
        originCountry: "",
      },
    ],
    taxCode: "txcd_99999999",
    withdrawalExclusion: "none",
    schemes: [],
    manufacturer: { new: { name: "Maker", postalAddress: "Street 1, Berlin", electronicAddress: "a@b.de", country: "DE" } },
    responsiblePerson: null,
  });
  const context = {
    markets: [
      { code: "NO", currency: "NOK" },
      { code: "SE", currency: "SEK" },
    ],
    primaryLocale: "nb-NO",
    operatorCountries: { "11111111-1111-4111-8111-111111111111": "NO" },
    euCountries: new Set(["DE", "SE", "BE"]),
  };

  it("accepts a complete product", () => {
    expect(productProblems(base, context)).toEqual([]);
  });

  it("explains what stops a product going on sale", () => {
    const problems = productProblems(
      { ...base, media: [], manufacturer: { id: "11111111-1111-4111-8111-111111111111" } },
      context,
    );
    expect(problems).toEqual([
      "Add at least one picture before putting the product on sale.",
      "The manufacturer is outside the EU, so add a responsible person established in the EU.",
    ]);
  });

  it("lets a draft be incomplete but not wrong", () => {
    const draft: ProductInput = {
      ...base,
      status: "draft",
      media: [],
      manufacturer: null,
      variants: [{ ...base.variants[0], prices: { NO: "abc" } }],
    };
    expect(productProblems(draft, context)).toEqual(['Default: "abc" is not a price in NOK.']);
  });

  it("catches duplicate SKUs and a missing title", () => {
    const problems = productProblems(
      {
        ...base,
        translations: [{ ...base.translations[0], title: "" }],
        variants: [base.variants[0], { ...base.variants[0], sku: "mug-1" }],
      },
      context,
    );
    expect(problems).toContain("Give the product a title.");
    expect(problems).toContain("Two variants have the same SKU.");
  });
});
