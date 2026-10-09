import { describe, expect, it } from "vitest";

import { fitsItem, globalKey, isLegalPage, menuUnit, productUnits, returnInstructionsUnit, RETURN_INSTRUCTIONS_UNIT, SCOPE_WORDS, TERM_FIELDS, TRANSLATE_SCOPES, termUnit, unitItems, type ProductTexts } from "./store-translate";
import { MAX_INSTRUCTIONS } from "./withdrawal";

const source: ProductTexts = { title: "Keramikkopp", description: "En kopp.", safetyInformation: "Ikke for barn.", seoTitle: "", seoDescription: "", excerpt: "" };
const none: ProductTexts = { title: "", description: "", safetyInformation: "", seoTitle: "", seoDescription: "", excerpt: "" };

describe("a product's units", () => {
  it("take the texts with words, and the safety information apart as a legal unit", () => {
    const units = productUnits("p1", source, null, "missing");
    expect(units.map((u) => [u.id, u.legal])).toEqual([["product:p1", false], ["product:p1:legal", true]]);
    expect(units[0].items.map((i) => i.key)).toEqual(["title", "description"]);
    expect(units[1].items.map((i) => i.key)).toEqual(["safetyInformation"]);
  });

  it("leave out what the language has, unless everything is asked for again", () => {
    const target = { ...none, title: "Cup", safetyInformation: "Not for children." };
    expect(productUnits("p1", source, target, "missing").flatMap((u) => u.items.map((i) => i.key))).toEqual(["description"]);
    expect(productUnits("p1", source, target, "all").flatMap((u) => u.items.map((i) => i.key))).toEqual(["title", "description", "safetyInformation"]);
    expect(productUnits("p1", none, null, "all")).toEqual([]);
  });
});

describe("a menu link's unit", () => {
  it("needs a text of the owner's own in the main language", () => {
    expect(menuUnit("m", "Main", 0, {}, "nb-NO", "en-GB", "missing")).toBeNull();
    expect(menuUnit("m", "Main", 0, { "nb-NO": "Butikk" }, "nb-NO", "en-GB", "missing")?.id).toBe("menu:m:0");
    expect(menuUnit("m", "Main", 0, { "nb-NO": "Butikk", "en-GB": "Shop" }, "nb-NO", "en-GB", "missing")).toBeNull();
    expect(menuUnit("m", "Main", 0, { "nb-NO": "Butikk", "en-GB": "Shop" }, "nb-NO", "en-GB", "all")).not.toBeNull();
  });
});

describe("legal pages", () => {
  it("are told by address or title, in the languages a store writes in", () => {
    for (const [slug, title] of [["vilkar", "Kjøpsvilkår"], ["privacy", "x"], ["x", "Personvernerklæring"], ["angrerett", "x"], ["x", "Terms and conditions"], ["x", "Integritetspolicy"]]) {
      expect(isLegalPage(slug, title), `${slug} ${title}`).toBe(true);
    }
    expect(isLegalPage("om-oss", "Om oss")).toBe(false);
  });

  it("includes the shipping policy and the accessibility statement, by words in four languages", () => {
    for (const [slug, title] of [["frakt", "x"], ["x", "Leveranse og frakt"], ["x", "Leveransvillkor"], ["x", "Forsendelse"], ["x", "Shipping policy"], ["x", "Tilgjengelighetserklæring"], ["x", "Tillgänglighetsredogörelse"], ["x", "Tilgængelighedserklæring"], ["accessibility", "x"]]) {
      expect(isLegalPage(slug, title), `${slug} ${title}`).toBe(true);
    }
  });

  it("is any page the store chose for a legal role, whatever it is called", () => {
    expect(isLegalPage("lars-sine-regler", "Lars' regler")).toBe(false);
    expect(isLegalPage("lars-sine-regler", "Lars' regler", true)).toBe(true);
  });
});

