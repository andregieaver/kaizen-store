import { describe, expect, it } from "vitest";

import { attentionFor, changeText, totalSales, type StoreFigures } from "./control-center";
import { workOverview } from "./work-overview";
import { workBase } from "@/lib/work-paths";

const store = (over: Partial<StoreFigures> = {}): StoreFigures => ({
  slug: "kaffe",
  name: "Kaffe",
  role: "owner",
  suspended: false,
  open: true,
  plan: { name: "Growth", status: "active", endsAt: null, cancelling: false },
  payments: "live",
  sales: [],
  toSend: 0,
  oldestToSend: null,
  lowStock: 0,
  outOfStock: 0,
  ...over,
});

describe("the control center (D107)", () => {
  it("says nothing when everything is well", () => {
    expect(attentionFor([store()])).toEqual([]);
  });

  it("puts what is urgent first and links to the page that acts on it", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    const items = attentionFor(
      [
        store({ slug: "a", name: "A", lowStock: 2 }),
        store({ slug: "b", name: "B", toSend: 3, oldestToSend: "2026-09-24T12:00:00Z" }),
        store({ slug: "c", name: "C", plan: { name: "Growth", status: "past_due", endsAt: null, cancelling: false } }),
      ],
      now,
    );
    expect(items.map((i) => i.href)).toEqual(["/admin/b/orders?show=to-send", "/admin/c/billing", "/admin/a/products"]);
    expect(items[0]).toMatchObject({ urgent: true, text: "B: 3 orders are waiting to be sent, the oldest for 5 days." });
    expect(items[2].text).toBe("A: 2 products are running low.");
  });

  it("asks staff only for what they can do", () => {
    const items = attentionFor([store({ role: "admin", open: false, plan: null, payments: "off", toSend: 1 })]);
    expect(items.map((i) => i.action)).toEqual(["Send"]);
  });

  it("puts withdrawals past the legal refund deadline and unsent acknowledgements first, then return requests (D153)", () => {
    const items = attentionFor([
      store({ slug: "a", name: "A", lowStock: 2, returns: { overdue: 2, unacknowledged: 1, requested: 3 } }),
      store({ slug: "b", name: "B", returns: { overdue: 0, unacknowledged: 0, requested: 1 } }),
    ]);
    expect(items.map((i) => [i.href, Boolean(i.urgent)])).toEqual([
      ["/admin/a/returns?overdue=1", true],
      ["/admin/a/returns", true],
      ["/admin/a/returns?status=requested", false],
      ["/admin/a/products", false],
      ["/admin/b/returns?status=requested", false],
    ]);
    expect(items[0].text).toBe("A: 2 withdrawals are past the legal deadline for the refund.");
    expect(items[1].text).toBe("A: the acknowledgement of 1 withdrawal was not sent.");
    expect(items[2].text).toBe("A: 3 return requests are waiting for an answer.");
    expect(items[4].text).toBe("B: 1 return request is waiting for an answer.");
  });

  it("says nothing about returns when nothing waits, and shows staff the same, as every member works the queue", () => {
    expect(attentionFor([store({ returns: { overdue: 0, unacknowledged: 0, requested: 0 } })])).toEqual([]);
    expect(attentionFor([store({ role: "admin", returns: { overdue: 1, unacknowledged: 0, requested: 0 } })]).map((i) => i.action)).toEqual(["Refund"]);
  });

  it("flags privacy requests past their one-month clock as urgent and those due this week as a heads-up, with counts only (D162)", () => {
    const items = attentionFor([store({ slug: "a", name: "A", privacy: { overdue: 2, dueSoon: 1 } }), store({ slug: "b", name: "B", privacy: { overdue: 0, dueSoon: 3 } })]);
    expect(items.map((i) => [i.text, i.href, i.action, Boolean(i.urgent)])).toEqual([
      ["A: 2 privacy requests are past the one-month deadline for an answer.", "/admin/a/privacy", "Answer", true],
      ["A: 1 privacy request is due within the week.", "/admin/a/privacy", "Open requests", false],
      ["B: 3 privacy requests are due within the week.", "/admin/b/privacy", "Open requests", false],
    ]);
  });

  it("says nothing about privacy requests when none is due, and names no person", () => {
    expect(attentionFor([store({ privacy: { overdue: 0, dueSoon: 0 } })])).toEqual([]);
    expect(attentionFor([store()])).toEqual([]);
    // Staff with the privacy log open see the same: the clock is the store's, not the owner's.
    expect(attentionFor([store({ role: "admin", privacy: { overdue: 1, dueSoon: 0 } })]).map((i) => i.action)).toEqual(["Answer"]);
  });

  it("asks an owner, and only an owner, to look at tax settings that are half done (D157)", () => {
    const tax = ["The VAT number has not been checked valid."];
    const items = attentionFor([store({ slug: "a", name: "A", tax })]);
    expect(items).toEqual([
      { text: "A: the tax settings need a look. The VAT number has not been checked valid.", href: "/admin/a/settings/tax", action: "Open tax settings" },
    ]);
    expect(attentionFor([store({ role: "admin", tax })])).toEqual([]);
    expect(attentionFor([store({ tax: [] })])).toEqual([]);
  });

  it("asks an owner, and only an owner, about paid orders waiting for an invoice, urgent only past a reverse-charge deadline (D159)", () => {
    const waiting = attentionFor([store({ slug: "a", name: "A", invoices: { waiting: 3, overdue: 0 } })]);
    expect(waiting).toEqual([
      { text: "A: 3 paid orders are waiting for an invoice.", href: "/admin/a/invoices?tab=waiting", action: "Open invoices", urgent: false },
    ]);
    const overdue = attentionFor([store({ slug: "a", name: "A", invoices: { waiting: 1, overdue: 1 } })]);
    expect(overdue[0]).toMatchObject({ text: "A: 1 paid order is waiting for an invoice, 1 of them past the deadline for a reverse-charge invoice.", urgent: true });
    expect(attentionFor([store({ role: "admin", invoices: { waiting: 3, overdue: 1 } })])).toEqual([]);
    expect(attentionFor([store({ invoices: { waiting: 0, overdue: 0 } })])).toEqual([]);
  });

  it("adds Work's own attention items for a store that uses it, urgent first, and nothing for one that does not", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    const workOf = (slug: string, name: string) => workOverview({
      today: "2026-09-29",
      now,
      invoices: [
        {
          id: "i1",
          clientId: "c1",
          status: "sent",
          currency: "NOK",
          totalMinor: 250_000,
          paidMinor: 0,
          creditedMinor: 0,
          dueOn: "2026-09-01",
          paidOn: null,
          updatedOn: "2026-09-01",
          recurringPeriod: null,
        },
      ],
      entries: [],
      timers: [],
      base: workBase(slug),
      label: name,
    }).attention;
    const work = workOf("b", "B");
    expect(work.map((i) => i.text)).toEqual(["B: 1 invoice is overdue, the oldest by 28 days."]);
    const items = attentionFor(
      [
        store({ slug: "a", name: "A", lowStock: 2 }),
        store({ slug: "b", name: "B", work }),
        store({ slug: "c", name: "C", work: [] }),
        store({ slug: "d", name: "D", role: "admin", open: false, plan: null, payments: "off", work: workOf("d", "D") }),
      ],
      now,
    );
    // The overdue invoice is 28 days late, so it is urgent and comes before the stock; staff see it too.
    expect(items.map((i) => i.href)).toEqual([
      "/admin/account/work/s/b/invoices?show=overdue",
      "/admin/account/work/s/d/invoices?show=overdue",
      "/admin/a/products",
    ]);
    expect(items[0]).toMatchObject({ urgent: true, action: "Open invoices" });
    // A store that has not switched Work on brings none, whether the figure is missing or empty.
    expect(attentionFor([store(), store({ work: [] })])).toEqual([]);
  });

  it("adds sales per currency, never across them, and words the change", () => {
    const sums = totalSales([
      { sales: [{ currency: "NOK", week: 1000, prior: 500, orders: 2, priorOrders: 1 }] },
      { sales: [{ currency: "NOK", week: 500, prior: 0, orders: 1, priorOrders: 0 }, { currency: "EUR", week: 9000, prior: 9000, orders: 3, priorOrders: 3 }] },
    ]);
    expect(sums).toEqual([
      { currency: "EUR", week: 9000, prior: 9000, orders: 3, priorOrders: 3 },
      { currency: "NOK", week: 1500, prior: 500, orders: 3, priorOrders: 1 },
    ]);
    expect(changeText(1500, 500)).toBe("+200 % on the week before");
    expect(changeText(90, 100)).toBe("−10 % on the week before");
    expect(changeText(100, 100)).toBe("Same as the week before");
    expect(changeText(5, 0)).toBe("New this week");
    expect(changeText(0, 0)).toBeNull();
  });
});
