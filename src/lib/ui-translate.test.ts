import { describe, expect, it } from "vitest";

import { catalogOf } from "./ui-catalog";
import { fullCatalog } from "./ui-catalog-all";
import { batchEntries, entryProblem, readUiAnswer, textProblem, uiMessages } from "./ui-translate";

const catalog = fullCatalog();
const find = (key: string) => catalog.find((e) => e.key === key)!;

describe("checking a plain text", () => {
  it("keeps the named placeholders the site fills in, and has none of its own", () => {
    expect(textProblem("{left} of {seats} left", "{left} von {seats} übrig")).toBeNull();
    expect(textProblem("{left} of {seats} left", "übrig")).toMatch(/must keep/);
    expect(textProblem("Add to cart", "In den {0} legen")).toMatch(/placeholder/);
    expect(textProblem("Add to cart", " ")).toMatch(/empty/);
    expect(textProblem("Add to cart", "<b>In den Warenkorb</b>")).toMatch(/markup/);
    expect(textProblem("Add", "x".repeat(400))).toMatch(/longer/);
  });
});

describe("checking a message with arguments", () => {
  const nights = find("ui:stay.nights");
  it("takes the language's own plural forms", () => {
    expect(entryProblem(nights, "{0, plural, one {# Nacht} other {# Nächte}}", "de")).toBeNull();
    expect(entryProblem(nights, "{0, plural, one {# noc} few {# noce} many {# nocy} other {# nocy}}", "pl")).toBeNull();
    expect(entryProblem(nights, "# Nächte", "de")).toMatch(/placeholders/);
    expect(entryProblem(nights, "{0} Nächte", "de")).toMatch(/choose on/);
  });
});

describe("asking and reading", () => {
  const entries = [find("ui:stay.nights"), catalog.find((e) => e.kind === "text")!];
  it("asks in the language, with the plural forms it needs and each text by id", () => {
    const [system, user] = uiMessages({ name: "Polish", lang: "pl" }, entries);
    expect(system.content).toContain("into Polish");
    expect(system.content).toContain("few");
    expect(JSON.parse(user.content)[0]).toMatchObject({ id: "0", key: "stay.nights", en: entries[0].source });
  });

  it("uses what is right and reports what is not", () => {
    const { done, problems } = readUiAnswer({ "0": "{0, plural, one {# Nacht} other {# Nächte}}", "1": 5 }, entries, "de");
    expect([...done.keys()]).toEqual(["ui:stay.nights"]);
    expect(problems).toEqual([{ key: entries[1].key, problem: "The AI left it out." }]);
    expect(readUiAnswer("not an object", entries, "de").done.size).toBe(0);
  });

  it("groups entries into batches", () => {
    const batches = batchEntries(catalog);
    expect(batches.flat()).toHaveLength(catalog.length);
    expect(batches.every((b) => b.length <= 40)).toBe(true);
    expect(catalogOf("ui", {})).toEqual([]);
  });
});
