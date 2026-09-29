import { describe, expect, it } from "vitest";

import {
  MAX_LAYOUTS,
  applyChanges,
  changesFrom,
  emptyGroup,
  fieldGroupInput,
  fieldListsOf,
  groupToInput,
  hasTranslations,
  importGroups,
  isRowsType,
  isStructural,
  layoutOf,
  newField,
  newLayout,
  parseFieldChanges,
  parseValue,
  readField,
  requiredProblems,
  rowFieldsOf,
  shownGroup,
  subFieldsOf,
  tidyFlexible,
  valuesFor,
  writeField,
  type FieldData,
  type FieldDef,
  type FieldGroup,
  type FieldValue,
} from "./custom-fields";
import { needsLookups } from "./custom-fields";
import { drawable, drawableBlocks } from "./field-parts";
import { searchBodies } from "./field-search";
import { definitionItems, valueChanges, valueSlots, withDefinitionTexts } from "./field-translate";

const MAIN = "nb";
const SV = "sv";
const words = { yes: "Ja", no: "Nei" };

const text = (id: string, label: string, over: Partial<FieldDef> = {}): FieldDef => ({
  id,
  name: label.toLowerCase(),
  label,
  type: "text",
  access: "private",
  ...over,
});

const heading = text("f_heading00001", "Heading");
const body = text("f_body0000001", "Body", { type: "textarea" });
const picture = text("f_picture00001", "Picture", { type: "image" });
const caption = text("f_caption0001", "Caption");
const quote = text("f_quote000001", "Quote", { type: "textarea" });
const author = text("f_author00001", "Author");
const stars = text("f_stars000001", "Stars", { type: "number" });

const flexible: FieldDef = {
  ...newField("flexible"),
  id: "f_flexible0001",
  name: "content",
  label: "Content",
  access: "public",
  layouts: [
    { key: "text", label: "Text", labels: { sv: "Text (sv)" }, subFields: [heading, body] },
    { key: "picture", label: "Picture with caption", subFields: [picture, caption] },
    { key: "quote", label: "Quote", subFields: [quote, author, stars] },
  ],
};

const row = (id: string, layout: string, cells: Record<string, unknown> = {}) => ({ id, layout, ...cells }) as never;
const nothing: FieldData = { values: {}, translations: {} };
const img = { url: "https://cdn.example.com/a.webp", thumbnailUrl: null, alt: "A chair" };

const groupOf = (fields: FieldDef[]): FieldGroup =>
  ({ ...emptyGroup("product"), id: "g", name: "Content", slug: "content", fields, sort: 0 }) as FieldGroup;

describe("flexible content as a field type", () => {
  it("is a layout field holding rows, its fields being those of all its layouts", () => {
    expect(isStructural("flexible")).toBe(true);
    expect(isRowsType("flexible")).toBe(true);
    expect(isRowsType("group")).toBe(false);
    expect(subFieldsOf(flexible).map((f) => f.id)).toEqual([
      heading.id,
      body.id,
      picture.id,
      caption.id,
      quote.id,
      author.id,
      stars.id,
    ]);
    expect(fieldListsOf(flexible)).toHaveLength(3);
    expect(rowFieldsOf(flexible, { layout: "picture" })).toEqual([picture, caption]);
    expect(rowFieldsOf(flexible, { layout: "gone" })).toBeNull();
    expect(layoutOf(flexible, "quote")?.label).toBe("Quote");
    expect(hasTranslations(flexible)).toBe(true);
    expect(hasTranslations({ ...flexible, layouts: [{ key: "n", label: "N", subFields: [stars] }] })).toBe(false);
  });

  it("starts with one layout with a text field", () => {
    const made = newField("flexible");
    expect(made.layouts).toHaveLength(1);
    expect(made.layouts?.[0]).toMatchObject({ key: "text", label: "Text" });
    expect(made.subFields).toBeUndefined();
    expect(newLayout("Text", ["text"]).key).toBe("text-2");
    expect(
      needsLookups([groupOf([{ ...flexible, layouts: [{ key: "l", label: "L", subFields: [newField("product")] }] }])]),
    ).toBe(true);
  });
});

