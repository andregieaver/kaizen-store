import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  SHOP_CUSTOMER_ID,
  addressOfLine,
  contactNames,
  isCustomerAccount,
  isSupplierAccount,
  partyBalances,
  partyId,
  saftBalances,
  saftXml,
  saftYears,
  standardName,
  ungroupedAccounts,
  type SaftAccount,
  type SaftEntry,
  type SaftLine,
  type SaftParty,
} from "@/lib/saft";
import { UNCARRIED_RESULT_ACCOUNT } from "@/lib/ledger";

import { audit, type Membership } from "./auth";
import { type LedgerBook } from "./ledger";
import { log } from "./log";
import { col, typedRows } from "./typed-rows";
import { vatReturnOrgNumber } from "./vat-return";

/**
 * SAF-T Financial (B5 step 2, D497): a year of the store's own books as Skatteetaten's file, read from the ledger. Each account with its
 * balances at the start and end of the year's days in the book (`saftBalances()`), the entries of those days with their lines, and the
 * customers and suppliers their lines name: a Work invoice's, credit note's or payment's client, the shop's buyers as one customer, a bill's
 * supplier (and its payment's). Read only; each file made is audited (`work.ledger_saft_downloaded`, ids and counts).
 */

export type SaftProblem = "year" | "org_number" | "grouping";
export type SaftResult = { ok: true; xml: string; organisationNumber: string; entries: number } | { ok: false; problem: SaftProblem; accounts?: number[] };

/** Kinds of entries whose line on a customer account is owed by the shop's buyers (their sales, payments, refunds and disputes). */
const isShopKind = (kind: string | null) => kind !== null && (kind.startsWith("shop_") || kind === "dispute");

const SUMS = z.object({
  number: col.int,
  name: col.text,
  standard: col.textOrNull,
  created_on: col.textOrNull,
  before_year: col.minor,
  in_year_before: col.minor,
  in_selection: col.minor,
});

/** The book's chart, each account with what its lines sum to before the year, in the year before the days, and in the days. */
async function accountsOf(book: LedgerBook, timeZone: string, from: string, to: string): Promise<SaftAccount[]> {
  const yearStart = `${from.slice(0, 4)}-01-01`;
  const rows = await typedRows(
    SUMS,
    sql`
      select a.number, a.name, a.standard, (timezone(${timeZone}, a.created_at))::date::text as created_on,
             coalesce(sum(l.amount_minor) filter (where e.entry_date < ${yearStart}::date), 0) as before_year,
             coalesce(sum(l.amount_minor) filter (where e.entry_date >= ${yearStart}::date and e.entry_date < ${from}::date), 0) as in_year_before,
             coalesce(sum(l.amount_minor) filter (where e.entry_date between ${from}::date and ${to}::date), 0) as in_selection
        from commerce.ledger_accounts a
        left join commerce.ledger_lines l on l.book_id = a.book_id and l.account = a.number
        left join commerce.ledger_entries e on e.id = l.entry_id
       where a.book_id = ${book.id}::uuid
       group by a.number, a.name, a.standard, a.created_at
    `,
  );
  const balances = new Map(saftBalances(rows.map((r) => ({ account: r.number, beforeYear: r.before_year, inYearBefore: r.in_year_before, inSelection: r.in_selection }))).map((b) => [b.account, b]));
  const accounts: SaftAccount[] = rows.map((r) => ({
    number: r.number,
    name: r.name,
    standard: r.standard,
    createdOn: r.created_on,
    opening: balances.get(r.number)?.opening ?? 0,
    closing: balances.get(r.number)?.closing ?? 0,
  }));
  // An earlier year's result carried to other equity, where the chart has no such account.
  const carried = balances.get(UNCARRIED_RESULT_ACCOUNT);
  if (carried && !accounts.some((a) => a.number === UNCARRIED_RESULT_ACCOUNT)) {
    accounts.push({ number: UNCARRIED_RESULT_ACCOUNT, name: standardName(UNCARRIED_RESULT_ACCOUNT), standard: String(UNCARRIED_RESULT_ACCOUNT), createdOn: null, opening: carried.opening, closing: carried.closing });
  }
  return accounts;
}

const PARTY_LINE = z.object({
  entry_id: col.uuid,
  line: col.int,
  account: col.int,
  amount_minor: col.minor,
  day: col.text,
  kind: col.textOrNull,
  client_id: col.uuid.nullable(),
  supplier_id: col.uuid.nullable(),
});

/**
 * Every line on a customer or supplier account up to `to`, with whose it is: a reversing entry's by the entry it reverses. The client of a
 * Work invoice, of the invoice a credit note or payment is for; the supplier of the bill an entry posted or paid.
 */
