import { describe, expect, it } from "vitest";

import { productInput, type ProductInput } from "./product-input";
import type { Term } from "./taxonomy";
import { PACK_COUNT_MAX, packTotal, typedMeasure } from "./unit-price";
import { allowSmallBase } from "./unit-price-test-support";
import {
  CONTENT_UNITS,
  baseAfterUnitChange,
  categoryChain,
  categoryGapWords,
  compareChoices,
  contentPreviews,
  contentState,
  editorFacts,
  needWords,
  needsContentNotice,
  unitLabel,
  withoutContentWhereNotGoods,
} from "./unit-price-editor";

const flat = (text: string) => text.replace(/\s/g, " ");

const markets: { code: string; name: string; currency: string; vatRates: Record<string, number> }[] = [
  { code: "NO", name: "Norway", currency: "NOK", vatRates: { standard: 0.25, food: 0.15 } },
  { code: "DE", name: "Germany", currency: "EUR", vatRates: { standard: 0.19 } },
];
const base = { markets, audience: "consumers" as const, vatCategory: "standard", locale: "nb" };
const kaffe = { amount: "250", unit: "g" as const, base: null };

describe("the live preview under a variant's content", () => {
  it("says nothing until a content is typed", () => {
    expect(contentPreviews({ ...base, content: null, prices: { NO: "49,90" } })).toEqual([]);
    expect(contentPreviews({ ...base, content: { amount: "", unit: "g", base: null }, prices: { NO: "49,90" } })).toEqual([]);
    expect(contentPreviews({ ...base, content: { amount: "abc", unit: "g", base: null }, prices: { NO: "49,90" } })).toEqual([]);
  });

  it("says there is no price yet when no market has one", () => {
    expect(contentPreviews({ ...base, content: kaffe, prices: {} })).toEqual([{ market: "", shown: false, text: "Not shown: no price yet." }]);
    expect(contentPreviews({ ...base, content: kaffe, prices: { NO: "abc" } })[0].text).toBe("Not shown: no price yet.");
  });

  it("shows the unit price the shop will show: 49,90 for 250 g is 199,60 per kg (the spec's table)", () => {
    const [line] = contentPreviews({ ...base, content: kaffe, prices: { NO: "49,90" } });
    expect(line.shown).toBe(true);
    expect(flat(line.text)).toBe("Unit price in Norway (NOK): 199,60 kr/kg");
  });

  it("works from the shown price in each market's own currency (the euro market gets its own figure)", () => {
    const lines = contentPreviews({ ...base, content: kaffe, prices: { NO: "49,90", DE: "4,35" } });
    expect(lines.map((l) => flat(l.text))).toEqual(["Unit price in Norway (NOK): 199,60 kr/kg", "Unit price in Germany (EUR): 17,40 €/kg"]);
  });

  it("applies the market's rule for the small base: never 100 g in Norway or Germany, whatever the owner chose", () => {
    const lines = contentPreviews({ ...base, content: { ...kaffe, base: "100g" }, prices: { NO: "49,90", DE: "4,35" } });
    expect(flat(lines[0].text)).toBe("Unit price in Norway (NOK): 199,60 kr/kg");
    expect(lines[1].text).toContain("€/kg");
    for (const line of lines) expect(line.text).not.toContain("100 g");
  });

  it("shows 100 g only in a market whose country is opened for the test", () => {
    const restore = allowSmallBase("NO");
    try {
      const lines = contentPreviews({ ...base, content: { ...kaffe, base: "100g" }, prices: { NO: "49,90", DE: "4,35" } });
      expect(flat(lines[0].text)).toBe("Unit price in Norway (NOK): 19,96 kr/100 g");
      expect(lines[1].text).toContain("€/kg");
    } finally {
      restore();
    }
  });

  it("says why nothing is shown: the same as the price, free", () => {
    const one = contentPreviews({ ...base, content: { amount: "1", unit: "kg", base: null }, prices: { NO: "49,90" } });
    expect(one).toEqual([{ market: "Norway", shown: false, text: "Not shown in Norway: the unit price is the same as the price." }]);
    expect(contentPreviews({ ...base, content: kaffe, prices: { NO: "0" } })[0].text).toBe("Not shown in Norway: the price is 0.");
  });

  it("types a business-only store's price without VAT and shows the unit price without VAT", () => {
    // 39,92 without 25 % VAT is kept as 49,90 with it; shown without VAT, 39,92 for 250 g is 159,68 per kg.
    const [line] = contentPreviews({ ...base, audience: "businesses", content: kaffe, prices: { NO: "39,92" } });
    expect(flat(line.text)).toBe("Unit price in Norway (NOK): 159,68 kr/kg excl. VAT");
  });

  it("shows both for a store selling to both", () => {
    const [line] = contentPreviews({ ...base, audience: "both", content: kaffe, prices: { NO: "49,90" } });
    expect(flat(line.text)).toBe("Unit price in Norway (NOK): 199,60 kr/kg incl. VAT, 159,68 kr/kg excl. VAT");
  });

  it("takes the product's VAT category for a business-only store", () => {
    // Food in Norway: 15 %. 39,92 typed without VAT is kept as 45,91 (rounded), shown without VAT again as 39,92.
    const [line] = contentPreviews({ ...base, audience: "businesses", vatCategory: "food", content: kaffe, prices: { NO: "39,92" } });
    expect(flat(line.text)).toContain("159,68 kr/kg excl. VAT");
  });

  it("converts cl and works for a piece", () => {
    const [cl] = contentPreviews({ ...base, content: { amount: "33", unit: "cl", base: null }, prices: { NO: "19,99" } });
    expect(flat(cl.text)).toBe("Unit price in Norway (NOK): 60,58 kr/l");
    const [piece] = contentPreviews({ ...base, content: { amount: "6", unit: "piece", base: null }, prices: { NO: "12,50" } });
    expect(flat(piece.text)).toBe("Unit price in Norway (NOK): 2,08 kr/piece");
  });
});

