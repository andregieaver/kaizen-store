import { describe, expect, it } from "vitest";

import {
  FIELD_PRESETS,
  FIELD_TYPES,
  applyChanges,
  changesFrom,
  conditionHolds,
  emptyGroup,
  exportGroups,
  fieldGroupInput,
  fieldShows,
  groupApplies,
  groupFromPreset,
  importGroups,
  isEmptyValue,
  newField,
  newFieldId,
  parseFieldChanges,
  parseValue,
  readField,
  requiredProblems,
  shownGroup,
  writeField,
  valuesFor,
  type Facts,
  type FieldData,
  type FieldDef,
  type FieldGroup,
} from "./custom-fields";

const def = (over: Partial<FieldDef> & Pick<FieldDef, "type">): FieldDef => ({
  id: newFieldId(),
  name: "f",
  label: "Field",
  access: "private",
  ...over,
});

const group = (over: Partial<FieldGroup> = {}): FieldGroup => ({
  id: "g1",
  name: "Specs",
  slug: "specs",
  entities: ["product"],
  location: [],
  fields: [],
  position: "main",
  active: true,
  sort: 0,
  ...over,
});

const facts = (over: Partial<Facts> = {}): Facts => ({
  entity: "product",
  categories: [],
  tags: [],
  roles: [],
  ...over,
});
const words = { yes: "Yes", no: "No" };

describe("where a group applies", () => {
  it("is everywhere it can be when it has no rules, and never when off or for another kind of thing", () => {
    expect(groupApplies(group(), facts())).toBe(true);
    expect(groupApplies(group({ active: false }), facts())).toBe(false);
    expect(groupApplies(group({ entities: ["page"] }), facts())).toBe(false);
  });

  it("reads rules as OR between groups and AND inside one", () => {
    const g = group({
      location: [
        [{ param: "kind", operator: "==", value: "stay" }],
        [
          { param: "category", operator: "==", value: "shoes" },
          { param: "audience", operator: "!=", value: "businesses" },
        ],
      ],
    });
    expect(groupApplies(g, facts({ kind: "stay" }))).toBe(true);
    expect(groupApplies(g, facts({ kind: "goods", categories: ["shoes"] }))).toBe(true);
    expect(groupApplies(g, facts({ kind: "goods", categories: ["shoes"], audience: "businesses" }))).toBe(false);
    expect(groupApplies(g, facts({ kind: "goods" }))).toBe(false);
  });

  it("matches tags and a page's roles, and an unknown rule never matches", () => {
    expect(
      groupApplies(
        group({ entities: ["page"], location: [[{ param: "role", operator: "==", value: "cart" }]] }),
        facts({ entity: "page", roles: ["cart"] }),
      ),
    ).toBe(true);
    expect(
      groupApplies(group({ location: [[{ param: "tag", operator: "==", value: "t1" }]] }), facts({ tags: ["t1"] })),
    ).toBe(true);
    expect(groupApplies(group({ location: [[{ param: "moon", operator: "==", value: "full" }]] }), facts())).toBe(
      false,
    );
  });
});

describe("conditional logic", () => {
  const trigger = def({
    type: "select",
    choices: [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ],
  });
  it("compares values in the ways ACF does", () => {
    const at = (operator: Parameters<typeof conditionHolds>[0]["operator"], value?: string) =>
      conditionHolds({ field: trigger.id, operator, value }, { [trigger.id]: "a" });
    expect(at("==", "a")).toBe(true);
    expect(at("!=", "a")).toBe(false);
    expect(at("has")).toBe(true);
    expect(at("empty")).toBe(false);
    expect(at("contains", "A")).toBe(true);
    expect(at("matches", "^a$")).toBe(true);
    expect(at("matches", "(")).toBe(false);
    expect(conditionHolds({ field: "x", operator: "empty" }, {})).toBe(true);
  });

  it("compares numbers, checkboxes and yes or no", () => {
    expect(conditionHolds({ field: "n", operator: ">", value: "3" }, { n: 5 })).toBe(true);
    expect(conditionHolds({ field: "n", operator: "<", value: "3" }, { n: 5 })).toBe(false);
    expect(conditionHolds({ field: "n", operator: ">", value: "3" }, {})).toBe(false);
    expect(conditionHolds({ field: "m", operator: ">", value: "3" }, { m: { value: 4, unit: "g" } })).toBe(true);
    expect(conditionHolds({ field: "c", operator: "contains", value: "milk" }, { c: ["milk", "soy"] })).toBe(true);
    expect(conditionHolds({ field: "b", operator: "==", value: "1" }, { b: true })).toBe(true);
    expect(conditionHolds({ field: "b", operator: "==", value: "1" }, { b: false })).toBe(false);
  });

  it("shows a field when one of its rule groups holds in full", () => {
    const field = def({
      type: "text",
      when: [
        [
          { field: "a", operator: "==", value: "x" },
          { field: "b", operator: "has" },
        ],
        [{ field: "c", operator: "has" }],
      ],
    });
    expect(fieldShows(field, { a: "x", b: "1" })).toBe(true);
    expect(fieldShows(field, { a: "x" })).toBe(false);
    expect(fieldShows(field, { c: "1" })).toBe(true);
    expect(fieldShows(def({ type: "text" }), {})).toBe(true);
  });
});