describe("checking a flexible field's definition", () => {
  const check = (field: Partial<FieldDef>) =>
    fieldGroupInput.safeParse({ ...emptyGroup("product"), name: "G", slug: "g", fields: [{ ...flexible, ...field }] });
  const problems = (field: Partial<FieldDef>) => {
    const result = check(field);
    return result.success ? [] : result.error.issues.map((i) => i.message);
  };

  it("accepts layouts with their fields", () => {
    expect(check({}).success).toBe(true);
  });

  it("needs layouts, each with a key of its own and a field", () => {
    expect(problems({ layouts: [] })).toContain("Add layouts to Content.");
    expect(problems({ layouts: undefined })).toContain("Add layouts to Content.");
    expect(
      problems({
        layouts: [
          { key: "a", label: "A", subFields: [heading] },
          { key: "a", label: "B", subFields: [body] },
        ],
      }),
    ).toContain("Content has two layouts with the same key.");
    expect(problems({ layouts: [{ key: "a", label: "A", subFields: [] }] })).toContain("Add fields to the layout A.");
    expect(problems({ layouts: [{ key: "Bad Key", label: "A", subFields: [heading] }] })).toContain(
      "A layout's key uses lowercase letters, digits, hyphens and underscores.",
    );
    expect(problems({ layouts: [{ key: "a", label: "", subFields: [heading] }] })).toContain(
      "Give each layout a label.",
    );
    const many = Array.from({ length: MAX_LAYOUTS + 1 }, (_, i) => ({
      key: `l${i}`,
      label: `L${i}`,
      subFields: [text(`f_many${String(i).padStart(7, "0")}`, "T")],
    }));
    expect(problems({ layouts: many })).toContain(`Use at most ${MAX_LAYOUTS} layouts.`);
  });

  it("keeps field ids unique across layouts, and names unique in a layout", () => {
    expect(
      problems({
        layouts: [
          { key: "a", label: "A", subFields: [heading] },
          { key: "b", label: "B", subFields: [heading] },
        ],
      }),
    ).toContain("Two fields share an id.");
    expect(
      problems({ layouts: [{ key: "a", label: "A", subFields: [heading, { ...body, name: "heading" }] }] }),
    ).toContain("Two fields in Content, A are named heading.");
    // The same name in two layouts is fine.
    expect(
      check({
        layouts: [
          { key: "a", label: "A", subFields: [heading] },
          { key: "b", label: "B", subFields: [{ ...body, name: "heading" }] },
        ],
      }).success,
    ).toBe(true);
  });

  it("allows nothing nested, no fields of its own, and layouts only on flexible content", () => {
    expect(problems({ layouts: [{ key: "a", label: "A", subFields: [newField("repeater")] }] }).join(" ")).toMatch(
      /cannot hold another/,
    );
    expect(problems({ layouts: [{ key: "a", label: "A", subFields: [newField("flexible")] }] }).join(" ")).toMatch(
      /cannot hold another/,
    );
    expect(problems({ subFields: [heading] })).toContain("Content takes its fields in its layouts.");
    const withLayouts = fieldGroupInput.safeParse({
      ...emptyGroup("product"),
      name: "G",
      slug: "g",
      fields: [{ ...newField("text"), layouts: flexible.layouts }],
    });
    expect(withLayouts.success).toBe(false);
  });

  it("lets a field inside a layout be shown by the fields above it in that layout only", () => {
    const shownByAuthor = { ...stars, when: [[{ field: author.id, operator: "has" as const }]] };
    expect(check({ layouts: [{ key: "q", label: "Q", subFields: [quote, author, shownByAuthor] }] }).success).toBe(
      true,
    );
    // Below it, or in another layout, is refused.
    expect(
      problems({
        layouts: [
          { key: "q", label: "Q", subFields: [{ ...quote, when: [[{ field: author.id, operator: "has" }]] }, author] },
        ],
      })[0],
    ).toMatch(/can only depend on fields above it/);
    expect(
      problems({
        layouts: [
          { key: "a", label: "A", subFields: [heading] },
          { key: "b", label: "B", subFields: [{ ...body, when: [[{ field: heading.id, operator: "has" }]] }] },
        ],
      })[0],
    ).toMatch(/can only depend on fields above it/);
  });

  it("holds the row limits", () => {
    expect(problems({ minRows: 3, maxRows: 2 })).toContain("Content: the fewest rows is more than the most.");
  });

  it("round trips through a group's input", () => {
    const input = fieldGroupInput.parse({ ...emptyGroup("product"), name: "G", slug: "g", fields: [flexible] });
    expect(input.fields[0].layouts?.map((l) => l.key)).toEqual(["text", "picture", "quote"]);
    expect(groupToInput({ ...groupOf([flexible]) }).fields[0].layouts).toHaveLength(3);
  });
});

