import { describe, expect, it } from "vitest";

import {
  isPictureAddress,
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
      "Add at least one picture before publishing the product.",
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

  describe("purchase options", () => {
    const plan = (interval: "week" | "month" | "year", intervalCount: number) => ({
      id: null,
      interval,
      intervalCount,
      discountPercent: 10,
      trialDays: 0,
      signupFee: {} as Record<string, string>,
      minCycles: 0,
    });

    it("accepts options on different schedules", () => {
      expect(productProblems({ ...base, plans: [plan("month", 1), plan("week", 2)] }, context)).toEqual([]);
    });

    it("refuses two options on one schedule, too long a schedule, and subscription-only without options", () => {
      const problems = productProblems(
        { ...base, plans: [plan("month", 1), plan("month", 1), plan("year", 4)] },
        context,
      );
      expect(problems).toContain("Two purchase options renew every month.");
      expect(problems).toContain("Every 4 years, 10% off: subscriptions renew at least every three years.");
      expect(productProblems({ ...base, subscriptionOnly: true }, context)).toEqual([
        "Add a purchase option, or let shoppers also buy the product once.",
      ]);
    });
  });

  describe("digital products", () => {
    const file = {
      id: null,
      name: "Guide.pdf",
      path: "store/1/guide.pdf",
      sizeBytes: 1000,
      contentType: "application/pdf",
      variantSku: null,
    };
    const ebook = { ...base.variants[0], sku: "EBOOK", delivery: "digital" as const };

    it("defaults to shipped, with five downloads over 30 days", () => {
      expect(base.delivery).toBe("physical");
      expect(base.variants[0].delivery).toBe("physical");
      expect(base.files).toEqual([]);
      expect([base.downloadLimit, base.downloadDays]).toEqual([5, 30]);
    });

    it("needs a file for each digital variant on sale, and no manufacturer", () => {
      const digital: ProductInput = { ...base, delivery: "digital", variants: [ebook], manufacturer: null };
      expect(productProblems(digital, context)).toEqual([
        "Default is digital: add a file for shoppers to download.",
      ]);
      expect(productProblems({ ...digital, files: [file] }, context)).toEqual([]);
    });

    it("keeps product-safety rules when some variants are shipped", () => {
      const mixed: ProductInput = {
        ...base,
        manufacturer: null,
        variants: [base.variants[0], ebook],
        files: [{ ...file, variantSku: "EBOOK" }],
      };
      expect(productProblems(mixed, context)).toEqual([
        "Add the manufacturer: EU product-safety rules require it on the listing.",
      ]);
    });

    it("refuses a file for a variant that is not digital", () => {
      const problems = productProblems({ ...base, files: [{ ...file, variantSku: "MUG-1" }] }, context);
      expect(problems).toContain('The file "Guide.pdf" belongs to a variant that is not digital. Choose where it goes.');
    });
  });
});

describe("isPictureAddress", () => {
  it("takes web addresses and paths on the store's own site, like the demo pictures", () => {
    expect(isPictureAddress("https://example.supabase.co/storage/v1/object/public/product-media/a.webp")).toBe(true);
    expect(isPictureAddress("http://localhost:3000/a.png")).toBe(true);
    expect(isPictureAddress("/demo/notebook.svg")).toBe(true);
  });

  it("refuses other schemes, other sites' paths and empty values", () => {
    expect(isPictureAddress("javascript:alert(1)")).toBe(false);
    expect(isPictureAddress("data:image/png;base64,AAAA")).toBe(false);
    expect(isPictureAddress("//evil.example/a.png")).toBe(false);
    expect(isPictureAddress("/\\evil.example/a.png")).toBe(false);
    expect(isPictureAddress("/demo/a b.svg")).toBe(false);
    expect(isPictureAddress("")).toBe(false);
  });
});
