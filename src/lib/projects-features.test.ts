import { describe, expect, it } from "vitest";

import { ADVANCED_FEATURES, ALL_FEATURES, BUILT_FEATURES, checklistFeatures, effectiveFeatures, NO_FEATURES, parseFeatures, storedFeatures } from "./projects-features";

describe("a checklist's fields (D903, from Kaizen Life's advanced lists)", () => {
  it("is a title and a box to tick until Advanced list", () => {
    expect(checklistFeatures({ isAdvanced: false, advancedFeatures: {} })).toEqual(NO_FEATURES);
    expect(checklistFeatures({ isAdvanced: true, advancedFeatures: {} })).toEqual(ALL_FEATURES);
  });

  it("stores only the fields switched off, so a field added later is on", () => {
    expect(storedFeatures({ ...ALL_FEATURES, cost: false, startDate: false })).toEqual({ cost: false, startDate: false });
    expect(parseFeatures({ cost: false })).toEqual({ ...ALL_FEATURES, cost: false });
  });

  it("reads anything unreadable as on, never off", () => {
    expect(parseFeatures(null)).toEqual(ALL_FEATURES);
    expect(parseFeatures(["cost"])).toEqual(ALL_FEATURES);
    expect(parseFeatures({ cost: "no", unknown: false })).toEqual(ALL_FEATURES);
  });

  it("hides status, assignment and labels on a routine, whatever the switches say", () => {
    const routine = effectiveFeatures({ isAdvanced: true, advancedFeatures: {}, isRoutine: true });
    expect(routine).toMatchObject({ status: false, assignment: false, category: false, tags: false, dueDate: true, subtasks: true });
  });


  it("offers switches only for fields that exist", () => {
    for (const feature of BUILT_FEATURES) expect(ADVANCED_FEATURES).toContain(feature);
  });
});