describe("what a content can be compared per", () => {
  it("offers only the usual base while no market may show the small one", () => {
    expect(compareChoices("g", ["NO", "SE", "DK", "DE"])).toEqual([{ value: null, label: "1 kg (usual)" }]);
    expect(compareChoices("cl", ["NO"]).map((c) => c.label)).toEqual(["1 l (usual)"]);
    expect(compareChoices("g", [])).toEqual([{ value: null, label: "1 kg (usual)" }]);
  });

  it("offers the small base for a mass or a volume only when a market's country allows it", () => {
    const restore = allowSmallBase("ZZ");
    try {
      expect(compareChoices("g", ["NO", "ZZ"])).toEqual([
        { value: null, label: "1 kg (usual)" },
        { value: "100g", label: "100 g" },
      ]);
      expect(compareChoices("cl", ["ZZ"]).map((c) => c.label)).toEqual(["1 l (usual)", "100 ml"]);
    } finally {
      restore();
    }
  });

  it("keeps an already chosen small base visible, and says it is not shown", () => {
    expect(compareChoices("g", ["NO"], "100g")).toEqual([
      { value: null, label: "1 kg (usual)" },
      { value: "100g", label: "100 g (not shown in your markets: they compare per kg)" },
    ]);
  });

  it("offers one base for lengths, areas and pieces", () => {
    const restore = allowSmallBase("ZZ");
    try {
      expect(compareChoices("m", ["ZZ"])).toEqual([{ value: null, label: "1 m (usual)" }]);
      expect(compareChoices("m2", ["ZZ"])).toEqual([{ value: null, label: "1 m² (usual)" }]);
      expect(compareChoices("piece", ["ZZ"])).toEqual([{ value: null, label: "1 piece (usual)" }]);
    } finally {
      restore();
    }
  });

  it("keeps a choice across units of the same kind and drops one that no longer compares them", () => {
    expect(baseAfterUnitChange("kg", "100g")).toBe("100g");
    expect(baseAfterUnitChange("ml", "100g")).toBeNull();
    expect(baseAfterUnitChange("l", "100ml")).toBe("100ml");
    expect(baseAfterUnitChange("m", "100ml")).toBeNull();
    expect(baseAfterUnitChange("g", null)).toBeNull();
  });

  it("lists the nine units with m² written as the shopper reads it", () => {
    expect(CONTENT_UNITS.map((u) => u.value)).toEqual(["g", "kg", "ml", "cl", "l", "cm", "m", "m2", "piece"]);
    expect(unitLabel("m2")).toBe("m²");
  });
});

