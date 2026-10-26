import { describe, expect, it } from "vitest";

import { readAutonomy } from "./autopilot-autonomy";
import { REVIEW_PLAN_TOOLS, reviewMessage, startDecision } from "./autopilot-reviews";

/** The autopilot keeps going (D328, `docs/ai-autopilot.md` 12): the settings, the start rule and the review's message. */

describe("planning settings", () => {
  it("are off and ask first unless set, and an unreadable value falls back to that", () => {
    expect(readAutonomy({}).planning).toEqual({ continues: false, starts: "ask", reviewDays: 7, plansPerWeek: 3 });
    expect(readAutonomy({ planning: { continues: true, starts: "auto" } }).planning).toEqual({ continues: true, starts: "auto", reviewDays: 7, plansPerWeek: 3 });
    expect(readAutonomy({ planning: { reviewDays: 0 } }).planning.continues).toBe(false);
  });
});

describe("startDecision", () => {
  const settings = (starts: "ask" | "auto", plansPerWeek = 3) => readAutonomy({ planning: { continues: true, starts, plansPerWeek } });

  it("asks when the owner chose to be asked", () => {
    expect(startDecision(settings("ask"), 0)).toEqual({ start: false, why: "Your setting is to ask before a new plan starts." });
  });

  it("starts at auto under the week's limit and asks once it is reached", () => {
    expect(startDecision(settings("auto", 2), 1)).toEqual({ start: true });
    expect(startDecision(settings("auto", 2), 2)).toEqual({ start: false, why: "The autopilot already started 2 plans this week, your limit." });
    expect(startDecision(settings("auto", 1), 1)).toMatchObject({ why: "The autopilot already started 1 plan this week, your limit." });
  });
});

describe("reviewMessage", () => {
  const goal = { id: "11111111-1111-4111-8111-111111111111", title: "First sales", vision: "Calm and honest.", dueOn: "2026-12-01" };

  it("carries the goal, its progress as code wrote it, its plans and the last review", () => {
    const text = reviewMessage(
      goal,
      [
        { target: "10 orders in 30 days", now: "3", met: false },
        { target: "Conversion 2 %", now: "", met: null, missing: "visit counting is off" },
      ],
      [{ title: "Launch week", status: "done", finishedAt: "2026-10-20T10:00:00Z", steps: [{ title: "Write the home page", status: "done", done: "Published it." }] }],
      "Nothing to do now: waiting for traffic.",
    );
    expect(text).toContain(`review of the goal "First sales" (id ${goal.id})`);
    expect(text).toContain("The owner's vision: Calm and honest.");
    expect(text).toContain("- 10 orders in 30 days: 3");
    expect(text).toContain("- Conversion 2 %: not measured (visit counting is off)");
    expect(text).toContain(`- "Launch week": done (2026-10-20)`);
    expect(text).toContain("  - Write the home page: done: Published it.");
    expect(text).toContain("Your last review said: Nothing to do now: waiting for traffic.");
    expect(text).toContain(`make_autopilot_plan (goal ${goal.id})`);
  });

  it("says when no plan was made yet", () => {
    expect(reviewMessage(goal, [], [], null)).toContain("No plan has been made for this goal yet.");
  });

  it("offers no tool that starts or decides anything", () => {
    for (const name of REVIEW_PLAN_TOOLS) expect(name).not.toMatch(/start|resume|decide|answer/);
  });
});
