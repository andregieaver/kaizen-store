import { describe, expect, it } from "vitest";

import { emptyGroup, fieldGroupInput, newField, type FieldDef } from "./custom-fields";
import {
  choiceKey,
  describeLocation,
  draftProblems,
  duplicateField,
  entitiesText,
  fieldsWithBrokenLogic,
  locationParamsFor,
  moveItem,
  newCondition,
  newLocationRule,
  parseUnits,
  pruneConditions,
  ruleFits,
  settleCondition,
  valueKindFor,
  withLabel,
} from "./field-group-editor";

const field = (type: Parameters<typeof newField>[0], label: string, taken: string[] = []): FieldDef => ({
  ...newField(type, taken),
  label,
});

describe("the field group generator's helpers (D118)", () => {
  it("moves an item and leaves the list alone when the move makes no sense", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("offers each location param once, for the kinds chosen", () => {
    const params = locationParamsFor(["product", "page"]).map((p) => p.param);
    expect(params).toEqual(["kind", "category", "tag", "audience", "role"]);
    expect(locationParamsFor(["article"]).map((p) => p.param)).toEqual(["category", "tag"]);
  });

  it("knows a rule that asks about something the kinds do not have", () => {
    expect(ruleFits({ param: "role", operator: "==", value: "blog" }, ["product"])).toBe(false);
    expect(ruleFits({ param: "role", operator: "==", value: "blog" }, ["product", "page"])).toBe(true);
    expect(newLocationRule(["product"])).toEqual({ param: "kind", operator: "==", value: "goods" });
    expect(newLocationRule(["article"])).toEqual({ param: "category", operator: "==", value: "" });
  });

  it("says where a group applies in words", () => {
    const lookup = {
      term: (id: string) => (id === "t1" ? "Shoes" : undefined),
      role: (role: string) => (role === "blog" ? "Blog page" : undefined),
    };
    expect(
      describeLocation(
        [
          [
            { param: "kind", operator: "==", value: "goods" },
            { param: "category", operator: "!=", value: "t1" },
          ],
          [{ param: "role", operator: "==", value: "blog" }],
          [{ param: "tag", operator: "==", value: "gone" }],
        ],
        lookup,
      ),
    ).toBe("Kind of product is Goods and Category is not Shoes or Special page is Blog page or Tag is a removed one");
    expect(entitiesText(["product", "page", "article"])).toBe("Products, pages and articles");
    expect(entitiesText(["page"])).toBe("Pages");
  });

  it("makes choice keys from labels, never twice", () => {
    expect(choiceKey("Runs small", [])).toBe("runs-small");
    expect(choiceKey("Runs small", ["runs-small"])).toBe("runs-small-2");
    expect(choiceKey("", [])).toBe("option");
  });

  it("reads units from a comma list", () => {
    expect(parseUnits(" g, kg ,, ")).toEqual(["g", "kg"]);
    expect(parseUnits("")).toEqual([]);
  });

  it("changes a label's translation and takes it away when emptied", () => {
    const one = withLabel({ labels: undefined }, "nb-NO", "Størrelse");
    expect(one.labels).toEqual({ "nb-NO": "Størrelse" });
    expect(withLabel(one, "nb-NO", "  ").labels).toBeUndefined();
  });

  it("duplicates a field next to the original with an id and name of its own", () => {
    const a = field("text", "Material");
    const b = field("number", "Weight", [a.name]);
    const result = duplicateField([a, b], a.id);
    expect(result?.fields.map((f) => f.label)).toEqual(["Material", "Material (copy)", "Weight"]);
    expect(result?.copy.id).not.toBe(a.id);
    expect(result?.copy.name).not.toBe(a.name);
    expect(duplicateField([a], "f_missing0000")).toBeNull();
  });

  it("keeps a copy's choices apart from the original's", () => {
    const a = field("select", "Fit");
    const result = duplicateField([a], a.id);
    result?.copy.choices?.push({ key: "extra", label: "Extra" });
    expect(a.choices).toHaveLength(2);
  });

  it("takes away conditions on fields that are gone or no longer above", () => {
    const a = field("boolean", "Has box");
    const b = {
      ...field("text", "Box size", [a.name]),
      when: [[{ field: a.id, operator: "==" as const, value: "1" }]],
    };
    expect(pruneConditions([a, b])).toEqual({ fields: [a, b], changed: [] });
    // The trigger is removed.
    expect(pruneConditions([b]).fields[0].when).toBeUndefined();
    expect(pruneConditions([b]).changed).toEqual(["Box size"]);
    // The trigger moved below.
    expect(pruneConditions([b, a]).fields[0].when).toBeUndefined();
    // One of two conditions in an AND survives.
    const c = {
      ...b,
      when: [
        [
          { field: a.id, operator: "==" as const, value: "1" },
          { field: "f_gone00000000", operator: "has" as const },
        ],
      ],
    };
    expect(pruneConditions([a, c]).fields[1].when).toEqual([[{ field: a.id, operator: "==", value: "1" }]]);
  });

  it("asks for a condition's value by what the field is", () => {
    expect(valueKindFor("select", "==")).toBe("choice");
    expect(valueKindFor("checkbox", "contains")).toBe("choice");
    expect(valueKindFor("boolean", "==")).toBe("boolean");
    expect(valueKindFor("number", ">")).toBe("number");
    expect(valueKindFor("date", "==")).toBe("date");
    expect(valueKindFor("text", "matches")).toBe("text");
    expect(valueKindFor("text", "has")).toBe("none");
    expect(valueKindFor(undefined, "==")).toBe("none");
  });

  it("settles a condition when the field it looks at, or the operator, changes", () => {
    const select = field("select", "Fit");
    const flag = field("boolean", "Vegan");
    expect(newCondition([])).toBeNull();
    expect(newCondition([select])).toEqual({ field: select.id, operator: "has" });
    // An operator the new field does not offer becomes its first.
    expect(settleCondition({ field: flag.id, operator: "matches", value: "x" }, flag)).toEqual({
      field: flag.id,
      operator: "==",
      value: "1",
    });
    // A value that is not one of the choices becomes the first choice.
    expect(settleCondition({ field: select.id, operator: "==", value: "nope" }, select)).toEqual({
      field: select.id,
      operator: "==",
      value: "option-1",
    });
    // No value is kept for an operator that needs none.
    expect(settleCondition({ field: select.id, operator: "has", value: "option-1" }, select)).toEqual({
      field: select.id,
      operator: "has",
    });
  });

  it("finds problems in a draft before it is sent", () => {
    const a = field("boolean", "Has box");
    const b = {
      ...field("text", "Box size", [a.name]),
      when: [[{ field: a.id, operator: "==" as const, value: "1" }]],
    };
    const draft = { ...emptyGroup("product"), name: "Box", slug: "box", fields: [a, b] };
    expect(draftProblems(draft)).toEqual([]);
    expect(fieldGroupInput.safeParse(draft).success).toBe(true);
    expect(draftProblems({ ...draft, fields: [b, a] })).toHaveLength(1);
    expect([...fieldsWithBrokenLogic([b, a])]).toEqual([b.id]);
    expect(fieldsWithBrokenLogic([a, b]).size).toBe(0);
    expect(draftProblems({ ...draft, location: [[{ param: "role", operator: "==", value: "blog" }]] })[0]).toMatch(
      /do not have/,
    );
    expect(draftProblems({ ...draft, location: [[{ param: "category", operator: "==", value: "" }]] })).toEqual([
      "Choose what each location rule compares with.",
    ]);
  });
});
