import { describe, expect, it } from "vitest";

import { socialCalendar, weekAction, type CalendarDraft } from "./social-calendar";
import type { CalendarSlot } from "./social-advice";

// Wednesday 25 November 2026: the calendar runs from Monday 23 November to Sunday 6 December.
const TODAY = "2026-11-25";
const slot = (day: string, channel: CalendarSlot["channel"], idea = "A reel of a bowl on the wheel.", productId: string | null = null): CalendarSlot => ({ day, channel, productId, idea });
const draft = (id: string, day: string, channel: CalendarDraft["channel"], approved = false): CalendarDraft => ({ id, day, channel, caption: `Post ${id}`, approved, productId: null, topic: "" });

describe("the social calendar (D870 S2.4)", () => {
  it("lays the plan over this week and next, from today's Monday, each planned post with the draft written for it", () => {
    const weeks = socialCalendar(TODAY, [slot("2026-11-26", "instagram"), slot("2026-11-26", "facebook"), slot("2026-12-02", "pinterest")], [draft("a", "2026-11-26", "instagram")]);
    expect(weeks.map((w) => w.start)).toEqual(["2026-11-23", "2026-11-30"]);
    expect(weeks[0].days).toHaveLength(7);
    const thursday = weeks[0].days.find((d) => d.day === "2026-11-26")!;
    expect(thursday.items.map((it) => [it.channel, it.draft?.id ?? null])).toEqual([
      ["instagram", "a"],
      ["facebook", null],
    ]);
    expect(weeks[1].days.find((d) => d.day === "2026-12-02")!.items[0]).toMatchObject({ channel: "pinterest", draft: null });
  });

  it("shows a draft written for a day no plan names on its own, and leaves out what falls outside the two weeks", () => {
    const weeks = socialCalendar(TODAY, [slot("2026-12-20", "instagram")], [draft("own", "2026-11-27", "linkedin"), draft("old", "2026-11-10", "instagram")]);
    const items = weeks.flatMap((w) => w.days.flatMap((d) => d.items));
    expect(items).toEqual([{ day: "2026-11-27", channel: "linkedin", productId: null, idea: "", draft: expect.objectContaining({ id: "own" }) }]);
  });

  it("gives Homer one button a week: write what is missing from today on, then approve the drafts, then nothing", () => {
    // Monday's planned post is past: it is shown but never offered to write.
    const plan = [slot("2026-11-23", "instagram"), slot("2026-11-26", "instagram"), slot("2026-11-28", "facebook")];
    const missing = socialCalendar(TODAY, plan, [draft("a", "2026-11-26", "instagram")]);
    expect(weekAction(missing[0])).toEqual({ kind: "write", count: 1 });
    expect(missing[0].toWrite.map((it) => it.day)).toEqual(["2026-11-28"]);

    const written = socialCalendar(TODAY, plan, [draft("a", "2026-11-26", "instagram", true), draft("b", "2026-11-28", "facebook")]);
    expect(weekAction(written[0])).toEqual({ kind: "approve", count: 1 });
    expect(written[0].toApprove.map((d) => d.id)).toEqual(["b"]);

    const done = socialCalendar(TODAY, plan, [draft("a", "2026-11-26", "instagram", true), draft("b", "2026-11-28", "facebook", true)]);
    expect(weekAction(done[0])).toBeNull();
    expect(weekAction(done[1])).toBeNull();
  });

  it("matches a slot to one draft only: the newest written for its day and channel, the older shown on its own", () => {
    const weeks = socialCalendar(TODAY, [slot("2026-11-26", "instagram")], [draft("new", "2026-11-26", "instagram"), draft("older", "2026-11-26", "instagram")]);
    const items = weeks[0].days.find((d) => d.day === "2026-11-26")!.items;
    expect(items.map((it) => [it.idea !== "", it.draft?.id])).toEqual([
      [true, "new"],
      [false, "older"],
    ]);
  });

  it("leaves a post whose picture check found something out of Approve the week (S2.3)", () => {
    const failed = { ...draft("bad", "2026-11-26", "instagram"), check: { problems: ["cut_off"], note: "The bowl is cut off." } };
    const passed = { ...draft("good", "2026-11-28", "facebook"), check: { problems: [], note: "" } };
    const weeks = socialCalendar(TODAY, [], [failed, passed, draft("unchecked", "2026-11-27", "pinterest")]);
    expect(weeks[0].toApprove.map((d) => d.id).sort()).toEqual(["good", "unchecked"]);
    expect(weeks[0].action).toEqual({ kind: "approve", count: 2 });
  });
});
