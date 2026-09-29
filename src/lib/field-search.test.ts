import { describe, expect, it } from "vitest";

import { EMPTY_DATA, newFieldId, type FieldData, type FieldDef, type FieldGroup } from "./custom-fields";
import { FIELD_SEARCH_MAX, searchBodies } from "./field-search";

const field = (over: Partial<FieldDef> & Pick<FieldDef, "type">): FieldDef => ({
  id: newFieldId(),
  name: "f",
  label: "Field",
  access: "public",
  search: true,
  ...over,
});
const group = (fields: FieldDef[]): FieldGroup => ({
  id: "g1",
  name: "Details",
  slug: "details",
  entities: ["product"],
  location: [],
  fields,
  position: "main",
  active: true,
  sort: 0,
});
const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});

const LOCALES = ["nb-NO", "sv-SE"];

describe("the search text of a product's custom fields", () => {
  const designer = field({ type: "text", name: "designer" });
  const story = field({ type: "richText", name: "story" });
  const material = field({
    type: "select",
    name: "material",
    choices: [
      { key: "wool", label: "Ull", labels: { "sv-SE": "Ull (sv)" } },
      { key: "cotton", label: "Bomull" },
    ],
  });
  const care = field({
    type: "checkbox",
    name: "care",
    choices: [
      { key: "wash", label: "Maskinvask" },
      { key: "dry", label: "Tørketrommel" },
    ],
  });
  const weight = field({ type: "number", name: "weight" });
  const organic = field({ type: "boolean", name: "organic" });

  it("has each language's own words, the main language's where it has none, and choices by their labels", () => {
    const data: FieldData = {
      values: { [material.id]: "wool", [care.id]: ["wash", "dry"], [weight.id]: 250, [organic.id]: true },
      translations: {
        "nb-NO": { [designer.id]: "Kari Nordmann", [story.id]: doc("Vevd på Voss") },
        "sv-SE": { [designer.id]: "Kari Svensson" },
      },
    };
    const bodies = searchBodies([group([designer, story, material, care, weight, organic])], data, LOCALES, "nb-NO");
    expect(bodies["nb-NO"]).toBe("Kari Nordmann Vevd på Voss Ull Maskinvask Tørketrommel");
    // Swedish: its own designer and label, the Norwegian story, and no numbers or yes and no.
    expect(bodies["sv-SE"]).toBe("Kari Svensson Vevd på Voss Ull (sv) Maskinvask Tørketrommel");
  });

  it("leaves out private fields, unflagged fields, unsearchable types and fields hidden by their logic", () => {
    const hidden = field({
      type: "text",
      name: "hidden",
      when: [[{ field: designer.id, operator: "==", value: "nobody" }]],
    });
    const secret = field({ type: "text", name: "secret", access: "private" });
    const plain = field({ type: "text", name: "plain", search: false });
    const email = field({ type: "email", name: "email" });
    const data: FieldData = {
      values: { [email.id]: "a@b.no" },
      translations: {
        "nb-NO": { [designer.id]: "Kari", [hidden.id]: "skjult", [secret.id]: "hemmelig", [plain.id]: "vanlig" },
      },
    };
    expect(searchBodies([group([designer, hidden, secret, plain, email])], data, LOCALES, "nb-NO")).toEqual({
      "nb-NO": "Kari",
      "sv-SE": "Kari",
    });
  });

  it("reads flagged fields inside groups and repeaters, in the language of their words", () => {
    const label = field({ type: "text", name: "label" });
    const size = field({ type: "number", name: "cm" });
    const unflagged = field({ type: "text", name: "note", search: false });
    const grouped = field({ type: "group", name: "box", search: false, subFields: [label, size, unflagged] });
    const name = field({ type: "text", name: "name" });
    const kind = field({ type: "radio", name: "kind", choices: [{ key: "a", label: "Sterk" }] });
    const list = field({ type: "repeater", name: "parts", search: false, subFields: [name, kind] });
    const privateList = field({ type: "repeater", name: "hidden_parts", access: "private", subFields: [name] });
    const data: FieldData = {
      values: {
        [list.id]: [{ id: "r_aaaaaa", [kind.id]: "a" }, { id: "r_bbbbbb" }],
        [privateList.id]: [{ id: "r_cccccc" }],
      },
      translations: {
        "nb-NO": {
          [grouped.id]: { [label.id]: "Stor eske", [unflagged.id]: "ikke" },
          [list.id]: { r_aaaaaa: { [name.id]: "Skrue" }, r_bbbbbb: { [name.id]: "Mutter" } },
          [privateList.id]: { r_cccccc: { [name.id]: "hemmelig" } },
        },
        "sv-SE": { [list.id]: { r_bbbbbb: { [name.id]: "Mutter (sv)" } } },
      },
    };
    const bodies = searchBodies([group([grouped, list, privateList])], data, LOCALES, "nb-NO");
    expect(bodies["nb-NO"]).toBe("Stor eske Skrue Sterk Mutter");
    expect(bodies["sv-SE"]).toBe("Stor eske Skrue Sterk Mutter (sv)");
  });

  it("gives no entry to a language without words, and caps the text", () => {
    expect(searchBodies([group([designer])], EMPTY_DATA, LOCALES, "nb-NO")).toEqual({});
    expect(searchBodies([], EMPTY_DATA, LOCALES, "nb-NO")).toEqual({});
    const long = Array.from({ length: 2000 }, (_, i) => `ord${i}`).join(" ");
    const bodies = searchBodies(
      [group([designer])],
      { values: {}, translations: { "nb-NO": { [designer.id]: long } } },
      ["nb-NO"],
      "nb-NO",
    );
    expect(bodies["nb-NO"].length).toBeLessThanOrEqual(FIELD_SEARCH_MAX);
    expect(bodies["nb-NO"].startsWith("ord0 ord1")).toBe(true);
  });
});
