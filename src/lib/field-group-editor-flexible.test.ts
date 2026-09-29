import { describe, expect, it } from "vitest";

import { MAX_LAYOUTS, newField, type FieldDef } from "./custom-fields";
import {
  addLayout,
  addSubField,
  cloneField,
  draftProblems,
  duplicateLayout,
  fieldProblems,
  fieldsWithBrokenLogic,
  hasTypeSettings,
  layoutHolder,
  layoutKey,
  layoutsSummary,
  moveLayout,
  pruneConditions,
  removeLayout,
  removeSubField,
  renameLayout,
  replaceLayout,
  subFieldsSummary,
  valueKindFor,
  withHeldFields,
} from "./field-group-editor";

const sub = (id: string, label: string, over: Partial<FieldDef> = {}): FieldDef => ({
  id,
  name: label.toLowerCase(),
  label,
  type: "text",
  access: "private",
  ...over,
});

const flexible = (): FieldDef => ({
  ...newField("flexible"),
  id: "f_flexible0001",
  name: "content",
  label: "Content",
  layouts: [
    { key: "text", label: "Text", subFields: [sub("f_head00000001", "Heading"), sub("f_body00000001", "Body")] },
    { key: "quote", label: "Quote", subFields: [sub("f_quote0000001", "Quote"), sub("f_author000001", "Author")] },
  ],
});

describe("a layout's key", () => {
  it("follows its label and is never one that is taken", () => {
    expect(layoutKey("Picture with caption", [])).toBe("picture-with-caption");
    expect(layoutKey("Text", ["text"])).toBe("text-2");
    expect(layoutKey("", [])).toBe("layout");
  });
});

describe("editing the layouts of flexible content", () => {
  it("adds a layout with a text field, keyed and labelled apart from the others, up to the limit", () => {
    const first = addLayout([flexible()], "f_flexible0001");
    expect(first.added).toMatchObject({ key: "new-layout", label: "New layout" });
    expect(first.added?.subFields).toHaveLength(1);
    const second = addLayout(first.fields, "f_flexible0001");
    expect(second.added).toMatchObject({ key: "new-layout-2", label: "New layout 2" });
    expect(second.fields[0].layouts?.map((l) => l.key)).toEqual(["text", "quote", "new-layout", "new-layout-2"]);

    const full: FieldDef = {
      ...flexible(),
      layouts: Array.from({ length: MAX_LAYOUTS }, (_, i) => ({
        key: `l${i}`,
        label: `L${i}`,
        subFields: [sub(`f_full${String(i).padStart(8, "0")}`, "T")],
      })),
    };
    expect(addLayout([full], full.id).added).toBeNull();
    expect(addLayout([newField("group")], "nope").added).toBeNull();
  });

  it("renames a layout without changing its key, replaces it, moves it and removes it", () => {
    const fields = [flexible()];
    expect(renameLayout(fields, "f_flexible0001", "quote", "Pull quote")[0].layouts?.[1]).toMatchObject({
      key: "quote",
      label: "Pull quote",
    });
    const changed = replaceLayout(fields, "f_flexible0001", "quote", {
      key: "citation",
      label: "Citation",
      subFields: [],
    });
    expect(changed[0].layouts?.[1]).toMatchObject({ key: "citation", subFields: [] });
    expect(moveLayout(fields, "f_flexible0001", 0, 1)[0].layouts?.map((l) => l.key)).toEqual(["quote", "text"]);
    expect(moveLayout(fields, "f_flexible0001", 0, 5)[0].layouts?.map((l) => l.key)).toEqual(["text", "quote"]);
    expect(removeLayout(fields, "f_flexible0001", "text")[0].layouts?.map((l) => l.key)).toEqual(["quote"]);
    // The others are left as they were.
    expect(fields[0].layouts).toHaveLength(2);
  });

  it("duplicates a layout next to itself with new field ids and a key and label of its own", () => {
    const result = duplicateLayout([flexible()], "f_flexible0001", "text");
    expect(result?.copy).toMatchObject({ key: "text-copy", label: "Text (copy)" });
    expect(result?.fields[0].layouts?.map((l) => l.key)).toEqual(["text", "text-copy", "quote"]);
    const ids = result?.fields[0].layouts?.flatMap((l) => l.subFields.map((s) => s.id)) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(duplicateLayout([flexible()], "f_flexible0001", "missing")).toBeNull();
  });

  it("edits the fields inside a layout with the same functions as a group's, through a stand-in group", () => {
    const parent = flexible();
    const layout = parent.layouts![0];
    const holder = layoutHolder(layout, parent);
    expect(holder).toMatchObject({ type: "group", label: "Text", access: parent.access });
    const added = addSubField([holder], holder.id, "number");
    expect(added.added?.type).toBe("number");
    const back = withHeldFields(layout, added.fields[0]);
    expect(back.subFields.map((s) => s.label)).toEqual(["Heading", "Body", "Number"]);
    expect(removeSubField([holder], holder.id, "f_head00000001").fields[0].subFields).toHaveLength(1);
    // A layout cannot hold a group, repeater or flexible content.
    expect(addSubField([holder], holder.id, "flexible").added).toBeNull();
  });

  it("keeps the conditions inside a layout to the fields above them there", () => {
    const parent = flexible();
    parent.layouts![1].subFields[1] = sub("f_author000001", "Author", {
      when: [[{ field: "f_quote0000001", operator: "has" }]],
    });
    expect(fieldsWithBrokenLogic([parent]).size).toBe(0);
    // A condition on a field of another layout is broken, and is taken away by pruning.
    parent.layouts![1].subFields[1] = sub("f_author000001", "Author", {
      when: [[{ field: "f_head00000001", operator: "has" }]],
    });
    expect([...fieldsWithBrokenLogic([parent])].sort()).toEqual(["f_author000001", "f_flexible0001"]);
    const pruned = pruneConditions([parent]);
    expect(pruned.changed).toEqual(["Author"]);
    expect(pruned.fields[0].layouts?.[1].subFields[1].when).toBeUndefined();
  });

  it("copies a field with new ids in every layout", () => {
    const copy = cloneField(flexible());
    const before = flexible().layouts!.flatMap((l) => l.subFields.map((s) => s.id));
    const after = copy.layouts!.flatMap((l) => l.subFields.map((s) => s.id));
    expect(after).toHaveLength(before.length);
    expect(after.filter((id) => before.includes(id))).toEqual([]);
    expect(copy.layouts?.map((l) => l.key)).toEqual(["text", "quote"]);
  });
});

