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