describe("checking a flexible value", () => {
  it("keeps rows with their layout and the cells of that layout only", () => {
    const parsed = parseValue(flexible, [
      row("r_aaaaaaaa", "text", { [heading.id]: " Hello ", [body.id]: "Words", [quote.id]: "not this layout's" }),
      row("r_bbbbbbbb", "quote", { [quote.id]: "Less is more", [stars.id]: "4,5" }),
    ]);
    expect(parsed).toEqual({
      ok: true,
      value: [
        { id: "r_aaaaaaaa", layout: "text", [heading.id]: "Hello", [body.id]: "Words" },
        { id: "r_bbbbbbbb", layout: "quote", [quote.id]: "Less is more", [stars.id]: 4.5 },
      ],
    });
  });

  it("drops a row of a layout the field does not have, and empties to null", () => {
    expect(
      parseValue(flexible, [
        row("r_aaaaaaaa", "removed", { [heading.id]: "x" }),
        row("r_bbbbbbbb", "text", { [heading.id]: "y" }),
      ]),
    ).toEqual({
      ok: true,
      value: [{ id: "r_bbbbbbbb", layout: "text", [heading.id]: "y" }],
    });
    expect(parseValue(flexible, [row("r_aaaaaaaa", "removed")])).toEqual({ ok: true, value: null });
    expect(parseValue(flexible, [])).toEqual({ ok: true, value: null });
    expect(parseValue(flexible, null)).toEqual({ ok: true, value: null });
  });

  it("refuses rows without an id, with a repeated id, over the limit, and cells that do not fit", () => {
    expect(parseValue(flexible, [{ layout: "text" }]).ok).toBe(false);
    expect(parseValue(flexible, [row("r_aaaaaaaa", "text"), row("r_aaaaaaaa", "text")]).ok).toBe(false);
    expect(
      parseValue({ ...flexible, maxRows: 1 }, [row("r_aaaaaaaa", "text"), row("r_bbbbbbbb", "text")]),
    ).toMatchObject({ ok: false, problem: "Content: Use at most 1 rows." });
    expect(parseValue(flexible, [row("r_aaaaaaaa", "quote", { [stars.id]: "many" })]).ok).toBe(false);
    expect(parseValue(flexible, { text: "no" }).ok).toBe(false);
  });

  it("splits into the shared part (order, ids, layouts, other cells) and each language's words by row id", () => {
    const rows = [
      row("r_aaaaaaaa", "picture", { [picture.id]: img, [caption.id]: "En stol" }),
      row("r_bbbbbbbb", "quote", { [quote.id]: "Q", [stars.id]: 5 }),
    ];
    const { changes, problems } = parseFieldChanges(
      [flexible],
      {
        values: { [flexible.id]: rows },
        translations: {
          nb: {
            [flexible.id]: {
              r_aaaaaaaa: { [caption.id]: "En stol", [picture.id]: img },
              r_bbbbbbbb: { [quote.id]: "Q" },
              bad_row: { x: 1 },
            },
          },
        },
      },
      ["nb", "sv"],
      "nb",
    );
    expect(problems).toEqual([]);
    expect(changes.values[flexible.id]).toEqual([
      { id: "r_aaaaaaaa", layout: "picture", [picture.id]: img },
      { id: "r_bbbbbbbb", layout: "quote", [stars.id]: 5 },
    ]);
    expect(changes.translations.nb[flexible.id]).toEqual({
      r_aaaaaaaa: { [caption.id]: "En stol" },
      r_bbbbbbbb: { [quote.id]: "Q" },
    });
  });
});

