import { pictureItem } from "./product-media";
import { describe, expect, it } from "vitest";

import { GENERAL_TAX_CODE, productInput, type ProductInput } from "./product-input";
import {
  createProductInput,
  factsOf,
  findLocale,
  findMarket,
  matchOptions,
  mergeProduct,
  notPricedIn,
  pricesAsChange,
  productApprovalSummary,
  setPricesInput,
  skuFor,
  textJobs,
  toProductInput,
  updateProductInput,
  writeProductTextsInput,
  type ToolStore,
} from "./product-tools";

const STORE: ToolStore = {
  locales: ["nb-NO", "sv-SE", "en-GB"],
  primaryLocale: "nb-NO",
  markets: [
    { code: "NO", currency: "NOK", name: "Norway" },
    { code: "SE", currency: "SEK", name: "Sweden" },
  ],
  operators: [{ id: "00000000-0000-4000-8000-000000000001", name: "Kari Keramikk AS", country: "NO" }],
};

/** The editor's blank product, as `emptyProduct()` makes it. */
function base(): ProductInput {
  return {
    handle: "",
    status: "draft",
    translations: STORE.locales.map((locale) => ({ locale, title: "", description: "", safetyInformation: "", seoTitle: "", seoDescription: "", excerpt: "" })),
    media: [],
    options: [],
    variants: [
      {
        id: null,
        options: {},
        sku: "",
        gtin: null,
        measure: null,
        prices: {},
        cost: "",
        stock: 0,
        stockPolicy: "deny",
        backorderDays: null,
        lowStockThreshold: null,
        minQuantity: 1,
        maxQuantity: null,
        quantityStep: 1,
        active: true,
        weightGrams: null,
        hsCode: null,
        originCountry: null,
        delivery: "physical",
        rentalPeriod: "day",
        image: null,
      },
    ],
    delivery: "physical",
    files: [],
    downloadLimit: 5,
    downloadDays: 30,
    plans: [],
    subscriptionOnly: false,
    audience: "all",
    soldByMeasure: false,
    vatCategory: "standard",
    kind: "goods",
    hostId: null,
    layoutId: null,
    appointment: null,
    bundle: null,
    priceBreaks: [],
    taxCode: GENERAL_TAX_CODE,
    withdrawalExclusion: "none",
    schemes: ["packaging"],
    manufacturer: { id: STORE.operators[0].id },
    responsiblePerson: null,
    categories: [],
    tags: [],
  };
}

const create = (args: unknown) => createProductInput.parse(args);

describe("findLocale and findMarket", () => {
  it("finds a language by its code or the language alone", () => {
    expect(findLocale("sv-SE", STORE.locales)).toBe("sv-SE");
    expect(findLocale("SV", STORE.locales)).toBe("sv-SE");
    expect(findLocale("nb_NO", STORE.locales)).toBe("nb-NO");
    expect(findLocale("de", STORE.locales)).toBeNull();
    expect(findLocale("en", ["en-GB", "en-US"])).toBeNull(); // two Englishes: say which
  });

  it("finds a country by its code or its name", () => {
    expect(findMarket("se", STORE.markets)?.code).toBe("SE");
    expect(findMarket("Norway", STORE.markets)?.code).toBe("NO");
    expect(findMarket("DK", STORE.markets)).toBeNull();
  });
});

describe("skuFor and matchOptions", () => {
  it("makes a SKU from the address and the option values", () => {
    expect(skuFor("linen-shirt", { Size: "M", Colour: "Sky blue" })).toBe("LINEN-SHIRT-M-SKY-BLUE");
    expect(skuFor("mug", {})).toBe("MUG");
    expect(skuFor("a".repeat(80), { Size: "M" })).toHaveLength(64);
  });

  it("matches option names and values without regard to case", () => {
    const options = [{ name: "Size", values: ["S", "M"] }];
    expect(matchOptions({ size: "m" }, options)).toEqual({ Size: "M" });
    expect(matchOptions({ Colour: "Red" }, options)).toEqual({ Colour: "Red" }); // left for the editor's check to refuse
  });
});