describe("what comes back", () => {
  const plain = { key: "title", label: "Title", max: 10, rich: false, runs: ["Kopp"] };
  const rich = { key: "doc", label: "Text", max: 0, rich: true, runs: ["a", "b"] };

  it("is checked for shape and length", () => {
    expect(fitsItem(plain, "Cup")).toBe(true);
    expect(fitsItem(plain, "A far too long title")).toBe(false);
    expect(fitsItem(plain, "  ")).toBe(false);
    expect(fitsItem(plain, ["Cup"])).toBe(false);
    expect(fitsItem(rich, ["x", "y"])).toBe(true);
    expect(fitsItem(rich, ["x"])).toBe(false);
    expect(fitsItem(rich, "xy")).toBe(false);
  });

  it("keeps each text's unit in its key", () => {
    const [unit] = productUnits("p1", source, null, "all");
    expect(unitItems([unit])[0].key).toBe(globalKey("product:p1", "title"));
    expect(unitItems([unit])[0].label).toContain("Keramikkopp");
  });
});

describe("the return instructions' unit (D153)", () => {
  it("is a scope of its own, with words for the review page", () => {
    expect(TRANSLATE_SCOPES).toContain("returns");
    expect(SCOPE_WORDS.returns.name).toBe("Return instructions");
  });

  it("is one legal unit with one text, as long as the instructions may be", () => {
    const unit = returnInstructionsUnit("Pakk godt.", null, "missing")!;
    expect(unit).toMatchObject({ id: RETURN_INSTRUCTIONS_UNIT, scope: "returns", legal: true });
    expect(unit.items).toEqual([{ key: "instructions", label: "Instructions", max: MAX_INSTRUCTIONS, rich: false, runs: ["Pakk godt."] }]);
  });

  it("is left out when there are no instructions, or the language has them and only what is missing is asked for", () => {
    expect(returnInstructionsUnit("", null, "all")).toBeNull();
    expect(returnInstructionsUnit("   ", null, "missing")).toBeNull();
    expect(returnInstructionsUnit("Pakk godt.", "Pack well.", "missing")).toBeNull();
    expect(returnInstructionsUnit("Pakk godt.", "  ", "missing")).not.toBeNull();
    expect(returnInstructionsUnit("Pakk godt.", "Pack well.", "all")).not.toBeNull();
  });
});

describe("categories and tags (wave 2, D168)", () => {
  const sv = { title: "Hem och inredning", description: "Allt för hemmet." };

  it("are a scope of their own, and never a legal text", () => {
    expect(TRANSLATE_SCOPES).toContain("terms");
    expect(SCOPE_WORDS.terms).toEqual({ name: "Categories and tags", one: "Category or tag" });
    expect(TERM_FIELDS.map((f) => [f.key, f.max])).toEqual([["title", 120], ["description", 320]]);
    expect(termUnit("t1", "Hem", "category", sv, null, "missing")?.legal).toBe(false);
  });

  it("list a term whose main-language text exists and the language has none", () => {
    const unit = termUnit("t1", "Hem", "category", sv, null, "missing")!;
    expect(unit).toMatchObject({ id: "term:t1", scope: "terms", title: "Hem", kind: "Category" });
    expect(unit.items).toEqual([
      { key: "title", label: "Search title", max: 120, rich: false, runs: ["Hem och inredning"] },
      { key: "description", label: "Search description", max: 320, rich: false, runs: ["Allt för hemmet."] },
    ]);
    expect(termUnit("t2", "Rea", "tag", sv, null, "all")?.kind).toBe("Tag");
  });

  it("do not list a term with no main-language text, or one the language has already (unless all is asked for)", () => {
    expect(termUnit("t1", "Hem", "category", null, null, "all")).toBeNull();
    expect(termUnit("t1", "Hem", "category", { title: "", description: " " }, null, "all")).toBeNull();
    expect(termUnit("t1", "Hem", "category", sv, { title: "Home", description: "All for the home." }, "missing")).toBeNull();
    expect(termUnit("t1", "Hem", "category", sv, { title: "Home", description: "All for the home." }, "all")).not.toBeNull();
  });

  it("ask only for the text the language lacks, and only for the texts the main language has", () => {
    const partial = termUnit("t1", "Hem", "category", sv, { title: "Home", description: "" }, "missing")!;
    expect(partial.items.map((i) => i.key)).toEqual(["description"]);
    const titleOnly = termUnit("t1", "Hem", "category", { title: "Hem", description: "" }, null, "missing")!;
    expect(titleOnly.items.map((i) => i.key)).toEqual(["title"]);
  });
});
