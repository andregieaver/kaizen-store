import { describe, expect, it } from "vitest";

import { DESCRIPTION_MAX, TITLE_MAX } from "./seo";
import { termInput } from "./taxonomy";
import { compactSeo, hasTermSeo, parseTermSeo, termMetaDescription, termMetaTitle, termSeoFor, termSeoInput, termShare, type TermSeo } from "./term-seo";

const LOCALES = ["nb-NO", "sv-SE", "en"];
const seo: TermSeo = {
  "sv-SE": { title: "Hem och inredning", description: "Allt för hemmet." },
  "nb-NO": { title: "", description: "Alt til hjemmet." },
};

describe("a term's search texts", () => {
  const schema = termSeoInput(LOCALES);

  it("are a title and a description for each language the store offers", () => {
    expect(schema.parse({ "sv-SE": { title: " Hem ", description: " Mer " } })).toEqual({ "sv-SE": { title: "Hem", description: "Mer" } });
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ en: { title: "Home" } })).toEqual({ en: { title: "Home", description: "" } });
  });

  it("refuse a language the store does not offer, with the language named", () => {
    const result = schema.safeParse({ "de-DE": { title: "Zuhause", description: "" } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["de-DE"] });
    expect(result.error?.issues[0].message).toContain("de-DE");
    // An empty list of languages offers none.
    expect(termSeoInput([]).safeParse({ en: { title: "x", description: "" } }).success).toBe(false);
  });

  it("hold the limits: 120 for the title, 320 for the description", () => {
    expect([TITLE_MAX, DESCRIPTION_MAX]).toEqual([120, 320]);
    expect(schema.safeParse({ en: { title: "a".repeat(120), description: "b".repeat(320) } }).success).toBe(true);
    const long = schema.safeParse({ en: { title: "a".repeat(121), description: "" } });
    expect(long.success).toBe(false);
    expect(long.error?.issues[0].message).toMatch(/title under 120/);
    expect(schema.safeParse({ en: { title: "", description: "b".repeat(321) } }).success).toBe(false);
  });

  it("remove a language whose title and description are both empty", () => {
    expect(schema.parse({ en: { title: "  ", description: "" }, "sv-SE": { title: "Hem", description: "" } })).toEqual({ "sv-SE": { title: "Hem", description: "" } });
    expect(compactSeo({ en: { title: "", description: "" }, nb: { title: "x", description: "" } })).toEqual({ nb: { title: "x", description: "" } });
  });

  it("are read leniently from what is stored: a malformed entry is dropped, never thrown", () => {
    expect(parseTermSeo(seo)).toEqual({ "sv-SE": seo["sv-SE"], "nb-NO": seo["nb-NO"] });
    expect(parseTermSeo({ en: "text", "nb-NO": { title: 5 }, de: { title: "ok", description: "" }, x: { title: "", description: "" } })).toEqual({ de: { title: "ok", description: "" } });
    for (const junk of [null, undefined, [], "x", 5]) expect(parseTermSeo(junk)).toEqual({});
  });

  it("are checked in the shared term schema as a shape, and an omitted one is left out (keeps what is there)", () => {
    const base = { kind: "category" as const, name: "Home", slug: "", parentId: null };
    expect(termInput.parse(base)).not.toHaveProperty("seo");
    expect(termInput.parse({ ...base, seo: { en: { title: "Home", description: "" } } }).seo).toEqual({ en: { title: "Home", description: "" } });
    expect(termInput.safeParse({ ...base, seo: { en: { title: "a".repeat(121), description: "" } } }).success).toBe(false);
  });
});

describe("what a page in a language gets", () => {
  it("is that language's text, and never another's", () => {
    expect(termSeoFor(seo, "sv-SE")).toEqual(seo["sv-SE"]);
    expect(termSeoFor(seo, "nb-NO")).toEqual(seo["nb-NO"]);
    expect(termSeoFor(seo, "da-DK")).toBeNull();
    expect(termSeoFor(seo, "sv")).toBeNull();
    expect(termSeoFor({}, "en")).toBeNull();
    expect(termSeoFor(undefined, "en")).toBeNull();
    // Inherited names are not languages.
    expect(termSeoFor({}, "constructor")).toBeNull();
    expect(termSeoFor({}, "__proto__")).toBeNull();
  });

  it("gives the title as written (absolute: no store name added), or `Name · Store` when the language has none", () => {
    expect(termMetaTitle({ name: "Hem", seo }, "sv-SE", "Demo")).toEqual({ absolute: "Hem och inredning" });
    expect(termMetaTitle({ name: "Hjem", seo }, "nb-NO", "Demo")).toBe("Hjem · Demo");
    expect(termMetaTitle({ name: "Hjem", seo }, "da-DK", "Demo")).toBe("Hjem · Demo");
    expect(termMetaTitle({ name: "Hjem" }, "da-DK", "Demo")).toBe("Hjem · Demo");
  });

  it("gives the description of the language, or the store's own", () => {
    expect(termMetaDescription({ seo }, "sv-SE", "Butiken")).toBe("Allt för hemmet.");
    expect(termMetaDescription({ seo }, "nb-NO", "Butikken")).toBe("Alt til hjemmet.");
    expect(termMetaDescription({ seo }, "da-DK", "Butikken")).toBe("Butikken");
    expect(termMetaDescription({}, "en", "Shop")).toBe("Shop");
  });

  it("gives the share tags the same words, and the name when there is no title", () => {
    expect(termShare({ name: "Hem", seo }, "sv-SE", "Butiken")).toEqual({ title: "Hem och inredning", description: "Allt för hemmet." });
    expect(termShare({ name: "Hjem", seo }, "nb-NO", "Butikken")).toEqual({ title: "Hjem", description: "Alt til hjemmet." });
    expect(termShare({ name: "Hjem", seo }, "da-DK", "Butikken")).toEqual({ title: "Hjem", description: "Butikken" });
  });

  it("is marked in the editor when any language has a text", () => {
    expect(hasTermSeo(seo)).toBe(true);
    expect(hasTermSeo({ en: { title: "", description: "" } })).toBe(false);
    expect(hasTermSeo({})).toBe(false);
    expect(hasTermSeo(undefined)).toBe(false);
  });
});
