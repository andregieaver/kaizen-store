import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { returnQueueFilter } from "@/lib/return-input";

import { ReturnsQueueView } from "./queue-view";
import { plain, row } from "./test-fixtures";

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;
const counts = { open: 3, requested: 1, overdue: 1, acknowledgementPending: 1 };
const filter = (over: Record<string, unknown> = {}) => returnQueueFilter.parse({ ...over });

const draw = (rows = [row()], over: { filter?: ReturnType<typeof filter>; counts?: typeof counts; total?: number; page?: number } = {}) => {
  const html = renderToString(
    h(ReturnsQueueView, {
      base: "/admin/s/returns",
      filter: over.filter ?? filter(),
      queue: { rows, total: over.total ?? rows.length, page: over.page ?? 1, pageSize: 25 },
      counts: over.counts ?? counts,
      timeZone: "Europe/Oslo",
    }),
  );
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("the returns queue", () => {
  it("says what needs doing first, in figures that lead to the filtered queue", () => {
    const { html, text } = draw();
    expect(text).toContain("1 past the refund deadline, 1 acknowledgement was not sent, 1 to approve.");
    expect(text).toContain("Open");
    expect(text).toContain("To approve");
    expect(text).toContain("Past the refund deadline");
    expect(text).toContain("Acknowledgement not sent");
    expect(html).toContain('href="/admin/s/returns?status=requested"');
    expect(html).toContain('href="/admin/s/returns?overdue=1"');
  });

  it("lists each return with its kind, order, customer, units, date, status and what to do about the refund", () => {
    const { html, text } = draw([row()]);
    expect(text).toContain("1001-R1");
    expect(html).toContain('href="/admin/s/returns/22222222-2222-4222-8222-222222222222"');
    expect(text).toContain("Withdrawal");
    expect(text).toContain("Kari Nordmann");
    expect(text).toContain("Order #1001");
    expect(html).toContain('href="/admin/s/orders/33333333-3333-4333-8333-333333333333"');
    expect(text).toContain("5 Oct 2026");
    expect(text).toContain("Approved");
    expect(text).toContain("Waiting for the goods, refund due by 19 Oct 2026");
  });

  it("marks what is overdue and what was not acknowledged, in alert colours", () => {
    const overdue = { state: "overdue" as const, deadline: new Date("2026-10-01T10:00:00Z"), daysToDeadline: -4, waitingFor: null, clockStart: null };
    const { html, text } = draw([row({ due: overdue, overdue: true, acknowledgementPending: true })]);
    expect(text).toContain("Refund overdue by 4 days");
    expect(text).toContain("Acknowledgement not sent");
    expect(html).toContain("text-red-700");
  });

  it("shows a refunded return's amount instead of a deadline", () => {
    const { text } = draw([row({ status: "closed", refundMinor: 25_000, due: { state: "done", deadline: null, daysToDeadline: null, waitingFor: null, clockStart: null } })]);
    expect(text.replace(/\s/g, "")).toContain("NOK250.00");
    expect(text).not.toContain("Waiting for the goods");
  });

  it("says a return request waits for the store's answer", () => {
    const { text } = draw([row({ kind: "return", status: "requested", due: { state: "not_applicable", deadline: null, daysToDeadline: null, waitingFor: null, clockStart: null } })]);
    expect(text).toContain("Return request");
    expect(text).toContain("Waiting for your answer");
  });

  it("falls back to the email when the customer gave no name", () => {
    expect(draw([row({ name: null })]).text).toContain("kari@example.com");
  });

  it("has a filter that keeps what was chosen, and a way to clear it", () => {
    const { html, text } = draw([], { filter: filter({ status: "closed", kind: "withdrawal", q: "Kari", overdue: "1" }) });
    expect(html).toContain('<option value="closed" selected="">Closed</option>');
    expect(html).toContain('<option value="withdrawal" selected="">Withdrawals</option>');
    expect(html).toContain('value="Kari"');
    expect(html).toMatch(/name="overdue"[^>]*checked/);
    expect(text).toContain("No returns match");
    expect(text).toContain("Clear");
  });

  it("explains an empty queue to a store that has none, without a filter to clear", () => {
    const { text } = draw([], { counts: { open: 0, requested: 0, overdue: 0, acknowledgementPending: 0 } });
    expect(text).toContain("No returns are open.");
    expect(text).toContain("Withdraw from the contract");
    expect(text).not.toContain("Clear");
  });

  it("pages through a long queue, keeping the filter in the links", () => {
    const { html, text } = draw([row()], { filter: filter({ status: "all" }), total: 60, page: 2 });
    expect(text).toContain("Page 2 of 3");
    expect(html).toContain('href="/admin/s/returns?status=all"');
    expect(html).toContain('href="/admin/s/returns?status=all&amp;page=3"');
  });

  it("is not drawn at a fixed width: the admin uses the whole of its room", () => {
    expect(draw().html).not.toMatch(/max-w-[0-9a-z]*xl/);
  });
});
