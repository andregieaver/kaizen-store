import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PrivacyBanner, PrivacyCard } from "./privacy-card";
import { BAD, card, overdue, plain, request } from "./test-fixtures";

const KEY = "22222222-2222-4222-8222-222222222222";

const draw = (data = card(), over: Partial<Parameters<typeof PrivacyCard>[0]> = {}) => {
  const html = renderToString(h(PrivacyCard, { base: "/admin/s", customerKey: KEY, data, canWrite: true, ...over }));
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("the Privacy card on a customer", () => {
  it("says what the store holds in counts, never a value", () => {
    const { text } = draw();
    expect(text).toContain("The store holds: 3 orders, 2 emails.");
    expect(text).not.toContain("kari@example.com");
  });

  it("says so when nothing is held", () => {
    expect(draw(card({ countsLine: "" })).text).toContain("holds no data about this person");
  });

  it("downloads with a POST form to the export route, never a link", () => {
    const { html } = draw();
    expect(html).toMatch(new RegExp(`<form action="/admin/s/customers/${KEY}/export" method="post">`));
    expect(html).not.toContain(`<a href="/admin/s/customers/${KEY}/export"`);
  });

  it("warns that the file includes internal notes before the first download", () => {
    expect(draw().text).toContain("includes internal notes about the customer");
  });

  it("links the erase page, carrying the open request so the erasure answers it", () => {
    const req = request();
    const { html } = draw(card({ request: req }));
    expect(html).toContain(`href="/admin/s/customers/${KEY}/erase?request=${req.id}"`);
    expect(draw().html).toContain(`href="/admin/s/customers/${KEY}/erase"`);
  });

  it("shows the open request with its clock and links it", () => {
    const req = request();
    const { text, html } = draw(card({ request: req }));
    expect(text).toContain("Erasure request open");
    expect(text).toContain("16 days left");
    expect(html).toContain(`href="/admin/s/privacy/${req.id}"`);
  });

  it("says overdue in words, not in colour alone", () => {
    const req = overdue();
    expect(draw(card({ request: req, overdue: true })).text).toContain("33 days overdue");
  });

  it("offers neither button to a member who may only read", () => {
    const { html, text } = draw(card(), { canWrite: false });
    expect(html).not.toContain("/export");
    expect(html).not.toContain("/erase");
    expect(text).toContain("needs permission to change customers");
  });

  it("shows a refused download's fixed sentence", () => {
    expect(draw(card(), { exportProblem: "There is too much data for one file." }).text).toContain("too much data for one file");
  });
});

describe("the banner for an overdue request", () => {
  const draw = (data: ReturnType<typeof card>) => renderToString(h(PrivacyBanner, { base: "/admin/s", data }));

  it("shows only when the request is past its day, and links it", () => {
    const req = overdue();
    const html = draw(card({ request: req, overdue: true }));
    expect(plain(html)).toContain("A privacy request for this customer is overdue.");
    expect(html).toContain('role="alert"');
    expect(html).toContain(`href="/admin/s/privacy/${req.id}"`);
  });

  it("shows nothing for a request on time or none", () => {
    expect(draw(card({ request: request(), overdue: false }))).toBe("");
    expect(draw(card())).toBe("");
  });
});