describe("reading and writing flexible content by language", () => {
  const written = () => {
    let data = writeField(flexible, nothing, MAIN, MAIN, [
      row("r_aaaaaaaa", "text", { [heading.id]: "Overskrift", [body.id]: "Tekst" }),
      row("r_bbbbbbbb", "quote", { [quote.id]: "Sitat", [author.id]: "Ola", [stars.id]: 5 }),
      row("r_cccccccc", "picture", { [picture.id]: img, [caption.id]: "Bilde" }),
    ]);
    data = writeField(flexible, data, SV, MAIN, [
      row("r_aaaaaaaa", "text", { [heading.id]: "Rubrik", [stars.id]: 99 }),
      row("r_bbbbbbbb", "quote", { [quote.id]: "Citat" }),
    ]);
    return data;
  };

  it("keeps structure and non-text cells shared, and words by row id", () => {
    const data = written();
    expect(data.values[flexible.id]).toEqual([
      { id: "r_aaaaaaaa", layout: "text" },
      { id: "r_bbbbbbbb", layout: "quote", [stars.id]: 5 },
      { id: "r_cccccccc", layout: "picture", [picture.id]: img },
    ]);
    expect(data.translations.nb[flexible.id]).toEqual({
      r_aaaaaaaa: { [heading.id]: "Overskrift", [body.id]: "Tekst" },
      r_bbbbbbbb: { [quote.id]: "Sitat", [author.id]: "Ola" },
      r_cccccccc: { [caption.id]: "Bilde" },
    });
    // Another language writes only the texts of the rows the main language has, of each row's layout (a stray cell is not taken).
    expect(data.translations.sv[flexible.id]).toEqual({
      r_aaaaaaaa: { [heading.id]: "Rubrik" },
      r_bbbbbbbb: { [quote.id]: "Citat" },
    });
  });

  it("reads a language's rows with its own words over the main language's, the rest shared", () => {
    const data = written();
    expect(readField(flexible, data, SV, MAIN)).toEqual([
      { id: "r_aaaaaaaa", layout: "text", [heading.id]: "Rubrik", [body.id]: "Tekst" },
      { id: "r_bbbbbbbb", layout: "quote", [quote.id]: "Citat", [author.id]: "Ola", [stars.id]: 5 },
      { id: "r_cccccccc", layout: "picture", [picture.id]: img, [caption.id]: "Bilde" },
    ]);
  });

  it("makes the words follow a row that is moved, and go with a row that is removed", () => {
    const data = written();
    const rows = readField(flexible, data, MAIN, MAIN) as never as Record<string, unknown>[];
    const moved = writeField(flexible, data, MAIN, MAIN, [rows[2], rows[1], rows[0]] as never);
    const inSwedish = readField(flexible, moved, SV, MAIN) as never as Record<string, unknown>[];
    expect(inSwedish.map((r) => r.id)).toEqual(["r_cccccccc", "r_bbbbbbbb", "r_aaaaaaaa"]);
    expect(inSwedish[1][quote.id]).toBe("Citat");
    expect(inSwedish[2][heading.id]).toBe("Rubrik");

    const removed = writeField(flexible, moved, MAIN, MAIN, [rows[0], rows[2]] as never);
    expect(Object.keys(removed.translations.nb[flexible.id] as object)).toEqual(["r_aaaaaaaa", "r_cccccccc"]);
    expect(removed.translations.sv[flexible.id]).toEqual({ r_aaaaaaaa: { [heading.id]: "Rubrik" } });
    expect(writeField(flexible, removed, MAIN, MAIN, undefined)).toEqual(nothing);
  });

  it("drops rows of a layout that is gone when written, and never fails reading them", () => {
    const data = written();
    const withoutQuote: FieldDef = { ...flexible, layouts: flexible.layouts?.filter((l) => l.key !== "quote") };
    // Reading skips the stale row.
    expect((readField(withoutQuote, data, SV, MAIN) as never as { id: string }[]).map((r) => r.id)).toEqual([
      "r_aaaaaaaa",
      "r_cccccccc",
    ]);
    expect(valuesFor([withoutQuote], data, SV, MAIN)[flexible.id]).toHaveLength(2);
    // Writing what was read leaves it out of the data for good.
    const again = writeField(withoutQuote, data, MAIN, MAIN, readField(withoutQuote, data, MAIN, MAIN));
    expect((again.values[flexible.id] as never as { id: string }[]).map((r) => r.id)).toEqual([
      "r_aaaaaaaa",
      "r_cccccccc",
    ]);
    // Tidying data as it is drops the row and its words in every language, and words of a cell its layout no longer has.
    const tidy = tidyFlexible([withoutQuote], data);
    expect((tidy.values[flexible.id] as never as { id: string }[]).map((r) => r.id)).toEqual([
      "r_aaaaaaaa",
      "r_cccccccc",
    ]);
    expect(tidy.translations.nb[flexible.id]).toEqual({
      r_aaaaaaaa: { [heading.id]: "Overskrift", [body.id]: "Tekst" },
      r_cccccccc: { [caption.id]: "Bilde" },
    });
    expect(tidy.translations.sv[flexible.id]).toEqual({ r_aaaaaaaa: { [heading.id]: "Rubrik" } });
    const onlyQuote = tidyFlexible([{ ...flexible, layouts: [] }], data);
    expect(onlyQuote).toEqual(nothing);
    // Words for a cell that is not in the row's layout any more.
    const swapped: FieldDef = {
      ...flexible,
      layouts: flexible.layouts?.map((l) => (l.key === "text" ? { ...l, subFields: [heading] } : l)),
    };
    expect(tidyFlexible([swapped], data).translations.nb[flexible.id]).toMatchObject({
      r_aaaaaaaa: { [heading.id]: "Overskrift" },
    });
    expect(
      (tidyFlexible([swapped], data).translations.nb[flexible.id] as Record<string, object>).r_aaaaaaaa,
    ).not.toHaveProperty(body.id);
  });

  it("is kept whole through the editor's round trip", () => {
    const data = written();
    const sent = changesFrom([flexible], data, [MAIN, SV]);
    const parsed = parseFieldChanges([flexible], JSON.parse(JSON.stringify(sent)), [MAIN, SV], MAIN);
    expect(parsed.problems).toEqual([]);
    expect(applyChanges(nothing, parsed.changes)).toEqual(data);
  });

  it("asks for its fewest rows and for what its rows need, only when it is used", () => {
    const needs: FieldDef = {
      ...flexible,
      minRows: 2,
      layouts: [
        { key: "text", label: "Text", subFields: [{ ...heading, required: true }, body] },
        ...(flexible.layouts?.slice(1) ?? []),
      ],
    };
    const data = (rows: unknown[]): FieldData => ({ values: { [needs.id]: rows as never }, translations: {} });
    expect(requiredProblems([needs], data([]), MAIN)).toEqual(["Content needs at least 2 rows."]);
    expect(requiredProblems([needs], data([row("r_aaaaaaaa", "quote")]), MAIN)).toEqual([
      "Content needs at least 2 rows.",
    ]);
    expect(requiredProblems([{ ...needs, minRows: undefined }], data([]), MAIN)).toEqual([]);
    const two = data([row("r_aaaaaaaa", "text"), row("r_bbbbbbbb", "quote")]);
    expect(requiredProblems([needs], two, MAIN)).toEqual(["Content, row 1: Heading is required."]);
  });
});

