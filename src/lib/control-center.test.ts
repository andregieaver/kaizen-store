import { describe, expect, it } from "vitest";

import { homeEn } from "./admin-messages/home.en";
import { homeNb } from "./admin-messages/home.nb";
import { attentionFor, changeText, totalSales, type StoreFigures } from "./control-center";
import { demoWords, NO_DEMO, removalWords } from "./demo-content";
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

describe("the control center and orders handed over by the store (D237)", () => {
  const texts = (figures: Partial<StoreFigures>, now?: number) => attentionFor([store(figures)], now).map((i) => `${i.text} -> ${i.href}`);
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
    expect(attentionFor([store(hand)], now).every((i) => !i.urgent)).toBe(true);
    expect(texts({ ...hand, hides: ["sales"] }, now)).toEqual([]);
  });
});

describe("support waiting (D216, step 14)", () => {
  it("says how many wait for a person, urgent, links to the inbox, and nothing when none or not given", () => {
    const items = attentionFor([store({ supportWaiting: 3 })]);
    expect(items.map((i) => `${i.text} -> ${i.href}`)).toEqual(["Kaffe: Support: 3 waiting for a person. -> /admin/kaffe/support"]);
    expect(items[0].urgent).toBe(true);
    expect(attentionFor([store({ supportWaiting: 0 })])).toEqual([]);
    expect(attentionFor([store()])).toEqual([]);
  });
});

describe("the control center and invoices on payment terms (D293)", () => {
  const texts = (figures: Partial<StoreFigures>) => attentionFor([store(figures)]).map((i) => `${i.text} -> ${i.href}`);

  it("says how many invoices are overdue, urgent, and links to them; nothing when none are or to a member who may not read orders", () => {
    expect(texts({ termsOverdue: 2 })).toEqual(["Kaffe: 2 invoices on payment terms are overdue. -> /admin/kaffe/orders?pay=terms_overdue"]);
    expect(texts({ termsOverdue: 1 })).toEqual(["Kaffe: 1 invoice on payment terms is overdue. -> /admin/kaffe/orders?pay=terms_overdue"]);
    expect(attentionFor([store({ termsOverdue: 1 })])[0].urgent).toBe(true);
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
    expect(attentionFor([store({ outOfStock: 1 })], now).map((i) => i.text)).toEqual(["Kaffe: 1 product is out of stock."]);
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
    const items = attentionFor([store({ limitsReached: 2 })]);
    expect(items.map((i) => `${i.text} -> ${i.href}`)).toEqual(["Kaffe has used up 2 limits of its plan. -> /admin/kaffe/billing"]);
    expect(attentionFor([store({ limitsReached: 1 })])[0].text).toBe("Kaffe has used up a limit of its plan.");
    expect(attentionFor([store({ limitsReached: 2, role: "admin" })])).toEqual([]);
    expect(attentionFor([store({ limitsReached: 0 })])).toEqual([]);
  });
});
