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
import { lockLedgerThrough, openLedgerBook, openLedgerBookEarlier, postDueDocuments, openBookOf, postHandEntry, reverseLedgerEntry } from "@/server/ledger";
import { matchBankStatement } from "@/server/bank-statements";
import { postOpeningFromTripletex } from "@/server/ledger-opening";
import { boughtAbroad, isPurchaseKind, isPurchaseVatRate, PURCHASE_KINDS } from "@/lib/purchases";
import { payCertainInvoices, payInvoiceFromBank, postBankOwnLine } from "@/server/bank-payments";
import { postPurchaseFromBank, purchaseLine, VOUCHER_BYTES } from "@/server/purchases";
import { readReceipt } from "@/server/receipt-reading";
import { readBill } from "@/server/bill-reading";
import { addBill, payBillFromBank, payCertainBills } from "@/server/supplier-invoices";
import { bankAmount } from "@/lib/bank-statement";
import { receiptAgrees } from "@/lib/receipt-reading";
import type { PurchaseKind, PurchaseVatRate } from "@/lib/purchases";
import { importBankStatement, STATEMENT_BYTES } from "@/server/bank-statements";
import { checkOwnerRole } from "@/server/permissions";
import { setVatTermSize } from "@/server/vat-return";
import { recurringInputOf } from "@/lib/recurring-costs";
import { endRecurringCost, recurringView, saveRecurringCost } from "@/server/recurring-costs";
import { dismissInboxDocument, readInboxDocument, markInboxUsed } from "@/server/books-inbox";

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

/**
 * *Open the books earlier* (D498): the books' first day moved back, so they hold more of the year; the documents of the days added are
 * posted at once as far as a request allows (the job does the rest), and the bank's lines in those days matched to what posted.
 */
