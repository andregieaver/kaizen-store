import { describe, expect, it } from "vitest";

import { homeEn } from "./admin-messages/home.en";
import { homeNb } from "./admin-messages/home.nb";
import { ATTENTION_KINDS, attentionFor, changeText, storeAttentionItems, totalSales, type StoreFigures } from "./control-center";
import { demoWords, NO_DEMO, removalWords } from "./demo-content";
import { workOverview } from "./work-overview";
import { workEn } from "./admin-messages/work.en";
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

describe("Kaizena Flow's own store and its plan", () => {
  const texts = (figures: Partial<StoreFigures>) => attentionFor([store(figures)], undefined, homeEn.attention).map((i) => i.text);

  it("asks a store with no plan to choose one, and never Kaizena Flow's own store, which sells plans", () => {
    expect(texts({ open: true, plan: null })).toEqual(["Kaffe has no plan yet."]);
    expect(texts({ open: true, plan: null, house: true })).toEqual([]);
    expect(texts({ open: true, plan: { name: "Plan", status: "past_due", endsAt: null, cancelling: false }, house: true })).toEqual([]);
  });
});

describe("the control center and stock (D172)", () => {
  const texts = (figures: Partial<StoreFigures>) => attentionFor([store(figures)], undefined, homeEn.attention).map((i) => `${i.text} -> ${i.href}`);

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
    expect(attentionFor([store({ owedUnits: 6 })], undefined, homeEn.attention)[0].urgent).toBeFalsy();
  });

  it("shows none of it to a member who may not open Products", () => {
    expect(texts({ outOfStock: 2, belowLevel: 3, owedUnits: 4, lowStock: 1, hides: ["stock"] })).toEqual([]);
  });
});

describe("the control center and the store's own books (D478)", () => {
  const texts = (figures: Partial<StoreFigures>) => attentionFor([store(figures)], undefined, homeEn.attention).map((i) => `${i.text} -> ${i.href} [${i.action}]`);

  it("tells the owner what differs from Tripletex and what has waited long to be posted, with the books one press away", () => {
    expect(texts({ books: { differ: 2, waiting: 1 } })).toEqual([
      "Kaffe: 2 documents in the books differ from Tripletex. -> /admin/kaffe/settings/books [Open the books]",
      "Kaffe: 1 document has waited more than a week to be posted to the books. -> /admin/kaffe/settings/books [Open the books]",
    ]);
    expect(texts({ books: { differ: 1, waiting: 0 } })).toEqual(["Kaffe: 1 document in the books differs from Tripletex. -> /admin/kaffe/settings/books [Open the books]"]);
  });

  it("tells the owner of bills past their due date and bills falling due within the week (D492)", () => {
    expect(texts({ books: { differ: 0, waiting: 0, billsOverdue: 2, billsDue: 1 } })).toEqual([
      "Kaffe: 2 bills are past their due date. -> /admin/kaffe/settings/books [See the bills]",
      "Kaffe: 1 bill falls due within a week. -> /admin/kaffe/settings/books [See the bills]",
    ]);
    expect(texts({ books: { differ: 0, waiting: 0, billsOverdue: 0, billsDue: 0 } })).toEqual([]);
    expect(texts({ role: "admin", books: { differ: 0, waiting: 0, billsOverdue: 1 } })).toEqual([]);
    expect(attentionFor([store({ books: { differ: 0, waiting: 0, billsOverdue: 1 } })], Date.now(), homeNb.attention).map((i) => i.text)).toEqual([
      "Kaffe: 1 regning har passert forfallsdatoen.",
    ]);
  });

  it("says it only to the owner, in their language", () => {
    expect(texts({ role: "admin", books: { differ: 2, waiting: 1 } })).toEqual([]);
    expect(attentionFor([store({ books: { differ: 3, waiting: 0 } })], Date.now(), homeNb.attention).map((i) => i.text)).toEqual(["Kaffe: 3 bilag i regnskapet avviker fra Tripletex."]);
  });
});