describe("the pack helper", () => {
  it("multiplies the content of one item", () => {
    expect(packTotal("6", "33")).toBe("198");
    expect(packTotal(12, "0,5")).toBe("6");
    expect(packTotal("3", "0.3333")).toBe("0.9999");
  });
  it("refuses what it cannot multiply", () => {
    expect(packTotal("0", "33")).toBeNull();
    expect(packTotal("1.5", "33")).toBeNull();
    expect(packTotal(String(PACK_COUNT_MAX + 1), "33")).toBeNull();
    expect(packTotal("6", "")).toBeNull();
    expect(packTotal("6", "abc")).toBeNull();
    expect(packTotal("1000", "999999")).toBeNull();
  });
  it("reads what is typed as a measure, or nothing", () => {
    expect(typedMeasure({ amount: "0,75", unit: "l" })).toEqual({ amount: "0.75", unit: "l" });
    expect(typedMeasure({ amount: "", unit: "l" })).toBeNull();
    expect(typedMeasure({ amount: "1", unit: "oz" })).toBeNull();
    expect(typedMeasure(null)).toBeNull();
  });
});

const term = (id: string, name: string, parentId: string | null, requiresUnitPrice = false, kind: "category" | "tag" = "category"): Term => ({
  id,
  kind,
  name,
  slug: name.toLowerCase(),
  parentId,
  requiresUnitPrice,
});
const terms = [term("food", "Food", null, true), term("coffee", "Coffee", "food"), term("gifts", "Gifts", null), term("t1", "Vegan", null, false, "tag")];

describe("the product's categories and what they ask for", () => {
  it("walks up to every ancestor, so a mark on a parent applies to its subcategories", () => {
    expect(categoryChain(terms, ["coffee"]).map((c) => [c.name, c.requiresUnitPrice]).sort()).toEqual([
      ["Coffee", false],
      ["Food", true],
    ]);
    expect(categoryChain(terms, ["gifts"])).toEqual([{ name: "Gifts", requiresUnitPrice: false }]);
  });
  it("leaves out tags and unknown ids", () => {
    expect(categoryChain(terms, ["t1", "nope"])).toEqual([]);
  });
});

const product = (change: Partial<ProductInput> = {}): ProductInput =>
  ({
    ...productInput.parse({
      handle: "kaffe",
      status: "draft",
      translations: [{ locale: "nb", title: "Kaffe", description: "", safetyInformation: "" }],
      media: [],
      options: [],
      variants: [{ id: null, options: {}, sku: "KAFFE-250", gtin: "", prices: { NO: "49,90" }, stock: 3, active: true, weightGrams: null, hsCode: "", originCountry: "" }],
      taxCode: "txcd_99999999",
      withdrawalExclusion: "none",
      schemes: [],
      manufacturer: null,
      responsiblePerson: null,
    }),
    ...change,
  }) as ProductInput;