async function partyLinesOf(storeId: string, bookId: string, to: string) {
  return typedRows(
    PARTY_LINE,
    sql`
      with lines as (
        select l.entry_id, l.line, l.account, l.amount_minor, e.entry_date::text as day,
               coalesce(o.id, e.id) as origin_id, coalesce(o.source_kind, e.source_kind) as kind, coalesce(o.source_id, e.source_id) as source_id
          from commerce.ledger_lines l
          join commerce.ledger_entries e on e.id = l.entry_id
          left join commerce.ledger_entries o on o.id = e.reverses
         where l.book_id = ${bookId}::uuid and e.entry_date <= ${to}::date
           and (left(l.account::text, 4)::int between 1500 and 1529 or left(l.account::text, 4)::int between 2400 and 2459)
      )
      select l.entry_id, l.line, l.account, l.amount_minor, l.day, l.kind,
             case
               when l.kind = 'work_invoice' then
                 (select i.client_id from commerce.work_invoices i where i.store_id = ${storeId}::uuid and i.id = l.source_id::uuid)
               when l.kind = 'work_credit_note' then
                 (select i.client_id from commerce.work_credit_notes c join commerce.work_invoices i on i.store_id = c.store_id and i.id = c.invoice_id
                   where c.store_id = ${storeId}::uuid and c.id = l.source_id::uuid)
               when l.kind = 'work_payment' then
                 (select i.client_id from commerce.work_invoice_payments p join commerce.work_invoices i on i.store_id = p.store_id and i.id = p.invoice_id
                   where p.store_id = ${storeId}::uuid and p.id = l.source_id::uuid)
             end as client_id,
             (select s.supplier_id from commerce.supplier_invoices s
               where s.store_id = ${storeId}::uuid and (s.entry_id = l.origin_id or s.paid_entry_id = l.origin_id) limit 1) as supplier_id
        from lines l
    `,
  );
}

const ADDRESS = z.object({ line1: z.string().optional(), line2: z.string().optional(), postalCode: z.string().optional(), city: z.string().optional() }).catch({});