describe("the control center (D107)", () => {
  it("says nothing when everything is well", () => {
    expect(attentionFor([store()], undefined, homeEn.attention)).toEqual([]);
  });

  it("puts what is urgent first and links to the page that acts on it", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    const items = attentionFor(
      [
        store({ slug: "a", name: "A", lowStock: 2 }),
        store({ slug: "b", name: "B", toSend: 3, oldestToSend: "2026-09-24T12:00:00Z" }),
        store({ slug: "c", name: "C", plan: { name: "Growth", status: "past_due", endsAt: null, cancelling: false } }),
      ],
      now, homeEn.attention
    );
    expect(items.map((i) => i.href)).toEqual(["/admin/b/orders?show=to-send", "/admin/c/billing", "/admin/a/products"]);
    expect(items[0]).toMatchObject({ urgent: true, text: "B: 3 orders are waiting to be sent, the oldest for 5 days." });
    expect(items[2].text).toBe("A: 2 products are running low.");
  });

  it("asks staff only for what they can do", () => {
    const items = attentionFor([store({ role: "admin", open: false, plan: null, payments: "off", toSend: 1 })], undefined, homeEn.attention);
    expect(items.map((i) => i.action)).toEqual(["Send"]);
  });

  it("puts withdrawals past the legal refund deadline and unsent acknowledgements first, then return requests (D153)", () => {
    const items = attentionFor([
      store({ slug: "a", name: "A", lowStock: 2, returns: { overdue: 2, unacknowledged: 1, requested: 3 } }),
      store({ slug: "b", name: "B", returns: { overdue: 0, unacknowledged: 0, requested: 1 } }),
    ], undefined, homeEn.attention);
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
    expect(attentionFor([store({ returns: { overdue: 0, unacknowledged: 0, requested: 0 } })], undefined, homeEn.attention)).toEqual([]);
    expect(attentionFor([store({ role: "admin", returns: { overdue: 1, unacknowledged: 0, requested: 0 } })], undefined, homeEn.attention).map((i) => i.action)).toEqual(["Refund"]);
  });

  it("flags privacy requests past their one-month clock as urgent and those due this week as a heads-up, with counts only (D162)", () => {
    const items = attentionFor([store({ slug: "a", name: "A", privacy: { overdue: 2, dueSoon: 1 } }), store({ slug: "b", name: "B", privacy: { overdue: 0, dueSoon: 3 } })], undefined, homeEn.attention);
    expect(items.map((i) => [i.text, i.href, i.action, Boolean(i.urgent)])).toEqual([
      ["A: 2 privacy requests are past the one-month deadline for an answer.", "/admin/a/privacy", "Answer", true],
      ["A: 1 privacy request is due within the week.", "/admin/a/privacy", "Open requests", false],
      ["B: 3 privacy requests are due within the week.", "/admin/b/privacy", "Open requests", false],
    ]);
  });

  it("says nothing about privacy requests when none is due, and names no person", () => {
    expect(attentionFor([store({ privacy: { overdue: 0, dueSoon: 0 } })], undefined, homeEn.attention)).toEqual([]);
    expect(attentionFor([store()], undefined, homeEn.attention)).toEqual([]);
    // Staff with the privacy log open see the same: the clock is the store's, not the owner's.
    expect(attentionFor([store({ role: "admin", privacy: { overdue: 1, dueSoon: 0 } })], undefined, homeEn.attention).map((i) => i.action)).toEqual(["Answer"]);
  });

  it("asks an owner, and only an owner, to look at tax settings that are half done (D157)", () => {
    const tax = ["The VAT number has not been checked valid."];
    const items = attentionFor([store({ slug: "a", name: "A", tax })], undefined, homeEn.attention);
    expect(items).toEqual([
      { kind: "tax", text: "A: the tax settings need a look. The VAT number has not been checked valid.", href: "/admin/a/settings/tax", action: "Open tax settings" },
    ]);
    expect(attentionFor([store({ role: "admin", tax })], undefined, homeEn.attention)).toEqual([]);
    expect(attentionFor([store({ tax: [] })], undefined, homeEn.attention)).toEqual([]);
  });

  it("asks an owner, and only an owner, about paid orders waiting for an invoice, urgent only past a reverse-charge deadline (D159)", () => {
    const waiting = attentionFor([store({ slug: "a", name: "A", invoices: { waiting: 3, overdue: 0 } })], undefined, homeEn.attention);
    expect(waiting).toEqual([
      { kind: "invoices", text: "A: 3 paid orders are waiting for an invoice.", href: "/admin/a/invoices?tab=waiting", action: "Open invoices", urgent: false },
    ]);
    const overdue = attentionFor([store({ slug: "a", name: "A", invoices: { waiting: 1, overdue: 1 } })], undefined, homeEn.attention);
    expect(overdue[0]).toMatchObject({ text: "A: 1 paid order is waiting for an invoice, 1 of them past the deadline for a reverse-charge invoice.", urgent: true });
    expect(attentionFor([store({ role: "admin", invoices: { waiting: 3, overdue: 1 } })], undefined, homeEn.attention)).toEqual([]);
    expect(attentionFor([store({ invoices: { waiting: 0, overdue: 0 } })], undefined, homeEn.attention)).toEqual([]);
  });

  it("asks an owner, and only an owner, to take the OSS or IOSS data near its due date, not urgent, never saying a return is late (D161)", () => {
    const taxReturns = [{ text: "Your OSS data for Q3 2026 has not been exported; it is due 31 October.", path: "/analytics/tax?view=oss&quarter=2026-Q3" }];
    const items = attentionFor([store({ slug: "a", name: "A", taxReturns })], undefined, homeEn.attention);
    expect(items).toEqual([
      { kind: "tax_returns", text: "A: Your OSS data for Q3 2026 has not been exported; it is due 31 October.", href: "/admin/a/analytics/tax?view=oss&quarter=2026-Q3", action: "Open VAT report" },
    ]);
    expect(items[0].urgent).toBeUndefined();
    expect(items[0].text).not.toMatch(/late|overdue/i);
    expect(attentionFor([store({ role: "admin", taxReturns })], undefined, homeEn.attention)).toEqual([]);
    expect(attentionFor([store({ taxReturns: [] })], undefined, homeEn.attention)).toEqual([]);
  });

  it("adds Work's own attention items for a store that uses it, urgent first, and nothing for one that does not", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    const workOf = (slug: string, name: string) => workOverview({ words: workEn.attention,
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
          lostMinor: 0,
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
      now, homeEn.attention
    );
    // The overdue invoice is 28 days late, so it is urgent and comes before the stock; staff see it too.
    expect(items.map((i) => i.href)).toEqual([
      "/admin/account/work/s/b/invoices?show=overdue",
      "/admin/account/work/s/d/invoices?show=overdue",
      "/admin/a/products",
    ]);
    expect(items[0]).toMatchObject({ urgent: true, action: "Open invoices" });
    // A store that has not switched Work on brings none, whether the figure is missing or empty.
    expect(attentionFor([store(), store({ work: [] })], undefined, homeEn.attention)).toEqual([]);
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
    expect(changeText(1500, 500, homeEn.common)).toBe("+200 % on the week before");
    expect(changeText(90, 100, homeEn.common)).toBe("−10 % on the week before");
    expect(changeText(100, 100, homeEn.common)).toBe("Same as the week before");
    expect(changeText(5, 0, homeEn.common)).toBe("New this week");
    expect(changeText(0, 0, homeEn.common)).toBeNull();
  });
});