describe("what a shopper sees of flexible content", () => {
  const data = (): FieldData => {
    let d = writeField(flexible, nothing, MAIN, MAIN, [
      row("r_aaaaaaaa", "text", { [heading.id]: "Overskrift", [body.id]: "Tekst" }),
      row("r_bbbbbbbb", "quote", { [quote.id]: "Sitat", [stars.id]: 5 }),
      row("r_cccccccc", "picture", {}),
      row("r_dddddddd", "quote", { [author.id]: "Ola" }),
    ]);
    d = writeField(flexible, d, SV, MAIN, [row("r_aaaaaaaa", "text", { [heading.id]: "Rubrik" })]);
    return d;
  };

  it("is a block for each row with something to show, in order, with its layout's label in the language", () => {
    const shown = shownGroup(groupOf([flexible]), data(), SV, MAIN, words, { publicOnly: true });
    const [field] = shown.fields;
    expect(field.type).toBe("flexible");
    expect(field.blocks?.map((b) => [b.layout, b.label, b.fields.map((f) => f.text)])).toEqual([
      ["text", "Text (sv)", ["Rubrik", "Tekst"]],
      ["quote", "Quote", ["Sitat", "5"]],
      ["quote", "Quote", ["Ola"]],
    ]);
    expect(drawable(field)).toBe(true);
    expect(drawableBlocks(field)).toHaveLength(3);
  });

  it("is left out when private, or when no row has anything", () => {
    expect(
      shownGroup(groupOf([{ ...flexible, access: "private" }]), data(), MAIN, MAIN, words, { publicOnly: true }).fields,
    ).toEqual([]);
    const empty = writeField(flexible, nothing, MAIN, MAIN, [row("r_aaaaaaaa", "text", {})]);
    expect(shownGroup(groupOf([flexible]), empty, MAIN, MAIN, words, { publicOnly: true }).fields).toEqual([]);
  });

  it("hides a field inside a layout by its logic, looking at the fields above it in the row", () => {
    const logic: FieldDef = {
      ...flexible,
      layouts: [
        {
          key: "quote",
          label: "Quote",
          subFields: [quote, author, { ...stars, when: [[{ field: author.id, operator: "has" }]] }],
        },
      ],
    };
    const d = writeField(logic, nothing, MAIN, MAIN, [
      row("r_aaaaaaaa", "quote", { [quote.id]: "A", [stars.id]: 3 }),
      row("r_bbbbbbbb", "quote", { [quote.id]: "B", [author.id]: "Ola", [stars.id]: 4 }),
    ]);
    const [field] = shownGroup(groupOf([logic]), d, MAIN, MAIN, words, { publicOnly: true }).fields;
    expect(field.blocks?.map((b) => b.fields.map((f) => f.text))).toEqual([["A"], ["B", "Ola", "4"]]);
  });
});