export async function openBooksEarlierAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const from = String(form.get("from") ?? "").trim();
  const moved = await openLedgerBookEarlier(member, from);
  if (!moved.ok) return { status: "error", messages: [w.earlier.problems[moved.problem]], fields: moved.problem === "date" || moved.problem === "later" ? { from: w.earlier.problems[moved.problem] } : undefined };
  const book = moved.book;
  await postDueDocuments(member.store.id, { id: book.id, currency: book.currency, opened_on: book.openedOn, closed_on: book.closedOn }, { deadline: Date.now() + 20_000 });
  await matchBankStatement(member.store.id, book.id);
  refresh();
  const locale = ADMIN_LANG_FACTS[adminLangOf(member.account.adminLocale)].locale;
  return { status: "ok", messages: [fillWords(w.earlier.done, { day: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${book.openedOn}T00:00:00Z`)) })] };
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
  // A bill named in a line and paid whole is paid too (D492).
  const billsPaid = await payCertainBills(member);
  refresh();
  // One message: a form shows the first.
  const said = [countWords(result.lines, w.bank.imported, { new: result.newLines, matched: result.matched })];
  if (paid.length > 0) said.push(countWords(paid.length, w.bank.autoPaid, { numbers: paid.join(", ") }));
  if (billsPaid.length > 0) said.push(countWords(billsPaid.length, w.bank.autoBills, { suppliers: [...new Set(billsPaid)].join(", ") }));
  return { status: "ok", messages: [said.join(" ")] };
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
  // *Post the purchase* (D490): the line's receipt, what it was and its VAT rate, in the fields named after the line.
  const bought = form.get("buy");
  if (bought !== null) {
    const lineId = String(bought);
    if (!uuid.test(lineId)) return { status: "error", messages: [w.bank.payProblems.line] };
    const kind = form.get(`kind-${lineId}`);
    const rate = form.get(`vat-${lineId}`);
    const file = form.get(`receipt-${lineId}`);
    const field = (name: string, words: string): FormState => ({ status: "error", messages: [words], fields: { [`${name}-${lineId}`]: words } });
    if (!isPurchaseKind(kind)) return field("kind", w.bank.purchaseProblems.kind);
    // The kind's usual rate unless the owner chose one; bought from abroad, the VAT is the store's to reckon (D502).
    const abroad = rate === "abroad";
    const vatRate = abroad ? 0 : rate === "usual" ? PURCHASE_KINDS[kind].vat : isPurchaseVatRate(rate) ? (Number(rate) as 25 | 15 | 12 | 0) : null;
    if (vatRate === null) return field("vat", w.bank.purchaseProblems.kind);
    // The receipt: a file chosen, else a document of the books' inbox (D504).
    const inboxId = String(form.get(`inbox-${lineId}`) ?? "");
    let voucher: { name: string; bytes: Uint8Array };
    if (file instanceof File && file.size > 0) {
      if (file.size > VOUCHER_BYTES) return field("receipt", w.bank.purchaseProblems.too_big);
      voucher = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    } else if (inboxId) {
      const doc = await readInboxDocument(member.store.id, inboxId);
      if (!doc || doc.status !== "waiting") return field("inbox", w.inbox.problems.gone);
      voucher = { name: doc.fileName, bytes: doc.bytes };
    } else {
      return field("receipt", w.bank.purchaseProblems.file);
    }
    const text = String(form.get(`text-${lineId}`) ?? "").trim().slice(0, 200) || null;
    const posted = await postPurchaseFromBank(member, lineId, { kind, vatRate, abroad, text }, voucher);
    if (!posted.ok) {
      const words = w.bank.purchaseProblems[posted.problem] ?? w.hand.problems[posted.problem] ?? w.hand.problems.other;
      return posted.problem === "file" || posted.problem === "type" || posted.problem === "too_big" ? field("receipt", words) : { status: "error", messages: [words] };
    }
    if (inboxId && !(file instanceof File && file.size > 0)) await markInboxUsed(member.store.id, inboxId, posted.entryId, member.account.id);
    refresh();
    return { status: "ok", messages: [fillWords(w.bank.purchased, { account: posted.account })] };
  }
  // *Mark it paid* for a bill (D492): the button says which, `line:bill`.
  const billed = form.get("bill");
  if (billed !== null) {
    const [lineId, billId] = String(billed).split(":");
    if (!uuid.test(lineId ?? "") || !uuid.test(billId ?? "")) return { status: "error", messages: [w.bank.payProblems.line] };
    const done = await payBillFromBank(member, lineId, billId);
    if (!done.ok) return { status: "error", messages: [done.problem === "line" ? w.bank.payProblems.line : (w.hand.problems[done.problem] ?? w.bank.billProblem)] };
    refresh();
    return { status: "ok", messages: [fillWords(w.bank.billPaid, { supplier: done.supplier })] };
  }
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

export type ReceiptReadResult =
  | { ok: true; kind: PurchaseKind | null; vatRate: PurchaseVatRate | null; abroad: boolean; supplier: string | null; totalMinor: number | null; agrees: "same" | "differs" | "unknown" }
  | { ok: false; reason: "no_ai" | "not_a_picture" | "unread" | "refused" };

/**
 * A purchase's receipt read by the store's model as the owner chooses it (D491): what it most likely was, its VAT rate, the supplier and
 * whether its total is the bank's amount, for the form to show. Nothing is kept or posted here; the owner posts.
 */
export async function readReceiptAction(storeSlug: string, form: FormData): Promise<ReceiptReadResult> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { ok: false, reason: "refused" };
  const { member } = who;
  const lineId = String(form.get("line") ?? "");
  const file = form.get("receipt");
  if (!/^[0-9a-f-]{36}$/i.test(lineId) || !(file instanceof File) || file.size === 0 || file.size > VOUCHER_BYTES) return { ok: false, reason: "unread" };
  const line = await purchaseLine(member.store.id, lineId);
  if (!line) return { ok: false, reason: "unread" };
  const read = await readReceipt(member.store.id, member.account.id, new Uint8Array(await file.arrayBuffer()), line.currency);
  if (!read.ok) return read;
  const { kind, vatRate, supplier, totalMinor } = read.reading;
  return { ok: true, kind, vatRate, abroad: boughtAbroad(read.reading, line.currency), supplier, totalMinor, agrees: receiptAgrees(read.reading, line.amountMinor, line.currency) };
}

/** *Add the bill* (D492): a supplier's invoice with its file, posted against what the store owes, waiting until the bank shows it paid. */
export async function addBillAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const p = w.bills.problems;
  const field = (name: string, words: string): FormState => ({ status: "error", messages: [words], fields: { [name]: words } });
  const supplier = String(form.get("supplier") ?? "").trim();
  if (!supplier) return field("supplier", p.supplier);
  const kind = form.get("kind");
  if (!isPurchaseKind(kind)) return field("kind", p.kind);
  const rate = form.get("vat");
  const abroad = rate === "abroad";
  const vatRate = abroad ? 0 : rate === "usual" ? PURCHASE_KINDS[kind].vat : isPurchaseVatRate(rate) ? (Number(rate) as 25 | 15 | 12 | 0) : null;
  if (vatRate === null) return field("vat", p.kind);
  const book = await openBookOf(member.store.id);
  if (!book) return { status: "error", messages: [p.book] };
  const totalMinor = bankAmount(String(form.get("amount") ?? ""), book.currency);
  if (totalMinor === null || totalMinor <= 0) return field("amount", p.amount);
  const file = form.get("bill");
  if (!(file instanceof File) || file.size === 0) return field("bill", p.file);
  if (file.size > VOUCHER_BYTES) return field("bill", p.too_big);
  const added = await addBill(
    member,
    {
      supplier,
      organisationNumber: String(form.get("organisationNumber") ?? "").trim() || null,
      number: String(form.get("number") ?? "").trim() || null,
      issuedOn: String(form.get("issuedOn") ?? ""),
      dueOn: String(form.get("dueOn") ?? "").trim() || null,
      totalMinor,
      kind,
      vatRate,
      abroad,
      text: String(form.get("text") ?? "").trim() || null,
    },
    { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
  );
  if (!added.ok) {
    const words = p[added.problem] ?? w.hand.problems[added.problem] ?? w.hand.problems.other;
    const at: Record<string, string> = { file: "bill", type: "bill", too_big: "bill", days: "dueOn", duplicate: "number", amount: "amount" };
    return at[added.problem] ? field(at[added.problem], words) : { status: "error", messages: [words] };
  }
  refresh();
  return { status: "ok", messages: [fillWords(w.bills.added, { supplier })] };
}

export type BillReadResult =
  | {
      ok: true;
      supplier: string | null;
      organisationNumber: string | null;
      number: string | null;
      issuedOn: string | null;
      dueOn: string | null;
      totalMinor: number | null;
      kind: PurchaseKind | null;
      vatRate: PurchaseVatRate | null;
      /** Most likely a service bought from abroad (another currency, no VAT on it, D502). */
      abroad: boolean;
      /** The bill's own currency when it is not the books' (its amount is then not filled). */
      otherCurrency: string | null;
    }
  | { ok: false; reason: "no_ai" | "not_readable" | "unread" | "refused" };

/** A bill read by the store's model as the owner chooses its file (D493): its fields for the form to show. Nothing is kept or posted here. */
export async function readBillAction(storeSlug: string, form: FormData): Promise<BillReadResult> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { ok: false, reason: "refused" };
  const { member } = who;
  const file = form.get("bill");
  if (!(file instanceof File) || file.size === 0 || file.size > VOUCHER_BYTES) return { ok: false, reason: "not_readable" };
  const book = await openBookOf(member.store.id);
  if (!book) return { ok: false, reason: "refused" };
  const read = await readBill(member.store.id, member.account.id, new Uint8Array(await file.arrayBuffer()), book.currency);
  if (!read.ok) return read;
  const r = read.reading;
  const other = r.currency !== null && r.currency !== book.currency ? r.currency : null;
  return {
    ok: true,
    supplier: r.supplier,
    organisationNumber: r.organisationNumber,
    number: r.number,
    issuedOn: r.issuedOn,
    dueOn: r.dueOn,
    totalMinor: other ? null : r.totalMinor,
    kind: r.kind,
    vatRate: r.vatRate,
    abroad: boughtAbroad(r, book.currency),
    otherCurrency: other,
  };
}

/** *Your VAT terms* (D496): two months, or a year where Skatteetaten has allowed it; the owner's to say. */
export async function setVatTermAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const book = await openBookOf(member.store.id);
  if (!book) return { status: "error", messages: [w.problems.forbidden] };
  const done = await setVatTermSize(member, book.id, form.get("size"));
  if (!done.ok) return { status: "error", messages: [w.vatReturn.invalid] };
  refresh();
  return { status: "ok", messages: [w.vatReturn.saved] };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * *Add a subscription* or *Save* one changed (D503): what it is, the words its charge carries in the bank's statement, what it was, its VAT
 * (or bought abroad, D502), how often and about what it costs in the books' currency, from when. The form's fields are named alike; `id`
 * says which one is changed.
 */
export async function saveRecurringCostAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const book = await openBookOf(member.store.id);
  if (!book) return { status: "error", messages: [w.bills.problems.book] };
  const id = String(form.get("id") ?? "");
  if (id && !UUID.test(id)) return { status: "error", messages: [w.recurring.problems.not_found] };
  const read = recurringInputOf(
    {
      name: form.get("name"),
      matchText: form.get("matchText"),
      kind: form.get("kind"),
      vat: form.get("vat"),
      every: form.get("every"),
      amount: form.get("amount"),
      startedOn: form.get("startedOn"),
    },
    book.currency,
    bankAmount,
  );
  if (!read.ok) {
    const fieldOf = { name: "name", words: "matchText", kind: "kind", vat: "vat", every: "every", amount: "amount", day: "startedOn" } as const;
    return {
      status: "error",
      messages: read.problems.map((p) => w.recurring.problems[p]),
      fields: Object.fromEntries(read.problems.map((p) => [fieldOf[p], w.recurring.problems[p]])),
    };
  }
  const saved = await saveRecurringCost(member, read.input, book.currency, id || undefined);
  if (!saved.ok) return { status: "error", messages: [w.recurring.problems[saved.problem]] };
  refresh();
  return { status: "ok", messages: [fillWords(id ? w.recurring.changed : w.recurring.added, { name: read.input.name })] };
}

/**
 * *End it* (a subscription stopped, today) or *Add it* (a charge the statement shows coming back each month, D503): with one press, the
 * button naming which (`end` the subscription's id, `likely` the charge's words). One added this way is a purchase of software with its
 * usual VAT, every month, from its first charge; the owner changes what is not so.
 */
export async function recurringPressAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const today = todayIn(new Date(), member.store.timeZone);
  const ended = form.get("end");
  if (ended !== null) {
    const id = String(ended);
    if (!UUID.test(id)) return { status: "error", messages: [w.recurring.problems.not_found] };
    const done = await endRecurringCost(member, id, today);
    if (!done.ok) return { status: "error", messages: [w.recurring.problems[done.problem]] };
    refresh();
    return { status: "ok", messages: [w.recurring.endDone] };
  }
  const likely = form.get("likely");
  if (likely === null) return { status: "error", messages: [w.recurring.problems.not_found] };
  const book = await openBookOf(member.store.id);
  if (!book) return { status: "error", messages: [w.bills.problems.book] };
  // Only a charge the statement still offers: what a stale page sends is checked again.
  const offered = (await recurringView(member.store.id, book.id, today)).likely.find((l) => l.matchText === String(likely));
  if (!offered) return { status: "error", messages: [w.recurring.problems.not_found] };
  const input = { name: offered.name, matchText: offered.matchText, kind: "software" as const, vatRate: PURCHASE_KINDS.software.vat, abroad: false, every: "month" as const, amountMinor: offered.amountMinor, startedOn: offered.firstDay };
  const saved = await saveRecurringCost(member, input, book.currency);
  if (!saved.ok) return { status: "error", messages: [w.recurring.problems[saved.problem]] };
  refresh();
  return { status: "ok", messages: [fillWords(w.recurring.added, { name: offered.name })] };
}

/** *Not for the books* (D504): a document of the books' inbox set aside, the button naming which. */
export async function dismissInboxAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const id = String(form.get("dismiss") ?? "");
  if (!UUID.test(id) || !(await dismissInboxDocument(member, id))) return { status: "error", messages: [w.inbox.problems.gone] };
  refresh();
  return { status: "ok", messages: [w.inbox.dismissed] };
}