describe("the control center and draft orders (D173)", () => {
  const texts = (figures: Partial<StoreFigures>, now?: number) => attentionFor([store(figures)], now, homeEn.attention).map((i) => `${i.text} -> ${i.href}`);
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
    expect(attentionFor([store({ drafts: { waiting: 4, oldestSentAt: "2026-09-01T00:00:00Z", expiringSoon: 4 } })], now, homeEn.attention).every((i) => !i.urgent)).toBe(true);
    expect(texts({ drafts: { waiting: 0, oldestSentAt: null, expiringSoon: 0 } }, now)).toEqual([]);
    expect(texts({}, now)).toEqual([]);
    expect(texts({ drafts: { waiting: 4, oldestSentAt: "2026-10-01T00:00:00Z", expiringSoon: 2 }, hides: ["sales"] }, now)).toEqual([]);
  });
});

describe("the control center, parcels and order changes (D174)", () => {
  const texts = (figures: Partial<StoreFigures>, now?: number) => attentionFor([store(figures)], now, homeEn.attention).map((i) => `${i.text} -> ${i.href}`);
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
    expect(attentionFor([store(both)], now, homeEn.attention).every((i) => !i.urgent)).toBe(true);
    expect(texts({ partlySent: { orders: 0, oldestFirstParcelAt: null }, orderChanges: { waiting: 0, expiringSoon: 0 } }, now)).toEqual([]);
    expect(texts({ ...both, hides: ["sales"] }, now)).toEqual([]);
  });
});

