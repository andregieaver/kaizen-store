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
  requiredProblems,
  shownGroup,
  valuesFor,
  type Facts,
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
