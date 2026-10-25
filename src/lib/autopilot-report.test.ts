import { describe, expect, it } from "vitest";

import { staffEmailsNb } from "./admin-messages/staff-emails.nb";
import { autopilotEmail, checkedNote, digestWorthSending, type ReportFacts } from "./autopilot-report";

/** The autopilot's digest and weekly report (D309, `docs/ai-autopilot.md` 7.5): what the email says, and the model's note's checks. */

const daily: ReportFacts = { kind: "daily", store: "Demo", stepsDone: ["Write the about page", "Publish it"], stepsDoneCount: 2, waiting: 1 };
const weekly: ReportFacts = {
  kind: "weekly",
  store: "Demo",
  stepsDone: [],
  stepsDoneCount: 4,
  waiting: 0,
  sales: { now: "kr 12 500,00", before: null },
  orders: { now: null, before: null },
  goals: [{ title: "First sales", met: 1, all: 2 }],
};
const text = (facts: ReportFacts, note: string | null = null, nb = false) =>
  JSON.stringify(autopilotEmail(facts, "https://kaizenaflow.com/admin/demo/assistant/autopilot", note, nb ? staffEmailsNb : undefined, nb ? "nb" : "en"));

describe("the digest", () => {
  it("is sent only when a step finished or something waits", () => {
    expect(digestWorthSending({ stepsDoneCount: 0, waiting: 0 })).toBe(false);
    expect(digestWorthSending({ stepsDoneCount: 0, waiting: 2 })).toBe(true);
  });

  it("lists the plans' step titles and what waits, with the link, in the person's language", () => {
    const en = text(daily);
    expect(en).toContain("What the autopilot did in Demo");
    expect(en).toContain("2 steps were done:");
    expect(en).toContain("Write the about page");
    expect(en).toContain("One thing waits for your yes or an answer.");
    expect(en).toContain("https://kaizenaflow.com/admin/demo/assistant/autopilot");
    expect(text(daily, null, true)).toContain("Det autopiloten gjorde i Demo");
  });
});

describe("the weekly report", () => {
  it("shows the figures as code wrote them, not measured where they are not, and the goals", () => {
    const out = text(weekly, "Keep an eye on the product pages.");
    expect(out).toContain("kr 12 500,00");
    expect(out).toContain("Not measured");
    expect(out).toContain("1 of 2 targets met");
    expect(out).toContain("What it sees: Keep an eye on the product pages.");
  });

  it("keeps the model's note only without figures, claims or length", () => {
    expect(checkedNote("  Your product pages need pictures.  Then publish the about page. ")).toBe("Your product pages need pictures. Then publish the about page.");
    expect(checkedNote("Sales rose 20 % this week.")).toBeNull();
    expect(checkedNote("Hurry, only a few left in stock!")).toBeNull();
    expect(checkedNote("x".repeat(601))).toBeNull();
    expect(checkedNote("")).toBeNull();
  });
});
