import { describe, expect, it } from "vitest";

import { formatTemplate, parseTemplate, pluralForms, templateArguments, templateProblem, TemplateError } from "./icu-lite";

describe("formatting", () => {
  it("puts arguments in by position", () => {
    expect(formatTemplate("Order {1} from {0}", ["Kaizen", "S1-42"], "en")).toBe("Order S1-42 from Kaizen");
    expect(formatTemplate("No placeholders", [], "en")).toBe("No placeholders");
    expect(formatTemplate("{0} and {0}", ["a"], "en")).toBe("a and a");
  });

  it("chooses a plural form by the language's own rules, with # the number", () => {
    const en = "{0, plural, one {# day} other {# days}}";
    expect(formatTemplate(en, [1], "en")).toBe("1 day");
    expect(formatTemplate(en, [5], "en")).toBe("5 days");
    const pl = "{0, plural, one {# dzień} few {# dni} many {# dni} other {# dnia}}";
    expect([1, 2, 5, 22, 1.5].map((n) => formatTemplate(pl, [n], "pl"))).toEqual(["1 dzień", "2 dni", "5 dni", "22 dni", "1.5 dnia"]);
    expect(formatTemplate("{0, plural, =0 {none} one {# item} other {# items}}", [0], "en")).toBe("none");
  });

  it("selects by the argument's text, and nests", () => {
    const t = "{0, select, true {per stay} other {per rental}}";
    expect(formatTemplate(t, [true], "en")).toBe("per stay");
    expect(formatTemplate(t, [false], "en")).toBe("per rental");
    const nested = "{0, select, y {{1, plural, one {# year} other {# years}}} other {{1, plural, one {# day} other {# days}}}}";
    expect(formatTemplate(nested, ["y", 2], "en")).toBe("2 years");
    expect(formatTemplate(nested, ["d", 1], "en")).toBe("1 day");
  });

  it("leaves # alone outside a plural, and refuses what it cannot read", () => {
    expect(formatTemplate("Order #{0}", ["12"], "en")).toBe("Order #12");
    expect(() => parseTemplate("{0")).toThrow(TemplateError);
    expect(() => parseTemplate("a } b")).toThrow(TemplateError);
    expect(() => parseTemplate("{name}")).toThrow(TemplateError);
    expect(() => parseTemplate("{0, plural, one {x}}")).toThrow(TemplateError);
  });

  it("lists the arguments a template uses", () => {
    expect(templateArguments("{2} {0, plural, one {# a} other {{1} b}}")).toEqual([0, 1, 2]);
  });
});

describe("checking a translation", () => {
  const source = "{0, plural, one {# day} other {# days}} from {1}";
  it("accepts one with the same arguments in the language's own forms", () => {
    expect(templateProblem(source, "{0, plural, one {# dzień} few {# dni} many {# dni} other {# dnia}} od {1}", "pl")).toBeNull();
  });
  it("refuses a different set of arguments, a missing choice, or a form the language lacks", () => {
    expect(templateProblem(source, "{0, plural, one {# Tag} other {# Tage}}", "de")).toMatch(/placeholders/);
    expect(templateProblem(source, "{0} Tage von {1}", "de")).toMatch(/choose on/);
    expect(templateProblem(source, "{0, plural, one {#} few {#} other {#}} von {1}", "de")).toMatch(/not a plural form/);
    expect(templateProblem("{0, select, true {a} other {b}}", "{0, select, other {b}}", "de")).toMatch(/option "true"/);
    expect(templateProblem("Hello {0}", "Hallo {0", "de")).toMatch(/never closed/);
    expect(templateProblem("Hello {0}", "  ", "de")).toMatch(/empty/);
    expect(templateProblem("Hello {0}", "Hallo {1}", "de")).toMatch(/placeholders/);
  });
  it("names a language's plural forms", () => {
    expect(pluralForms("de")).toEqual(["one", "other"]);
    expect(pluralForms("pl")).toEqual(expect.arrayContaining(["one", "few", "many", "other"]));
  });
});
