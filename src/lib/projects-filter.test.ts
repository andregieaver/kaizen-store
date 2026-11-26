import { describe, expect, it } from "vitest";

import { dueGroups, filterCounts, isFiltering, matches, NO_FILTER, toggled, type FilterTask } from "./projects-filter";

const OSLO = "Europe/Oslo";
// Thursday 26 November 2026, 15:00 in Oslo.
const now = new Date("2026-11-26T14:00:00Z");
const task = (over: Partial<FilterTask> = {}): FilterTask => ({ statusId: null, assignedTo: null, priority: null, dueAt: null, allDay: null, categoryId: null, tagIds: [], ...over });

describe("filters on a checklist's tasks (D903 P4.11)", () => {
  it("puts a task in its due groups: late, today (and so this week), this week, or no date", () => {
    expect(dueGroups(task({ dueAt: "2026-11-25T11:00:00Z", allDay: true }), now, OSLO)).toEqual(["late"]);
    expect(dueGroups(task({ dueAt: "2026-11-26T11:00:00Z", allDay: true }), now, OSLO)).toEqual(["today", "week"]);
    expect(dueGroups(task({ dueAt: "2026-12-02T11:00:00Z", allDay: true }), now, OSLO)).toEqual(["week"]);
    expect(dueGroups(task({ dueAt: "2026-12-03T11:00:00Z", allDay: true }), now, OSLO)).toEqual([]);
    expect(dueGroups(task(), now, OSLO)).toEqual(["none"]);
  });

  it("matches any value within a group and every group across them; nothing chosen matches all", () => {
    const mine = task({ assignedTo: "a", priority: "high", statusId: "s1" });
    expect(matches(mine, NO_FILTER, now, OSLO)).toBe(true);
    expect(matches(mine, { ...NO_FILTER, people: ["a", "b"] }, now, OSLO)).toBe(true);
    expect(matches(mine, { ...NO_FILTER, people: ["a"], priorities: ["low"] }, now, OSLO)).toBe(false);
    expect(matches(task(), { ...NO_FILTER, people: ["nobody"], priorities: ["none"], due: ["none"] }, now, OSLO)).toBe(true);
    expect(matches(task(), { ...NO_FILTER, statuses: ["s1"] }, now, OSLO)).toBe(false);
    const tagged = task({ categoryId: "c1", tagIds: ["t1", "t2"] });
    expect(matches(tagged, { ...NO_FILTER, tags: ["t2", "t9"] }, now, OSLO)).toBe(true);
    expect(matches(tagged, { ...NO_FILTER, categories: ["none"] }, now, OSLO)).toBe(false);
    expect(matches(task(), { ...NO_FILTER, categories: ["none"], tags: ["t1"] }, now, OSLO)).toBe(false);
  });

  it("counts each value over every task, and toggles a value in and out", () => {
    const counts = filterCounts([task({ assignedTo: "a" }), task({ assignedTo: "a", priority: "low" }), task()], now, OSLO);
    expect(counts.people).toEqual(new Map([["a", 2], ["nobody", 1]]));
    expect(counts.priorities.get("none")).toBe(2);
    expect(counts.due.get("none")).toBe(3);
    const on = toggled(NO_FILTER, "people", "a");
    expect(on.people).toEqual(["a"]);
    expect(isFiltering(on)).toBe(true);
    expect(isFiltering(toggled(on, "people", "a"))).toBe(false);
  });
});
