import { describe, expect, it } from "vitest";

import { featureGroups, parseMatrixForm, type PlanFeature } from "./plan-features";

const form = (entries: Record<string, string>) => ({ get: (name: string) => entries[name] ?? null });
const known = { featureIds: ["a", "b"], planIds: ["p1", "p2"] };
const feature = (id: string, category: string, position: number, name = id): PlanFeature => ({
  id,
  category,
  name,
  description: "",
  position,
  planIds: [],
});

describe("featureGroups", () => {
  it("groups by category in the order each category's first feature comes", () => {
    const groups = featureGroups([feature("c", "Two", 30), feature("a", "One", 10), feature("b", "Two", 20)]);
    expect(groups.map((g) => g.category)).toEqual(["One", "Two"]);
    expect(groups[1].features.map((f) => f.id)).toEqual(["b", "c"]);
  });
});

describe("parseMatrixForm", () => {
  const base = {
    "f:a:name": "Blog",
    "f:a:category": "Content",
    "f:a:description": "Articles",
    "f:a:position": "10",
    "g:a:p1": "on",
  };

  it("reads an edited feature and the plans that include it", () => {
    const parsed = parseMatrixForm(form(base), known);
    expect(parsed).toEqual({
      ok: true,
      input: { edits: [{ id: "a", remove: false, category: "Content", name: "Blog", description: "Articles", position: 10, planIds: ["p1"] }], added: [] },
    });
  });

  it("leaves out a feature that is not in the form and ignores ticks for unknown plans", () => {
    const parsed = parseMatrixForm(form({ ...base, "g:a:other": "on" }), known);
    expect(parsed.ok && parsed.input.edits).toHaveLength(1);
    expect(parsed.ok && parsed.input.edits[0].planIds).toEqual(["p1"]);
  });

  it("takes a feature out when Remove is ticked, without checking its words", () => {
    const parsed = parseMatrixForm(form({ "f:a:name": "", "f:a:remove": "on" }), known);
    expect(parsed).toEqual({ ok: true, input: { edits: [{ id: "a", remove: true, category: "", name: "", description: "", position: 0, planIds: [] }], added: [] } });
  });

  it("asks for a name and a category", () => {
    const parsed = parseMatrixForm(form({ ...base, "f:a:name": " ", "f:a:category": "" }), known);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && [...parsed.problems].sort()).toEqual(["Give every feature a category.", "Give every feature a name."]);
  });

  it("adds a new feature only when its row is filled in", () => {
    const parsed = parseMatrixForm(
      form({ ...base, "n:1:name": "Pop-ups", "n:1:category": "Design", "n:1:description": "", "n:1:position": "500", "n:1:g:p2": "on", "n:0:category": "Design" }),
      known,
    );
    expect(parsed.ok && parsed.input.added).toEqual([{ category: "Design", name: "Pop-ups", description: "", position: 500, planIds: ["p2"] }]);
  });

  it("refuses too long words", () => {
    const parsed = parseMatrixForm(form({ ...base, "f:a:name": "x".repeat(81) }), known);
    expect(parsed.ok).toBe(false);
  });
});
