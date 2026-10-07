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
  belowLevel: 0,
  owedUnits: 0,
  ...over,
});

describe("the control center and stock (D172)", () => {
  const texts = (figures: Partial<StoreFigures>) => attentionFor([store(figures)]).map((i) => `${i.text} -> ${i.href}`);

  it("says out of stock and running low apart: a variant that is gone is not also low", () => {
    expect(texts({ outOfStock: 2, lowStock: 5 })).toEqual([
      "Kaffe: 2 products are out of stock. -> /admin/kaffe/products",
      "Kaffe: 5 products are running low. -> /admin/kaffe/products",
    ]);
    expect(texts({ lowStock: 1 })).toEqual(["Kaffe: 1 product is running low. -> /admin/kaffe/products"]);
  });

  it("tells the owner about variants at or below the level they set, and links to the Inventory page filtered to them", () => {
    expect(texts({ belowLevel: 1 })).toEqual(["Kaffe: 1 variant is at or below the warning level you set. -> /admin/kaffe/inventory?status=low"]);
    expect(texts({ belowLevel: 3, outOfStock: 1 })).toEqual([
      "Kaffe: 1 product is out of stock. -> /admin/kaffe/products",
      "Kaffe: 3 variants are at or below the warning level you set. -> /admin/kaffe/inventory?status=low",
    ]);
  });

  it("tells the owner what is owed on backorder, and is not urgent", () => {
    expect(texts({ owedUnits: 1 })).toEqual(["Kaffe: 1 unit is owed on backorder, on orders that are paid and not sent. -> /admin/kaffe/inventory?status=backorder"]);
    expect(texts({ owedUnits: 6 })[0]).toContain("6 units are owed");
    expect(attentionFor([store({ owedUnits: 6 })])[0].urgent).toBeFalsy();
  });

  it("shows none of it to a member who may not open Products", () => {
    expect(texts({ outOfStock: 2, belowLevel: 3, owedUnits: 4, lowStock: 1, hides: ["stock"] })).toEqual([]);
  });
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

  it("asks an owner, and only an owner, to take the OSS or IOSS data near its due date, not urgent, never saying a return is late (D161)", () => {
    const taxReturns = [{ text: "Your OSS data for Q3 2026 has not been exported; it is due 31 October.", path: "/analytics/tax?view=oss&quarter=2026-Q3" }];
    const items = attentionFor([store({ slug: "a", name: "A", taxReturns })]);
    expect(items).toEqual([
      { text: "A: Your OSS data for Q3 2026 has not been exported; it is due 31 October.", href: "/admin/a/analytics/tax?view=oss&quarter=2026-Q3", action: "Open VAT report" },
    ]);
    expect(items[0].urgent).toBeUndefined();
    expect(items[0].text).not.toMatch(/late|overdue/i);
    expect(attentionFor([store({ role: "admin", taxReturns })])).toEqual([]);
    expect(attentionFor([store({ taxReturns: [] })])).toEqual([]);
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

describe("the control center and draft orders (D173)", () => {
  const texts = (figures: Partial<StoreFigures>, now?: number) => attentionFor([store(figures)], now).map((i) => `${i.text} -> ${i.href}`);
  const now = Date.parse("2026-10-06T12:00:00Z");

  it("tells the owner how many drafts wait for payment and how long the oldest has waited, and links to the sent drafts", () => {
    expect(texts({ drafts: { waiting: 3, oldestSentAt: "2026-10-03T12:00:00Z", expiringSoon: 0 } }, now)).toEqual([
      "Kaffe: 3 draft orders are waiting for payment, the oldest sent 3 days ago. -> /admin/kaffe/orders/drafts?status=sent",
    ]);
    expect(texts({ drafts: { waiting: 1, oldestSentAt: "2026-10-06T08:00:00Z", expiringSoon: 0 } }, now)).toEqual(["Kaffe: 1 draft order is waiting for payment. -> /admin/kaffe/orders/drafts?status=sent"]);
  });

  it("says apart which pay links end within two days, because the order is then cancelled", () => {
    const items = texts({ drafts: { waiting: 2, oldestSentAt: "2026-10-05T12:00:00Z", expiringSoon: 1 } }, now);
    expect(items).toHaveLength(2);
    expect(items[1]).toBe("Kaffe: the pay link of 1 draft order ends within 2 days, and the order is then cancelled. -> /admin/kaffe/orders/drafts?status=sent");
    expect(texts({ drafts: { waiting: 2, oldestSentAt: null, expiringSoon: 2 } }, now)[1]).toContain("the pay links of 2 draft orders end within 2 days");
  });

  it("is not urgent, shows nothing when none wait, and nothing to a member who may not read orders", () => {
    expect(attentionFor([store({ drafts: { waiting: 4, oldestSentAt: "2026-09-01T00:00:00Z", expiringSoon: 4 } })], now).every((i) => !i.urgent)).toBe(true);
    expect(texts({ drafts: { waiting: 0, oldestSentAt: null, expiringSoon: 0 } }, now)).toEqual([]);
    expect(texts({}, now)).toEqual([]);
    expect(texts({ drafts: { waiting: 4, oldestSentAt: "2026-10-01T00:00:00Z", expiringSoon: 2 }, hides: ["sales"] }, now)).toEqual([]);
  });
});

describe("the control center, parcels and order changes (D174)", () => {
  const texts = (figures: Partial<StoreFigures>, now?: number) => attentionFor([store(figures)], now).map((i) => `${i.text} -> ${i.href}`);
  const now = Date.parse("2026-10-07T12:00:00Z");

  it("tells how many orders are partly sent and when the oldest one's first parcel left, and opens the list filtered to them", () => {
    expect(texts({ partlySent: { orders: 2, oldestFirstParcelAt: "2026-10-03T12:00:00Z" } }, now)).toEqual([
      "Kaffe: 2 orders are partly sent, with items still to send; the oldest one's first parcel left 4 days ago. -> /admin/kaffe/orders?ship=partly_sent",
    ]);
    expect(texts({ partlySent: { orders: 1, oldestFirstParcelAt: "2026-10-07T08:00:00Z" } }, now)).toEqual([
      "Kaffe: 1 order is partly sent, with items still to send. -> /admin/kaffe/orders?ship=partly_sent",
    ]);
  });

  it("tells how many changes wait for the customer's payment, and which pay links end within two days", () => {
    expect(texts({ orderChanges: { waiting: 1, expiringSoon: 0 } }, now)).toEqual([
      "Kaffe: 1 order change is waiting for the customer's payment. -> /admin/kaffe/orders?ship=edit_pending",
    ]);
    expect(texts({ orderChanges: { waiting: 3, expiringSoon: 2 } }, now)).toEqual([
      "Kaffe: 3 order changes are waiting for the customer's payment; the pay links of 2 end within 2 days, and the order then stays as it was. -> /admin/kaffe/orders?ship=edit_pending",
    ]);
    expect(texts({ orderChanges: { waiting: 1, expiringSoon: 1 } }, now)[0]).toContain("the pay link of 1 ends within 2 days");
  });

  it("is not urgent, shows nothing when none, and nothing to a member who may not read orders (left out, never a 0)", () => {
    const both = { partlySent: { orders: 5, oldestFirstParcelAt: "2026-09-01T00:00:00Z" }, orderChanges: { waiting: 2, expiringSoon: 2 } };
    expect(attentionFor([store(both)], now).every((i) => !i.urgent)).toBe(true);
    expect(texts({ partlySent: { orders: 0, oldestFirstParcelAt: null }, orderChanges: { waiting: 0, expiringSoon: 0 } }, now)).toEqual([]);
    expect(texts({ ...both, hides: ["sales"] }, now)).toEqual([]);
  });
});
