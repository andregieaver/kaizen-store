import { describe, expect, it } from "vitest";

import { canMove, nextSlug, submissionProblems, SUBMISSION_STATUSES, themeSlugFrom } from "./theme-submissions";

describe("themes from outside (D344)", () => {
  const ok = { title: "Fjord", summary: "Calm and clear.", description: "", authorName: "Ada" };

  it("needs a name for a new theme and an author always, within the limits", () => {
    expect(submissionProblems(ok, "theme")).toEqual([]);
    expect(submissionProblems({ ...ok, title: "  " }, "theme")).toEqual(["title"]);
    // An update keeps its theme's name.
    expect(submissionProblems({ ...ok, title: "" }, "update")).toEqual([]);
    expect(submissionProblems({ ...ok, authorName: " " }, "theme")).toEqual(["authorName"]);
    expect(submissionProblems({ ...ok, title: "x".repeat(81), summary: "y".repeat(201), description: "z".repeat(2001), notes: "n".repeat(2001) }, "theme")).toEqual([
      "title",
      "summary",
      "description",
      "notes",
    ]);
  });

  it("moves a submission only forward, as the database does", () => {
    const allowed = SUBMISSION_STATUSES.flatMap((from) => SUBMISSION_STATUSES.filter((to) => canMove(from, to)).map((to) => `${from}→${to}`));
    expect(allowed).toEqual(["waiting→reviewing", "waiting→rejected", "waiting→withdrawn", "reviewing→approved", "reviewing→rejected", "reviewing→withdrawn"]);
  });

  it("makes a theme store address from a name", () => {
    expect(themeSlugFrom("Fjord & Fell")).toBe("fjord-fell");
    expect(themeSlugFrom("Blåbær Søt")).toBe("blabaer-sot");
    expect(themeSlugFrom("!!!")).toBe("theme");
    expect(themeSlugFrom("a".repeat(80))).toHaveLength(60);
    expect(themeSlugFrom("a".repeat(80))).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/);
    expect(nextSlug("fjord", 2)).toBe("fjord-2");
    expect(nextSlug("a".repeat(60), 12)).toBe(`${"a".repeat(57)}-12`);
  });
});