describe("toProductInput", () => {
  it("makes a draft of physical goods the editor's schema accepts", () => {
    const made = toProductInput(create({ title: "Blue mug", description: "A mug.", prices: { NO: "249", se: "299" }, stock: 12 }), base(), STORE, { handle: "blue-mug" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.input.status).toBe("draft");
    expect(made.input.kind).toBe("goods");
    expect(made.input.handle).toBe("blue-mug");
    expect(made.input.translations.find((t) => t.locale === "nb-NO")).toMatchObject({ title: "Blue mug", description: "A mug." });
    expect(made.input.variants).toHaveLength(1);
    expect(made.input.variants[0]).toMatchObject({ sku: "BLUE-MUG", prices: { NO: "249", SE: "299" }, stock: 12, delivery: "physical", id: null });
    expect(productInput.safeParse(made.input).success).toBe(true);
  });

  it("makes every combination of the options when no variants are given", () => {
    const made = toProductInput(
      create({ title: "Shirt", options: [{ name: "Size", values: ["S", "M"] }, { name: "Colour", values: ["Red", "Blue"] }], prices: { NO: "399" } }),
      base(),
      STORE,
      { handle: "shirt" },
    );
    expect(made.ok && made.input.variants.map((v) => v.sku)).toEqual(["SHIRT-S-RED", "SHIRT-S-BLUE", "SHIRT-M-RED", "SHIRT-M-BLUE"]);
    expect(made.ok && made.input.variants.every((v) => v.prices.NO === "399")).toBe(true);
  });

  it("lets a variant give its own SKU, price and stock", () => {
    const made = toProductInput(
      create({
        title: "Shirt",
        options: [{ name: "Size", values: ["S", "M"] }],
        prices: { NO: "399" },
        variants: [{ options: { size: "s" }, sku: "SH-S", stock: 3 }, { options: { Size: "M" }, prices: { NO: "449" } }],
      }),
      base(),
      STORE,
      { handle: "shirt" },
    );
    expect(made.ok && made.input.variants.map((v) => [v.sku, v.options, v.prices.NO, v.stock])).toEqual([
      ["SH-S", { Size: "S" }, "399", 3],
      ["SHIRT-M", { Size: "M" }, "449", 0],
    ]);
  });

  it("refuses a country or a language the store does not have, with the store's own", () => {
    const made = toProductInput(create({ title: "Mug", prices: { DK: "199" }, translations: [{ language: "de", title: "Becher" }] }), base(), STORE, {});
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.problems[0]).toContain('does not sell to "DK"');
    expect(made.problems[0]).toContain("Norway (NO, NOK)");
    expect(made.problems[1]).toContain('the language "de"');
  });

  it("names a company by name, or adds one with its details", () => {
    const named = toProductInput(create({ title: "Mug", manufacturer: "kari keramikk as" }), base(), STORE, {});
    expect(named.ok && named.input.manufacturer).toEqual({ id: STORE.operators[0].id });
    const added = toProductInput(
      create({ title: "Mug", manufacturer: { name: "Clay Co", postal_address: "1 Clay Road, Leeds", contact: "hi@clay.example", country: "gb" }, responsible_person: "Kari Keramikk AS" }),
      base(),
      STORE,
      {},
    );
    expect(added.ok && added.input.manufacturer).toEqual({ new: { name: "Clay Co", postalAddress: "1 Clay Road, Leeds", electronicAddress: "hi@clay.example", country: "GB" } });
    const unknown = toProductInput(create({ title: "Mug", manufacturer: "Nobody Ltd" }), base(), STORE, {});
    expect(!unknown.ok && unknown.problems[0]).toContain("Kari Keramikk AS");
  });

  it("writes the other languages' words and the content for the unit price", () => {
    const made = toProductInput(
      create({ title: "Juice", translations: [{ language: "sv", title: "Juice", description: "En juice." }], variants: [{ content: { amount: "0,75", unit: "l" } }] }),
      base(),
      STORE,
      { handle: "juice" },
    );
    expect(made.ok && made.input.translations.find((t) => t.locale === "sv-SE")).toMatchObject({ title: "Juice", description: "En juice." });
    expect(made.ok && made.input.variants[0].measure).toEqual({ amount: "0,75", unit: "l", base: null });
  });
});

