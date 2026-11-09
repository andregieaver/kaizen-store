import { describe, expect, it } from "vitest";

import { clientNeeds, showsClients, sortClients, vatToReport, type ClientFacts } from "./books-clients";

const book = { openedOn: "2026-01-01", lockedThrough: "2026-08-31", lockHeld: false, vatTerm: "two_months" as const, currency: "NOK" };
const client = (over: Partial<ClientFacts> = {}): ClientFacts => ({
  slug: "a",
  name: "A",
  owner: false,
  keeps: true,
  book,
  bankWaiting: 0,
  ledgerWaiting: 0,
  billsUnpaid: 0,
  billsDue: 0,
  inboxWaiting: 0,
  vatTotalMinor: null,
  ...over,
});

describe("an accountant's clients (D512)", () => {
  it("names the VAT term to report: the last ended, until the books are locked through it", () => {
    // 9 November: September–October has ended (due 10 December); the books are locked through August.
    expect(vatToReport(book, "2026-11-09")).toMatchObject({ from: "2026-09-01", to: "2026-10-31", due: "2026-12-10" });
    expect(vatToReport({ ...book, lockedThrough: "2026-10-31" }, "2026-11-09")).toBeNull();
    expect(vatToReport({ ...book, vatTerm: "year", lockedThrough: null }, "2026-11-09")).toBeNull();
  });

  it("says what each client's books need, the most pressing first", () => {
    expect(clientNeeds(client({ book: null }), "2026-11-09")).toEqual([{ kind: "open_books" }]);
    const needs = clientNeeds(client({ billsDue: 2, bankWaiting: 5, ledgerWaiting: 1, inboxWaiting: 3 }), "2026-11-09");
    expect(needs.map((n) => n.kind)).toEqual(["vat", "bills", "bank", "waiting", "inbox"]);
    expect(needs[0]).toMatchObject({ kind: "vat", late: false });
    expect(clientNeeds(client(), "2026-12-11")[0]).toMatchObject({ kind: "vat", late: true });
    expect(clientNeeds(client({ book: { ...book, lockedThrough: "2026-10-31" } }), "2026-11-09")).toEqual([]);
  });

  it("puts a late VAT term first and books not open last, then by name", () => {
    const sorted = sortClients(
      [
        client({ slug: "calm", name: "Calm", book: { ...book, lockedThrough: "2026-10-31" } }),
        client({ slug: "closed", name: "Closed", book: null }),
        client({ slug: "late", name: "Late", book: { ...book, lockedThrough: "2026-06-30" } }),
        client({ slug: "bank", name: "Bank", book: { ...book, lockedThrough: "2026-10-31" }, bankWaiting: 4 }),
      ],
      "2026-11-09",
    );
    expect(sorted.map((c) => c.slug)).toEqual(["late", "bank", "calm", "closed"]);
  });

  it("shows the screen to someone who keeps another's books, or the books of two stores", () => {
    expect(showsClients([{ owner: true }])).toBe(false);
    expect(showsClients([{ owner: false }])).toBe(true);
    expect(showsClients([{ owner: true }, { owner: true }])).toBe(true);
    expect(showsClients([])).toBe(false);
  });
});
