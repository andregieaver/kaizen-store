import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RequestsView, requestsFilter } from "./requests-view";
import { BAD, overdue, plain, request } from "./test-fixtures";

const draw = (over: Partial<Parameters<typeof RequestsView>[0]> = {}) => {
  const html = renderToString(h(RequestsView, { base: "/admin/s", requests: [request(), overdue({ id: "99999999-9999-4999-8999-999999999999", subjectEmail: "ola@example.com" })], filter: "open", canWrite: true, ...over }));
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("the privacy requests list", () => {
  it("shows the open requests with received day, due day and days left", () => {
    const { text } = draw();
    expect(text).toContain("kari@example.com");
    expect(text).toContain("20 Sept 2026");
    expect(text).toContain("20 Oct 2026");
    expect(text).toContain("16 days left");
  });

  it("says in words and an alert that a request is past its day", () => {
    const { text, html } = draw();
    expect(text).toContain("33 days overdue");
    expect(text).toContain("1 request is past its day");
    expect(html).toContain('role="alert"');
  });

  it("links each request and offers Log a request to those who may change customers only", () => {
    expect(draw().html).toContain('href="/admin/s/privacy/11111111-1111-4111-8111-111111111111"');
    expect(draw().html).toContain('href="/admin/s/privacy/new"');
    expect(draw({ canWrite: false }).html).not.toContain("/privacy/new");
  });

  it("filters: the open list leaves out answered requests, and the answered list leaves out open ones", () => {
    const done = request({ id: "88888888-8888-4888-8888-888888888888", status: "done", outcome: "exported", subjectEmail: "per@example.com", daysLeft: null, completedAt: new Date("2026-09-25T00:00:00Z") });
    const all = [request(), done];
    expect(draw({ requests: all, filter: "open" }).text).not.toContain("per@example.com");
    const answered = draw({ requests: all, filter: "answered" }).text;
    expect(answered).toContain("per@example.com");
    expect(answered).not.toContain("kari@example.com");
    expect(answered).toContain("Answered 25 Sept 2026");
  });

  it("never prints an address for an erased person, only the word", () => {
    const erased = request({ status: "done", outcome: "erased", subjectEmail: null, daysLeft: null, completedAt: new Date("2026-09-25T00:00:00Z") });
    expect(draw({ requests: [erased], filter: "all" }).text).toContain("Erased");
  });

  it("says so when nothing is open", () => {
    expect(draw({ requests: [] }).text).toContain("No request is open.");
  });

  it("reads the status filter safely: anything else is the open list", () => {
    expect(requestsFilter("answered")).toBe("answered");
    expect(requestsFilter("all")).toBe("all");
    expect(requestsFilter("<script>")).toBe("open");
    expect(requestsFilter(undefined)).toBe("open");
  });
});
