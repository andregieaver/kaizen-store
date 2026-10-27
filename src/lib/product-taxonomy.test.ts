import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ancestry,
  categoryAttributes,
  categoryFromCell,
  categoryPath,
  googleCategory,
  keepForCategory,
  pathIndex,
  searchCategories,
  searchIndex,
  sortedAttributes,
  standardProblems,
  taxonomyLang,
  TAXONOMY_LANGS,
  type TaxonomyNames,
  type TaxonomyStructure,
  type TaxonomyWords,
} from "./product-taxonomy";

/**
 * The standard product taxonomy's rules (wave 6 unit I, D327), on a small taxonomy of their own, and the release kept in
 * `src/data/product-taxonomy/` held to its own shape: every category's attributes and every attribute's values exist, every id has a name
 * in every language kept, and the licence's notice is there.
 */

const T: TaxonomyStructure = {
  release: "test",
  commit: "0",
  label: "test",
  google: "2021-09-21",
  categories: {
    aa: [166, [1]],
    "aa-1": [1604, [1, 3]],
    "aa-1-1": [212, [1, 3, 9], { "9": "sleeve-length-type" }],
    hg: [0, []],
    "hg-1": [734, [1]],
  },
  attributes: { "1": ["color", [10, 11, 12]], "3": ["pattern", [30, 31]], "9": ["sleeve-length", [90, 91]] },
  values: { "10": "black", "11": "blue", "12": "red", "30": "striped", "31": "plain", "90": "short", "91": "long" },
};
const EN: TaxonomyNames = {
  c: { aa: "Apparel & Accessories", "aa-1": "Clothing", "aa-1-1": "T-Shirts", hg: "Home & Garden", "hg-1": "Coffee Grinders" },
  a: { "1": "Color", "3": "Pattern", "9": "Sleeve length" },
  x: { "sleeve-length-type": "Sleeve length type" },
  v: { "10": "Black", "11": "Blue", "12": "Red", "30": "Striped", "31": "Plain", "90": "Short", "91": "Long" },
};
const NB: TaxonomyNames = { c: { aa: "Klær og tilbehør", "aa-1": "Klesplagg", "aa-1-1": "T-skjorter" }, a: { "1": "Farge" }, x: {}, v: { "10": "Svart" } };
const en: TaxonomyWords = { lang: "en", own: EN, english: EN };
const nb: TaxonomyWords = { lang: "nb", own: NB, english: EN };