describe("checking a value", () => {
  it("cleans text and refuses what is too long, and an empty value takes the value away", () => {
    expect(parseValue(def({ type: "text" }), "  hello \n world ")).toEqual({ ok: true, value: "hello world" });
    expect(parseValue(def({ type: "text" }), "   ")).toEqual({ ok: true, value: null });
    expect(parseValue(def({ type: "text", maxLength: 3 }), "abcd").ok).toBe(false);
    expect(parseValue(def({ type: "text" }), 5).ok).toBe(false);
    expect(parseValue(def({ type: "textarea" }), "a\r\nb")).toEqual({ ok: true, value: "a\nb" });
    expect(parseValue(def({ type: "text" }), null)).toEqual({ ok: true, value: null });
  });

  it("checks emails, phone numbers, addresses, colours, dates and times", () => {
    const check = (type: FieldDef["type"], value: string) => parseValue(def({ type }), value).ok;
    expect(check("email", "a@b.no")).toBe(true);
    expect(check("email", "a@b")).toBe(false);
    expect(check("phone", "+47 22 33 44 55")).toBe(true);
    expect(check("phone", "abc")).toBe(false);
    expect(check("url", "https://example.com/x")).toBe(true);
    expect(check("url", "javascript:alert(1)")).toBe(false);
    expect(check("color", "#1f2937")).toBe(true);
    expect(check("color", "red")).toBe(false);
    expect(check("date", "2026-02-28")).toBe(true);
    expect(check("date", "2026-02-30")).toBe(false);
    expect(check("time", "23:59")).toBe(true);
    expect(check("time", "24:00")).toBe(false);
    expect(check("datetime", "2026-09-29T10:30")).toBe(true);
    expect(check("datetime", "2026-09-29")).toBe(false);
  });

  it("checks numbers and measurements against their limits and units", () => {
    const number = def({ type: "number", min: 0, max: 10 });
    expect(parseValue(number, "3,5")).toEqual({ ok: true, value: 3.5 });
    expect(parseValue(number, 11).ok).toBe(false);
    expect(parseValue(number, "abc").ok).toBe(false);
    expect(parseValue(number, "")).toEqual({ ok: true, value: null });
    const weight = def({ type: "measurement", units: ["g", "kg"] });
    expect(parseValue(weight, { value: "250", unit: "g" })).toEqual({ ok: true, value: { value: 250, unit: "g" } });
    expect(parseValue(weight, { value: 2 })).toEqual({ ok: true, value: { value: 2, unit: "g" } });
    expect(parseValue(weight, { value: 2, unit: "lb" }).ok).toBe(false);
    expect(parseValue(weight, { value: "" })).toEqual({ ok: true, value: null });
  });

  it("only takes the choices a field has", () => {
    const select = def({ type: "select", choices: [{ key: "a", label: "A" }] });
    expect(parseValue(select, "a")).toEqual({ ok: true, value: "a" });
    expect(parseValue(select, "z").ok).toBe(false);
    expect(parseValue(select, "")).toEqual({ ok: true, value: null });
    const boxes = def({
      type: "checkbox",
      choices: [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
    });
    expect(parseValue(boxes, ["a", "a", "b"])).toEqual({ ok: true, value: ["a", "b"] });
    expect(parseValue(boxes, ["a", "z"]).ok).toBe(false);
    expect(parseValue(boxes, [])).toEqual({ ok: true, value: null });
    expect(parseValue(def({ type: "boolean" }), "yes").ok).toBe(false);
    expect(parseValue(def({ type: "boolean" }), false)).toEqual({ ok: true, value: false });
  });

  it("checks pictures, galleries, videos and rich text", () => {
    const image = def({ type: "image" });
    expect(parseValue(image, { url: "/demo/a.svg", thumbnailUrl: null, alt: "A" })).toEqual({
      ok: true,
      value: { url: "/demo/a.svg", thumbnailUrl: null, alt: "A" },
    });
    expect(parseValue(image, { url: "javascript:1", alt: "" }).ok).toBe(false);
    expect(
      parseValue(def({ type: "gallery", maxItems: 1 }), [
        { url: "/a.svg", alt: "" },
        { url: "/b.svg", alt: "" },
      ]).ok,
    ).toBe(false);
    expect(
      parseValue(def({ type: "video" }), { source: "youtube", link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }).ok,
    ).toBe(true);
    expect(parseValue(def({ type: "video" }), { source: "youtube", link: "https://example.com" }).ok).toBe(false);
    expect(parseValue(def({ type: "video" }), { source: "youtube", link: "" })).toEqual({ ok: true, value: null });
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] };
    expect(parseValue(def({ type: "richText" }), doc).ok).toBe(true);
    expect(parseValue(def({ type: "richText" }), { type: "doc", content: [{ type: "paragraph" }] })).toEqual({
      ok: true,
      value: null,
    });
    expect(parseValue(def({ type: "richText" }), { type: "doc", content: [{ type: "script" }] }).ok).toBe(false);
  });

  it("treats every kind of empty value as empty", () => {
    for (const value of ["", "  ", [], null, undefined]) expect(isEmptyValue(value as never)).toBe(true);
    for (const value of ["a", 0, false, ["a"]]) expect(isEmptyValue(value)).toBe(false);
  });
});