describe("the control center and orders handed over by the store (D237)", () => {
  const texts = (figures: Partial<StoreFigures>, now?: number) => attentionFor([store(figures)], now, homeEn.attention).map((i) => `${i.text} -> ${i.href}`);
  const now = Date.parse("2026-10-07T12:00:00Z");

  it("says orders waiting to be collected and local deliveries apart from those to send, and opens their views", () => {
    expect(texts({ toSend: 1, handOver: { pickup: 2, oldestPickupAt: "2026-10-04T10:00:00Z", local: 1 } }, now)).toEqual([
      "Kaffe: 1 order is waiting to be sent. -> /admin/kaffe/orders?show=to-send",
      "Kaffe: 2 orders are waiting to be collected, the oldest placed 3 days ago. -> /admin/kaffe/orders?show=to-hand-over",
      "Kaffe: 1 local delivery is not delivered yet. -> /admin/kaffe/orders?show=local",
    ]);
    expect(texts({ handOver: { pickup: 1, oldestPickupAt: "2026-10-07T09:00:00Z", local: 0 } }, now)).toEqual(["Kaffe: 1 order is waiting to be collected. -> /admin/kaffe/orders?show=to-hand-over"]);
    expect(texts({ handOver: { pickup: 0, oldestPickupAt: null, local: 3 } }, now)).toEqual(["Kaffe: 3 local deliveries are not delivered yet. -> /admin/kaffe/orders?show=local"]);
  });

  it("is not urgent, and shows nothing to a member who may not read orders (left out, never a 0)", () => {
    const hand = { handOver: { pickup: 4, oldestPickupAt: "2026-09-01T00:00:00Z", local: 2 } };
    expect(attentionFor([store(hand)], now, homeEn.attention).every((i) => !i.urgent)).toBe(true);
    expect(texts({ ...hand, hides: ["sales"] }, now)).toEqual([]);
  });
});

describe("support waiting (D216, step 14)", () => {
  it("says how many wait for a person, urgent, links to the inbox, and nothing when none or not given", () => {
    const items = attentionFor([store({ supportWaiting: 3 })], undefined, homeEn.attention);
    expect(items.map((i) => `${i.text} -> ${i.href}`)).toEqual(["Kaffe: Support: 3 waiting for a person. -> /admin/kaffe/support"]);
    expect(items[0].urgent).toBe(true);
    expect(attentionFor([store({ supportWaiting: 0 })], undefined, homeEn.attention)).toEqual([]);
  });

  it("counts the chat assistant's requests waiting for a decision (ecosystem plan E1.7)", () => {
    const items = attentionFor([store({ supportRequests: 2 })], undefined, homeEn.attention);
    expect(items.map((i) => `${i.text} -> ${i.href}`)).toEqual(["Kaffe: Support: 2 requests from the chat assistant are waiting for your decision. -> /admin/kaffe/support/requests"]);
    expect(items[0].urgent).toBeFalsy();
    expect(attentionFor([store({ supportRequests: 1 })], undefined, homeEn.attention)[0].text).toBe("Kaffe: Support: 1 request from the chat assistant is waiting for your decision.");
    expect(attentionFor([store({ supportRequests: 0 })], undefined, homeEn.attention)).toEqual([]);
    expect(attentionFor([store()], undefined, homeEn.attention)).toEqual([]);
  });
});

