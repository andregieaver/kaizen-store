import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { findClaims } from "./claims";
import { newField, parseValue, type FieldDef, type FieldGroup } from "./custom-fields";
import {
  buildFieldGroup,
  coerceFieldValue,
  describeLocation,
  fieldValueText,
  plainToRich,
  prepareValues,
  resolveField,
  SIMPLE_FIELD_TYPES,
  wordsIn,
} from "./field-tools";
import { MANAGER_TOOLS, TOOL_WORDS } from "./manager-tools";
import { approvalSummary, OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";
import { richTextPlain } from "./page-content";

const def = (over: Partial<FieldDef> & Pick<FieldDef, "type">): FieldDef => ({
  ...newField(over.type),
  id: `f_${over.type.padEnd(8, "x")}`,
  name: over.type,
  label: over.label ?? over.type,
  ...over,
});

const group = (fields: FieldDef[], slug = "specs"): Pick<FieldGroup, "name" | "slug"> & { fields: FieldDef[] } => ({
  name: "Specs",
  slug,
  fields,
});

describe("the custom-fields tools in the owner assistant's catalogue (D118)", () => {
  it("has the four tools, gated where they change what the site shows", () => {
    for (const name of ["list_field_groups", "get_fields"]) expect(OWNER_TOOLS_BY_NAME[name]?.gate).toBeUndefined();
    for (const name of ["set_fields", "create_field_group"]) expect(OWNER_TOOLS_BY_NAME[name]?.gate).toBe("public");
  });

  it("gives every tool words for the progress line, and JSON Schema without refs", () => {
    for (const name of ["list_field_groups", "get_fields", "set_fields", "create_field_group"]) {
      expect(TOOL_WORDS[name], name).toBeTruthy();
      const definition = toolDefinition(OWNER_TOOLS_BY_NAME[name]);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
    // Every tool, of the store's and the manager's, has words.
    for (const tool of [...OWNER_TOOLS, ...MANAGER_TOOLS]) expect(TOOL_WORDS[tool.name], tool.name).toBeTruthy();
  });

  it("checks the arguments", () => {
    const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);
    expect(read("get_fields", { entity: "product", item: "mug" })).toMatchObject({ ok: true });
    expect(read("get_fields", { entity: "variant", item: "mug" })).toMatchObject({ ok: false });
    expect(
      read("set_fields", {
        entity: "product",
        item: "mug",
        values: { material: "Stoneware", weight: 300, dishwasher_safe: true, tags: ["a"], old: null },
      }),
    ).toMatchObject({ ok: true });
    expect(read("set_fields", { entity: "product", item: "mug", values: { x: { nested: 1 } } })).toMatchObject({
      ok: false,
    });
    expect(read("set_fields", { entity: "product", item: "mug" })).toMatchObject({ ok: false });
    const made = read("create_field_group", {
      name: "Specs",
      fields: [{ label: "Material" }, { label: "Size", type: "select", options: ["S", "M"] }],
    });
    expect(made).toMatchObject({
      ok: true,
      input: {
        entity: "product",
        fields: [
          { type: "text", required: false, access: "private" },
          { type: "select", access: "private" },
        ],
      },
    });
    // The structural types are the admin editor's.
    for (const type of ["repeater", "group", "image", "file", "link", "product"]) {
      expect(read("create_field_group", { name: "x", fields: [{ label: "y", type }] }), type).toMatchObject({
        ok: false,
      });
    }
    expect(read("create_field_group", { name: "x", fields: [] })).toMatchObject({ ok: false });
  });

  it("describes what the owner approves", () => {
    expect(
      approvalSummary("create_field_group", {
        name: "Specs",
        entity: "product",
        fields: [
          { label: "Material", type: "text" },
          { label: "Size", type: "select", access: "public" },
        ],
      }),
    ).toBe('Create the custom field group "Specs" for products: Material (text), Size (select, shown on the site).');
    expect(
      approvalSummary("set_fields", {
        entity: "product",
        item: "mug",
        values: { material: "Stoneware", old: null, weight: 300 },
      }),
    ).toBe('Set the custom fields of the product "mug": material = "Stoneware"; old cleared; weight = 300.');
  });

  it("has a skill and knows the fields page", () => {
    const skill = ASSISTANT_SKILLS.find((s) => s.id === "custom-fields");
    expect(skill).toMatchObject({ area: "store" });
    expect(skill!.steps.join(" ")).toContain("private until made public");
    expect(skill!.steps.join(" ")).toContain("Custom fields component");
    expect(ADMIN_PAGES.some((p) => p.area === "store" && p.id === "fields")).toBe(true);
  });
});

describe("choosing and coercing what the model says", () => {
  const size = def({
    type: "select",
    label: "Size",
    choices: [
      { key: "s", label: "Small", labels: { nb: "Liten" } },
      { key: "m", label: "Medium" },
    ],
  });
  const tags = def({
    type: "checkbox",
    label: "Features",
    choices: [
      { key: "a", label: "Dishwasher safe" },
      { key: "b", label: "Microwave safe" },
    ],
  });

  it("turns a choice's label, in any language, into its key", () => {
    expect(coerceFieldValue(size, "small", "the editor")).toEqual({ ok: true, value: "s" });
    expect(coerceFieldValue(size, "Liten", "the editor")).toEqual({ ok: true, value: "s" });
    expect(coerceFieldValue(size, "m", "the editor")).toEqual({ ok: true, value: "m" });
    expect(coerceFieldValue(size, "Huge", "the editor")).toMatchObject({
      ok: false,
      problem: expect.stringContaining("Small, Medium"),
    });
    expect(coerceFieldValue(tags, ["dishwasher safe", "b"], "the editor")).toEqual({ ok: true, value: ["a", "b"] });
    expect(coerceFieldValue(tags, "Dishwasher safe, Microwave safe", "the editor")).toEqual({
      ok: true,
      value: ["a", "b"],
    });
    expect(coerceFieldValue(tags, ["Nope"], "the editor")).toMatchObject({ ok: false });
  });

  it("reads yes and no, numbers, measurements and rich text", () => {
    expect(coerceFieldValue(def({ type: "boolean" }), "Yes", "e")).toEqual({ ok: true, value: true });
    expect(coerceFieldValue(def({ type: "boolean" }), false, "e")).toEqual({ ok: true, value: false });
    expect(coerceFieldValue(def({ type: "boolean" }), "maybe", "e")).toMatchObject({ ok: false });
    expect(coerceFieldValue(def({ type: "number" }), "12,5", "e")).toEqual({ ok: true, value: "12,5" });
    const weight = def({ type: "measurement", units: ["g", "kg"] });
    expect(coerceFieldValue(weight, "250 g", "e")).toEqual({ ok: true, value: { value: "250", unit: "g" } });
    expect(parseValue(weight, (coerceFieldValue(weight, "1,5 kg", "e") as { value: unknown }).value)).toEqual({
      ok: true,
      value: { value: 1.5, unit: "kg" },
    });
    expect(parseValue(weight, (coerceFieldValue(weight, 300, "e") as { value: unknown }).value)).toEqual({
      ok: true,
      value: { value: 300, unit: "g" },
    });
    expect(coerceFieldValue(def({ type: "text" }), 42, "e")).toEqual({ ok: true, value: "42" });
    const rich = coerceFieldValue(def({ type: "richText" }), "One\nTwo\n\n- a\n- b", "e") as {
      value: ReturnType<typeof plainToRich>;
    };
    expect(richTextPlain(rich.value)).toBe("One Two\na\nb");
    expect(rich.value.content.map((b) => b.type)).toEqual(["paragraph", "bulletList"]);
    expect(parseValue(def({ type: "richText" }), rich.value)).toMatchObject({ ok: true });
  });

  it("clears with null or nothing", () => {
    for (const type of ["text", "number", "select", "checkbox", "boolean", "date"] as const) {
      expect(coerceFieldValue(def({ type, choices: size.choices }), null, "e"), type).toEqual({
        ok: true,
        value: null,
      });
    }
    expect(coerceFieldValue(size, "", "e")).toEqual({ ok: true, value: null });
    expect(coerceFieldValue(tags, [], "e")).toEqual({ ok: true, value: null });
  });

  it("refuses pictures, files, links, relations, groups and repeaters, pointing at the editor", () => {
    for (const type of [
      "image",
      "gallery",
      "video",
      "file",
      "link",
      "product",
      "page",
      "term",
      "group",
      "repeater",
    ] as const) {
      const refused = coerceFieldValue(
        def({ type, label: "Thing" }),
        "x",
        "the product's editor (/admin/kaffe/products/1)",
      );
      expect(refused, type).toMatchObject({ ok: false, problem: expect.stringContaining("/admin/kaffe/products/1") });
    }
    for (const type of SIMPLE_FIELD_TYPES)
      expect(coerceFieldValue(def({ type, choices: size.choices, units: ["g"] }), null, "e"), type).toMatchObject({
        ok: true,
      });
  });
});

describe("naming fields, and the words the claims filter reads", () => {
  const material = def({ type: "text", label: "Material", name: "material" });
  const shape = def({ type: "text", label: "Shape", name: "shape", id: "f_shape0000" });

  it("finds a field by name or label, and says when two groups share a name", () => {
    const a = { group: { name: "A", slug: "a" }, def: material };
    const b = { group: { name: "B", slug: "b" }, def: { ...material, id: "f_material2" } };
    expect(resolveField("material", [a])).toMatchObject({ ok: true });
    expect(resolveField("MATERIAL", [a])).toMatchObject({ ok: true });
    expect(resolveField("material", [a, b])).toMatchObject({
      ok: false,
      problem: expect.stringContaining("a.material or b.material"),
    });
    expect(resolveField("b.material", [a, b])).toMatchObject({ ok: true, candidate: { group: { slug: "b" } } });
    expect(resolveField("colour", [a])).toMatchObject({
      ok: false,
      problem: expect.stringContaining("Its fields: material"),
    });
  });

  it("collects every problem at once, and reads only free text for claims", () => {
    const candidates = [
      material,
      shape,
      def({ type: "number", label: "Weight", name: "weight", id: "f_weight000" }),
    ].map((d) => ({ group: group([d]), def: d }));
    const bad = prepareValues({ material: "Wool", colour: "red", weight: true }, candidates, "the editor");
    expect(bad).toMatchObject({
      ok: false,
      problems: [expect.stringContaining('no field "colour"'), "Weight: give a number."],
    });
    const good = prepareValues({ material: "An eco-friendly wool", weight: 3 }, candidates, "the editor");
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    // Only the words a person wrote are read; the claims filter finds the green claim.
    expect(wordsIn(good.prepared)).toEqual(["An eco-friendly wool"]);
    expect(findClaims(wordsIn(good.prepared)[0]).map((c) => c.kind)).toEqual(["green"]);
  });
});

describe("showing a value and a rule", () => {
  it("cuts long text and says what structural values hold", () => {
    const words = { yes: "Yes", no: "No" };
    expect(fieldValueText(def({ type: "text" }), "x".repeat(600), "en-GB", words, 50)).toHaveLength(50);
    expect(fieldValueText(def({ type: "boolean" }), false, "en-GB", words)).toBe("No");
    expect(fieldValueText(def({ type: "select", choices: [{ key: "s", label: "Small" }] }), "s", "en-GB", words)).toBe(
      "Small",
    );
    expect(
      fieldValueText(def({ type: "repeater" }), [{ id: "r_abcdef" }, { id: "r_abcdeg" }], "en-GB", words),
    ).toContain("2 rows");
    expect(fieldValueText(def({ type: "number", unit: "cm" }), 12, "en-GB", words)).toBe("12 cm");
  });

  it("writes location rules in words", () => {
    const names = new Map([["c1", "Mugs"]]);
    expect(describeLocation({ entities: ["product"], location: [] }, names)).toBe("all of them");
    expect(
      describeLocation(
        {
          entities: ["product"],
          location: [
            [
              { param: "category", operator: "==", value: "c1" },
              { param: "kind", operator: "!=", value: "goods" },
            ],
            [{ param: "audience", operator: "==", value: "businesses" }],
          ],
        },
        names,
      ),
    ).toBe("Category is Mugs and Kind of product is not Goods, or Sold to is Businesses");
  });
});

describe("building a group", () => {
  it("makes a valid, private group with keys and names from the labels", () => {
    const built = buildFieldGroup(
      {
        name: "Size guide",
        entity: "product",
        fields: [
          { label: "Fits like", type: "select", options: ["Small", "True to size", "Small"] },
          { label: "Weight", type: "measurement", units: ["g", "kg"], required: true },
          { label: "Dishwasher safe", type: "boolean", access: "public" },
          { label: "Fits like", type: "text" },
        ],
      },
      ["size-guide"],
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.group).toMatchObject({
      id: null,
      slug: "size-guide-2",
      entities: ["product"],
      location: [],
      active: true,
    });
    const [fits, weight, dishwasher, again] = built.group.fields;
    expect(fits).toMatchObject({
      name: "fits_like",
      access: "private",
      choices: [
        { key: "small", label: "Small" },
        { key: "true-to-size", label: "True to size" },
      ],
    });
    expect(weight).toMatchObject({ required: true, units: ["g", "kg"] });
    expect(dishwasher.access).toBe("public");
    expect(again.name).toBe("fits_like_2");
    expect(new Set(built.group.fields.map((f) => f.id)).size).toBe(4);
  });

  it("says what is missing", () => {
    expect(
      buildFieldGroup({ name: "x", entity: "page", fields: [{ label: "Pick", type: "select" }] }, []),
    ).toMatchObject({ ok: false, problem: expect.stringContaining("give its options") });
    expect(
      buildFieldGroup({ name: "x", entity: "page", fields: [{ label: "Weight", type: "measurement" }] }, []),
    ).toMatchObject({ ok: false, problem: expect.stringContaining("give its units") });
    expect(
      buildFieldGroup({ name: "x", entity: "page", fields: [{ label: "Note", type: "text", options: ["a"] }] }, []),
    ).toMatchObject({ ok: false, problem: expect.stringContaining("no options") });
  });
});
