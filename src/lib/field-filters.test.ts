import { describe, expect, it } from "vitest";

import { newFieldId, type FieldDef, type FieldGroup } from "./custom-fields";
import { YES, fieldFilterValues, filterableFields } from "./field-filters";

const field = (over: Partial<FieldDef> & Pick<FieldDef, "type" | "name">): FieldDef => ({
  id: newFieldId(),
  label: "Field",
  access: "public",
  filter: true,
  ...over,
});
const group = (fields: FieldDef[], over: Partial<FieldGroup> = {}): FieldGroup => ({
  id: "g1",
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
const choices = [
  { key: "wool", label: "Ull" },
  { key: "cotton", label: "Bomull" },
];

describe("custom fields as listing filters", () => {
  it("offers public fields flagged for filtering, of a type with a choice or a yes or no, in active groups for products", () => {
    const material = field({ type: "select", name: "material", choices });
    const organic = field({ type: "boolean", name: "organic" });
    const secret = field({ type: "select", name: "secret", choices, access: "private" });
    const plain = field({ type: "select", name: "plain", choices, filter: false });
    const text = field({ type: "text", name: "designer" });
    const nested = field({ type: "group", name: "box", subFields: [field({ type: "boolean", name: "inner" })] });
    const other = field({ type: "boolean", name: "page_only" });
    const found = filterableFields([
      group([material, organic, secret, plain, text, nested]),
      group([other], { entities: ["page"] }),
      group([field({ type: "boolean", name: "off" })], { active: false }),
    ]);
    expect(found.map((def) => def.name)).toEqual(["material", "organic"]);
  });

  it("names one field when two groups use the same name: the first", () => {
    const first = field({ type: "select", name: "material", choices });
    const second = field({ type: "boolean", name: "material" });
    expect(filterableFields([group([first]), group([second])])).toEqual([first]);
  });

  it("keeps only values a field can hold", () => {
    const material = field({ type: "checkbox", name: "material", choices });
    expect(fieldFilterValues(material, ["wool", "silk", "wool", "cotton"])).toEqual(["wool", "cotton"]);
    expect(fieldFilterValues(material, ["silk"])).toEqual([]);
    const organic = field({ type: "boolean", name: "organic" });
    expect(fieldFilterValues(organic, [YES, "0"])).toEqual([YES]);
    expect(fieldFilterValues(organic, ["0", "true"])).toEqual([]);
  });
});
