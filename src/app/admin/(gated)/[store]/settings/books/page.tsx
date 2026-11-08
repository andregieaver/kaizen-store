import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { field } from "@/components/admin/data/ui";
import { Card, Chip, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { todayIn } from "@/lib/analytics-period";
import { HAND_ROWS, LEDGER_SERIES, NO_TAX_CODES, balanceSheet, isDay, profitAndLoss, vatTermOf, type ReportRow } from "@/lib/ledger";
import { formatMoney, minorUnitDigits } from "@/lib/money";
import { formatStoreDay } from "@/lib/return-time";
import { groupingOf, saftYears } from "@/lib/saft";
import { vatTermOfDay } from "@/lib/vat-return";
import { ledgerAccounts, ledgerJournal, ledgerTrialBalance, ledgerVatByCode, ledgerWaiting, openBookOf } from "@/server/ledger";
import { ledgerComparisonSummary } from "@/server/ledger-compare";
import { hasOpeningBalance } from "@/server/ledger-opening";
import { BillFields, type BillFieldWords } from "@/components/admin/bill-fields";
import { ReceiptFields, type ReceiptFieldWords } from "@/components/admin/receipt-fields";
import { bankOwnKind, BANK_OWN_ACCOUNTS } from "@/lib/bank-own-lines";
import { invoiceOffers } from "@/server/bank-payments";
import { vouchersOf } from "@/server/purchases";
import { billOffers, unpaidBills } from "@/server/supplier-invoices";
import { bankSummary } from "@/server/bank-statements";
import { memberCan, requirePermission } from "@/server/permissions";
import { getTripletexConnection } from "@/server/tripletex";
import { vatReturnOrgNumber } from "@/server/vat-return";

import { addBillAction, lockBooksAction, openBooksAction, openBooksEarlierAction, openingFromTripletexAction, payFromBankAction, postEntryAction, readBillAction, readReceiptAction, reverseEntryAction, uploadBankStatementAction } from "./actions";

export const metadata: Metadata = { title: "Books" };

const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

/**
 * Settings → Books (B2, D478): the store's own books. Homer opens them (the owner, from the day Tripletex started booking), then reads what
 * waits for him, the trial balance of this year with its result, the profit and loss, the balance sheet on the last day and VAT by code
 * (step 3b), and the journal of the latest entries; Lisa chooses the days (or the VAT term), posts an entry by hand (the opening balance among
 * them), reverses one and locks the books through a day. Members who may read settings see them; only the owner opens, posts, reverses and locks.
 */
export default async function BooksPage({ params, searchParams }: PageProps<"/admin/[store]/settings/books">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "books");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const owner = memberCan(member, "owner");
  const today = todayIn(new Date(), store.timeZone);
  const book = await openBookOf(store.id);
  const day = (d: string) => formatStoreDay(d, locale);

  if (!book) {
    const tripletex = await getTripletexConnection(store.id);
    const from = tripletex?.syncFrom ?? `${today.slice(0, 7)}-01`;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={w.intro} />
        <Card title={w.open.title} description={w.open.text}>
          {owner ? (
            <ActionForm action={openBooksAction.bind(null, store.slug)} className="flex flex-col gap-3">
              <label className="flex w-fit flex-col gap-1 text-sm font-medium">
                {w.open.from}
                <input type="date" name="from" required defaultValue={from} max={`${Number(today.slice(0, 4)) + 1}-12-31`} className={field} />
                <span className="font-normal text-muted">{w.open.fromHelp}</span>
              </label>
              <div>
                <SubmitButton>{w.open.button}</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">{w.open.ownerOnly}</p>
          )}
        </Card>
      </div>
    );
  }

  const query = await searchParams;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const asked = (value: unknown) => (typeof value === "string" && isDay(value) ? value : null);
  const from = asked(query.from) ?? (yearStart < book.openedOn ? book.openedOn : yearStart);
  const to = asked(query.to) ?? today;
  const [waiting, tb, vat, tripletex, journal, chart, organisationNumber] = await Promise.all([
    ledgerWaiting(book.id),
    ledgerTrialBalance(book.id, from, to),
    ledgerVatByCode(book.id, from, to),
    getTripletexConnection(store.id),
    ledgerJournal(book.id),
    ledgerAccounts(book.id),
    vatReturnOrgNumber(book, store.id),
  ]);
  const pl = profitAndLoss(tb.rows);
  const bs = balanceSheet(tb.rows);
  const term = vatTermOf(to);
  const termFrom = term.from < book.openedOn ? book.openedOn : term.from;
  const vatToPay = vat.reduce((sum, r) => sum + r.vat, 0);
  const codeName = (code: string) => {
    const known = NO_TAX_CODES.find((c) => c.code === code);
    return known ? (lang === "nb" ? known.nb : known.en) : "";
  };
  const compared = tripletex ? await ledgerComparisonSummary(book.id) : null;
  // The opening balance from Tripletex (step 2d): offered to the owner while the books have none.
  const offerOpening = owner && tripletex !== null && !(await hasOpeningBalance(book.id));
  // The bank (B4, D486): the statements uploaded, matched to the books, and what is left on either side.
  const bank = await bankSummary(book.id);
  // A client's payment in the bank, and the Work invoice it most likely pays (D487).
  const offers = await invoiceOffers(store.id, book.id);
  // The bills waiting to be paid, and the bank lines that most likely pay them (D492).
  const [bills, billFor] = await Promise.all([unpaidBills(store.id, book.id), billOffers(store.id, book.id)]);
  // The vouchers of the journal's entries and of the bills, such as a purchase's receipt (D490), by entry.
  const vouchers = await vouchersOf(store.id, [...journal.map((e) => e.id), ...bills.map((b) => b.entryId)]);
  // The bill's fields' words, for the part of them that reads its file in the browser (D493).
  const billWords: BillFieldWords = {
    file: w.bills.file,
    supplier: w.bills.supplier,
    number: w.bills.number,
    issuedOn: w.bills.issuedOn,
    dueOn: w.bills.dueOn,
    amount: w.bills.amount,
    what: w.bank.what,
    vatRate: w.bank.vatRate,
    vatUsual: w.bank.vatUsual,
    vatNone: w.bank.vatNone,
    kinds: w.bank.kinds,
    more: w.bills.more,
    organisationNumber: w.bills.organisationNumber,
    words: w.bank.words,
    reading: w.bills.reading,
    readFrom: w.bills.readFrom,
    readBare: w.bills.readBare,
    unread: w.bills.unread,
    otherCurrency: w.bills.otherCurrency,
  };
  // The receipt's fields' words, for the part of them that reads a photo in the browser (D491).
  const receiptWords: ReceiptFieldWords = {
    what: w.bank.what,
    vatRate: w.bank.vatRate,
    vatUsual: w.bank.vatUsual,
    vatNone: w.bank.vatNone,
    words: w.bank.words,
    receiptFile: w.bank.receiptFile,
    kinds: w.bank.kinds,
    reading: w.bank.reading,
    readFrom: w.bank.readFrom,
    readBare: w.bank.readBare,
    differs: w.bank.differs,
    unread: w.bank.unread,
  };
  const amount = (minor: number) => formatMoney(minor, book.currency, locale);
  // The table's amounts as numbers, the currency said once above it; the result with its currency.
  const digits = minorUnitDigits(book.currency);
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const signed = (minor: number) => number.format(minor / 10 ** digits);
  const money = (minor: number) => (minor === 0 ? "" : signed(minor));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.intro} />

      <Card title={fillWords(w.facts.title, { name: book.legalName })}>
        <ul className="flex flex-col gap-1 text-sm">
          {book.organisationNumber && <li>{fillWords(w.facts.number, { number: book.organisationNumber })}</li>}
          <li>{fillWords(w.facts.since, { day: day(book.openedOn), currency: book.currency })}</li>
          <li className="text-muted">{book.lockedThrough ? fillWords(w.facts.locked, { day: day(book.lockedThrough) }) : w.facts.open}</li>
        </ul>
      </Card>

      {offerOpening && (
        <Card title={w.opening.title} description={w.opening.lead}>
          <ActionForm action={openingFromTripletexAction.bind(null, store.slug)} className="flex flex-col items-start gap-3">
            <SubmitButton>{w.opening.button}</SubmitButton>
          </ActionForm>
        </Card>
      )}

      <Card title={w.bank.title} description={w.bank.lead} aside={bank.statements > 0 ? <Chip signal={bank.waiting === 0 ? "positive" : "warning"}>{`${bank.lines - bank.waiting}/${bank.lines}`}</Chip> : undefined}>
        <div className="flex flex-col gap-4 text-sm">
          {bank.statements > 0 && bank.fromDay && bank.toDay && (
            <div className="flex flex-col gap-1">
              <p>
                {countWords(bank.lines, w.bank.summary, { from: day(bank.fromDay), to: day(bank.toDay), matched: bank.matched })}
                {bank.settled > 0 && <> {countWords(bank.settled, w.bank.settled)}</>}
              </p>
              {bank.closing && (
                <p className={bank.closing.bankMinor === bank.closing.booksMinor ? "text-muted" : "font-medium"}>
                  {bank.closing.bankMinor === bank.closing.booksMinor
                    ? fillWords(w.bank.balanceAgrees, { bank: amount(bank.closing.bankMinor), day: day(bank.closing.day) })
                    : fillWords(w.bank.balance, { bank: amount(bank.closing.bankMinor), day: day(bank.closing.day), books: amount(bank.closing.booksMinor) })}
                </p>
              )}
              {bank.waiting === 0 && bank.booksOnly.length === 0 && <p className="text-muted">{w.bank.none}</p>}
            </div>
          )}
          {(() => {
            // In the bank, not in the books; an offer to mark an invoice paid beside a client's payment (D487). One form holds every
            // offer, so its message stays once the line it paid has left the list.
            const list = bank.bankOnly.length > 0 && (
              <details open>
                <summary className="cursor-pointer font-medium">{`${w.bank.bankOnly} (${bank.waiting})`}</summary>
                <p className="mt-1 text-muted">{w.bank.bankOnlyLead}</p>
                <ul className="mt-2 flex flex-col divide-y divide-line">
                  {bank.bankOnly.map((l) => {
                    const offer = offers.get(l.id);
                    // Money out: the bill it most likely pays (D492), before the bank's own fees and the purchases.
                    const billOffer = offer ? undefined : billFor.get(l.id);
                    // The bank's own fee or interest, posted with one press (D488).
                    const own = offer || billOffer ? null : bankOwnKind({ amountMinor: l.amountMinor, text: l.text });
                    const ownAccount = own ? BANK_OWN_ACCOUNTS[own] : null;
                    const ownName = ownAccount ? `${ownAccount} ${chart.find((a) => a.number === ownAccount)?.name ?? ""}`.trim() : "";
                    return (
                      <li key={l.id} className="flex flex-col gap-2 py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <span className="min-w-0 flex-1">
                            <span className="text-muted">{day(l.day)}</span> {[l.counterparty, l.text, l.reference].filter(Boolean).join(" · ")}
                          </span>
                          <span className="tabular-nums">{amount(l.amountMinor)}</span>
                        </div>
                        {offer && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span className="text-muted">
                              {offer.source === "shop"
                                ? fillWords(w.bank.offerOrder, { number: offer.printedNumber, order: offer.orderNumber ?? "", amount: amount(offer.outstandingMinor) })
                                : fillWords(w.bank.offer, { number: offer.printedNumber, client: offer.client, amount: amount(offer.outstandingMinor) })}
                            </span>
                            {owner && (
                              <SubmitButton variant="secondary" name="pay" value={`${l.id}:${offer.invoiceId}`}>
                                {w.bank.pay}
                              </SubmitButton>
                            )}
                          </div>
                        )}
                        {billOffer && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span className="text-muted">
                              {billOffer.number
                                ? fillWords(w.bank.offerBill, { number: billOffer.number, supplier: billOffer.supplier })
                                : fillWords(w.bank.offerBillNoNumber, { supplier: billOffer.supplier })}
                            </span>
                            {owner && (
                              <SubmitButton variant="secondary" name="bill" value={`${l.id}:${billOffer.billId}`}>
                                {w.bank.pay}
                              </SubmitButton>
                            )}
                          </div>
                        )}
                        {own && owner && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span className="text-muted">{fillWords(w.bank.own[own], { account: ownName })}</span>
                            <SubmitButton variant="secondary" name="post" value={l.id}>
                              {w.bank.post}
                            </SubmitButton>
                          </div>
                        )}
                        {/* A purchase: its receipt, what it was and its VAT, posted with one press (D490). */}
                        {!offer && !billOffer && !own && owner && l.amountMinor < 0 && (
                          <details className="text-sm">
                            <summary className="w-fit cursor-pointer text-muted underline underline-offset-2">{w.bank.receipt}</summary>
                            <div className="mt-2 flex flex-col gap-3">
                              <p className="text-muted">{w.bank.receiptLead}</p>
                              <ReceiptFields
                                lineId={l.id}
                                defaultText={l.text}
                                bankMinor={l.amountMinor}
                                currency={book.currency}
                                locale={locale}
                                words={receiptWords}
                                read={readReceiptAction.bind(null, store.slug)}
                              />
                              <div>
                                <SubmitButton name="buy" value={l.id}>
                                  {w.bank.postPurchase}
                                </SubmitButton>
                              </div>
                            </div>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
            // Before the books opened (D495): nothing waits for an entry; a client's payment can still mark an old invoice paid.
            const earlierPaying = bank.earlier.filter((l) => offers.has(l.id));
            const earlier = bank.earlierCount > 0 && bank.openedOn && (
              <details open={earlierPaying.length > 0}>
                <summary className="cursor-pointer font-medium">{`${w.bank.earlier} (${bank.earlierCount})`}</summary>
                <p className="mt-1 text-muted">{w.bank.earlierLead}</p>
                {earlierPaying.length > 0 && (
                  <ul className="mt-2 flex flex-col divide-y divide-line">
                    {earlierPaying.map((l) => {
                      const offer = offers.get(l.id)!;
                      return (
                        <li key={l.id} className="flex flex-col gap-2 py-2">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <span className="min-w-0 flex-1">
                              <span className="text-muted">{day(l.day)}</span> {[l.counterparty, l.text, l.reference].filter(Boolean).join(" · ")}
                            </span>
                            <span className="tabular-nums">{amount(l.amountMinor)}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span className="text-muted">
                              {offer.source === "shop"
                                ? fillWords(w.bank.offerOrder, { number: offer.printedNumber, order: offer.orderNumber ?? "", amount: amount(offer.outstandingMinor) })
                                : fillWords(w.bank.offer, { number: offer.printedNumber, client: offer.client, amount: amount(offer.outstandingMinor) })}
                            </span>
                            {owner && (
                              <SubmitButton variant="secondary" name="pay" value={`${l.id}:${offer.invoiceId}`}>
                                {w.bank.pay}
                              </SubmitButton>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {bank.earlierCount > earlierPaying.length && (
                  <p className="mt-2 text-muted">{countWords(bank.earlierCount - earlierPaying.length, w.bank.earlierRest, { day: day(bank.openedOn) })}</p>
                )}
              </details>
            );
            return owner ? (
              <ActionForm action={payFromBankAction.bind(null, store.slug)} className="flex flex-col gap-2">
                {/* Enter in a field presses the form's first button: a disabled one first, so it presses none (only a button pressed acts). */}
                <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} />
                {list}
                {earlier}
              </ActionForm>
            ) : (
              <>
                {list}
                {earlier}
              </>
            );
          })()}
          {bank.booksOnly.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">{`${w.bank.booksOnly} (${bank.booksOnly.length})`}</summary>
              <p className="mt-1 text-muted">{w.bank.booksOnlyLead}</p>
              <ul className="mt-2 flex flex-col divide-y divide-line">
                {bank.booksOnly.map((l) => (
                  <li key={l.entryId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="text-muted">{day(l.day)}</span> {l.name} · {l.text}
                    </span>
                    <span className="tabular-nums">{amount(l.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {owner && (
            <ActionForm action={uploadBankStatementAction.bind(null, store.slug)} className="flex flex-col items-start gap-3">
              <label className="flex w-full max-w-md flex-col gap-1 text-sm font-medium">
                {w.bank.file}
                <input name="file" type="file" required accept=".xml,.csv,.txt,text/xml,application/xml,text/csv" className={`${field} py-2`} />
                <span className="font-normal text-muted">{w.bank.fileHelp}</span>
              </label>
              <SubmitButton>{w.bank.upload}</SubmitButton>
            </ActionForm>
          )}
        </div>
      </Card>

      {/* The bills to pay (B3, D492): posted as they come, waiting until the bank shows them paid. */}
      <Card
        title={w.bills.title}
        description={w.bills.lead}
        aside={bills.length > 0 ? <Chip signal={bills.some((b) => b.dueOn !== null && b.dueOn < today) ? "warning" : "neutral"}>{String(bills.length)}</Chip> : undefined}
      >
        <div className="flex flex-col gap-4 text-sm">
          {bills.length === 0 ? (
            <p className="text-muted">{w.bills.none}</p>
          ) : (
            <>
              <p>{countWords(bills.length, w.bills.total, { amount: amount(bills.reduce((sum, b) => sum + b.totalMinor, 0)) })}</p>
              <ul className="flex flex-col divide-y divide-line">
                {bills.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                    <span className="min-w-0 flex-1">
                      {b.dueOn === null ? (
                        <span className="text-muted">{w.bills.noDue}</span>
                      ) : b.dueOn < today ? (
                        <Chip signal="warning">{fillWords(w.bills.overdue, { day: day(b.dueOn) })}</Chip>
                      ) : (
                        <span className="text-muted">{fillWords(w.bills.due, { day: day(b.dueOn) })}</span>
                      )}{" "}
                      {[b.supplier, b.number].filter(Boolean).join(" · ")}
                      {vouchers.has(b.entryId) && (
                        <>
                          {" · "}
                          <a href={`/admin/${store.slug}/settings/books/vouchers/${vouchers.get(b.entryId)!.id}`} target="_blank" rel="noopener" className="underline underline-offset-2">
                            {w.bank.voucherBill}
                          </a>
                        </>
                      )}
                    </span>
                    <span className="tabular-nums">{amount(b.totalMinor)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {owner && (
            <details>
              <summary className="w-fit cursor-pointer font-medium underline underline-offset-2">{w.bills.add}</summary>
              <ActionForm action={addBillAction.bind(null, store.slug)} className="mt-3 flex flex-col gap-3">
                <BillFields today={today} openedOn={book.openedOn} currency={book.currency} locale={locale} words={billWords} read={readBillAction.bind(null, store.slug)} />
                <div>
                  <SubmitButton>{w.bills.save}</SubmitButton>
                </div>
              </ActionForm>
            </details>
          )}
        </div>
      </Card>

      {waiting.length > 0 && (
        <Card title={w.waiting.title} aside={<Chip signal="warning">{waiting.length}</Chip>}>
          <p className="mb-2 text-sm">{countWords(waiting.length, w.waiting.count, { n: waiting.length })}</p>
          <ul className="flex flex-col divide-y divide-line text-sm">
            {waiting.slice(0, 20).map((item) => (
              <li key={`${item.kind}:${item.id}`} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {w.waiting.kinds[item.kind] ?? item.kind}: {w.waiting.problems[item.problem] ?? item.problem}
                </span>
                <span className="text-muted">{fillWords(w.waiting.since, { day: day(item.since.slice(0, 10)) })}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={w.trial.title}>
        <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.trial.from}
            <input type="date" name="from" defaultValue={from} min={book.openedOn} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.trial.to}
            <input type="date" name="to" defaultValue={to} min={book.openedOn} className={field} />
          </label>
          <button type="submit" className="min-h-10 rounded-full border border-edge bg-card px-4 text-sm hover:bg-sunken">
            {w.trial.show}
          </button>
        </form>
        {tb.rows.length > 0 && <p className="mb-2 text-sm text-muted">{fillWords(w.trial.amounts, { currency: book.currency })}</p>}
        {tb.rows.length === 0 ? (
          <p className="text-sm text-muted">{w.trial.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left font-medium">{w.trial.account}</th>
                  <th className={`${cell} font-medium`}>{w.trial.before}</th>
                  <th className={`${cell} font-medium`}>{w.trial.debit}</th>
                  <th className={`${cell} font-medium`}>{w.trial.credit}</th>
                  <th className={`${cell} font-medium`}>{w.trial.after}</th>
                </tr>
              </thead>
              <tbody>
                {tb.rows.map((r) => (
                  <tr key={r.account} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <span className="tabular-nums">{r.account}</span> {r.name}
                    </td>
                    <td className={cell}>{money(r.before)}</td>
                    <td className={cell}>{money(r.debit)}</td>
                    <td className={cell}>{money(-r.credit)}</td>
                    <td className={cell}>{money(r.after)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-medium">
                <tr className="border-t border-edge">
                  <td className="px-3 py-2">{w.trial.total}</td>
                  <td className={cell}>{signed(tb.totals.before)}</td>
                  <td className={cell}>{signed(tb.totals.debit)}</td>
                  <td className={cell}>{signed(-tb.totals.credit)}</td>
                  <td className={cell}>{signed(tb.totals.after)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {tb.rows.length > 0 && <p className="mt-3 text-sm font-medium">{fillWords(w.trial.result, { amount: formatMoney(tb.result, book.currency, locale) })}</p>}
        {tb.totals.after !== 0 && (
          <p role="alert" className="mt-2 text-sm">
            {w.trial.unbalanced}
          </p>
        )}
      </Card>

      <Card title={w.pl.title} description={w.pl.lead}>
        {pl.groups.length === 0 ? (
          <p className="text-sm text-muted">{w.pl.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <ReportGroups groups={pl.groups} names={w.pl.groups} amount={money} total={signed} />
              <tfoot>
                <ReportLine label={w.pl.operating} value={signed(pl.operating)} />
                <ReportLine label={w.pl.financial} value={signed(pl.financial)} />
                <ReportLine label={w.pl.beforeTax} value={signed(pl.beforeTax)} />
                <ReportLine label={w.pl.result} value={formatMoney(pl.result, book.currency, locale)} strong />
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card title={w.balance.title} description={fillWords(w.balance.lead, { day: day(to) })}>
        {bs.groups.length === 0 && bs.unallocated === 0 ? (
          <p className="text-sm text-muted">{w.balance.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <ReportGroups groups={bs.groups.filter((g) => g.group === "fixed_assets" || g.group === "current_assets")} names={w.balance.groups} amount={money} total={signed} />
              <tbody>
                <ReportLine label={w.balance.assets} value={signed(bs.assets)} strong />
              </tbody>
              <ReportGroups groups={bs.groups.filter((g) => g.group !== "fixed_assets" && g.group !== "current_assets")} names={w.balance.groups} amount={money} total={signed} />
              <tbody>
                {bs.unallocated !== 0 && <ReportLine label={w.balance.unallocated} value={signed(bs.unallocated)} />}
                <ReportLine label={w.balance.equityAndLiabilities} value={signed(bs.equityAndLiabilities)} strong />
              </tbody>
            </table>
          </div>
        )}
        {bs.assets !== bs.equityAndLiabilities && (
          <p role="alert" className="mt-2 text-sm">
            {w.balance.unbalanced}
          </p>
        )}
      </Card>

      <Card
        title={w.vat.title}
        description={w.vat.lead}
        aside={
          <Link href={`/admin/${store.slug}/settings/books/vat/${vatTermOfDay(book.vatTerm, today).key}`} className="text-sm underline">
            {w.vatReturn.link}
          </Link>
        }
      >
        <p className="mb-3 text-sm text-muted">
          {fillWords(w.vat.term, { to: day(to), term: String(term.term) })}{" "}
          {(from !== termFrom || to !== term.to) && (
            <a href={`?from=${termFrom}&to=${term.to}`} className="underline underline-offset-2">
              {fillWords(w.vat.showTerm, { term: String(term.term) })}
            </a>
          )}
        </p>
        {vat.length === 0 ? (
          <p className="text-sm text-muted">{w.vat.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left font-medium">{w.vat.code}</th>
                  <th className={`${cell} font-medium`}>{w.vat.base}</th>
                  <th className={`${cell} font-medium`}>{w.vat.amount}</th>
                </tr>
              </thead>
              <tbody>
                {vat.map((r) => (
                  <tr key={r.code} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <span className="tabular-nums">{r.code}</span> {codeName(r.code)}
                    </td>
                    <td className={cell}>{signed(r.base)}</td>
                    <td className={cell}>{signed(r.vat)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-medium">
                <tr className="border-t border-edge">
                  <td className="px-3 py-2">{w.vat.total}</td>
                  <td className={cell} />
                  <td className={cell}>{formatMoney(vatToPay, book.currency, locale)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card title={w.saft.title} description={w.saft.lead}>
        {organisationNumber ? (
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {saftYears(book.openedOn, book.closedOn, today).map((y) => (
              <li key={y.year} className="flex flex-col">
                <a href={`/admin/${store.slug}/settings/books/saft/${y.year}`} download className="underline underline-offset-2">
                  {fillWords(w.saft.download, { year: String(y.year) })}
                </a>
                {(y.from !== `${y.year}-01-01` || y.to !== `${y.year}-12-31`) && <span className="text-muted">{fillWords(w.saft.days, { from: day(y.from), to: day(y.to) })}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{w.saft.noOrgNumber}</p>
        )}
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer">{w.saft.mapping}</summary>
          <p className="mt-2 text-muted">{w.saft.mappingLead}</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left font-medium">{w.saft.account}</th>
                  <th className="px-3 py-2 text-left font-medium">{w.saft.code}</th>
                  <th className="px-3 py-2 text-left font-medium">{w.saft.codeName}</th>
                </tr>
              </thead>
              <tbody>
                {chart.map((a) => {
                  const g = groupingOf(a.number, a.standard);
                  return (
                    <tr key={a.number} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <span className="tabular-nums">{a.number}</span> {a.name}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{g?.code ?? "–"}</td>
                      <td className="px-3 py-2">{g ? (lang === "nb" ? g.nb : g.en) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <Card title={w.journal.title} description={w.journal.lead}>
        {journal.length === 0 ? (
          <p className="text-sm text-muted">{w.journal.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {journal.map((e) => (
              <li key={e.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium tabular-nums">{e.name}</span>
                  <span className="text-muted">{day(e.date)}</span>
                  <span>{e.text}</span>
                  <Chip>{w.journal.kinds[e.sourceKind ?? "hand"] ?? w.journal.kinds.hand}</Chip>
                  {e.reversedBy && <Chip signal="warning">{fillWords(w.journal.reversedBy, { name: e.reversedBy })}</Chip>}
                  {e.reverses && <Chip>{fillWords(w.journal.reverses, { name: e.reverses })}</Chip>}
                  {vouchers.has(e.id) && (
                    <a href={`/admin/${store.slug}/settings/books/vouchers/${vouchers.get(e.id)!.id}`} target="_blank" rel="noopener" className="underline underline-offset-2">
                      {e.sourceKind === "supplier_invoice" ? w.bank.voucherBill : w.bank.voucher}
                    </a>
                  )}
                </div>
                <table className="w-full max-w-2xl table-fixed text-sm">
                  {/* The same columns in every entry, so the amounts line up down the journal. */}
                  <colgroup>
                    <col />
                    <col className="w-32" />
                    <col className="w-32" />
                  </colgroup>
                  <thead className="sr-only">
                    <tr>
                      <th>{w.hand.account}</th>
                      <th>{w.journal.debit}</th>
                      <th>{w.journal.credit}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.lines.map((l, i) => (
                      <tr key={i} className="text-muted">
                        <td className="truncate py-0.5 pr-3">
                          <span className="tabular-nums">{l.account}</span> {l.name}
                          {l.vatCode && <span className="ml-2 text-xs">({w.hand.vat} {l.vatCode})</span>}
                        </td>
                        <td className={`${cell} py-0.5`}>{l.amount > 0 ? signed(l.amount) : ""}</td>
                        <td className={`${cell} py-0.5`}>{l.amount < 0 ? signed(-l.amount) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {owner && !e.reversedBy && !e.reverses && (
                  <details className="text-sm">
                    <summary className="w-fit cursor-pointer text-muted underline underline-offset-2">{w.journal.reverse}</summary>
                    <ActionForm action={reverseEntryAction.bind(null, store.slug, e.id)} className="mt-2 flex flex-col gap-2">
                      <p className="text-muted">{fillWords(w.journal.reverseConfirm, { name: e.name })}</p>
                      <div>
                        <SubmitButton variant="secondary">{w.journal.reverse}</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {compared && (
        <Card
          title={w.compare.title}
          description={w.compare.text}
          aside={compared.differ + compared.missing > 0 ? <Chip signal="warning">{compared.differ + compared.missing}</Chip> : undefined}
        >
          {compared.agree + compared.differ + compared.missing === 0 ? (
            <p className="text-sm text-muted">{w.compare.none}</p>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                {[
                  countWords(compared.agree, w.compare.agree, { n: compared.agree }),
                  compared.differ > 0 ? countWords(compared.differ, w.compare.differ, { n: compared.differ }) : null,
                  compared.missing > 0 ? countWords(compared.missing, w.compare.missing, { n: compared.missing }) : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
                .
              </p>
              {compared.items.length === 0 ? (
                <p className="font-medium">{w.compare.all}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {compared.items.slice(0, 20).map((item) => (
                    <li key={`${item.kind}:${item.id}`} className="py-2">
                      <p className="font-medium">{item.text || (w.waiting.kinds[item.kind] ?? item.kind)}</p>
                      {item.state === "missing" ? (
                        <p className="text-muted">{w.compare.gone}</p>
                      ) : (
                        <ul className="text-muted">
                          {item.differences.map((d) => (
                            <li key={String(d.account)}>
                              {fillWords(w.compare.line, { account: d.account === "vat" ? w.compare.vat : String(d.account), ours: signed(d.ours), theirs: signed(d.theirs) })}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {owner && (
        <Card title={w.hand.title} description={w.hand.lead}>
          <details>
            <summary className="w-fit cursor-pointer rounded-full border border-edge bg-card px-4 py-2 text-sm hover:bg-sunken">{w.hand.open}</summary>
            <ActionForm action={postEntryAction.bind(null, store.slug)} className="mt-4 flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.hand.series}
                  <select name="series" defaultValue={LEDGER_SERIES.manual} className={field}>
                    <option value={LEDGER_SERIES.manual}>{w.hand.seriesManual}</option>
                    <option value={LEDGER_SERIES.opening}>{w.hand.seriesOpening}</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.hand.date}
                  <input type="date" name="date" required defaultValue={today} min={book.lockedThrough ?? book.openedOn} className={field} />
                </label>
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm font-medium">
                  {w.hand.text}
                  <input name="text" required maxLength={200} className={field} />
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted">
                    <tr>
                      <th className="px-1 py-1 text-left font-medium">{w.hand.account}</th>
                      <th className="px-1 py-1 text-left font-medium">{w.hand.debit}</th>
                      <th className="px-1 py-1 text-left font-medium">{w.hand.credit}</th>
                      <th className="px-1 py-1 text-left font-medium">{w.hand.vat}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: HAND_ROWS }, (_, i) => (
                      <tr key={i}>
                        <td className="px-1 py-1">
                          <select name={`account_${i}`} defaultValue="" aria-label={`${w.hand.account} ${i + 1}`} className={`${field} w-full min-w-56`}>
                            <option value="">{w.hand.choose}</option>
                            {chart
                              .filter((a) => a.active)
                              .map((a) => (
                                <option key={a.number} value={a.number}>
                                  {a.number} {a.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <input name={`debit_${i}`} inputMode="decimal" aria-label={`${w.hand.debit} ${i + 1}`} className={`${field} w-32 text-right tabular-nums`} />
                        </td>
                        <td className="px-1 py-1">
                          <input name={`credit_${i}`} inputMode="decimal" aria-label={`${w.hand.credit} ${i + 1}`} className={`${field} w-32 text-right tabular-nums`} />
                        </td>
                        <td className="px-1 py-1">
                          <select name={`vat_${i}`} defaultValue="" aria-label={`${w.hand.vat} ${i + 1}`} className={field}>
                            <option value="">{w.hand.none}</option>
                            {NO_TAX_CODES.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.code} {lang === "nb" ? c.nb : c.en}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <SubmitButton>{w.hand.button}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>
      )}

      {owner && (
        <Card title={w.lock.title} description={w.lock.text}>
          <ActionForm action={lockBooksAction.bind(null, store.slug)} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.lock.through}
              <input type="date" name="through" defaultValue={book.lockedThrough ?? ""} min={book.openedOn} max={today} className={field} />
            </label>
            <SubmitButton variant="secondary">{w.lock.button}</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {owner && (
        <Card title={w.earlier.title} description={fillWords(w.earlier.text, { day: day(book.openedOn) })}>
          <ActionForm action={openBooksEarlierAction.bind(null, store.slug)} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.earlier.from}
              <input type="date" name="from" required defaultValue={book.openedOn.endsWith("-01-01") ? `${Number(book.openedOn.slice(0, 4)) - 1}-01-01` : `${book.openedOn.slice(0, 4)}-01-01`} max={book.openedOn} className={field} />
            </label>
            <SubmitButton variant="secondary">{w.earlier.button}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

/** A report's groups (the profit and loss's, the balance sheet's): each group's name and total, its accounts under it. */
function ReportGroups({
  groups,
  names,
  amount,
  total,
}: {
  groups: { group: string; rows: ReportRow[]; total: number }[];
  names: Record<string, string>;
  amount: (minor: number) => string;
  total: (minor: number) => string;
}) {
  return groups.map((g) => (
    <tbody key={g.group}>
      <tr className="border-b border-line">
        <th scope="rowgroup" className="px-3 pb-1 pt-4 text-left font-medium">
          {names[g.group] ?? g.group}
        </th>
        <td className={`${cell} pb-1 pt-4 font-medium`}>{total(g.total)}</td>
      </tr>
      {g.rows.map((r) => (
        <tr key={r.account}>
          <td className="px-3 py-1 pl-6 text-muted">
            <span className="tabular-nums">{r.account}</span> {r.name}
          </td>
          <td className={`${cell} py-1 text-muted`}>{amount(r.amount)}</td>
        </tr>
      ))}
    </tbody>
  ));
}

/** A report's summing line: a label and its amount, the last one stronger. */
function ReportLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={`border-t font-medium ${strong ? "border-edge text-base" : "border-line"}`}>
      <td className="px-3 py-2">{label}</td>
      <td className={cell}>{value}</td>
    </tr>
  );
}