describe("what the editor says about a product", () => {
  it("needs nothing and nudges only a food product with no content", () => {
    expect(contentState(product(), terms, "nb")).toEqual({ need: { required: false }, problems: [], pending: [], nudge: null });
    const food = contentState(product({ vatCategory: "food" }), terms, "nb");
    expect(food.nudge).toBe("Food is usually sold with a price per kg or litre. Add the content of each variant.");
    expect(food.problems).toEqual([]);
  });

  it("gives no nudge once a variant has content", () => {
    const given = product({ vatCategory: "food" });
    given.variants[0] = { ...given.variants[0], measure: kaffe };
    expect(contentState(given, terms, "nb").nudge).toBeNull();
  });

  it("is required by the flag, with the sentence a refusal would give, once the product is active", () => {
    const flagged = contentState(product({ soldByMeasure: true, status: "active" }), terms, "nb");
    expect(flagged.need).toEqual({ required: true, reason: "flag" });
    expect(flagged.nudge).toBeNull();
    expect(flagged.problems.map((p) => p.message)).toEqual([
      "Add the content of Kaffe Default (SKU KAFFE-250): this product needs a price per kg or litre because it is sold by measure.",
    ]);
  });

  it("is required by a marked category or its ancestor, and names it", () => {
    const state = contentState(product({ categories: ["coffee"], status: "active" }), terms, "nb");
    expect(state.need).toEqual({ required: true, reason: "category", category: "Food" });
    expect(state.problems[0].message).toContain("its category Food is marked as needing one");
    expect(needWords(state.need)).toBe("Its category Food needs a price per kg or litre: every variant that is for sale and shipped needs its content.");
  });

  it("lets a draft be incomplete, and says what it will need once published", () => {
    const draft = contentState(product({ soldByMeasure: true, status: "draft" }), terms, "nb");
    expect(draft.problems).toEqual([]);
    expect(draft.pending.map((p) => p.sku)).toEqual(["KAFFE-250"]);
    expect(contentState(product({ soldByMeasure: true, status: "active" }), terms, "nb").pending).toEqual([]);
  });

  it("lets an inactive or digital variant go without", () => {
    const off = product({ soldByMeasure: true, status: "active" });
    off.variants[0] = { ...off.variants[0], active: false };
    expect(contentState(off, terms, "nb").problems).toEqual([]);
    const digital = product({ soldByMeasure: true, status: "active" });
    digital.variants[0] = { ...digital.variants[0], delivery: "digital" };
    expect(contentState(digital, terms, "nb").problems).toEqual([]);
  });

  it("is satisfied by a typed content, and an empty one does not count", () => {
    const given = product({ soldByMeasure: true, status: "active" });
    given.variants[0] = { ...given.variants[0], measure: kaffe };
    expect(contentState(given, terms, "nb").problems).toEqual([]);
    given.variants[0] = { ...given.variants[0], measure: { amount: "", unit: "g", base: null } };
    expect(contentState(given, terms, "nb").problems).toHaveLength(1);
  });

  it("names a variant by the product's title in the store's main language", () => {
    expect(editorFacts(product(), terms, "nb").variants[0].title).toBe("Kaffe Default");
    expect(editorFacts(product(), terms, "sv").variants[0].title).toBe("kaffe Default");
  });

  it("says nothing of an appointment", () => {
    expect(needWords({ required: false })).toBeNull();
  });
});

describe("taking content away where it cannot be", () => {
  const variants = [
    { delivery: "physical", measure: { amount: "1", unit: "kg", base: null } },
    { delivery: "digital", measure: { amount: "1", unit: "kg", base: null } },
    { delivery: "physical", measure: null },
  ];
  it("keeps the variants of shipped goods and drops the rest", () => {
    const out = withoutContentWhereNotGoods("goods", variants);
    expect(out.map((v) => v.measure !== null)).toEqual([true, false, false]);
  });
  it("drops all content when the product is not goods", () => {
    expect(withoutContentWhereNotGoods("stay", variants).every((v) => v.measure === null)).toBe(true);
  });
  it("returns the same array when nothing changes", () => {
    const fine = [variants[0], variants[2]];
    expect(withoutContentWhereNotGoods("goods", fine)).toBe(fine);
  });
});

describe("words for the categories screen and the products page", () => {
  it("counts products", () => {
    expect(categoryGapWords(0)).toBe("Every active product in this category has its content.");
    expect(categoryGapWords(1)).toBe("1 active product in this category has no content yet.");
    expect(categoryGapWords(7)).toBe("7 active products in this category have no content yet.");
    expect(needsContentNotice(1)).toBe("1 active product still needs its content for the price per kg or litre.");
    expect(needsContentNotice(3)).toBe("3 active products still need their content for the price per kg or litre.");
  });
});