describe("mergeProduct", () => {
  const stored = (): ProductInput => {
    const made = toProductInput(
      create({ title: "Shirt", options: [{ name: "Size", values: ["S", "M"] }], prices: { NO: "399", SE: "499" }, stock: 5 }),
      base(),
      STORE,
      { handle: "shirt", categories: ["c1"] },
    );
    if (!made.ok) throw new Error("fixture");
    return { ...made.input, variants: made.input.variants.map((v, i) => ({ ...v, id: `00000000-0000-4000-8000-00000000001${i}` })) };
  };

  it("lays the fields given over the stored product and says what changed", () => {
    const merged = mergeProduct(stored(), updateProductInput.parse({ product: "shirt", title: "Linen shirt", variants: [{ sku: "SHIRT-M", prices: { SE: "", NO: "449" } }] }), STORE, {});
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.input.translations.find((t) => t.locale === "nb-NO")?.title).toBe("Linen shirt");
    expect(merged.input.variants.find((v) => v.sku === "SHIRT-M")?.prices).toEqual({ NO: "449" });
    expect(merged.input.variants.find((v) => v.sku === "SHIRT-S")?.prices).toEqual({ NO: "399", SE: "499" });
    expect(merged.input.categories).toEqual(["c1"]);
    expect(merged.changed).toEqual(["the title", "SHIRT-M: prices"]);
  });

  it("adds a variant for a new SKU and switches one off, never deleting it", () => {
    const merged = mergeProduct(
      stored(),
      updateProductInput.parse({
        product: "shirt",
        options: [{ name: "Size", values: ["S", "M", "L"] }],
        variants: [{ sku: "SHIRT-L", options: { size: "l" }, prices: { NO: "399" }, stock: 2 }, { sku: "shirt-s", active: false }],
      }),
      STORE,
      {},
    );
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.input.variants.map((v) => [v.sku, v.active, v.id === null])).toEqual([
      ["SHIRT-S", false, false],
      ["SHIRT-M", true, false],
      ["SHIRT-L", true, true],
    ]);
    expect(merged.input.variants[2]).toMatchObject({ options: { Size: "L" }, stock: 2 });
  });

  it("refuses to change an existing variant's stock, and a change that changes nothing", () => {
    const stock = mergeProduct(stored(), updateProductInput.parse({ product: "shirt", variants: [{ sku: "SHIRT-S", stock: 9 }] }), STORE, {});
    expect(!stock.ok && stock.problems[0]).toContain("set_stock");
    const same = mergeProduct(stored(), updateProductInput.parse({ product: "shirt", variants: [{ sku: "SHIRT-S", stock: 5 }] }), STORE, {});
    expect(!same.ok && same.problems[0]).toContain("Nothing to change");
  });

  it("replaces or adds pictures, without the same picture twice", () => {
    const one = pictureItem("https://x.example/a.webp", null, "A");
    const two = pictureItem("https://x.example/b.webp", null, "B");
    const replaced = mergeProduct(stored(), updateProductInput.parse({ product: "shirt", pictures: [{ url: one.url }] }), STORE, { media: [one] });
    expect(replaced.ok && replaced.input.media).toEqual([one]);
    if (!replaced.ok) return;
    const added = mergeProduct(replaced.input, updateProductInput.parse({ product: "shirt", add_pictures: [{ url: one.url }, { url: two.url }] }), STORE, { addMedia: [one, two] });
    expect(added.ok && added.input.media).toEqual([one, two]);
  });

  it("replaces the pictures only: a product's videos and 3D models stay (D325)", () => {
    const one = pictureItem("https://x.example/a.webp", null, "A");
    const clip = { ...pictureItem("https://x.example/poster.webp", null, "Clip"), kind: "video" as const, source: "youtube" as const, mediaUrl: "https://youtu.be/dQw4w9WgXcQ" };
    const before = { ...stored(), media: [pictureItem("https://x.example/old.webp", null, "Old"), clip] };
    const replaced = mergeProduct(before, updateProductInput.parse({ product: "shirt", pictures: [{ url: one.url }] }), STORE, { media: [one] });
    expect(replaced.ok && replaced.input.media).toEqual([one, clip]);
  });
});