describe("the control center and business customers the register flags (D891)", () => {
  const items = (figures: Partial<StoreFigures>) => attentionFor([store(figures)], undefined, homeEn.attention);

  it("opens the one company at once, the list for several, urgent; nothing when none or when sales are hidden", () => {
    const one = items({ companiesFlagged: { n: 1, first: "c1" } });
    expect(one.map((i) => `${i.text} -> ${i.href}`)).toEqual(["Kaffe: 1 business customer is bankrupt or being wound up, says Brønnøysund. -> /admin/kaffe/companies/c1"]);
    expect(one[0]).toMatchObject({ kind: "companies_flagged", urgent: true, action: homeEn.attention.actions.openCompany });
    expect(items({ companiesFlagged: { n: 3, first: "c1" } })[0]).toMatchObject({ href: "/admin/kaffe/companies", action: homeEn.attention.actions.openCompanies });
    expect(items({ companiesFlagged: { n: 0, first: null } })).toEqual([]);
    expect(items({ companiesFlagged: { n: 2, first: "c1" }, hides: ["sales"] })).toEqual([]);
  });
});

describe("the control center and invoices on payment terms (D293)", () => {
  const texts = (figures: Partial<StoreFigures>) => attentionFor([store(figures)], undefined, homeEn.attention).map((i) => `${i.text} -> ${i.href}`);

  it("says how many invoices are overdue, urgent, and links to them; nothing when none are or to a member who may not read orders", () => {
    expect(texts({ termsOverdue: 2 })).toEqual(["Kaffe: 2 invoices on payment terms are overdue. -> /admin/kaffe/orders?pay=terms_overdue"]);
    expect(texts({ termsOverdue: 1 })).toEqual(["Kaffe: 1 invoice on payment terms is overdue. -> /admin/kaffe/orders?pay=terms_overdue"]);
    expect(attentionFor([store({ termsOverdue: 1 })], undefined, homeEn.attention)[0].urgent).toBe(true);
    expect(texts({ termsOverdue: 0 })).toEqual([]);
    expect(texts({ termsOverdue: 3, hides: ["sales"] })).toEqual([]);
  });
});

describe("the control center in Norwegian (D312 A3)", () => {
  const nb = homeNb.attention;
  const now = Date.parse("2026-10-22T12:00:00Z");

  it("writes every item in the account's language, with its count and its action", () => {
    const items = attentionFor(
      [
        store({
          toSend: 1,
          oldestToSend: "2026-10-18T12:00:00Z",
          outOfStock: 3,
          drafts: { waiting: 2, oldestSentAt: null, expiringSoon: 1 },
          invoices: { waiting: 4, overdue: 1 },
        }),
      ],
      now,
      nb,
    );
    expect(items.map((i) => `${i.text} [${i.action}]`)).toEqual([
      "Kaffe: 1 bestilling venter på å bli sendt, den eldste i 4 dager. [Send]",
      "Kaffe: 4 betalte bestillinger venter på faktura, 1 av dem over fristen for en faktura med omvendt avgiftsplikt. [Åpne fakturaer]",
      "Kaffe: 2 utkast til bestillinger venter på betaling. [Åpne utkast]",
      "Kaffe: betalingslenken til 1 utkast til bestilling utløper innen 2 dager, og bestillingen blir da kansellert. [Åpne utkast]",
      "Kaffe: 3 produkter er utsolgt. [Åpne produkter]",
    ]);
  });

  it("keeps the English as it was when no words are given", () => {
    expect(attentionFor([store({ outOfStock: 1 })], now, homeEn.attention).map((i) => i.text)).toEqual(["Kaffe: 1 product is out of stock."]);
  });

  it("says the change on the week before and the demo content in Norwegian", () => {
    expect(changeText(150, 100, homeNb.common)).toBe("+50 % fra uken før");
    expect(changeText(1, 0, homeNb.common)).toBe("Nytt denne uken");
    expect(demoWords({ products: 6, pages: 1, articles: 0, categories: 2, tags: 0 }, homeNb.demo)).toBe("6 produkter, 1 side og 2 kategorier");
    expect(removalWords(NO_DEMO, [{ kind: "page", title: "Om oss", reason: "changed" }], homeNb.demo)).toEqual([
      "Ingenting ble fjernet.",
      "Beholdt 1 du har endret: Om oss.",
    ]);
  });

  it("has a Norwegian word for every English one of the area, none left empty", () => {
    const leaves = (value: unknown, path = ""): [string, string][] =>
      typeof value === "string" ? [[path, value]] : Object.entries(value as object).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
    const en = new Map(leaves(homeEn));
    const nbLeaves = leaves(homeNb);
    expect(nbLeaves.map(([p]) => p).sort()).toEqual([...en.keys()].sort());
    expect(nbLeaves.filter(([, v]) => v.trim() === "")).toEqual([]);
  });
});

