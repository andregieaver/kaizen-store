"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import type { BooksMessages } from "@/lib/admin-messages/books.en";
import { adminText } from "@/lib/admin-text";
import { todayIn } from "@/lib/analytics-period";
import { formatMoney } from "@/lib/money";
import { HAND_ROWS } from "@/lib/ledger";
import type { Membership } from "@/server/auth";
import { actionAdminLang } from "@/server/admin-request-lang";
import { lockLedgerThrough, openLedgerBook, postDueDocuments, openBookOf, postHandEntry, reverseLedgerEntry } from "@/server/ledger";
import { postOpeningFromTripletex } from "@/server/ledger-opening";
import { payCertainInvoices, payInvoiceFromBank, postBankOwnLine } from "@/server/bank-payments";
import { importBankStatement, STATEMENT_BYTES } from "@/server/bank-statements";
import { checkOwnerRole } from "@/server/permissions";

/**
 * Settings → Books (B2, D478): opening the store's books, posting an entry by hand, reversing one, and locking them through a day. Each
 * action checks the member is the store's owner, whatever a stale page sends, and answers in their language.
 */

type Owner = { member: Membership; w: BooksMessages; refused: null } | { member: null; w: null; refused: string };

async function owner(storeSlug: string): Promise<Owner> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { member: null, w: null, refused: adminText(await actionAdminLang(), "books").problems.forbidden };
  return { member, w: adminText(adminLangOf(member.account.adminLocale), "books"), refused: null };
}

/** *Open the books* from a day: the store's books open with Norway's chart, and the documents of their days are posted at once. */
export async function openBooksAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const from = String(form.get("from") ?? "").trim();
  const opened = await openLedgerBook(member, from);
  if (!opened.ok) return { status: "error", messages: [w.problems[opened.problem]], fields: opened.problem === "date" ? { from: w.problems.date } : undefined };
  const book = await openBookOf(member.store.id);
  if (book) {
    await postDueDocuments(member.store.id, { id: book.id, currency: book.currency, opened_on: book.openedOn, closed_on: book.closedOn }, { deadline: Date.now() + 20_000 });
  }
  refresh();
  return { status: "ok", messages: [w.open.opened] };
}

/** *Lock*: nothing dated on or before the day is posted after it. */
export async function lockBooksAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const through = String(form.get("through") ?? "").trim();
  const locked = await lockLedgerThrough(member, through || null);
  if (!locked.ok) return { status: "error", messages: [w.lock.invalid], fields: { through: w.lock.invalid } };
  refresh();
  return { status: "ok", messages: [w.lock.done] };
}

/** *Post the entry*: an entry typed by hand (step 3b), in the series of entries by hand or of the opening balance. */
export async function postEntryAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const text = (name: string) => String(form.get(name) ?? "");
  const rows = Array.from({ length: HAND_ROWS }, (_, i) => ({ account: text(`account_${i}`), debit: text(`debit_${i}`), credit: text(`credit_${i}`), vatCode: text(`vat_${i}`) }));
  const posted = await postHandEntry(member, { series: text("series"), date: text("date"), text: text("text"), rows });
  if (!posted.ok) {
    const messages = posted.problems.map((p) => w.hand.problems[p] ?? w.hand.problems.other);
    if (posted.rows.length > 0) messages.push(w.hand.rowsWrong.replace("{rows}", posted.rows.map((r) => String(r + 1)).join(", ")));
    return { status: "error", messages };
  }
  refresh();
  return { status: "ok", messages: [w.hand.posted] };
}

/** *Reverse*: an entry turned back by one with its lines' signs turned, on its own day while that is open, else today. */
export async function reverseEntryAction(storeSlug: string, entryId: string): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const reversed = await reverseLedgerEntry(member, entryId, todayIn(new Date(), member.store.timeZone));
  if (!reversed.ok) return { status: "error", messages: [w.journal.problems[reversed.problem] ?? w.hand.problems.other] };
  refresh();
  return { status: "ok", messages: [w.journal.reversed] };
}

/** *Bring in the opening balance*: what each account held in Tripletex the day before the books opened (step 2d), posted once. */
export async function openingFromTripletexAction(storeSlug: string): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const result = await postOpeningFromTripletex(member);
  const book = await openBookOf(member.store.id);
  const locale = ADMIN_LANG_FACTS[adminLangOf(member.account.adminLocale)].locale;
  const amount = (minor: number) => formatMoney(Math.abs(minor), book?.currency ?? "NOK", locale);
  if (!result.ok) {
    const words = w.opening.problems[result.problem] ?? w.hand.problems.other;
    return { status: "error", messages: [fillWords(words, { amount: amount(result.differenceMinor ?? 0) })] };
  }
  refresh();
  const messages = [fillWords(w.opening.posted, { n: result.accounts })];
  if (result.carriedMinor !== 0) messages.push(fillWords(w.opening.carried, { amount: amount(result.carriedMinor) }));
  return { status: "ok", messages };
}

/** *Upload the statement*: the bank's file read into the books (B4, D486), its lines kept once and matched to the books. */
export async function uploadBankStatementAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", messages: [w.bank.problems.empty], fields: { file: w.bank.problems.empty } };
  if (file.size > STATEMENT_BYTES) return { status: "error", messages: [w.bank.problems.too_big], fields: { file: w.bank.problems.too_big } };
  const result = await importBankStatement(member, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  if (!result.ok) {
    const words = fillWords(w.bank.problems[result.problem] ?? w.hand.problems.other, { currency: result.currency ?? "" });
    return { status: "error", messages: [words], fields: { file: words } };
  }
  // A client's payment that names its invoice and pays exactly what is outstanding records the payment (D487).
  const paid = await payCertainInvoices(member);
  refresh();
  // One message: a form shows the first.
  const read = countWords(result.lines, w.bank.imported, { new: result.newLines, matched: result.matched });
  return { status: "ok", messages: [paid.length > 0 ? `${read} ${countWords(paid.length, w.bank.autoPaid, { numbers: paid.join(", ") })}` : read] };
}

/**
 * A line of the statement the books do not have, done with one press: *Mark it paid* records it as the payment of the invoice it was offered
 * (D487; the button says which, `line:invoice`), *Post it* posts the bank's own fee or interest (D488; the button names the line).
 */
export async function payFromBankAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const own = form.get("post");
  if (own !== null) {
    if (!uuid.test(String(own))) return { status: "error", messages: [w.bank.payProblems.line] };
    const posted = await postBankOwnLine(member, String(own));
    if (!posted.ok) {
      const words = posted.problem === "line" || posted.problem === "kind" ? w.bank.payProblems.line : (w.hand.problems[posted.problem] ?? w.hand.problems.other);
      return { status: "error", messages: [words] };
    }
    refresh();
    return { status: "ok", messages: [fillWords(w.bank.posted, { account: posted.account })] };
  }
  const [lineId, invoiceId] = String(form.get("pay") ?? "").split(":");
  if (!uuid.test(lineId ?? "") || !uuid.test(invoiceId ?? "")) return { status: "error", messages: [w.bank.payProblems.line] };
  const paid = await payInvoiceFromBank(member, lineId, invoiceId);
  if (!paid.ok) return { status: "error", messages: [w.bank.payProblems[paid.problem]] };
  refresh();
  return { status: "ok", messages: [fillWords(w.bank.paid, { number: paid.printedNumber })] };
}
