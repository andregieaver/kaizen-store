import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RequestDetail } from "./request-detail";
import { BAD, noop, overdue, plain, request } from "./test-fixtures";

const KEY = "22222222-2222-4222-8222-222222222222";
const actions = { extend: noop, refuse: noop, closeNoData: noop, cancel: noop, identity: noop };

const draw = (over: Partial<Parameters<typeof RequestDetail>[0]> = {}) => {
  const html = renderToString(h(RequestDetail, { base: "/admin/s", request: request(), canWrite: true, subjectKey: KEY, holdsData: true, actions, ...over }));
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("one privacy request", () => {
  it("shows the person, the clock and the note", () => {
    const { text } = draw({ request: request({ note: "Wrote by email on Friday" }) });
    expect(text).toContain("kari@example.com");
    expect(text).toContain("Received 20 Sept 2026");
    expect(text).toContain("20 Oct 2026");
    expect(text).toContain("16 days left");
    expect(text).toContain("Wrote by email on Friday");
  });

  it("raises an alert for an overdue request", () => {
    const { text, html } = draw({ request: overdue() });
    expect(html).toContain('role="alert"');
    expect(text).toContain("This request is 33 days overdue");
  });

  it("offers a download as a POST carrying the request, and the erase page carrying it too", () => {
    const req = request();
    const { html } = draw({ request: req });
    expect(html).toMatch(new RegExp(`<form action="/admin/s/customers/${KEY}/export" method="post">`));
    expect(html).toContain(`name="request" value="${req.id}"`);
    expect(html).toContain(`href="/admin/s/customers/${KEY}/erase?request=${req.id}"`);
  });

  it("has the extend, refuse, identity and cancel steps while it is open", () => {
    const { text } = draw();
    for (const word of ["Extend the answer", "Refuse the request", "Waiting for identity", "Logged by mistake"]) expect(text).toContain(word);
    // The refusal reasons are the closed list, in words.
    expect(text).toContain("We could not confirm who is asking");
  });

  it("offers closing as no data held, not a download, when the store holds nothing", () => {
    const { text, html } = draw({ subjectKey: null, holdsData: false });
    expect(text).toContain('Close as "no data held"');
    expect(html).not.toContain("/export");
  });

  it("shows no actions to a member who may only read", () => {
    const { html, text } = draw({ canWrite: false });
    expect(html).not.toContain("/export");
    expect(text).toContain("needs permission to change customers");
  });

  it("shows an answered request with what was done, in counts, and no actions", () => {
    const done = request({
      status: "done",
      outcome: "erased",
      subjectEmail: null,
      daysLeft: null,
      completedAt: new Date("2026-09-25T00:00:00Z"),
      planSummary: {
        rows: [
          { table: "wishlists", action: "deleted", count: 2 },
          { table: "orders", action: "restricted", count: 1 },
        ],
        keptUntil: { first: "2032-01-01", last: "2032-01-01" },
        subscriptionsCancelled: 1,
        savedCardsDetached: 0,
        warnings: [],
      },
    });
    const { text, html } = draw({ request: done, subjectKey: null, holdsData: false });
    expect(text).toContain("The person's data was erased.");
    expect(text).toContain("2 × Wishlists: deleted");
    expect(text).toContain("1 × Orders: kept restricted");
    expect(text).toContain("until 1 Jan 2032");
    expect(text).toContain("1 subscriptions cancelled");
    expect(html).not.toContain("Extend the answer");
  });

  it("shows a refused request's reason and note", () => {
    const refused = request({ status: "refused", outcome: "refused", refusalReason: "identity_not_confirmed", refusalNote: "No reply to our question", daysLeft: null, completedAt: new Date("2026-09-25T00:00:00Z") });
    const { text } = draw({ request: refused, subjectKey: null, holdsData: false });
    expect(text).toContain("We could not confirm who is asking");
    expect(text).toContain("No reply to our question");
  });

  it("shows a refused download's fixed sentence", () => {
    expect(draw({ problem: "There is too much data for one file." }).text).toContain("too much data");
  });
});