/** The customers and suppliers the lines name, with what each owed at the start and end; those with nothing owed and no line in the days left out. */
async function partiesOf(storeId: string, rows: Awaited<ReturnType<typeof partyLinesOf>>, from: string, to: string) {
  const owner = new Map<string, string>();
  const customerLines: { party: string; account: number; amount: number; date: string }[] = [];
  const supplierLines: { party: string; account: number; amount: number; date: string }[] = [];
  for (const r of rows) {
    if (isCustomerAccount(r.account)) {
      const party = r.client_id ? partyId(r.client_id) : isShopKind(r.kind) ? SHOP_CUSTOMER_ID : null;
      if (!party) continue;
      owner.set(`${r.entry_id}:${r.line}`, party);
      customerLines.push({ party, account: r.account, amount: r.amount_minor, date: r.day });
    } else if (isSupplierAccount(r.account) && r.supplier_id) {
      const party = partyId(r.supplier_id);
      owner.set(`${r.entry_id}:${r.line}`, party);
      supplierLines.push({ party, account: r.account, amount: r.amount_minor, date: r.day });
    }
  }
  const named = (lines: typeof customerLines) => {
    const active = new Set(lines.filter((l) => l.date >= from && l.date <= to).map((l) => l.party));
    return [...partyBalances(lines, from, to).entries()].filter(([party, balances]) => active.has(party) || balances.some((b) => b.opening !== 0 || b.closing !== 0));
  };
  const customers = named(customerLines);
  const suppliers = named(supplierLines);
  const clientIds = [...new Set(rows.filter((r) => r.client_id && customers.some(([p]) => p === partyId(r.client_id!))).map((r) => r.client_id!))];
  const supplierIds = [...new Set(rows.filter((r) => r.supplier_id && suppliers.some(([p]) => p === partyId(r.supplier_id!))).map((r) => r.supplier_id!))];
  const [clients, sellers] = await Promise.all([
    clientIds.length === 0
      ? Promise.resolve([])
      : typedRows(
          z.object({ id: col.uuid, name: col.text, legal_name: col.textOrNull, organisation_number: col.textOrNull, country: col.textOrNull, billing_address: z.unknown() }),
          sql`select id, name, legal_name, organisation_number, country, billing_address from commerce.work_clients
               where store_id = ${storeId}::uuid and id in (${sql.join(clientIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
        ),
    supplierIds.length === 0
      ? Promise.resolve([])
      : typedRows(
          z.object({ id: col.uuid, name: col.text, organisation_number: col.textOrNull }),
          sql`select id, name, organisation_number from commerce.suppliers
               where store_id = ${storeId}::uuid and id in (${sql.join(supplierIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
        ),
  ]);
  const clientById = new Map(clients.map((c) => [partyId(c.id), c]));
  const supplierById = new Map(sellers.map((s) => [partyId(s.id), s]));
  const customerParties: SaftParty[] = customers.map(([id, balances]) => {
    if (id === SHOP_CUSTOMER_ID) return { id, name: "Nettbutikkens kunder", registrationNumber: null, address: null, balances };
    const c = clientById.get(id);
    const a = ADDRESS.parse(c?.billing_address ?? {});
    const street = [a.line1, a.line2].filter((x) => x && x.trim()).join(", ");
    const address = street || a.postalCode || a.city || c?.country ? { street: street || null, postalCode: a.postalCode?.trim() || null, city: a.city?.trim() || null, country: c?.country ?? null } : null;
    return { id, name: c ? (c.legal_name?.trim() || c.name) : id, registrationNumber: c?.organisation_number ?? null, address, balances };
  });
  const supplierParties: SaftParty[] = suppliers.map(([id, balances]) => {
    const s = supplierById.get(id);
    return { id, name: s?.name ?? id, registrationNumber: s?.organisation_number ?? null, address: null, balances };
  });
  return { owner, customers: customerParties, suppliers: supplierParties };
}

const ENTRY = z.object({ id: col.uuid, series: col.text, year: col.int, number: col.int, entry_date: col.text, posted_on: col.text, text: col.text, source_kind: col.textOrNull, reversal: z.boolean() });
const LINE = z.object({ entry_id: col.uuid, line: col.int, account: col.int, amount_minor: col.minor, vat_code: col.textOrNull, text: col.textOrNull });

/** The entries of the days, each with its lines, the customer or supplier on each line that has one. */
async function entriesOf(bookId: string, timeZone: string, from: string, to: string, owner: Map<string, string>): Promise<SaftEntry[]> {
  const [entries, lines] = await Promise.all([
    typedRows(
      ENTRY,
      sql`select e.id, e.series, e.year, e.number, e.entry_date::text, (timezone(${timeZone}, e.posted_at))::date::text as posted_on, e.text, e.source_kind,
                 e.reverses is not null as reversal
            from commerce.ledger_entries e
           where e.book_id = ${bookId}::uuid and e.entry_date between ${from}::date and ${to}::date`,
    ),
    typedRows(
      LINE,
      sql`select l.entry_id, l.line, l.account, l.amount_minor, l.vat_code, l.text
            from commerce.ledger_lines l join commerce.ledger_entries e on e.id = l.entry_id
           where l.book_id = ${bookId}::uuid and e.entry_date between ${from}::date and ${to}::date`,
    ),
  ]);
  const byEntry = new Map<string, SaftLine[]>();
  for (const l of lines) {
    const party = owner.get(`${l.entry_id}:${l.line}`) ?? null;
    const list = byEntry.get(l.entry_id) ?? [];
    list.push({
      line: l.line,
      account: l.account,
      amount: l.amount_minor,
      vatCode: l.vat_code,
      text: l.text,
      customerId: party && isCustomerAccount(l.account) ? party : null,
      supplierId: party && isSupplierAccount(l.account) ? party : null,
    });
    byEntry.set(l.entry_id, list);
  }
  return entries.map((e) => ({
    series: e.series,
    year: e.year,
    number: e.number,
    date: e.entry_date,
    postedOn: e.posted_on,
    text: e.text,
    sourceKind: e.source_kind,
    reversal: e.reversal,
    lines: byEntry.get(e.id) ?? [],
  }));
}

/**
 * A year of the store's open book as Skatteetaten's SAF-T file, made by a member (the file's contact, and who the audit names): the year's
 * days in the book only. Refused for a year the book does not hold, without an organisation number, or with an account no code fits.
 */
export async function saftFile(member: Membership, book: LedgerBook, year: number, today: string): Promise<SaftResult> {
  const span = saftYears(book.openedOn, book.closedOn, today).find((y) => y.year === year);
  if (!span) return { ok: false, problem: "year" };
  const organisationNumber = await vatReturnOrgNumber(book, member.store.id);
  if (!organisationNumber) return { ok: false, problem: "org_number" };
  const { from, to } = span;
  const timeZone = member.store.timeZone;
  const accounts = await accountsOf(book, timeZone, from, to);
  const ungrouped = ungroupedAccounts(accounts);
  if (ungrouped.length > 0) return { ok: false, problem: "grouping", accounts: ungrouped };
  const partyLines = await partyLinesOf(member.store.id, book.id, to);
  const { owner, customers, suppliers } = await partiesOf(member.store.id, partyLines, from, to);
  const entries = await entriesOf(book.id, timeZone, from, to, owner);
  const [store] = await typedRows(
    z.object({ postal_address: col.textOrNull, country: col.textOrNull, contact_email: col.textOrNull }),
    sql`select postal_address, country, contact_email from commerce.stores where id = ${member.store.id}::uuid`,
  );
  const xml = saftXml({
    company: {
      organisationNumber,
      name: book.legalName.trim() || member.store.name,
      address: addressOfLine(store?.postal_address, store?.country ?? book.country),
      contact: { ...contactNames(member.account.name, member.account.email), email: store?.contact_email ?? member.account.email ?? null },
    },
    currency: book.currency,
    createdOn: today,
    from,
    to,
    software: { name: "Kaizena Flow", version: (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 12) },
    accounts,
    customers,
    suppliers,
    entries,
  });
  await audit(member.account.id, member.store.id, "work.ledger_saft_downloaded", { bookId: book.id, year, entries: entries.length, customers: customers.length, suppliers: suppliers.length });
  log("info", "saft.made", { storeId: member.store.id, bookId: book.id, year, entries: entries.length, bytes: xml.length });
  return { ok: true, xml, organisationNumber, entries: entries.length };
}