describe("the taxonomy's rules", () => {
  it("reads a category's ancestors from its id and names its path, in a language with English where it has none", () => {
    expect(ancestry("aa-1-1")).toEqual(["aa", "aa-1", "aa-1-1"]);
    expect(categoryPath(en, "aa-1-1")).toBe("Apparel & Accessories > Clothing > T-Shirts");
    expect(categoryPath(nb, "aa-1-1")).toBe("Klær og tilbehør > Klesplagg > T-skjorter");
    expect(categoryPath(nb, "hg-1")).toBe("Home & Garden > Coffee Grinders");
    expect(googleCategory(T, "aa-1-1")).toBe(212);
    expect(googleCategory(T, "hg")).toBeNull();
  });

  it("finds categories by every word typed, in the language or in English, the leaf's own name first", () => {
    const index = searchIndex(T, nb);
    expect(searchCategories(index, "t-skjorte").map((h) => h.id)).toEqual(["aa-1-1"]);
    expect(searchCategories(index, "shirts").map((h) => h.id)).toEqual(["aa-1-1"]);
    expect(searchCategories(index, "klesplagg")[0]).toEqual({ id: "aa-1", name: "Klesplagg", path: "Klær og tilbehør > Klesplagg" });
    expect(searchCategories(index, "coffee grinder")[0].id).toBe("hg-1");
    expect(searchCategories(index, "  ")).toEqual([]);
    expect(searchCategories(index, "submarine")).toEqual([]);
  });

  it("gives a category's attributes, an extended one under the category's own name", () => {
    const attributes = categoryAttributes(T, nb, "aa-1-1");
    expect(attributes.map((a) => [a.id, a.handle, a.name])).toEqual([
      [1, "color", "Farge"],
      [3, "pattern", "Pattern"],
      [9, "sleeve-length", "Sleeve length type"],
    ]);
    expect(attributes[0].values[0]).toEqual({ id: 10, handle: "black", name: "Svart" });
    expect(categoryAttributes(T, en, "zz")).toEqual([]);
  });

  it("checks a category and its attributes against the release", () => {
    expect(standardProblems(T, "aa-1-1", { "1": [10, 11], "9": [91] })).toEqual([]);
    expect(standardProblems(T, null, {})).toEqual([]);
    expect(standardProblems(T, null, { "1": [10] })[0]).toMatch(/before its attributes/);
    expect(standardProblems(T, "aa-9", {})[0]).toMatch(/not in the taxonomy/);
    expect(standardProblems(T, "aa-1", { "9": [90] })[0]).toMatch(/not one of this category's/);
    expect(standardProblems(T, "aa-1", { "1": [30] })[0]).toMatch(/Value 30 is not one of attribute 1's/);
    expect(standardProblems(T, "aa-1", { "1": [] })[0]).toMatch(/has no value/);
    expect(standardProblems(T, "aa-1", { "1": [10, 10] })[0]).toMatch(/a value twice/);
  });

  it("keeps the attributes a new category also has, in a stable order", () => {
    expect(keepForCategory([1], { "1": [11], "3": [30] })).toEqual({ "1": [11] });
    expect(sortedAttributes({ "3": [31, 30], "1": [12, 10, 12], "9": [] })).toEqual({ "1": [10, 12], "3": [30, 31] });
  });

  it("reads Shopify's Product Category cell: a full English path, a gid or an id; anything else is unknown", () => {
    const paths = pathIndex(T, EN);
    expect(categoryFromCell(T, paths, "Apparel & Accessories > Clothing > T-Shirts")).toBe("aa-1-1");
    expect(categoryFromCell(T, paths, "apparel & accessories >clothing> t-shirts")).toBe("aa-1-1");
    expect(categoryFromCell(T, paths, "gid://shopify/TaxonomyCategory/hg-1")).toBe("hg-1");
    expect(categoryFromCell(T, paths, "aa-1")).toBe("aa-1");
    expect(categoryFromCell(T, paths, "gid://shopify/TaxonomyCategory/zz-1")).toBeNull();
    expect(categoryFromCell(T, paths, "Clothing")).toBeNull();
    expect(categoryFromCell(T, paths, "")).toBeNull();
  });

  it("speaks Norwegian, Swedish and Danish where the release does, English otherwise", () => {
    expect(["nb-NO", "no", "nn-NO", "sv-SE", "da-DK", "de-DE", "en"].map(taxonomyLang)).toEqual(["nb", "nb", "nb", "sv", "da", "en", "en"]);
  });
});

describe("the release kept in the repository", () => {
  const dir = path.join(process.cwd(), "src/data/product-taxonomy");
  const read = <X,>(file: string) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as X;
  const structure = read<TaxonomyStructure>("structure.json");

  it("is Shopify's release v2026-10, with its licence's notice", () => {
    expect(structure.release).toBe("v2026-10");
    expect(structure.google).toBe("2021-09-21");
    expect(readFileSync(path.join(dir, "LICENSE"), "utf8")).toMatch(/Copyright \(c\) Shopify[\s\S]*Permission is hereby granted, free of charge/);
    expect(Object.keys(structure.categories)).toHaveLength(14606);
  });

  it("holds together: every category's parent, attributes and extended names, every attribute's values, every name in every language", () => {
    for (const [id, [google, attributes, named]] of Object.entries(structure.categories)) {
      for (const step of ancestry(id)) expect(structure.categories[step], `${id}'s ancestor ${step}`).toBeDefined();
      expect(Number.isInteger(google)).toBe(true);
      for (const a of attributes) expect(structure.attributes[String(a)], `${id}'s attribute ${a}`).toBeDefined();
      for (const a of Object.keys(named ?? {})) expect(attributes).toContain(Number(a));
    }
    for (const [, values] of Object.values(structure.attributes)) for (const v of values) expect(structure.values[String(v)]).toBeDefined();
    for (const lang of TAXONOMY_LANGS) {
      const names = read<TaxonomyNames>(`names-${lang}.json`);
      expect(Object.keys(names.c).length, lang).toBe(Object.keys(structure.categories).length);
      expect(Object.keys(names.a).length, lang).toBe(Object.keys(structure.attributes).length);
      expect(Object.keys(names.v).length, lang).toBe(Object.keys(structure.values).length);
    }
  });

  it("maps a known category to Google's and names it in Norwegian", () => {
    const words: TaxonomyWords = { lang: "nb", own: read("names-nb.json"), english: read("names-en.json") };
    expect(categoryPath(words, "aa-1-1")).toBe("Klær og tilbehør > Klesplagg > Treningsklær");
    expect(googleCategory(structure, "aa-1-1")).toBe(5322);
    expect(categoryAttributes(structure, words, "aa-1-1")[0]).toMatchObject({ id: 1, handle: "color", name: "Farge" });
  });
});
