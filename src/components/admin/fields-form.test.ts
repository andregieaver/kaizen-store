import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FIELD_TYPE_KEYS, newField, type FieldData, type FieldDef, type FieldGroup } from "@/lib/custom-fields";

import { FieldsForm } from "./fields-form";

/**
 * The entry form is client code, but it renders on the server too: this holds
 * that every type of field draws, with and without a value, and that a field
 * its logic hides is not drawn.
 */

const group = (fields: FieldDef[]): FieldGroup => ({
  id: "g",
  name: "Specs",
  slug: "specs",
  entities: ["product"],
  location: [],
  fields,
  position: "main",
  active: true,
  sort: 0,
});

const html = (fields: FieldDef[], data: FieldData = { values: {}, translations: {} }, locale = "nb-NO") =>
  renderToString(
    createElement(FieldsForm, {
      groups: [group(fields)],
      data,
      onChange: () => {},
      locale,
      main: "nb-NO",
      upload: null,
    }),
  );

describe("the entry form for custom fields", () => {
  it("draws every type of field, empty", () => {
    for (const type of FIELD_TYPE_KEYS) {
      const field = { ...newField(type), label: `Label of ${type}` };
      const out = html([field]);
      expect(out, type).toContain(`Label of ${type}`);
    }
  });

  it("draws values and marks what only staff see and what is required", () => {
    const text = { ...newField("text"), label: "Material", required: true };
    const choice = {
      ...newField("select"),
      label: "Finish",
      access: "public" as const,
      choices: [{ key: "a", label: "Alpha" }],
    };
    const out = html([text, choice], { values: { [choice.id]: "a" }, translations: { "nb-NO": { [text.id]: "Ull" } } });
    expect(out).toContain('value="Ull"');
    expect(out).toContain("(only staff)");
    expect(out).toContain("Alpha");
    expect(out).toContain("*");
  });

  it("shows a text's main language as the hint while another language's is empty", () => {
    const text = { ...newField("text"), label: "Material" };
    const out = html([text], { values: {}, translations: { "nb-NO": { [text.id]: "Ull" } } }, "sv-SE");
    expect(out).toContain('placeholder="nb-NO: Ull"');
  });

  it("leaves out a field its logic hides", () => {
    const trigger = { ...newField("boolean"), label: "Has warranty" };
    const shy = {
      ...newField("text"),
      label: "Warranty terms",
      when: [[{ field: trigger.id, operator: "==" as const, value: "1" }]],
    };
    expect(html([trigger, shy])).not.toContain("Warranty terms");
    expect(html([trigger, shy], { values: { [trigger.id]: true }, translations: {} })).toContain("Warranty terms");
  });

  it("says so when a group has no fields", () => {
    expect(html([])).toContain("no fields yet");
  });
});
