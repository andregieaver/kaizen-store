import { describe, expect, it } from "vitest";

import {
  applyChanges,
  emptyGroup,
  fieldGroupInput,
  newField,
  newRowId,
  parseFieldChanges,
  readField,
  type FieldData,
  type FieldDef,
  type FieldGroup,
} from "./custom-fields";
import {
  definitionItems,
  definitionUnit,
  FIELD_LABEL_MAX,
  valueChanges,
  valueItems,
  valueSlots,
  valueUnit,
  variantTitle,
  withDefinitionTexts,
} from "./field-translate";
import type { RichTextDoc } from "./page-content";
import { fitsItem } from "./store-translate";

const MAIN = "nb-NO";
const TO = "sv-SE";

const field = (type: FieldDef["type"], over: Partial<FieldDef> = {}): FieldDef => ({
  ...newField(type),
  access: "public",
  ...over,
});
const group = (fields: FieldDef[], over: Partial<FieldGroup> = {}): FieldGroup => ({
  id: crypto.randomUUID(),
  name: "Details",
  slug: "details",
  entities: ["product"],
  location: [],
  fields,
  position: "main",
  active: true,
  sort: 0,
  ...over,
});
const doc = (...texts: string[]): RichTextDoc =>
  ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: texts.map((text, i) => ({ type: "text", text, ...(i % 2 === 1 && { marks: [{ type: "bold" }] }) })),
      },
    ],
  }) as RichTextDoc;

describe("the labels of a group's definition", () => {
  const material = field("select", {
    label: "Materiale",
    choices: [
      { key: "ull", label: "Ull" },
      { key: "bomull", label: "Bomull", labels: { [TO]: "Bomull (sv)" } },
    ],
  });
  const size = field("group", {
    label: "Størrelse",
    subFields: [
      { ...newField("text"), label: "Bredde" },
      { ...newField("select"), label: "Enhet", choices: [{ key: "cm", label: "cm" }] },
    ],
  });
  const secret = field("text", { label: "Internt", access: "private" });
  const g = group([material, size, secret]);

  it("list a public field's label and choices, and its sub fields', but nothing private", () => {
    const items = definitionItems(g, TO, "all");
    const keys = items.map((i) => i.key);
    expect(keys).toContain(`${material.id}.label`);
    expect(keys).toContain(`${material.id}.choice.ull`);
    expect(keys).toContain(`${size.id}.label`);
    expect(keys).toContain(`${size.subFields![0].id}.label`);
    expect(keys).toContain(`${size.subFields![1].id}.choice.cm`);
    expect(keys.some((k) => k.startsWith(secret.id))).toBe(false);
    expect(items.every((i) => i.max === FIELD_LABEL_MAX && !i.rich && i.runs.length === 1)).toBe(true);
  });

  it("leave out what the language has, unless everything is asked for again", () => {
    expect(definitionItems(g, TO, "missing").map((i) => i.key)).not.toContain(`${material.id}.choice.bomull`);
    expect(definitionItems(g, TO, "all").map((i) => i.key)).toContain(`${material.id}.choice.bomull`);
    // A base-language label counts, as it does on the site.
    const based = group([{ ...material, labels: { sv: "Material" } }]);
    expect(definitionItems(based, TO, "missing").map((i) => i.key)).not.toContain(`${material.id}.label`);
  });

  it("are no unit for an inactive group or one with nothing to translate", () => {
    expect(definitionUnit(group([material], { active: false }), TO, "all")).toBeNull();
    expect(definitionUnit(group([secret]), TO, "all")).toBeNull();
    expect(definitionUnit(g, TO, "missing")).toMatchObject({
      id: `fielddef:${g.id}`,
      scope: "fields",
      title: "Details",
      legal: false,
    });
  });

  it("are written as labels in the language and nothing else, and the group still passes its own checks", () => {
    const done = {
      [`${material.id}.label`]: " Material ",
      [`${material.id}.choice.ull`]: "Ull (sv)",
      [`${size.subFields![0].id}.label`]: "Bredd",
      [`${secret.id}.label`]: "Should not be written",
      bogus: "x",
    };
    const fields = withDefinitionTexts(g.fields, TO, done);
    expect(fields[0].labels).toEqual({ [TO]: "Material" });
    expect(fields[0].choices).toEqual([
      { key: "ull", label: "Ull", labels: { [TO]: "Ull (sv)" } },
      { key: "bomull", label: "Bomull", labels: { [TO]: "Bomull (sv)" } },
    ]);
    expect(fields[1].subFields![0].labels).toEqual({ [TO]: "Bredd" });
    expect(fields[2]).toEqual(secret);
    // Nothing but labels changed: strip them and it is the group as it was.
    const withoutLabels = <T extends { labels?: unknown }>(item: T) => ({ ...item, labels: undefined });
    const strip = (defs: FieldDef[]): unknown =>
      defs.map(({ choices, subFields, ...rest }) => ({
        ...withoutLabels(rest),
        choices: choices?.map(withoutLabels),
        subFields: subFields && strip(subFields),
      }));
    expect(strip(fields)).toEqual(strip(g.fields));
    expect(fieldGroupInput.safeParse({ ...emptyGroup(), name: "G", slug: "g", fields }).success).toBe(true);
  });

  it("keep the definition's own limit on a label (a test that fails if it moves)", () => {
    const at = (label: string) =>
      fieldGroupInput.safeParse({ ...emptyGroup(), name: "G", slug: "g", fields: [{ ...newField("text"), label }] })
        .success;
    expect(at("x".repeat(FIELD_LABEL_MAX))).toBe(true);
    expect(at("x".repeat(FIELD_LABEL_MAX + 1))).toBe(false);
  });
});