describe("limits used up (D314)", () => {
  it("tells the owner, links to Billing, and tells nobody else", () => {
    const items = attentionFor([store({ limitsReached: 2 })], undefined, homeEn.attention);
    expect(items.map((i) => `${i.text} -> ${i.href}`)).toEqual(["Kaffe has used up 2 limits of its plan. -> /admin/kaffe/billing"]);
    expect(attentionFor([store({ limitsReached: 1 })], undefined, homeEn.attention)[0].text).toBe("Kaffe has used up a limit of its plan.");
    expect(attentionFor([store({ limitsReached: 2, role: "admin" })], undefined, homeEn.attention)).toEqual([]);
    expect(attentionFor([store({ limitsReached: 0 })], undefined, homeEn.attention)).toEqual([]);
  });
});

describe("the queues of ecosystem plan E2.1 (D713)", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  const texts = (figures: Partial<StoreFigures>) =>
    attentionFor([store(figures)], now, homeEn.attention).map((i) => `${i.text} -> ${i.href} [${i.action}]${i.urgent ? " urgent" : ""}`);
  const one = { orderId: "11111111-1111-4111-8111-111111111111", disputeId: "22222222-2222-4222-8222-222222222222" };

  it("asks for the answer to a payment dispute, urgent, with the days left, opening the dispute itself when there is one", () => {
    expect(texts({ disputes: { waiting: 1, dueBy: "2026-11-20T10:00:00Z", only: one } })).toEqual([
      `Kaffe: a customer's bank disputed a payment, and it needs your answer within 3 days. -> /admin/kaffe/orders/${one.orderId}/dispute/${one.disputeId} [Answer] urgent`,
    ]);
    expect(texts({ disputes: { waiting: 2, dueBy: "2026-11-18T11:00:00Z", only: null } })).toEqual([
      "Kaffe: customers' banks disputed 2 payments, and they need your answer, the first within 1 day. -> /admin/kaffe/orders?pay=disputed [See orders] urgent",
    ]);
    // A deadline not known, or already past, is not said; staff who read orders see it too (the figure is only there for them).
    expect(texts({ disputes: { waiting: 1, dueBy: null, only: one } })[0]).toContain("it needs your answer. ->");
    expect(texts({ disputes: { waiting: 1, dueBy: "2026-11-16T12:00:00Z", only: one } })[0]).toContain("it needs your answer. ->");
    expect(texts({ role: "admin", disputes: { waiting: 1, dueBy: null, only: one } })).toHaveLength(1);
    expect(texts({ disputes: { waiting: 0, dueBy: null, only: null } })).toEqual([]);
  });

  it("tells the owner, and only the owner, what the AI manager waits on them to decide", () => {
    expect(texts({ aiDecisions: 2 })).toEqual(["Kaffe: the AI manager is waiting for your decisions on 2 things. -> /admin/kaffe/assistant/autopilot [Decide]"]);
    expect(texts({ aiDecisions: 1 })).toEqual(["Kaffe: the AI manager is waiting for your decision on 1 thing. -> /admin/kaffe/assistant/autopilot [Decide]"]);
    expect(texts({ role: "admin", aiDecisions: 2 })).toEqual([]);
    expect(texts({ aiDecisions: 0 })).toEqual([]);
  });

  it("counts new leads waiting for a decision, not urgent, with the leads view one press away", () => {
    expect(texts({ leads: 3 })).toEqual(["Kaffe: 3 new leads are waiting for you to make a deal or dismiss them. -> /admin/kaffe/deals?view=leads [Open leads]"]);
    expect(texts({ leads: 1 })).toEqual(["Kaffe: 1 new lead is waiting for you to make a deal or dismiss it. -> /admin/kaffe/deals?view=leads [Open leads]"]);
    expect(texts({ leads: 0 })).toEqual([]);
  });

  it("says the member's own calls, meetings and tasks overdue and due today apart, and the team's where the figures are everyone's", () => {
    expect(texts({ activities: { overdue: 2, today: 1 } })).toEqual([
      "Kaffe: 2 of your calls, meetings and tasks are overdue. -> /admin/kaffe?today=mine [See today]",
      "Kaffe: 1 of your calls, meetings and tasks is due today. -> /admin/kaffe?today=mine [See today]",
    ]);
    expect(texts({ activities: { overdue: 0, today: 4, team: true } })).toEqual([
      "Kaffe: 4 of the team's calls, meetings and tasks are due today. -> /admin/kaffe?today=team [See today]",
    ]);
    expect(texts({ activities: { overdue: 1, today: 0, team: true } })).toEqual([
      "Kaffe: 1 of the team's calls, meetings and tasks is overdue. -> /admin/kaffe?today=team [See today]",
    ]);
    expect(texts({ activities: { overdue: 0, today: 0 } })).toEqual([]);
  });

  it("counts blog comments held for a check, with the Comments page's waiting tab", () => {
    expect(texts({ blogComments: 5 })).toEqual(["Kaffe: 5 comments on your articles are waiting to be checked. -> /admin/kaffe/articles/comments?status=pending [Check]"]);
    expect(texts({ blogComments: 1 })).toEqual(["Kaffe: 1 comment on your articles is waiting to be checked. -> /admin/kaffe/articles/comments?status=pending [Check]"]);
    expect(texts({ blogComments: 0 })).toEqual([]);
  });

  it("says nothing of a queue whose figure is missing: the member may not see it, or nothing waits", () => {
    expect(attentionFor([store()], now, homeEn.attention)).toEqual([]);
  });

  it("puts a dispute among the urgent first, and the others after", () => {
    const items = attentionFor([store({ lowStock: 1, leads: 1, disputes: { waiting: 1, dueBy: null, only: one } })], now, homeEn.attention);
    expect(items.map((i) => i.kind)).toEqual(["disputes", "leads", "low_stock"]);
  });

  it("writes them in Norwegian", () => {
    const items = attentionFor(
      [
        store({
          disputes: { waiting: 2, dueBy: "2026-11-20T10:00:00Z", only: null },
          aiDecisions: 1,
          leads: 2,
          activities: { overdue: 1, today: 2 },
          blogComments: 1,
        }),
      ],
      now,
      homeNb.attention,
    );
    expect(items.map((i) => `${i.text} [${i.action}]`)).toEqual([
      "Kaffe: kunders banker har krevd 2 betalinger tilbakeført, og de trenger svaret ditt, den første innen 3 dager. [Se bestillinger]",
      "Kaffe: KI-assistenten venter på avgjørelsen din om 1 ting. [Avgjør]",
      "Kaffe: 2 nye leads venter på at du lager avtaler av dem eller avviser dem. [Åpne leads]",
      "Kaffe: 1 av samtalene, møtene og oppgavene dine er forsinket. [Se dagen]",
      "Kaffe: 2 av samtalene, møtene og oppgavene dine skal gjøres i dag. [Se dagen]",
      "Kaffe: 1 kommentar på artiklene dine venter på kontroll. [Kontroller]",
    ]);
  });
});