describe("what the dialog says about flexible content", () => {
  it("lists its layouts in a line", () => {
    expect(layoutsSummary(flexible())).toBe("2 layouts: Text, Quote");
    expect(layoutsSummary({ layouts: [] })).toBe("No layouts yet");
    expect(subFieldsSummary(flexible())).toBe("2 layouts: Text, Quote");
    expect(subFieldsSummary(newField("group"))).toMatch(/^1 field: Text$/);
  });

  it("says what is wrong before the field is applied", () => {
    expect(fieldProblems(flexible(), [], [])).toEqual([]);
    expect(fieldProblems({ ...flexible(), layouts: [] }, [], [])).toContain("Add at least one layout.");
    const twice: FieldDef = {
      ...flexible(),
      layouts: [
        { key: "a", label: "A", subFields: [sub("f_aaaa00000001", "A")] },
        { key: "a", label: "", subFields: [] },
      ],
    };
    const problems = fieldProblems(twice, [], []);
    expect(problems).toContain("Two layouts have the same key.");
    expect(problems).toContain("Give each layout a label.");
    expect(problems).toContain("Add at least one field to the layout a.");
    expect(fieldProblems({ ...flexible(), minRows: 3, maxRows: 2 }, [], [])).toContain(
      "The fewest rows is more than the most.",
    );
    // A problem inside a layout's field names the layout and the field.
    const bad = flexible();
    bad.layouts![0].subFields[0] = sub("f_head00000001", "", {});
    expect(fieldProblems(bad, [], []).join(" ")).toMatch(/Text, a field inside: Give the field a label\./);
  });

  it("is checked with the group before it is saved", () => {
    const problems = draftProblems({
      id: null,
      name: "G",
      slug: "g",
      entities: ["product"],
      location: [],
      fields: [
        { ...flexible(), layouts: [] },
        { ...flexible(), id: "f_flexible0002", layouts: [{ key: "a", label: "A", subFields: [] }] },
      ],
      position: "main",
      active: true,
    });
    expect(problems).toContain("Add layouts to Content.");
    expect(problems).toContain("Add fields to every layout of Content.");
  });

  it("has settings of its own, and money has some too", () => {
    expect(hasTypeSettings("flexible")).toBe(true);
    expect(hasTypeSettings("money")).toBe(true);
    expect(valueKindFor("money", ">")).toBe("number");
    expect(valueKindFor("money", "has")).toBe("none");
  });
});
