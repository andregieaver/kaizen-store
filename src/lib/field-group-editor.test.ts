import { describe, expect, it } from "vitest";

import { emptyGroup, fieldGroupInput, newField, type FieldDef } from "./custom-fields";
import {
  SUB_FIELD_TYPES,
  addSubField,
  choiceKey,
  cloneField,
  duplicateSubField,
  fieldProblems,
  hasTypeSettings,
  moveSubField,
  removeSubField,
  replaceSubField,
  subFieldsSummary,
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

  describe("fields inside a group or repeater", () => {
    const repeaterWith = () => {
      const flag = field("boolean", "Special");
      const why = {
        ...field("text", "Reason", [flag.name]),
        when: [[{ field: flag.id, operator: "==" as const, value: "1" }]],
      };
      const other = field("text", "Other", [flag.name, why.name]);
      const parent = { ...field("repeater", "Features"), subFields: [flag, why, other] };
      return { flag, why, other, parent };
    };

    it("offers every type inside a group or repeater but a group or repeater", () => {
      expect(SUB_FIELD_TYPES).toContain("text");
      expect(SUB_FIELD_TYPES).toContain("file");
      expect(SUB_FIELD_TYPES).toContain("link");
      expect(SUB_FIELD_TYPES).not.toContain("group");
      expect(SUB_FIELD_TYPES).not.toContain("repeater");
    });

    it("adds a field at the end, named apart from the others, and refuses a group inside a group", () => {
      const { parent } = repeaterWith();
      const result = addSubField([parent], parent.id, "text");
      const taken = (parent.subFields ?? []).map((s) => s.name);
      expect(result.added?.name).toBeTruthy();
      expect(taken).not.toContain(result.added?.name);
      expect(result.fields[0].subFields).toHaveLength(4);
      expect(result.fields[0].subFields?.[3].id).toBe(result.added?.id);
      // The name is taken now.
      const again = addSubField(result.fields, parent.id, "text").added?.name;
      expect(again).not.toBe(result.added?.name);
      expect(taken).not.toContain(again);
      expect(addSubField([parent], parent.id, "group").added).toBeNull();
      const plain = field("text", "Plain");
      expect(addSubField([plain], plain.id, "text").added).toBeNull();
      expect(addSubField([parent], "f_missing00000", "text").added).toBeNull();
    });

    it("takes away the conditions that looked at a field taken out", () => {
      const { flag, why, other, parent } = repeaterWith();
      const result = removeSubField([parent], parent.id, flag.id);
      expect(result.fields[0].subFields?.map((s) => s.id)).toEqual([why.id, other.id]);
      expect(result.fields[0].subFields?.[0].when).toBeUndefined();
      expect(result.changed).toEqual(["Reason"]);
      // Taking out one nothing looks at changes nothing else.
      const quiet = removeSubField([parent], parent.id, other.id);
      expect(quiet.changed).toEqual([]);
      expect(quiet.fields[0].subFields).toHaveLength(2);
    });

    it("takes away the conditions of a field moved above what it looks at", () => {
      const { flag, why, parent } = repeaterWith();
      const moved = moveSubField([parent], parent.id, 0, 2);
      expect(moved[0].subFields?.map((s) => s.id)).toEqual([why.id, moved[0].subFields?.[1].id, flag.id]);
      expect(moved[0].subFields?.[0].when).toBeUndefined();
      // A move that keeps the order of the trigger and the field keeps the logic.
      const kept = moveSubField([parent], parent.id, 2, 0);
      expect(kept[0].subFields?.[1].when).toBeUndefined();
      const fine = moveSubField([parent], parent.id, 2, 1);
      expect(fine[0].subFields?.[2].id).toBe(why.id);
      expect(fine[0].subFields?.[2].when).toHaveLength(1);
      // The parent's own logic is left alone.
      const trigger = field("boolean", "Show");
      const shy = { ...parent, when: [[{ field: trigger.id, operator: "==" as const, value: "1" }]] };
      expect(moveSubField([trigger, shy], shy.id, 0, 1)[1].when).toEqual(shy.when);
    });

    it("replaces an edited field inside", () => {
      const { why, parent } = repeaterWith();
      const result = replaceSubField([parent], parent.id, { ...why, label: "Because" });
      expect(result[0].subFields?.[1].label).toBe("Because");
      expect(result[0].subFields).toHaveLength(3);
    });

    it("duplicates a field inside with an id and a name of its own", () => {
      const { why, parent } = repeaterWith();
      const result = duplicateSubField([parent], parent.id, why.id);
      expect(result?.fields[0].subFields).toHaveLength(4);
      expect(result?.copy.id).not.toBe(why.id);
      expect(result?.copy.name).not.toBe(why.name);
      expect(duplicateSubField([parent], parent.id, "f_missing00000")).toBeNull();
    });

    it("takes away the logic of fields whose trigger a whole group's removal leaves, top level and inside alike", () => {
      const { parent, flag } = repeaterWith();
      const outer = field("boolean", "Outer");
      const gated = {
        ...field("text", "Gated", [outer.name]),
        when: [[{ field: outer.id, operator: "has" as const }]],
      };
      const result = pruneConditions([outer, parent, gated]);
      expect(result.changed).toEqual([]);
      // The trigger inside is not a trigger for a top-level field: its logic goes.
      const wrong = { ...gated, when: [[{ field: flag.id, operator: "has" as const }]] };
      const wrongResult = pruneConditions([parent, wrong]);
      expect(wrongResult.changed).toEqual(["Gated"]);
      expect(wrongResult.fields[1].when).toBeUndefined();
      // Removing the parent leaves its fields' logic with it; a top-level field looking at the parent goes.
      const looksAtParent = { ...gated, when: [[{ field: parent.id, operator: "has" as const }]] };
      expect(pruneConditions([looksAtParent]).fields[0].when).toBeUndefined();
      // Conditions inside are pruned by what is above them inside.
      const broken = { ...parent, subFields: [parent.subFields?.[1] as FieldDef, parent.subFields?.[0] as FieldDef] };
      const inside = pruneConditions([broken]);
      expect(inside.changed).toEqual(["Reason"]);
      expect(inside.fields[0].subFields?.[0].when).toBeUndefined();
    });

    it("gives a copy of a group new ids all through, conditions following", () => {
      const { parent, flag, why } = repeaterWith();
      const copy = cloneField(parent);
      const ids = [parent.id, ...(parent.subFields ?? []).map((s) => s.id)];
      const copyIds = [copy.id, ...(copy.subFields ?? []).map((s) => s.id)];
      expect(copyIds).toHaveLength(4);
      expect(copyIds.some((id) => ids.includes(id))).toBe(false);
      expect(new Set(copyIds).size).toBe(4);
      const copyFlag = copy.subFields?.[0];
      expect(copy.subFields?.[1].when?.[0][0].field).toBe(copyFlag?.id);
      expect(copy.subFields?.[1].when?.[0][0].field).not.toBe(flag.id);
      // The original is untouched.
      expect(parent.subFields?.[1].when?.[0][0].field).toBe(flag.id);
      expect(why.when?.[0][0].field).toBe(flag.id);
    });

    it("duplicates a group so that the two save together", () => {
      const { parent } = repeaterWith();
      const result = duplicateField([parent], parent.id);
      const draft = { ...emptyGroup("product"), name: "Box", slug: "box", fields: result?.fields ?? [] };
      expect(draft.fields).toHaveLength(2);
      expect(fieldGroupInput.safeParse(draft).success).toBe(true);
    });

    it("finds broken logic inside, and marks the group or repeater too", () => {
      const { parent, why } = repeaterWith();
      expect(fieldsWithBrokenLogic([parent]).size).toBe(0);
      const broken = { ...parent, subFields: [parent.subFields?.[1] as FieldDef, parent.subFields?.[0] as FieldDef] };
      expect([...fieldsWithBrokenLogic([broken])].sort()).toEqual([broken.id, why.id].sort());
      const draft = { ...emptyGroup("product"), name: "Box", slug: "box", fields: [broken] };
      expect(draftProblems(draft)).toHaveLength(1);
      expect(draftProblems({ ...draft, fields: [parent] })).toEqual([]);
      expect(fieldGroupInput.safeParse({ ...draft, fields: [parent] }).success).toBe(true);
      expect(fieldGroupInput.safeParse(draft).success).toBe(false);
    });

    it("asks for fields in an empty group or repeater", () => {
      const empty = { ...field("group", "Size"), subFields: [] };
      const draft = { ...emptyGroup("product"), name: "Box", slug: "box", fields: [empty] };
      expect(draftProblems(draft)).toEqual(["Add fields to Size."]);
    });

    it("says what a group or repeater holds", () => {
      const { parent } = repeaterWith();
      expect(subFieldsSummary(parent)).toBe("3 fields: Special, Reason, Other");
      expect(subFieldsSummary({ type: "group", subFields: [] })).toBe("No fields yet");
      expect(subFieldsSummary({ type: "text" })).toBe("No fields yet");
      const many = { ...parent, subFields: [...(parent.subFields ?? []), field("text", "Fourth", ["a", "b", "c"])] };
      expect(subFieldsSummary(many)).toBe("4 fields: Special, Reason, Other …");
    });
  });

  describe("what is wrong with a field before Apply", () => {
    it("checks a field's label, name and choices", () => {
      const a = field("select", "Fit");
      expect(fieldProblems(a, [], [])).toEqual([]);
      expect(fieldProblems({ ...a, label: " " }, [], [])).toEqual(["Give the field a label."]);
      expect(fieldProblems({ ...a, name: "Bad Name" }, [], [])[0]).toMatch(/lowercase/);
      expect(fieldProblems(a, [a.name], [])).toEqual([`Another field is already named ${a.name}.`]);
      expect(fieldProblems({ ...a, choices: [] }, [], [])).toEqual(["Add at least one choice."]);
      expect(fieldProblems({ ...a, min: 5, max: 1 }, [], [])).toEqual(["The least is more than the most."]);
    });

    it("checks the fields inside a group or repeater, and names the one at fault", () => {
      const inner = { ...field("select", "Kind"), choices: [] };
      const parent = { ...field("repeater", "Rows"), subFields: [field("text", "Title"), inner] };
      expect(fieldProblems(parent, [], [])).toEqual(["Kind: Add at least one choice."]);
      expect(fieldProblems({ ...parent, subFields: [] }, [], [])).toEqual(["Add at least one field to the repeater."]);
      expect(fieldProblems({ ...field("group", "G"), subFields: [] }, [], [])).toEqual([
        "Add at least one field to the group.",
      ]);
      const twins = {
        ...field("group", "G"),
        subFields: [
          { ...field("text", "A"), name: "same" },
          { ...field("text", "B"), name: "same" },
        ],
      };
      expect(fieldProblems(twins, [], [])).toEqual([
        "A: Another field is already named same.",
        "B: Another field is already named same.",
      ]);
    });

    it("checks a repeater's fewest and most rows", () => {
      const parent = { ...field("repeater", "Rows"), minRows: 5, maxRows: 2 };
      expect(fieldProblems(parent, [], [])).toEqual(["The fewest rows is more than the most."]);
      expect(fieldProblems({ ...parent, minRows: 1, maxRows: 2 }, [], [])).toEqual([]);
    });

    it("finds logic that looks at a field that is no longer above", () => {
      const trigger = field("boolean", "Show");
      const shy = {
        ...field("text", "Shy", [trigger.name]),
        when: [[{ field: trigger.id, operator: "has" as const }]],
      };
      expect(fieldProblems(shy, [], [trigger])).toEqual([]);
      expect(fieldProblems(shy, [], [])).toEqual(["The logic looks at a field that is no longer above this one."]);
    });

    it("knows which types have settings of their own", () => {
      expect(hasTypeSettings("text")).toBe(true);
      expect(hasTypeSettings("select")).toBe(true);
      expect(hasTypeSettings("term")).toBe(true);
      expect(hasTypeSettings("repeater")).toBe(true);
      expect(hasTypeSettings("file")).toBe(false);
      expect(hasTypeSettings("link")).toBe(false);
      expect(hasTypeSettings("group")).toBe(false);
      expect(hasTypeSettings("boolean")).toBe(false);
    });
  });
});