describe("flexible content in keyword search and the translation worklist", () => {
  const searched: FieldDef = {
    ...flexible,
    layouts: [
      {
        key: "text",
        label: "Text",
        subFields: [
          { ...heading, search: true },
          { ...body, search: true },
        ],
      },
      { key: "quote", label: "Quote", subFields: [{ ...quote, search: true }, author] },
    ],
  };
  const data = (): FieldData => {
    let d = writeField(searched, nothing, MAIN, MAIN, [
      row("r_aaaaaaaa", "text", { [heading.id]: "Vevd stol", [body.id]: "Fra Voss" }),
      row("r_bbbbbbbb", "quote", { [quote.id]: "Mindre er mer", [author.id]: "Ikke søkt" }),
    ]);
    d = writeField(searched, d, SV, MAIN, [row("r_aaaaaaaa", "text", { [heading.id]: "Vävd stol" })]);
    return d;
  };

  it("searches the flagged texts of every row by language, the main language's where there is no other", () => {
    const bodies = searchBodies([groupOf([searched])], data(), [MAIN, SV], MAIN);
    expect(bodies[MAIN]).toBe("Vevd stol Fra Voss Mindre er mer");
    expect(bodies[SV]).toBe("Vävd stol Fra Voss Mindre er mer");
  });

  it("lists the texts of each row, by row id, and writes the accepted ones back to the row", () => {
    const d = data();
    const slots = valueSlots(
      searched.layouts?.flatMap((l) => l.subFields).length ? [{ ...searched, access: "public" }] : [],
      d,
      MAIN,
      "da",
    );
    expect(slots.map((s) => s.key)).toEqual([
      `${searched.id}.r_aaaaaaaa.${heading.id}`,
      `${searched.id}.r_aaaaaaaa.${body.id}`,
      `${searched.id}.r_bbbbbbbb.${quote.id}`,
      `${searched.id}.r_bbbbbbbb.${author.id}`,
    ]);
    expect(slots[0].label).toBe("Content, row 1: Heading");
    const done = {
      [`${searched.id}.r_bbbbbbbb.${quote.id}`]: "Mindre er mere",
      [`${searched.id}.r_aaaaaaaa.${heading.id}`]: "Vævet stol",
    };
    const { changes, count } = valueChanges(slots, d, MAIN, "da", done);
    expect(count).toBe(2);
    expect(changes.translations.da[searched.id]).toEqual({
      r_aaaaaaaa: { [heading.id]: "Vævet stol" },
      r_bbbbbbbb: { [quote.id]: "Mindre er mere" },
    });
    const next = applyChanges(d, changes as never);
    expect((readField(searched, next, "da", MAIN) as never as Record<string, unknown>[])[1][quote.id]).toBe(
      "Mindre er mere",
    );
  });

  it("lists the labels of the field and of its layouts, and writes translated ones into the layouts", () => {
    const g = groupOf([{ ...flexible, access: "public" }]);
    const items = definitionItems(g, "sv-SE", "all").map((i) => i.key);
    expect(items).toContain(`${flexible.id}.label`);
    expect(items).toContain(`${flexible.id}.layout.picture`);
    expect(items).toContain(`${heading.id}.label`);
    const written = withDefinitionTexts(g.fields, "da", {
      [`${flexible.id}.layout.picture`]: "Billede med tekst",
      [`${heading.id}.label`]: "Overskrift",
    });
    expect(written[0].layouts?.find((l) => l.key === "picture")?.labels).toEqual({ da: "Billede med tekst" });
    expect(written[0].layouts?.[0].subFields[0].labels).toEqual({ da: "Overskrift" });
    // Only what has no translation yet is listed in the "missing" mode.
    expect(definitionItems(g, "sv", "missing").map((i) => i.key)).not.toContain(`${flexible.id}.layout.text`);
  });
});