describe("one attention source (ecosystem plan E2.1, D713)", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");

  it("names every item's kind, from one list without repeats", () => {
    expect(new Set(ATTENTION_KINDS).size).toBe(ATTENTION_KINDS.length);
    const items = attentionFor(
      [
        store({
          suspended: true,
          toSend: 1,
          outOfStock: 1,
          supportWaiting: 1,
          privacy: { overdue: 1, dueSoon: 1 },
          books: { differ: 1, waiting: 1, billsOverdue: 1, billsDue: 1 },
          disputes: { waiting: 1, dueBy: null, only: null },
          leads: 1,
          work: [{ text: "Kaffe: 1 invoice is overdue.", href: "/admin/account/work/s/kaffe/invoices", action: "Open invoices" }],
        }),
      ],
      now, homeEn.attention
    );
    expect(items.every((i) => (ATTENTION_KINDS as readonly string[]).includes(i.kind))).toBe(true);
    expect(items.find((i) => i.href.includes("/work/"))?.kind).toBe("work");
    expect(items.find((i) => i.href.endsWith("/orders?show=to-send"))?.kind).toBe("to_send");
  });

  it("gives a store's queue items said inside the store, typed, urgent a yes or a no, urgent first", () => {
    const items = storeAttentionItems({ slug: "kaffe", name: "Kaffe", role: "owner", blogComments: 2, disputes: { waiting: 1, dueBy: null, only: null } }, now, homeEn.attention);
    expect(items).toEqual([
      { kind: "disputes", text: "A customer's bank disputed a payment, and it needs your answer.", href: "/admin/kaffe/orders?pay=disputed", action: "See orders", urgent: true },
      { kind: "blog_comments", text: "2 comments on your articles are waiting to be checked.", href: "/admin/kaffe/articles/comments?status=pending", action: "Check", urgent: false },
    ]);
    expect(storeAttentionItems({ slug: "kaffe", name: "Kaffe", role: "owner" }, now, homeEn.attention)).toEqual([]);
    expect(storeAttentionItems({ slug: "kaffe", name: "Kaffe", role: "owner", leads: 1 }, now, homeNb.attention)[0].text).toBe(
      "1 nytt lead venter på at du lager en avtale av det eller avviser det.",
    );
  });

  it("names flows losing readers, opening the one flow or the flows page (M3.8)", () => {
    const one = storeAttentionItems({ slug: "kaffe", name: "Kaffe", role: "owner", flowsLosing: { flows: 1, only: "f1" } }, now, homeEn.attention);
    expect(one).toEqual([
      {
        kind: "flows_losing",
        text: "1 flow is losing readers: more than 1 in 20 who started it left your list. Its page says what to change.",
        href: "/admin/kaffe/flows/f1",
        action: "See the flow",
        urgent: false,
      },
    ]);
    expect(storeAttentionItems({ slug: "kaffe", name: "Kaffe", role: "owner", flowsLosing: { flows: 2, only: null } }, now, homeNb.attention)[0]).toMatchObject({
      href: "/admin/kaffe/flows",
      text: "2 flyter mister lesere: mer enn 1 av 20 som startet dem, meldte seg av listen. Sidene deres sier hva du kan endre.",
    });
  });

  it("names a flow the guard switched off as urgent, opening it (M3.9)", () => {
    const [item] = storeAttentionItems({ slug: "kaffe", name: "Kaffe", role: "owner", flowsPaused: { flows: 1, only: "f2" } }, now, homeEn.attention);
    expect(item).toEqual({
      kind: "flows_paused",
      text: "1 flow was switched off because readers left your list after its emails. Its page says what happened.",
      href: "/admin/kaffe/flows/f2",
      action: "See the flow",
      urgent: true,
    });
  });
});
