import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RETENTION_KINDS, RETENTION_SEED } from "@/lib/retention";

import { KIND_LABELS, RetentionView, setInCode } from "./retention-view";
import { BAD, noop, overview, plain, rule } from "./test-fixtures";

const draw = (over: Partial<Parameters<typeof RetentionView>[0]> = {}) => {
  const html = renderToString(h(RetentionView, { overview: overview(), verify: () => noop, change: noop, today: "2026-10-04", ...over }));
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("the retention page", () => {
  it("has a label for every kind on the schedule", () => {
    for (const kind of RETENTION_KINDS) expect(KIND_LABELS[kind], kind).toBeTruthy();
  });

  it("lists every kind with its period in words", () => {
    const { text } = draw();
    expect(text).toContain("Orders, invoices and payments (bookkeeping)");
    expect(text).toContain("5 years from the end of the calendar year");
    expect(text).toContain("7 years from the end of the calendar year");
    expect(text).toContain("Sign-in codes");
    expect(text).toContain("7 days");
  });

  it("says where each bookkeeping period comes from and how much of it was read", () => {
    const { text } = draw();
    expect(text).toContain("Read at the source");
    expect(text).toContain("Seen in a search result only");
    expect(text).toContain("Bokføringsloven § 13(2)");
  });

  it("shows what is not reviewed, with a button, and the review once there is one", () => {
    const first = RETENTION_SEED[0];
    const reviewed = overview({
      rules: [{ ...rule({ ...first, id: "00000000-0000-4000-8000-0000000000aa" }), verifiedAt: "2026-10-05T09:00:00.000Z" }],
      unverified: 0,
    });
    const none = draw({ overview: reviewed });
    expect(none.text).toContain("Every period in force has been reviewed by a person.");
    expect(none.text).toContain("Reviewed 5 Oct 2026");
    expect(none.html).not.toContain("Mark reviewed");
    const some = draw();
    expect(some.text).toContain(`${RETENTION_SEED.length} periods are in force without a review`);
    expect(some.text).toContain("Mark reviewed");
  });

  it("binds the review to the rule's own id", () => {
    const seen: string[] = [];
    draw({ verify: (id) => (seen.push(id), noop) });
    expect(seen).toHaveLength(RETENTION_SEED.length);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("says that a period set in code is only a record when changed here", () => {
    const search = RETENTION_SEED.find((r) => r.kind === "search_queries")!;
    expect(setInCode(search)).toBe(true);
    expect(setInCode(RETENTION_SEED.find((r) => r.kind === "carts")!)).toBe(false);
    expect(draw().text).toContain("Set in code: a change here is only a record");
  });

  it("explains that a period is never edited in place, and has the form to start a new one", () => {
    const { text, html } = draw();
    expect(text).toContain("A change ends the period in force and starts a new one");
    expect(html).toContain('name="periodValue"');
    expect(html).toContain('name="validFrom"');
  });

  it("shows the daily job's last runs, with problems in words", () => {
    const { text } = draw({
      overview: overview({ lastRuns: [{ at: "2026-10-04T03:00:00.000Z", counts: { orders: 12, carts: 30, email_bodies: 4 } as never, errors: 1, filesLeft: 2 }] }),
    });
    expect(text).toContain("12");
    expect(text).toContain("1 step failed");
    expect(text).toContain("2 files still to remove");
    expect(draw().text).toContain("The job has not run yet.");
  });

  it("is not legal advice, and says so", () => {
    expect(draw().text).toContain("This is not legal advice.");
  });
});
