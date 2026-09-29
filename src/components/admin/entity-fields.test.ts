import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EMPTY_DATA, EMPTY_LOOKUPS, newField, type FieldGroup } from "@/lib/custom-fields";

import { EntityFields } from "./entity-fields";

/** The fields panel of an editor: a group in the side column must not be left out of a one-column editor. */

const group = (name: string, position: "main" | "side"): FieldGroup => ({
  id: `g-${name}`,
  name,
  slug: name.toLowerCase(),
  entities: ["product"],
  location: [],
  fields: [{ ...newField("text"), name: name.toLowerCase(), label: `${name} field` }],
  position,
  active: true,
  sort: 0,
});

const draw = (groups: FieldGroup[], side?: boolean) =>
  renderToString(
    createElement(EntityFields, {
      groups,
      data: EMPTY_DATA,
      onChange: () => {},
      locales: ["nb-NO"],
      main: "nb-NO",
      languageNames: { "nb-NO": "Norwegian" },
      upload: null,
      fileUpload: null,
      lookups: EMPTY_LOOKUPS,
      ...(side !== undefined && { side }),
    }),
  );

describe("EntityFields", () => {
  const groups = [group("Specs", "main"), group("Brand", "side")];

  it("draws every group when the editor does not split them by column", () => {
    const html = draw(groups);
    expect(html).toContain("Specs field");
    expect(html).toContain("Brand field");
  });

  it("draws one column's groups when asked to", () => {
    expect(draw(groups, true)).toContain("Brand field");
    expect(draw(groups, true)).not.toContain("Specs field");
    expect(draw(groups, false)).toContain("Specs field");
    expect(draw(groups, false)).not.toContain("Brand field");
  });

  it("draws nothing when no group applies", () => {
    expect(draw([])).toBe("");
  });
});
