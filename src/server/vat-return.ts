import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { compareVatReturns, isVatTermSize, mvaMeldingXml, theirVatRows, vatReturnOf, type VatDifference, type VatReturn, type VatTerm, type VatTermSize } from "@/lib/vat-return";
import type { VatRow } from "@/lib/ledger";

import { audit, type Membership } from "./auth";
import { ledgerVatByCode, type LedgerBook } from "./ledger";
import { log } from "./log";
import { getTripletexConnection, tripletexCredential } from "./tripletex";
import { listAll, openSession, type TripletexDeps } from "./tripletex-client";

/**
 * The VAT return (B5, D496): a term's return from the store's own ledger (`vatReturnOf()` over VAT by code), Tripletex's for the same
 * term worked out from its postings and its own status of the term (what it filed, what Skatteetaten says is owed), and the return as
 * Skatteetaten's XML. Nothing here posts, files or changes anything in Tripletex: reads only, and the owner's choice of term length.
 */

/** The days of a term the book holds: a book that opened in the term holds it from its first day. */
const daysOf = (book: Pick<LedgerBook, "openedOn" | "closedOn">, term: VatTerm) => ({
  from: term.from < book.openedOn ? book.openedOn : term.from,
  to: book.closedOn && book.closedOn < term.to ? book.closedOn : term.to,
});

export type OurVatReturn = { term: VatTerm; from: string; to: string; rows: VatRow[]; ret: VatReturn; partial: boolean };

/** The term's return from the store's own ledger; `partial` when the book opened after the term began. */
export async function ourVatReturn(book: LedgerBook, term: VatTerm): Promise<OurVatReturn> {
  const { from, to } = daysOf(book, term);
  const rows = await ledgerVatByCode(book.id, from, to);
  return { term, from, to, rows, ret: vatReturnOf(rows), partial: from !== term.from };
}

/** Tripletex's own word on a term (`GET /vatReturns/status`): whether it was sent, and what Skatteetaten says is owed. */
export type TheirVatStatus = { delivery: string | null; voucherNumber: number | null; basisMinor: number | null; owedMinor: number | null; payment: string | null };

export type TheirVatReturn =
  | { ok: true; rows: VatRow[]; status: TheirVatStatus | null; comparison: { differences: VatDifference[]; totalDifference: number } }
  | { ok: false; problem: "connection" | "session" | "read" };

type PostingJson = { account?: { number?: unknown }; vatType?: { number?: unknown } | null; amount?: unknown; amountGross?: unknown };
type StatusJson = {
  value?: {
    voucherNumber?: unknown;
    totalAmountVatBasis?: unknown;
    altinnPaymentAmount?: unknown;
    deliveryStatus?: { status?: unknown } | null;
    paymentStatus?: { status?: unknown } | null;
  };
};

const minorOf = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);
const textOf = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v.slice(0, 40) : null);
const dayAfter = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Tripletex's return for the same days, from its postings (`GET /ledger/posting`, each with its account, VAT code, net and gross), by the
 * ledger's own rule (`theirVatRows()`), compared with ours code by code; and its status of the term where it has one.
 */
export async function theirVatReturn(storeId: string, ours: OurVatReturn, deps: TripletexDeps = {}): Promise<TheirVatReturn> {
  const connection = await getTripletexConnection(storeId);
  const credential = connection && connection.state !== "auth_failed" ? await tripletexCredential(storeId) : null;
  if (!connection || !credential) return { ok: false, problem: "connection" };
  const opened = await openSession(credential, deps);
  if (!opened.ok) {
    log("warn", "vat_return.tripletex_session", { storeId, key: opened.failure.key });
    return { ok: false, problem: "session" };
  }
  const read = await listAll<PostingJson>(opened.session, "/ledger/posting", { dateFrom: ours.from, dateTo: dayAfter(ours.to), fields: "account(number),vatType(number),amount,amountGross" }, 20_000, 1000);
  if (!read.ok) {
    log("warn", "vat_return.tripletex_postings", { storeId, key: read.failure.key });
    return { ok: false, problem: "read" };
  }
  const postings = read.value.flatMap((p) => {
    const account = Number(p.account?.number);
    const net = minorOf(p.amount);
    const gross = minorOf(p.amountGross) ?? net;
    if (!Number.isInteger(account) || net === null || gross === null) return [];
    const code = p.vatType?.number === undefined || p.vatType?.number === null ? null : String(p.vatType.number).trim();
    return [{ account, vatCode: code, netMinor: net, grossMinor: gross }];
  });
  const rows = theirVatRows(postings);
  // Its own status of the term, when it keeps one (a two-month term by its number; a year as term 1).
  let status: TheirVatStatus | null = null;
  const answer = await opened.session.get<StatusJson>("/vatReturns/status", {
    year: ours.term.year,
    term: ours.term.term,
    fields: "voucherNumber,totalAmountVatBasis,altinnPaymentAmount,deliveryStatus(status),paymentStatus(status)",
  });
  if (answer.ok && answer.value?.value) {
    const v = answer.value.value;
    const voucher = Number(v.voucherNumber);
    status = {
      delivery: textOf(v.deliveryStatus?.status),
      voucherNumber: Number.isSafeInteger(voucher) && voucher > 0 ? voucher : null,
      basisMinor: minorOf(v.totalAmountVatBasis),
      owedMinor: minorOf(v.altinnPaymentAmount),
      payment: textOf(v.paymentStatus?.status),
    };
  } else if (!answer.ok) {
    log("info", "vat_return.tripletex_status", { storeId, key: answer.failure.key });
  }
  return { ok: true, rows, status, comparison: compareVatReturns(ours.rows, rows) };
}

/**
 * The organisation number the return is for: the books' (the legal entity's when they opened), else the store's now; nine digits, or null
 * when there is none (Skatteetaten takes no return without one, so none is offered).
 */
export async function vatReturnOrgNumber(book: LedgerBook, storeId: string): Promise<string | null> {
  const nine = (v: string | null | undefined) => {
    const digits = (v ?? "").replace(/\D/g, "");
    return /^\d{9}$/.test(digits) ? digits : null;
  };
  const own = nine(book.organisationNumber);
  if (own) return own;
  const [store] = await db().execute<{ organisation_number: string | null }>(sql`select organisation_number from commerce.stores where id = ${storeId}::uuid`);
  return nine(store?.organisation_number);
}

/** The return as Skatteetaten's XML, with Kaizena Flow as the system and the term as our reference. */
export function vatReturnXml(organisationNumber: string, ours: OurVatReturn, storeId: string): string {
  return mvaMeldingXml({
    organisationNumber,
    term: ours.term,
    ret: ours.ret,
    reference: `kf-${storeId.slice(0, 8)}-${ours.term.key}`,
    system: { name: "Kaizena Flow", version: (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 12) },
  });
}

/** The owner's choice of how long the book's terms are (Skatteetaten decides which a business has; the owner says which it is). */
export async function setVatTermSize(member: Membership, bookId: string, size: unknown): Promise<{ ok: true } | { ok: false }> {
  if (!isVatTermSize(size)) return { ok: false };
  const rows = await db().execute(sql`
    update commerce.ledger_books set vat_term = ${size satisfies VatTermSize}, updated_at = now()
     where id = ${bookId}::uuid and store_id = ${member.store.id}::uuid and closed_on is null and vat_term <> ${size}
    returning id`);
  if (rows.length > 0) await audit(member.account.id, member.store.id, "work.ledger_vat_term_set", { bookId, size });
  return { ok: true };
}