describe("the texts entered in fields", () => {
  const title = field("text", { label: "Tittel" });
  const about = field("richText", { label: "Om" });
  const site = field("link", { label: "Nettsted" });
  const weight = field("number", { label: "Vekt" });
  const hidden = field("text", { label: "Skjult", access: "private" });
  const cell = { ...newField("text"), label: "Navn" };
  const amount = { ...newField("number"), label: "Mengde" };
  const size = field("group", { label: "Størrelse", subFields: [cell, amount] });
  const nutrient = { ...newField("text"), label: "Stoff" };
  const list = field("repeater", { label: "Innhold", subFields: [nutrient, { ...newField("number"), label: "Gram" }] });
  const r1 = newRowId();
  const r2 = newRowId();
  const defs = [title, about, site, weight, hidden, size, list];

  const source: FieldData = {
    values: { [weight.id]: 5, [size.id]: { [amount.id]: 3 }, [list.id]: [{ id: r1 }, { id: r2 }] },
    translations: {
      [MAIN]: {
        [title.id]: "Ullgenser",
        [about.id]: doc("Varm ", "og myk"),
        [site.id]: { kind: "url", ref: "https://example.com", label: "Les mer" },
        [hidden.id]: "Intern notat",
        [size.id]: { [cell.id]: "Stor" },
        [list.id]: { [r1]: { [nutrient.id]: "Protein" }, [r2]: { [nutrient.id]: "Salt" } },
      },
    },
  };

  const slots = valueSlots(defs, source, MAIN, TO);

  it("list every public text in the main language: texts, rich text runs, a link's words, group cells and repeater rows", () => {
    const items = valueItems(slots, "all");
    expect(items.map((i) => i.key)).toEqual([
      title.id,
      about.id,
      site.id,
      `${size.id}.${cell.id}`,
      `${list.id}.${r1}.${nutrient.id}`,
      `${list.id}.${r2}.${nutrient.id}`,
    ]);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey[title.id]).toMatchObject({ rich: false, runs: ["Ullgenser"], max: 500 });
    expect(byKey[about.id]).toMatchObject({ rich: true, runs: ["Varm ", "og myk"], max: 0 });
    expect(byKey[site.id]).toMatchObject({ rich: false, runs: ["Les mer"], max: 100 });
    expect(byKey[`${list.id}.${r2}.${nutrient.id}`].label).toBe("Innhold, row 2: Stoff");
    expect(byKey[`${size.id}.${cell.id}`].label).toBe("Størrelse: Navn");
  });

  it("never list private fields, numbers or anything a field's logic hides", () => {
    expect(slots.map((s) => s.key)).not.toContain(hidden.id);
    expect(slots.map((s) => s.key)).not.toContain(weight.id);
    const conditional = { ...title, when: [[{ field: weight.id, operator: "==" as const, value: "9" }]] };
    expect(valueSlots([weight, conditional], source, MAIN, TO).map((s) => s.key)).toEqual([]);
  });

  it("leave out what the language has, unless everything is asked for again", () => {
    const partly: FieldData = {
      ...source,
      translations: {
        ...source.translations,
        [TO]: { [title.id]: "Ullgenser (sv)", [list.id]: { [r1]: { [nutrient.id]: "Protein (sv)" } } },
      },
    };
    const missing = valueItems(valueSlots(defs, partly, MAIN, TO), "missing").map((i) => i.key);
    expect(missing).toEqual([about.id, site.id, `${size.id}.${cell.id}`, `${list.id}.${r2}.${nutrient.id}`]);
    expect(valueItems(valueSlots(defs, partly, MAIN, TO), "all")).toHaveLength(6);
  });

  it("are no unit without texts, and a legal page's start as legal", () => {
    expect(valueUnit("product", "p1", "Genser", "genser", [], "all")).toBeNull();
    expect(valueUnit("product", "p1", "Genser", "genser", slots, "all")).toMatchObject({
      id: "fieldval:product:p1",
      scope: "fields",
      legal: false,
      kind: "Product fields",
    });
    expect(valueUnit("page", "g1", "Om oss", "om-oss", slots, "all")).toMatchObject({
      id: "fieldval:page:g1",
      legal: false,
      kind: "Page fields",
    });
    expect(valueUnit("page", "g2", "Kjøpsvilkår", "vilkar", slots, "all")?.legal).toBe(true);
    expect(valueUnit("article", "g3", "Privacy", "privacy", slots, "all")).toMatchObject({
      legal: true,
      kind: "Article fields",
    });
    // A product is never legal by its name.
    expect(valueUnit("product", "p2", "Terms", "terms", slots, "all")?.legal).toBe(false);
  });

  it("are units of a variant, a category and a tag too, and never legal by their names", () => {
    expect(valueUnit("variant", "v1", "Genser · GEN-M (M)", "GEN-M", slots, "all")).toMatchObject({
      id: "fieldval:variant:v1",
      scope: "fields",
      kind: "Variant fields",
      legal: false,
    });
    expect(valueUnit("term", "t1", "Vilkår", "terms", slots, "all")).toMatchObject({
      id: "fieldval:term:t1",
      kind: "Category or tag fields",
      legal: false,
    });
    expect(valueUnit("term", "t1", "Ull", "ull", slots, "all", "category")?.kind).toBe("Category fields");
    expect(valueUnit("term", "t2", "Nytt", "nytt", slots, "all", "tag")?.kind).toBe("Tag fields");
    expect(valueUnit("variant", "v1", "Genser", "gen", [], "all")).toBeNull();
  });

  it("name a variant by its product, SKU and options, keeping the SKU in view when the title is long", () => {
    expect(variantTitle("Ullgenser", "GEN-M", { size: "M", colour: "blå" })).toBe("Ullgenser · GEN-M (M, blå)");
    expect(variantTitle("Ullgenser", "GEN-1", {})).toBe("Ullgenser · GEN-1");
    expect(variantTitle("Ullgenser", "GEN-1", null)).toBe("Ullgenser · GEN-1");
    const long = variantTitle("x".repeat(200), "GEN-M", { size: "M" });
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("· GEN-M (M)")).toBe(true);
    expect(valueUnit("variant", "v1", long, "GEN-M", slots, "all")!.title).toBe(long);
  });

  it("are checked like other texts: length and the runs of a rich text", () => {
    const items = valueItems(slots, "all");
    const link = items.find((i) => i.key === site.id)!;
    expect(fitsItem(link, "x".repeat(101))).toBe(false);
    expect(fitsItem(link, "Läs mer")).toBe(true);
    const rich = items.find((i) => i.key === about.id)!;
    expect(fitsItem(rich, ["Varm och mjuk"])).toBe(false);
    expect(fitsItem(rich, ["Varm ", "och mjuk"])).toBe(true);
  });

  const done = {
    [title.id]: "Ulltröja",
    [about.id]: ["Varm ", "och len"],
    [site.id]: "Läs mer",
    [`${size.id}.${cell.id}`]: "Stor (sv)",
    [`${list.id}.${r2}.${nutrient.id}`]: "Salt (sv)",
    bogus: "not asked for",
  };

  it("are applied as a change set in the language only, and it passes the editors' own checks", () => {
    const { changes, count } = valueChanges(slots, source, MAIN, TO, done);
    expect(count).toBe(5);
    expect(changes.values).toEqual({});
    expect(Object.keys(changes.translations)).toEqual([TO]);
    const sv = changes.translations[TO];
    expect(sv[title.id]).toBe("Ulltröja");
    expect(sv[about.id]).toEqual(doc("Varm ", "och len"));
    expect(sv[site.id]).toEqual({ kind: "url", ref: "https://example.com", label: "Läs mer" });
    expect(sv[size.id]).toEqual({ [cell.id]: "Stor (sv)" });
    expect(sv[list.id]).toEqual({ [r2]: { [nutrient.id]: "Salt (sv)" } });

    // Through the same check an editor's save takes, then merged over what is there.
    const parsed = parseFieldChanges(defs, changes, [MAIN, "sv-SE"], MAIN);
    expect(parsed.problems).toEqual([]);
    const next = applyChanges(source, parsed.changes);
    expect(next.translations[MAIN]).toEqual(source.translations[MAIN]);
    expect(next.values).toEqual(source.values);
    // Read in Swedish: the new words, and the Norwegian where none were given.
    expect(readField(title, next, TO, MAIN)).toBe("Ulltröja");
    expect(readField(list, next, TO, MAIN)).toEqual([
      { id: r1, [nutrient.id]: "Protein" },
      { id: r2, [nutrient.id]: "Salt (sv)" },
    ]);
    expect(readField(size, next, TO, MAIN)).toEqual({ [amount.id]: 3, [cell.id]: "Stor (sv)" });
  });

  it("keep the words a group or row already has in the language, and take nothing it was not given", () => {
    const has: FieldData = {
      ...source,
      translations: {
        ...source.translations,
        [TO]: { [list.id]: { [r1]: { [nutrient.id]: "Protein (sv)" } }, [size.id]: { [cell.id]: "Stor" } },
      },
    };
    const again = valueSlots(defs, has, MAIN, TO);
    const { changes, count } = valueChanges(again, has, MAIN, TO, { [`${list.id}.${r2}.${nutrient.id}`]: "Salt (sv)" });
    expect(count).toBe(1);
    expect(Object.keys(changes.translations[TO])).toEqual([list.id]);
    expect(changes.translations[TO][list.id]).toEqual({
      [r1]: { [nutrient.id]: "Protein (sv)" },
      [r2]: { [nutrient.id]: "Salt (sv)" },
    });
  });

  it("leave out a rich text that came back split differently", () => {
    const result = valueChanges(slots, source, MAIN, TO, { [about.id]: ["Only one run"] });
    expect(result.count).toBe(0);
    expect(result.changes.translations[TO]).toEqual({});
  });
});
