import { describe, expect, it } from "vitest";

import type { FieldDef, FieldGroup, ShownField, ShownGroup } from "./custom-fields";
import { isTileFieldType, tileEntity, tileFieldIds, tileFieldOptions, tileLines } from "./tile-fields";

const shown = (id: string, type: ShownField["type"], text: string, label = id): ShownField => ({
  id,
  name: id,
  label,
  type,
  value: text,
  text,
});
const groups: ShownGroup[] = [
  {
    id: "g1",
    name: "Specs",
    slug: "specs",
    position: "main",
    fields: [
      shown("f_material", "text", "Oak", "Material"),
      shown("f_weight00", "number", "250 g", "Weight"),
      shown("f_photo000", "image", "", "Photo"),
      shown("f_guide000", "link", "Guide", "Guide"),
      shown("f_blank000", "text", "  ", "Blank"),
    ],
  },
];

describe("fields on a grid's tiles (D120)", () => {
  it("takes only the types that are plain words", () => {
    for (const type of ["text", "number", "measurement", "select", "radio", "buttons", "checkbox", "boolean", "date"]) {
      expect(isTileFieldType(type), type).toBe(true);
    }
    for (const type of [
      "image",
      "gallery",
      "file",
      "link",
      "product",
      "page",
      "term",
      "group",
      "repeater",
      "richText",
    ]) {
      expect(isTileFieldType(type), type).toBe(false);
    }
  });

  it("makes a line of each named field that has words, in the grid's order, leaving the rest out", () => {
    expect(tileLines(groups, ["f_weight00", "f_material"])).toEqual([
      { label: "Weight", text: "250 g" },
      { label: "Material", text: "Oak" },
    ]);
    expect(tileLines(groups, ["f_photo000", "f_guide000", "f_blank000", "f_missing0"])).toEqual([]);
    expect(tileLines([], ["f_material"])).toEqual([]);
  });

  it("keeps a line short", () => {
    const long = [{ ...groups[0], fields: [shown("f_material", "text", "x".repeat(500))] }];
    expect(tileLines(long, ["f_material"])[0].text).toHaveLength(120);
  });

  it("asks for each id once, at most three", () => {
    expect(tileFieldIds({})).toEqual([]);
    expect(tileFieldIds({ tileFields: ["f_a", "f_a", "f_b", "f_c", "f_d"] })).toEqual(["f_a", "f_b", "f_c"]);
  });

  it("names the kind of thing a grid lists", () => {
    expect(tileEntity({ type: "products" })).toBe("product");
    expect(tileEntity({ type: "articles" })).toBe("article");
    expect(tileEntity({ type: "pages" })).toBe("page");
  });

  it("offers only the plain fields of each group, and no group without one", () => {
    const def = (id: string, type: FieldDef["type"]): FieldDef => ({ id, name: id, label: id, type, access: "public" });
    const group = (id: string, fields: FieldDef[]) => ({ id, name: id, fields }) as unknown as FieldGroup;
    const options = tileFieldOptions([
      group("a", [def("f_1", "text"), def("f_2", "image"), def("f_3", "boolean")]),
      group("b", [def("f_4", "repeater")]),
    ]);
    expect(options.map((o) => [o.group.id, o.fields.map((f) => f.id)])).toEqual([["a", ["f_1", "f_3"]]]);
  });
});