describe("values by language", () => {
  const text = def({ type: "text", id: "f_text0000001" });
  const number = def({ type: "number", id: "f_number000001" });
  const defs = [text, number];

  it("keeps texts in their language and the rest for all, and drops fields that are not defined", () => {
    const { changes, problems } = parseFieldChanges(
      defs,
      {
        values: { [number.id]: 4, [text.id]: "ignored here", other: "x" },
        translations: {
          nb: { [text.id]: "Hei", other: "x" },
          en: { [text.id]: "Hi" },
          xx: { [text.id]: "no such language" },
        },
      },
      ["nb", "en"],
      "nb",
    );
    expect(problems).toEqual([]);
    expect(changes).toEqual({
      values: { [number.id]: 4 },
      translations: { nb: { [text.id]: "Hei" }, en: { [text.id]: "Hi" } },
    });
  });

  it("says which value is wrong, and in which language", () => {
    const { problems } = parseFieldChanges(
      [def({ ...text, maxLength: 2 })],
      { translations: { nb: { [text.id]: "abc" }, en: { [text.id]: "abc" } } },
      ["nb", "en"],
      "nb",
    );
    expect(problems).toHaveLength(2);
    expect(problems[1]).toContain("(en)");
  });

  it("sends every field an editor holds, with a null for those it holds none of", () => {
    const changes = changesFrom(defs, { values: {}, translations: { nb: { [text.id]: "Hei" } } }, ["nb", "en"]);
    expect(changes).toEqual({
      values: { [number.id]: null },
      translations: { nb: { [text.id]: "Hei" }, en: { [text.id]: null } },
    });
    // Sent back as they are, they leave a thing as the editor showed it.
    const kept = { values: { [number.id]: 3 }, translations: { nb: { [text.id]: "Hei" }, en: { [text.id]: "Hi" } } };
    expect(
      applyChanges(kept, changesFrom(defs, { values: {}, translations: { nb: { [text.id]: "Hei" } } }, ["nb", "en"])),
    ).toEqual({
      values: {},
      translations: { nb: { [text.id]: "Hei" } },
    });
  });

  it("merges changes over what is kept, and a null takes a value away", () => {
    const kept = { values: { a: 1, b: 2 }, translations: { nb: { t: "Hei" }, en: { t: "Hi" } } };
    const next = applyChanges(kept, { values: { a: null, c: 3 }, translations: { en: { t: null } } });
    expect(next).toEqual({ values: { b: 2, c: 3 }, translations: { nb: { t: "Hei" } } });
  });

  it("falls back to the main language's text, and never to another language's number", () => {
    const data = { values: { [number.id]: 7 }, translations: { nb: { [text.id]: "Hei" } } };
    expect(valuesFor(defs, data, "en", "nb")).toEqual({ [number.id]: 7, [text.id]: "Hei" });
    expect(
      valuesFor(defs, { ...data, translations: { nb: { [text.id]: "Hei" }, en: { [text.id]: "Hi" } } }, "en", "nb")[
        text.id
      ],
    ).toBe("Hi");
  });

  it("asks for required fields that show, in the main language, and not for hidden ones", () => {
    const required = def({ type: "text", required: true, label: "Name", id: "f_req0000001" });
    const hidden = def({
      type: "text",
      required: true,
      label: "Hidden",
      id: "f_hid0000001",
      when: [[{ field: number.id, operator: "has" }]],
    });
    expect(requiredProblems([required, hidden, number], { values: {}, translations: {} }, "nb")).toEqual([
      "Name is required.",
    ]);
    expect(
      requiredProblems(
        [required, hidden, number],
        { values: { [number.id]: 1 }, translations: { nb: { [required.id]: "x" } } },
        "nb",
      ),
    ).toEqual(["Hidden is required."]);
  });
});