describe("copying and importing flexible content", () => {
  it("gives every field in every layout a new id, the conditions among them following", () => {
    const shownByAuthor = { ...stars, when: [[{ field: author.id, operator: "has" as const }]] };
    const field: FieldDef = {
      ...flexible,
      layouts: [{ key: "quote", label: "Quote", subFields: [quote, author, shownByAuthor] }],
    };
    const file = {
      kaizenFieldGroups: 1,
      groups: [
        { name: "G", slug: "g", entities: ["product"], location: [], fields: [field], position: "main", active: true },
      ],
    };
    const result = importGroups(file, []);
    if (!result.ok) throw new Error(result.problem);
    const [imported] = result.groups[0].fields;
    const subs = imported.layouts?.[0].subFields ?? [];
    expect(imported.id).not.toBe(field.id);
    expect(subs.map((s) => s.id)).not.toContain(quote.id);
    expect(subs[2].when?.[0][0].field).toBe(subs[1].id);
    expect(imported.layouts?.[0].key).toBe("quote");
  });
});

describe("the row id scheme is a repeater's", () => {
  it("takes the same ids", () => {
    expect(parseValue(flexible, [row("r_aaaaaaaa", "text")]).ok).toBe(true);
    expect(parseValue(flexible, [row("not-a-row", "text")]).ok).toBe(false);
    void ({} as FieldValue);
  });
});
