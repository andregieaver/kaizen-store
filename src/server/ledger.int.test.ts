import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { closeDb, db } = await import("@/db/client");
const fx = await import("./invoice-test-fixture");
const ledger = await import("./ledger");
const { NO_POSTING } = await import("@/lib/ledger");
type BookingDoc = import("@/lib/accounting-docs").BookingDoc;
type Row = Record<string, unknown>;

/**
 * Our own ledger (B2, D478) against a real database: a store's books opened with Norway's starting chart, a Work invoice and its credit
 * note posted (once each), a mistake reversed, a month locked, and the trial balance read, balanced to the øre.
 */

afterAll(async () => {
  await closeDb();
});

const run = Date.now().toString(36);

const invoice = (id: string, kind: BookingDoc["kind"] = "invoice"): BookingDoc => ({
  source: "work",
  kind,
  id,
  documentNumber: kind === "invoice" ? "1042" : "7",
  invoiceNumber: "1042",
  issuedOn: "2027-01-14",
  currency: "NOK",
  totalMinor: 125_000,
  vatMinor: 25_000,
  lines: [{ key: "standard_25", text: "Design", grossMinor: 125_000, netMinor: 100_000, vatMinor: 25_000 }],
  customer: { kind: "work_client", clientId: "c-1" },
  counterparty: "Kunde AS",
});