describe("pricesAsChange", () => {
  const product = (): ProductInput => {
    const made = toProductInput(create({ title: "Mug", options: [{ name: "Size", values: ["S", "M"] }], prices: { NO: "199" } }), base(), STORE, { handle: "mug" });
    if (!made.ok) throw new Error("fixture");
    return made.input;
  };

  it("prices one variant, or every variant that is on", () => {
    const all = pricesAsChange("mug", setPricesInput.parse({ product: "mug", changes: [{ prices: { SE: "249" } }, { sku: "mug-m", prices: { NO: "229" } }] }), product());
    expect(all.ok && all.change.variants).toEqual([
      { sku: "MUG-S", prices: { SE: "249" } },
      { sku: "MUG-M", prices: { SE: "249", NO: "229" } },
    ]);
    const merged = all.ok ? mergeProduct(product(), all.change, STORE, {}) : null;
    expect(merged?.ok && merged.input.variants.map((v) => v.prices)).toEqual([{ NO: "199", SE: "249" }, { NO: "229", SE: "249" }]);
  });

  it("never adds a variant", () => {
    const unknown = pricesAsChange("mug", setPricesInput.parse({ product: "mug", changes: [{ sku: "MUG-XL", prices: { NO: "1" } }] }), product());
    expect(!unknown.ok && unknown.problems[0]).toContain("MUG-S, MUG-M");
  });
});

describe("notPricedIn", () => {
  it("names the countries no active variant has a price in", () => {
    const made = toProductInput(create({ title: "Mug", prices: { NO: "199" } }), base(), STORE, {});
    expect(made.ok && notPricedIn(made.input, STORE.markets)).toEqual(["Sweden (SE, SEK)"]);
  });
});

describe("textJobs and factsOf", () => {
  const product = (description = "") => {
    const made = toProductInput(create({ title: "Mug", description, options: [{ name: "Size", values: ["S"] }] }), base(), STORE, {});
    if (!made.ok) throw new Error("fixture");
    return made.input;
  };

  it("writes only what is empty, and translates into every other language", () => {
    const jobs = textJobs(product(), writeProductTextsInput.parse({ product: "mug" }), STORE);
    expect(jobs.ok && jobs.jobs).toEqual([
      { kind: "write", locale: "nb-NO" },
      { kind: "seo", locale: "nb-NO" },
      { kind: "translate", locale: "sv-SE" },
      { kind: "translate", locale: "en-GB" },
    ]);
  });

  it("keeps a description that is there unless asked to rewrite it", () => {
    const kept = textJobs(product("A mug."), writeProductTextsInput.parse({ product: "mug", texts: ["description"] }), STORE);
    expect(kept.ok && kept.jobs).toEqual([]);
    const rewritten = textJobs(product("A mug."), writeProductTextsInput.parse({ product: "mug", texts: ["description"], rewrite: true }), STORE);
    expect(rewritten.ok && rewritten.jobs).toEqual([{ kind: "improve", locale: "nb-NO" }]);
  });

  it("refuses a language that is not one of the store's others", () => {
    const jobs = textJobs(product(), writeProductTextsInput.parse({ product: "mug", texts: ["languages"], languages: ["nb", "de"] }), STORE);
    expect(!jobs.ok && jobs.problems).toHaveLength(2);
  });

  it("gives the writer the product's own words, never a price or stock", () => {
    const facts = factsOf(product("A mug."), "nb-NO", { categories: ["Kitchen"], tags: [] });
    expect(facts).toEqual({ kind: "goods", title: "Mug", description: "A mug.", seoTitle: "", seoDescription: "", categories: ["Kitchen"], tags: [], options: [{ name: "Size", values: ["S"] }] });
  });
});

describe("productApprovalSummary", () => {
  it("says what a live change does in words from its arguments and the product's title", () => {
    expect(productApprovalSummary("set_product_status", { status: "active" }, "Blue mug", STORE.markets)).toBe('Publish "Blue mug" on the site, for sale.');
    expect(productApprovalSummary("set_prices", { changes: [{ sku: "MUG", prices: { NO: "249", SE: "" } }] }, "Blue mug", STORE.markets)).toBe(
      'Change the prices of the live product "Blue mug": MUG 249 NOK in NO, no price in SE.',
    );
    expect(productApprovalSummary("update_product", { title: "Big mug", tags: ["gift"], handle: "big-mug" }, "Blue mug", STORE.markets)).toBe(
      'Change the live product "Blue mug": the title to "Big mug"; the web address to /p/big-mug (the old one is redirected); the tags to gift.',
    );
  });
});
