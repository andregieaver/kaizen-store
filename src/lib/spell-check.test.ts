import { describe, expect, it } from "vitest";
import { fieldLang, holdsWords, spellLang, type SpellField } from "./spell-check";

const field = (over: Partial<SpellField>): SpellField => ({
  tag: "input",
  type: "",
  spellcheck: null,
  editableHost: false,
  readOnly: false,
  disabled: false,
  inputMode: "",
  lang: null,
  langOurs: false,
  ...over,
});

describe("holdsWords", () => {
  it("checks text areas, text inputs and editable content", () => {
    expect(holdsWords(field({ tag: "textarea" }))).toBe(true);
    expect(holdsWords(field({}))).toBe(true);
    expect(holdsWords(field({ type: "text" }))).toBe(true);
    expect(holdsWords(field({ type: "Search" }))).toBe(true);
    expect(holdsWords(field({ tag: "div", editableHost: true }))).toBe(true);
    expect(holdsWords(field({ tag: "h2", editableHost: true }))).toBe(true);
  });

  it("leaves out fields that are not words", () => {
    for (const type of ["url", "email", "number", "color", "range", "checkbox", "password", "tel"]) {
      expect(holdsWords(field({ type }))).toBe(false);
    }
    expect(holdsWords(field({ inputMode: "numeric" }))).toBe(false);
    expect(holdsWords(field({ tag: "button" }))).toBe(false);
    expect(holdsWords(field({ tag: "div" }))).toBe(false);
  });

  it("keeps to a field's own spellCheck={false} (CSS, HTML, code)", () => {
    expect(holdsWords(field({ tag: "textarea", spellcheck: "false" }))).toBe(false);
    expect(holdsWords(field({ spellcheck: "FALSE" }))).toBe(false);
    expect(holdsWords(field({ spellcheck: "true" }))).toBe(true);
  });

  it("leaves out read-only and disabled fields", () => {
    expect(holdsWords(field({ readOnly: true }))).toBe(false);
    expect(holdsWords(field({ tag: "textarea", disabled: true }))).toBe(false);
  });
});

describe("fieldLang", () => {
  it("gives the version's language", () => {
    expect(fieldLang(field({}), "nb-NO")).toBe("nb-NO");
    expect(fieldLang(field({}), "de")).toBe("de");
  });

  it("follows a change of version on a field it marked before", () => {
    expect(fieldLang(field({ lang: "nb-NO", langOurs: true }), "sv-SE")).toBe("sv-SE");
    expect(fieldLang(field({ lang: "sv-SE", langOurs: true }), "sv-SE")).toBeNull();
  });

  it("leaves a field that names its own language", () => {
    expect(fieldLang(field({ lang: "en" }), "nb-NO")).toBeNull();
  });

  it("leaves the inherited language without a version's", () => {
    expect(fieldLang(field({}), undefined)).toBeNull();
    expect(fieldLang(field({}), "")).toBeNull();
    expect(fieldLang(field({}), "not a language")).toBeNull();
  });
});

describe("spellLang", () => {
  it("writes tags as dictionaries name them", () => {
    expect(spellLang("nb-no")).toBe("nb-NO");
    expect(spellLang("en_GB")).toBe("en-GB");
    expect(spellLang("sr-latn-rs")).toBe("sr-Latn-RS");
    expect(spellLang("es-419")).toBe("es-419");
    expect(spellLang(" FI ")).toBe("fi");
  });

  it("refuses what is not a tag", () => {
    expect(spellLang("")).toBeNull();
    expect(spellLang(null)).toBeNull();
    expect(spellLang("english")).toBeNull();
    expect(spellLang("en-")).toBeNull();
    expect(spellLang("en-\"x\"")).toBeNull();
  });
});
