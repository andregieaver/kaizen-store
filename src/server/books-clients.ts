import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { NORWAY_TIME_ZONE } from "@/lib/dates";
import { todayIn } from "@/lib/analytics-period";
import { sortClients, vatToReport, type ClientFacts } from "@/lib/books-clients";
import { can } from "@/lib/permissions";

import { membershipsOf, type Account } from "./auth";
import { openBookOf } from "./ledger";
import { col, typedRow } from "./typed-rows";
import { ourVatReturn } from "./vat-return";

/**
 * An accountant's clients (B6, D512, `src/lib/books-clients.ts`): every store whose books the person may read (`books:read`, as its owner or
 * in a role such as the accountant's), with what its books need from them. Read for Your account → Books; counts only, never a document.
 */

/** The stores whose books the person may read, as their membership holds them (`membershipsOf()`, read once per request). */
async function booksMemberships(account: Pick<Account, "id">) {
  // Open stores, never a store template or a sandbox, whose account has Work (D748): the books are part of it.
  const rows = (await membershipsOf(account))
    .filter((m) => m.status !== "closed" && !m.starter && !m.sandbox && m.work_extension)
    .map((m) => ({ id: m.id, slug: m.slug, name: m.name, time_zone: m.time_zone, role: m.role, kind: m.kind, role_id: m.role_id, permissions: m.permissions }));
  return rows
    .map((r) => {
      const holder = { role: r.role, kind: r.kind === "collaborator" ? ("collaborator" as const) : ("staff" as const), permissions: r.role_id ? (r.permissions ?? []) : null };
      return { ...r, owner: can(holder, "owner"), reads: can(holder, "books:read"), keeps: can(holder, "books:write") };
    })
    .filter((r) => r.reads);
}

/** Whether the person has clients to show (they keep or read books as a member of a store they do not own, or of two or more). */
export async function booksClientStores(account: Pick<Account, "id">): Promise<{ owner: boolean }[]> {
  return (await booksMemberships(account)).map((m) => ({ owner: m.owner }));
}

const COUNTS = z.object({ bank: col.int, waiting: col.int, unpaid: col.int, due: col.int, inbox: col.int });

/** Each client with what its books need, the most pressing first. */
export async function booksClients(account: Pick<Account, "id">, now = new Date()): Promise<(ClientFacts & { today: string })[]> {
  const clients: (ClientFacts & { today: string })[] = [];
  for (const m of await booksMemberships(account)) {
    const today = todayIn(now, m.time_zone);
    const book = await openBookOf(m.id);
    const base = { slug: m.slug, name: m.name, owner: m.owner, keeps: m.keeps, today };
    if (!book) {
      clients.push({ ...base, book: null, bankWaiting: 0, ledgerWaiting: 0, billsUnpaid: 0, billsDue: 0, inboxWaiting: 0, vatTotalMinor: null });
      continue;
    }
    const counts = await typedRow(
      COUNTS,
      sql`select
            (select count(*)::int from commerce.bank_lines b where b.book_id = ${book.id}::uuid and b.entry_id is null and b.payment_ref is null and b.booked_on >= ${book.openedOn}::date) as bank,
            (select count(*)::int from commerce.ledger_waiting w where w.book_id = ${book.id}::uuid) as waiting,
            (select count(*)::int from commerce.supplier_invoices i where i.book_id = ${book.id}::uuid and i.paid_on is null) as unpaid,
            (select count(*)::int from commerce.supplier_invoices i where i.book_id = ${book.id}::uuid and i.paid_on is null and i.due_on <= ${today}::date) as due,
            (select count(*)::int from commerce.books_inbox x where x.store_id = ${m.id}::uuid and x.status = 'waiting') as inbox`,
    );
    const clientBook = { openedOn: book.openedOn, lockedThrough: book.lockedThrough, lockHeld: book.lockHeld, vatTerm: book.vatTerm, currency: book.currency };
    const term = vatToReport(clientBook, today);
    const vat = term ? (await ourVatReturn(book, term)).ret.total : null;
    clients.push({
      ...base,
      book: clientBook,
      bankWaiting: counts?.bank ?? 0,
      ledgerWaiting: counts?.waiting ?? 0,
      billsUnpaid: counts?.unpaid ?? 0,
      billsDue: counts?.due ?? 0,
      inboxWaiting: counts?.inbox ?? 0,
      vatTotalMinor: vat,
    });
  }
  // Norway's day: the books' deadlines are the Norwegian VAT return's (D796).
  return sortClients(clients, todayIn(now, NORWAY_TIME_ZONE));
}

