import { describe, expect, it } from "vitest";

import { DEFAULT_STATUSES, freeSlug, itemInput, problemFields, sequence, slugOf, statusBar } from "./projects";

describe("statuses (D903)", () => {
  it("start with an active status first, so a new item has one, and a done one for ticking", () => {
    expect(DEFAULT_STATUSES[0].bucket).toBe("active");
    expect(DEFAULT_STATUSES.some((s) => s.bucket === "done")).toBe(true);
  });

  it("are named by a slug that survives Norwegian and odd names", () => {
    expect(slugOf("Til gjennomgang")).toBe("til-gjennomgang");
    expect(slugOf("Ærlig på vei – før søndag")).toBe("aerlig-pa-vei-for-sondag");
    expect(slugOf("!!!")).toBe("status");
    expect(slugOf("x".repeat(60))).toHaveLength(40);
    expect(freeSlug("Done", new Set(["done", "done-2"]))).toBe("done-3");
  });
});

describe("a list's order", () => {
  it("numbers items and sections in one sequence, once each", () => {
    expect(
      sequence([
        { kind: "section", id: "s1" },
        { kind: "item", id: "a" },
        { kind: "item", id: "a" },
        { kind: "item", id: "b" },
      ]),
    ).toEqual([
      { kind: "section", id: "s1", sortOrder: 0 },
      { kind: "item", id: "a", sortOrder: 1 },
      { kind: "item", id: "b", sortOrder: 2 },
    ]);
  });
});

describe("a project's sums", () => {
  const statuses = [
    { id: "todo", name: "To do", colour: "neutral" as const, bucket: "active" as const },
    { id: "done", name: "Done", colour: "positive" as const, bucket: "done" as const },
  ];

  it("counts items by status, finding a status for one that has none", () => {
    const bar = statusBar(statuses, [
      { statusId: "todo", done: false },
      { statusId: null, done: true },
      { statusId: "elsewhere", done: false },
    ]);
    expect(bar).toEqual({ total: 3, finished: 1, parts: [{ ...statuses[0], count: 2 }, { ...statuses[1], count: 1 }] });
  });

});

describe("an item's input", () => {
  it("trims, empties to none, and refuses dates the wrong way round", () => {
    const ok = itemInput.parse({ title: "  Order boxes ", description: "", dueAt: "" });
    expect(ok).toMatchObject({ title: "Order boxes", description: null, dueAt: null });
    const bad = itemInput.safeParse({ title: "", startAt: "2026-12-02T10:00:00Z", dueAt: "2026-12-01T10:00:00Z" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(problemFields(bad.error)).toEqual(["title", "dueAt"]);
  });
});