describe("what a page shows", () => {
  const specs = group({
    fields: [
      def({
        type: "text",
        id: "f_a00000001",
        name: "material",
        label: "Material",
        labels: { nb: "Materiale" },
        access: "public",
      }),
      def({ type: "number", id: "f_b00000001", name: "months", label: "Months", unit: "months", access: "public" }),
      def({
        type: "select",
        id: "f_c00000001",
        name: "fit",
        label: "Fit",
        access: "public",
        choices: [{ key: "s", label: "Small", labels: { nb: "Liten" } }],
      }),
      def({ type: "boolean", id: "f_d00000001", name: "vegan", label: "Vegan", access: "public" }),
      def({ type: "text", id: "f_e00000001", name: "cost", label: "Cost", access: "private" }),
      def({
        type: "text",
        id: "f_f00000001",
        name: "shy",
        label: "Shy",
        access: "public",
        when: [[{ field: "f_b00000001", operator: ">", value: "100" }]],
      }),
      def({
        type: "checkbox",
        id: "f_g00000001",
        name: "allergens",
        label: "Allergens",
        access: "public",
        choices: [
          { key: "m", label: "Milk" },
          { key: "n", label: "Nuts" },
        ],
      }),
    ],
  });
  const data = {
    values: { f_b00000001: 24, f_c00000001: "s", f_d00000001: false, f_g00000001: ["m", "n"] },
    translations: { nb: { f_a00000001: "Ull", f_e00000001: "Secret", f_f00000001: "Skjult" } },
  };

  it("draws the fields with a value, in the shopper's language, and only the public ones for the site", () => {
    const shown = shownGroup(specs, data, "nb", "nb", words, { publicOnly: true });
    expect(shown.fields.map((f) => f.name)).toEqual(["material", "months", "fit", "vegan", "allergens"]);
    expect(shown.fields.map((f) => f.label)).toEqual(["Materiale", "Months", "Fit", "Vegan", "Allergens"]);
    expect(shown.fields.map((f) => f.text)).toEqual(["Ull", "24 months", "Liten", "No", "Milk, Nuts"]);
    expect(shown.fields.at(-1)?.items).toEqual(["Milk", "Nuts"]);
    // The editor sees the private one too.
    expect(shownGroup(specs, data, "nb", "nb", words, { publicOnly: false }).fields.map((f) => f.name)).toContain(
      "cost",
    );
  });

  it("leaves out a field its logic hides, and shows it when the condition holds", () => {
    const more = { ...data, values: { ...data.values, f_b00000001: 200 } };
    expect(shownGroup(specs, more, "nb", "nb", words, { publicOnly: true }).fields.map((f) => f.name)).toContain("shy");
  });

  it("writes numbers and dates as the language does", () => {
    const g = group({
      fields: [
        def({ type: "measurement", id: "f_m00000001", name: "w", label: "W", access: "public", units: ["kg"] }),
        def({ type: "date", id: "f_n00000001", name: "d", label: "D", access: "public" }),
      ],
    });
    const shown = shownGroup(
      g,
      { values: { f_m00000001: { value: 1234.5, unit: "kg" }, f_n00000001: "2026-09-29" }, translations: {} },
      "en-GB",
      "en-GB",
      words,
      { publicOnly: true },
    );
    expect(shown.fields[0].text).toBe("1,234.5 kg");
    expect(shown.fields[1].text).toBe("29 September 2026");
  });
});