describe("a store's books", () => {
  it("open with Norway's chart, post documents once, reverse a mistake, lock a month, and balance", async () => {
    const store = await fx.makeStore(`ledger-${run}`);
    const owner = await fx.ownerOf(store);
    await db().execute(sql`update commerce.stores set legal_name = 'Human Web AS', organisation_number = '999999999' where id = ${store.storeId}::uuid`);

    expect(await ledger.openLedgerBook(owner, "2027-02-30")).toEqual({ ok: false, problem: "date" });
    const opened = await ledger.openLedgerBook(owner, "2027-01-01");
    expect(opened).toMatchObject({ ok: true, book: { legalName: "Human Web AS", organisationNumber: "999999999", country: "NO", currency: "NOK", openedOn: "2027-01-01", lockedThrough: null } });
    expect(await ledger.openLedgerBook(owner, "2027-01-01")).toEqual({ ok: false, problem: "open" });
    const book = (await ledger.openBookOf(store.storeId))!;
    const chart = await ledger.ledgerAccounts(book.id);
    expect(chart.find((a) => a.number === 2703)).toMatchObject({ name: "Utgående merverdiavgift, lav sats", kind: "liability" });

    // An opening balance, by hand: the share capital in the bank.
    const opening = await ledger.postLedgerEntry(
      book.id,
      { series: "IB", date: "2027-01-01", text: "Inngående balanse", source: null, lines: [{ account: 1920, amountMinor: 3_000_000 }, { account: 2000, amountMinor: -3_000_000 }] },
      owner.account.id,
    );
    expect(opening.ok).toBe(true);

    const first = await ledger.postLedgerDoc(book, invoice(`inv-${run}`), NO_POSTING);
    expect(first.ok).toBe(true);
    expect(await ledger.postLedgerDoc(book, invoice(`inv-${run}`), NO_POSTING)).toEqual(first);
    const credit = await ledger.postLedgerDoc(book, invoice(`cn-${run}`, "credit_note"), NO_POSTING);
    expect(credit.ok).toBe(true);
    expect(await ledger.postLedgerDoc(book, { ...invoice(`eur-${run}`), currency: "EUR" }, NO_POSTING)).toEqual({ ok: false, problem: "currency" });

    // A fee posted on the wrong account, put right by its reversal and a new entry.
    const wrong = await ledger.postLedgerEntry(
      book.id,
      { series: "B", date: "2027-01-20", text: "Kortgebyr", source: null, lines: [{ account: 6800, amountMinor: 2_500 }, { account: 1920, amountMinor: -2_500 }] },
      owner.account.id,
    );
    expect(wrong.ok).toBe(true);
    const reversed = await ledger.reverseLedgerEntry(owner, wrong.ok ? wrong.id : "", "2027-01-21");
    expect(reversed.ok).toBe(true);
    expect(await ledger.reverseLedgerEntry(owner, wrong.ok ? wrong.id : "", "2027-01-21")).toEqual({ ok: false, problem: "reversed" });
    await ledger.postLedgerEntry(book.id, { series: "B", date: "2027-01-20", text: "Kortgebyr", source: null, lines: [{ account: 7770, amountMinor: 2_500 }, { account: 1920, amountMinor: -2_500 }] }, null);
    const [reversal] = await db().execute<Row>(sql`select text, entry_date::text as day from commerce.ledger_entries where id = ${reversed.ok ? reversed.id : null}::uuid`);
    expect(reversal).toEqual({ text: "Tilbakeføring av B2027-1: Kortgebyr", day: "2027-01-20" });

    // January locked: nothing more is posted on its days.
    expect(await ledger.lockLedgerThrough(owner, "2027-01-31")).toEqual({ ok: true });
    expect(await ledger.postLedgerEntry(book.id, { series: "M", date: "2027-01-31", text: "Late", source: null, lines: [{ account: 7770, amountMinor: 100 }, { account: 1920, amountMinor: -100 }] }, null)).toEqual({
      ok: false,
      problems: ["locked"],
    });
    expect(await ledger.postLedgerEntry(book.id, { series: "M", date: "2027-02-01", text: "x", source: null, lines: [{ account: 7770, amountMinor: 100 }, { account: 1920, amountMinor: -99 }] }, null)).toEqual({
      ok: false,
      problems: ["balance"],
    });

    const tb = await ledger.ledgerTrialBalance(book.id, "2027-01-02", "2027-01-31");
    expect(tb.totals.after).toBe(0);
    expect(tb.rows.find((r) => r.account === 1920)).toMatchObject({ before: 3_000_000, after: 2_997_500 });
    // The invoice and its credit note cancel: what is left is the card fee.
    expect(tb.rows.find((r) => r.account === 1500)?.after).toBe(0);
    expect(tb.result).toBe(-2_500);

    const [audits] = await db().execute<Row>(sql`
      select count(*) filter (where action = 'work.ledger_book_opened')::int as opened, count(*) filter (where action = 'work.ledger_entry_reversed')::int as reversed,
             count(*) filter (where action = 'work.ledger_locked')::int as locked
        from commerce.audit_log where store_id = ${store.storeId}::uuid`);
    expect(audits).toEqual({ opened: 1, reversed: 1, locked: 1 });
  });

  it("adds standard accounts and sub-accounts to the chart, and nothing that is neither", async () => {
    const store = await fx.makeStore(`ledger-chart-${run}`);
    const owner = await fx.ownerOf(store);
    const opened = await ledger.openLedgerBook(owner, "2027-01-01");
    if (!opened.ok) throw new Error("no book");
    expect(await ledger.addLedgerAccount(store.storeId, opened.book.id, { number: 6705 })).toEqual({ ok: false, problem: "taken" });
    expect(await ledger.addLedgerAccount(store.storeId, opened.book.id, { number: 3020 })).toEqual({ ok: true });
    expect(await ledger.addLedgerAccount(store.storeId, opened.book.id, { number: 19201, name: "Driftskonto DNB" })).toEqual({ ok: true });
    expect(await ledger.addLedgerAccount(store.storeId, opened.book.id, { number: 1234 })).toEqual({ ok: false, problem: "not_standard" });
    const chart = await ledger.ledgerAccounts(opened.book.id);
    expect(chart.find((a) => a.number === 19201)).toMatchObject({ name: "Driftskonto DNB", standard: "1920", kind: "asset" });
    expect(chart.find((a) => a.number === 3020)).toMatchObject({ name: "Salgsinntekt tjenester, avgiftspliktig, høy sats", kind: "income" });
  });
});