describe("a group definition", () => {
  const ok = () => ({
    ...emptyGroup(),
    name: "Specs",
    slug: "specs",
    fields: [{ ...newField("text"), name: "material", label: "Material" }],
  });

  it("is accepted when it is well formed", () => {
    expect(fieldGroupInput.safeParse(ok()).success).toBe(true);
  });

  it("refuses two fields with one name, choices that are missing or repeated, and units that are missing", () => {
    const a = { ...newField("text"), name: "x", label: "A" };
    const b = { ...newField("text"), name: "x", label: "B" };
    expect(fieldGroupInput.safeParse({ ...ok(), fields: [a, b] }).success).toBe(false);
    expect(fieldGroupInput.safeParse({ ...ok(), fields: [{ ...newField("select"), choices: [] }] }).success).toBe(
      false,
    );
    const dup = newField("select");
    expect(
      fieldGroupInput.safeParse({
        ...ok(),
        fields: [
          {
            ...dup,
            choices: [
              { key: "a", label: "A" },
              { key: "a", label: "B" },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(fieldGroupInput.safeParse({ ...ok(), fields: [{ ...newField("measurement"), units: [] }] }).success).toBe(
      false,
    );
    expect(fieldGroupInput.safeParse({ ...ok(), fields: [{ ...newField("number"), min: 5, max: 1 }] }).success).toBe(
      false,
    );
  });

  it("lets a field depend on fields above it only", () => {
    const first = { ...newField("boolean"), name: "a", label: "A" };
    const second = {
      ...newField("text"),
      name: "b",
      label: "B",
      when: [[{ field: first.id, operator: "==" as const, value: "1" }]],
    };
    expect(fieldGroupInput.safeParse({ ...ok(), fields: [first, second] }).success).toBe(true);
    expect(fieldGroupInput.safeParse({ ...ok(), fields: [second, first] }).success).toBe(false);
    const self = { ...first, when: [[{ field: first.id, operator: "has" as const }]] };
    expect(fieldGroupInput.safeParse({ ...ok(), fields: [self] }).success).toBe(false);
  });

  it("refuses bad names, web names, rules without a value and a group with nowhere to be", () => {
    expect(fieldGroupInput.safeParse({ ...ok(), fields: [{ ...newField("text"), name: "Bad Name" }] }).success).toBe(
      false,
    );
    expect(fieldGroupInput.safeParse({ ...ok(), slug: "Not ok" }).success).toBe(false);
    expect(
      fieldGroupInput.safeParse({ ...ok(), location: [[{ param: "kind", operator: "==", value: "" }]] }).success,
    ).toBe(false);
    expect(fieldGroupInput.safeParse({ ...ok(), entities: [] }).success).toBe(false);
    expect(
      fieldGroupInput.safeParse({
        ...ok(),
        fields: Array.from({ length: 61 }, (_, i) => ({ ...newField("text"), name: `f${i}`, label: `F${i}` })),
      }).success,
    ).toBe(false);
  });

  it("makes every type with valid defaults", () => {
    for (const type of Object.keys(FIELD_TYPES) as (keyof typeof FIELD_TYPES)[]) {
      const field = newField(type);
      expect(fieldGroupInput.safeParse({ ...ok(), fields: [field] }).success, type).toBe(true);
    }
  });
});

describe("starting points, export and import", () => {
  it("makes each preset into a valid group with ids of its own", () => {
    for (const preset of FIELD_PRESETS) {
      const made = groupFromPreset(preset.key)!;
      const parsed = fieldGroupInput.safeParse(made);
      expect(parsed.success, `${preset.key}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      const again = groupFromPreset(preset.key, [made.slug])!;
      expect(again.slug).not.toBe(made.slug);
      expect(again.fields[0].id).not.toBe(made.fields[0].id);
    }
    expect(groupFromPreset("nope")).toBeNull();
  });

  it("moves groups between stores with new ids, conditions following, and drops rules that name a store's own categories", () => {
    const first = { ...newField("boolean"), name: "a", label: "A" };
    const second = {
      ...newField("text"),
      name: "b",
      label: "B",
      when: [[{ field: first.id, operator: "==" as const, value: "1" }]],
    };
    const source: FieldGroup = group({
      fields: [first, second],
      location: [
        [
          { param: "kind", operator: "==", value: "goods" },
          { param: "category", operator: "==", value: "cat-1" },
        ],
      ],
    });
    const file = JSON.parse(JSON.stringify(exportGroups([source])));
    const imported = importGroups(file, ["specs"]);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const [copy] = imported.groups;
    expect(copy.slug).toBe("specs-2");
    expect(copy.id).toBeNull();
    expect(copy.fields[0].id).not.toBe(first.id);
    expect(copy.fields[1].when?.[0][0].field).toBe(copy.fields[0].id);
    expect(copy.location).toEqual([[{ param: "kind", operator: "==", value: "goods" }]]);
    expect(fieldGroupInput.safeParse(copy).success).toBe(true);
  });

  it("refuses files that are not ours or hold nothing valid", () => {
    expect(importGroups({}, []).ok).toBe(false);
    expect(importGroups({ kaizenFieldGroups: 1, groups: [] }, []).ok).toBe(false);
    expect(
      importGroups({ kaizenFieldGroups: 1, groups: [{ name: "", slug: "x", entities: ["product"], fields: [] }] }, [])
        .ok,
    ).toBe(false);
  });
});

describe("groups and repeaters", () => {
  const title = { ...newField("text"), id: "f_subtitle0001", name: "title", label: "Title" };
  const amount = { ...newField("number"), id: "f_subamount001", name: "amount", label: "Amount" };
  const note = { ...newField("textarea"), id: "f_subnote00001", name: "note", label: "Note", required: true };
  const repeater: FieldDef = {
    ...newField("repeater"),
    id: "f_replist00001",
    name: "list",
    label: "List",
    subFields: [title, amount, note],
    maxRows: 3,
    minRows: 1,
  };
  const group: FieldDef = { ...newField("group"), id: "f_grpdims00001", name: "dims", label: "Dimensions", subFields: [title, amount] };
  const row = (id: string, cells: Record<string, unknown>) => ({ id, ...cells }) as never;

  it("keep a repeater's rows and numbers shared, and each language's words by row", () => {
    // Written in the main language, then translated: the words follow the row, not its place.
    let data: FieldData = { values: {}, translations: {} };
    data = writeField(repeater, data, "nb", "nb", [
      row("r_aaaaaaaa", { [title.id]: "Lett", [amount.id]: 2, [note.id]: "Hei" }),
      row("r_bbbbbbbb", { [title.id]: "Sterk", [amount.id]: 5 }),
    ]);
    expect(data.values[repeater.id]).toEqual([
      { id: "r_aaaaaaaa", [amount.id]: 2 },
      { id: "r_bbbbbbbb", [amount.id]: 5 },
    ]);
    expect(data.translations.nb[repeater.id]).toEqual({ r_aaaaaaaa: { [title.id]: "Lett", [note.id]: "Hei" }, r_bbbbbbbb: { [title.id]: "Sterk" } });

    // Swedish sees the rows, writes only words, and a row it invents is not kept.
    const inSwedish = readField(repeater, data, "sv", "nb") as never as Record<string, unknown>[];
    expect(inSwedish.map((r) => r[title.id])).toEqual(["Lett", "Sterk"]);
    data = writeField(repeater, data, "sv", "nb", [
      row("r_aaaaaaaa", { [title.id]: "Lätt", [amount.id]: 99 }),
      row("r_cccccccc", { [title.id]: "Ny" }),
    ]);
    expect(data.values[repeater.id]).toEqual([
      { id: "r_aaaaaaaa", [amount.id]: 2 },
      { id: "r_bbbbbbbb", [amount.id]: 5 },
    ]);
    expect(data.translations.sv[repeater.id]).toEqual({ r_aaaaaaaa: { [title.id]: "Lätt" } });
    const merged = readField(repeater, data, "sv", "nb") as never as Record<string, unknown>[];
    expect(merged[0]).toEqual({ id: "r_aaaaaaaa", [title.id]: "Lätt", [amount.id]: 2, [note.id]: "Hei" });
    // No Swedish for the second row: the Norwegian shows.
    expect(merged[1][title.id]).toBe("Sterk");

    // Moving a row keeps its words in every language.
    const moved = writeField(repeater, data, "nb", "nb", [row("r_bbbbbbbb", { [title.id]: "Sterk", [amount.id]: 5 }), row("r_aaaaaaaa", { [title.id]: "Lett", [amount.id]: 2, [note.id]: "Hei" })]);
    const movedSv = readField(repeater, moved, "sv", "nb") as never as Record<string, unknown>[];
    expect(movedSv.map((r) => r[title.id])).toEqual(["Sterk", "Lätt"]);

    // No rows: nothing is kept, in any language.
    expect(writeField(repeater, moved, "nb", "nb", undefined)).toEqual({ values: {}, translations: {} });
  });

  it("keep a group's fields the same way", () => {
    let data: FieldData = { values: {}, translations: {} };
    data = writeField(group, data, "nb", "nb", { [title.id]: "Mål", [amount.id]: 12 });
    expect(data.values[group.id]).toEqual({ [amount.id]: 12 });
    expect(data.translations.nb[group.id]).toEqual({ [title.id]: "Mål" });
    // Swedish changes the words only, whatever number it sends.
    data = writeField(group, data, "sv", "nb", { [title.id]: "Mått", [amount.id]: 1 });
    expect(data.values[group.id]).toEqual({ [amount.id]: 12 });
    expect(readField(group, data, "sv", "nb")).toEqual({ [title.id]: "Mått", [amount.id]: 12 });
    expect(readField(group, data, "en", "nb")).toEqual({ [title.id]: "Mål", [amount.id]: 12 });
  });

  it("are checked in the two parts they are kept in, and refuse what a row may not hold", () => {
    const shared = parseFieldChanges(
      [repeater],
      { values: { [repeater.id]: [row("r_aaaaaaaa", { [title.id]: "ignored here", [amount.id]: "3,5" })] }, translations: { nb: { [repeater.id]: { r_aaaaaaaa: { [title.id]: "Lett", [amount.id]: 9, bad_row: { x: 1 } } } } } },
      ["nb"],
      "nb",
    );
    expect(shared.problems).toEqual([]);
    expect(shared.changes.values[repeater.id]).toEqual([{ id: "r_aaaaaaaa", [amount.id]: 3.5 }]);
    expect(shared.changes.translations.nb[repeater.id]).toEqual({ r_aaaaaaaa: { [title.id]: "Lett" } });

    const wrongRows = (rows: unknown) => parseFieldChanges([repeater], { values: { [repeater.id]: rows } }, ["nb"], "nb").problems;
    expect(wrongRows([row("bad", {})])).toHaveLength(1);
    expect(wrongRows([row("r_aaaaaaaa", {}), row("r_aaaaaaaa", {})])).toHaveLength(1);
    expect(wrongRows([1, 2, 3, 4].map((n) => row(`r_aaaaaa0${n}`, {})))[0]).toContain("at most 3");
    expect(wrongRows([row("r_aaaaaaaa", { [amount.id]: "many" })])[0]).toContain("List");
    expect(wrongRows("rows")).toHaveLength(1);
    expect(parseValue(repeater, [])).toEqual({ ok: true, value: null });
    expect(parseValue(group, { [title.id]: "  ", [amount.id]: "" })).toEqual({ ok: true, value: null });
  });

  it("ask for a repeater's rows and the required fields in them, only when it is used", () => {
    const data = (rows: unknown[]): FieldData => ({ values: { [repeater.id]: rows as never }, translations: {} });
    expect(requiredProblems([repeater], data([]), "nb")).toEqual(["List needs at least 1 row."]);
    expect(requiredProblems([repeater], data([row("r_aaaaaaaa", { [amount.id]: 1 })]), "nb")).toEqual(["List, row 1: Note is required."]);
    const full: FieldData = { values: { [repeater.id]: [row("r_aaaaaaaa", { [amount.id]: 1 })] as never }, translations: { nb: { [repeater.id]: { r_aaaaaaaa: { [note.id]: "x" } } as never } } };
    expect(requiredProblems([repeater], full, "nb")).toEqual([]);
    // An optional group nobody uses asks for nothing; one that is used asks for its required fields.
    const strict = { ...group, subFields: [amount, note] };
    expect(requiredProblems([strict], { values: {}, translations: {} }, "nb")).toEqual([]);
    expect(requiredProblems([strict], { values: { [strict.id]: { [amount.id]: 1 } as never }, translations: {} }, "nb")).toEqual(["Dimensions: Note is required."]);
  });

  it("are shown row by row, with what is empty or hidden left out", () => {
    const g = { id: "g", name: "G", slug: "g", entities: ["product" as const], location: [], fields: [{ ...repeater, access: "public" as const }, { ...group, access: "public" as const }], position: "main" as const, active: true, sort: 0 };
    const data: FieldData = {
      values: { [repeater.id]: [row("r_aaaaaaaa", { [amount.id]: 2 }), row("r_bbbbbbbb", {})] as never, [group.id]: { [amount.id]: 12 } as never },
      translations: { nb: { [repeater.id]: { r_aaaaaaaa: { [title.id]: "Lett" } } as never, [group.id]: { [title.id]: "Mål" } as never } },
    };
    const shown = shownGroup(g, data, "nb", "nb", words, { publicOnly: true });
    expect(shown.fields.map((f) => f.name)).toEqual(["list", "dims"]);
    // The empty row is not drawn.
    expect(shown.fields[0].rows).toHaveLength(1);
    expect(shown.fields[0].rows![0].map((f) => [f.label, f.text])).toEqual([["Title", "Lett"], ["Amount", "2"]]);
    expect(shown.fields[1].children!.map((f) => [f.label, f.text])).toEqual([["Title", "Mål"], ["Amount", "12"]]);
  });

  it("are refused when nested, empty, or with conditions that look forward, and get new ids on import", () => {
    const ok = { ...emptyGroup(), name: "S", slug: "s", fields: [repeater] };
    expect(fieldGroupInput.safeParse(ok).success).toBe(true);
    const nested = { ...repeater, subFields: [{ ...newField("group") }] };
    expect(fieldGroupInput.safeParse({ ...ok, fields: [nested] }).success).toBe(false);
    expect(fieldGroupInput.safeParse({ ...ok, fields: [{ ...repeater, subFields: [] }] }).success).toBe(false);
    expect(fieldGroupInput.safeParse({ ...ok, fields: [{ ...repeater, minRows: 5, maxRows: 2 }] }).success).toBe(false);
    const forward = { ...repeater, subFields: [{ ...title, when: [[{ field: amount.id, operator: "has" as const }]] }, amount] };
    expect(fieldGroupInput.safeParse({ ...ok, fields: [forward] }).success).toBe(false);
    const sameId = { ...repeater, subFields: [title, { ...amount, id: title.id }] };
    expect(fieldGroupInput.safeParse({ ...ok, fields: [sameId] }).success).toBe(false);

    const conditional = { ...repeater, subFields: [amount, { ...title, when: [[{ field: amount.id, operator: "has" as const }]] }] };
    const source: FieldGroup = { id: "g", name: "S", slug: "s", entities: ["product"], location: [], fields: [conditional], position: "main", active: true, sort: 0 };
    const imported = importGroups(JSON.parse(JSON.stringify(exportGroups([source]))), []);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const [copy] = imported.groups;
    const [first, second] = copy.fields[0].subFields!;
    expect(first.id).not.toBe(amount.id);
    expect(second.when![0][0].field).toBe(first.id);
  });

  it("start from presets with their own fields inside", () => {
    for (const key of ["key-features", "downloads"]) {
      const made = groupFromPreset(key)!;
      expect(fieldGroupInput.safeParse(made).success, key).toBe(true);
      expect(made.fields[0].type).toBe("repeater");
      expect(made.fields[0].subFields!.length).toBeGreaterThan(1);
    }
  });
});

describe("links, files and things to choose", () => {
  const id = "0f8e2c1a-1b2c-4d3e-8f4a-5b6c7d8e9f01";
  const other = "1a2b3c4d-1b2c-4d3e-8f4a-5b6c7d8e9f02";

  it("are checked: a link points at something with words, a file has an address and a size", () => {
    const link = def({ type: "link" });
    expect(parseValue(link, { kind: "product", ref: id, label: " Buy " })).toEqual({ ok: true, value: { kind: "product", ref: id, label: "Buy" } });
    expect(parseValue(link, { kind: "url", ref: "https://example.com/a", label: "", newTab: true })).toEqual({ ok: true, value: { kind: "url", ref: "https://example.com/a", label: "", newTab: true } });
    expect(parseValue(link, { kind: "url", ref: "/om-oss", label: "About" }).ok).toBe(true);
    expect(parseValue(link, { kind: "url", ref: "javascript:alert(1)", label: "" }).ok).toBe(false);
    expect(parseValue(link, { kind: "product", ref: "not-an-id", label: "" }).ok).toBe(false);
    expect(parseValue(link, { kind: "moon", ref: id, label: "" }).ok).toBe(false);
    expect(parseValue(link, { kind: "page", ref: "", label: "x" })).toEqual({ ok: true, value: null });

    const file = def({ type: "file" });
    const value = { url: "https://example.supabase.co/storage/v1/object/public/field-files/s/a.pdf", name: "Data sheet.pdf", size: 1234, contentType: "application/pdf" };
    expect(parseValue(file, value)).toEqual({ ok: true, value });
    expect(parseValue(file, { ...value, url: "javascript:1" }).ok).toBe(false);
    expect(parseValue(file, { ...value, size: 60 * 1024 * 1024 }).ok).toBe(false);
    expect(parseValue(file, { ...value, name: "" }).ok).toBe(false);
    expect(parseValue(file, { url: "" })).toEqual({ ok: true, value: null });
  });

  it("choose one or several things by id", () => {
    const one = def({ type: "product" });
    expect(parseValue(one, id)).toEqual({ ok: true, value: id });
    expect(parseValue(one, [id])).toEqual({ ok: true, value: id });
    expect(parseValue(one, [id, other]).ok).toBe(false);
    expect(parseValue(one, "nope").ok).toBe(false);
    expect(parseValue(one, "")).toEqual({ ok: true, value: null });
    const many = def({ type: "term", multiple: true });
    expect(parseValue(many, [id, other, id])).toEqual({ ok: true, value: [id, other] });
    expect(parseValue(many, id)).toEqual({ ok: true, value: [id] });
    expect(parseValue(many, [])).toEqual({ ok: true, value: null });
    expect(parseValue(def({ type: "page", multiple: true }), Array.from({ length: 51 }, (_, i) => `1a2b3c4d-1b2c-4d3e-8f4a-5b6c7d8e${String(i).padStart(4, "0")}`)).ok).toBe(false);
  });

  it("show a file or a web link by itself, and leave the lookups to the server", () => {
    const g = group({
      fields: [
        def({ type: "file", id: "f_file0000001", name: "sheet", label: "Sheet", access: "public" }),
        def({ type: "link", id: "f_link0000001", name: "more", label: "More", access: "public" }),
        def({ type: "product", id: "f_prod0000001", name: "related", label: "Related", access: "public", multiple: true }),
      ],
    });
    const data: FieldData = {
      values: { f_file0000001: { url: "https://x.example/a.pdf", name: "A.pdf", size: 10, contentType: "application/pdf" }, f_prod0000001: [id, other] },
      translations: { nb: { f_link0000001: { kind: "url", ref: "https://example.com", label: "Les mer" } } },
    };
    const shown = shownGroup(g, data, "nb", "nb", words, { publicOnly: true });
    expect(shown.fields.map((f) => f.name)).toEqual(["sheet", "more", "related"]);
    expect(shown.fields[0].links).toEqual([{ label: "A.pdf", href: "https://x.example/a.pdf", newTab: true, size: 10, contentType: "application/pdf" }]);
    expect(shown.fields[1].links).toEqual([{ label: "Les mer", href: "https://example.com" }]);
    expect(shown.fields[2].links).toBeUndefined();
    expect(shown.fields[1].text).toBe("Les mer");
  });

  it("keep a link per language, falling back to the main one", () => {
    const link = def({ type: "link", id: "f_link0000002" });
    const data: FieldData = { values: {}, translations: { nb: { [link.id]: { kind: "url", ref: "https://a.example", label: "A" } } } };
    expect(readField(link, data, "sv", "nb")).toEqual({ kind: "url", ref: "https://a.example", label: "A" });
    expect(writeField(link, data, "sv", "nb", { kind: "url", ref: "https://b.example", label: "B" }).translations.sv[link.id]).toMatchObject({ label: "B" });
  });
});
