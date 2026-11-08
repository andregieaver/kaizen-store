import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { field } from "@/components/admin/data/ui";
import { Card, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import type { BooksMessages } from "@/lib/admin-messages/books.en";
import { adminText } from "@/lib/admin-text";
import { todayIn } from "@/lib/analytics-period";
import { NO_TAX_CODES } from "@/lib/ledger";
import { formatMoney, minorUnitDigits } from "@/lib/money";
import { formatStoreDay } from "@/lib/return-time";
import { VAT_TERM_SIZES, vatTermOfDay, vatTermOfKey, vatTermsOf, type VatTerm } from "@/lib/vat-return";
import { openBookOf, type LedgerBook } from "@/server/ledger";
import { memberCan, requirePermission } from "@/server/permissions";
import { getTripletexConnection } from "@/server/tripletex";
import { ourVatReturn, theirVatReturn, vatReturnOrgNumber, type OurVatReturn } from "@/server/vat-return";

import { setVatTermAction } from "../actions";

export const metadata: Metadata = { title: "VAT return" };

const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

/**
 * Tripletex's return for the same days (D496), read when the page is: the same figures, or where they differ code by code, and what
 * Tripletex says about the term. Streams in, as reading Tripletex takes a moment.
 */
async function TripletexComparison({ storeId, ours, w, money, amount }: { storeId: string; ours: OurVatReturn; w: BooksMessages["vatReturn"]; money: (m: number) => string; amount: (m: number) => string }) {
  const t = w.tripletex;
  const theirs = await theirVatReturn(storeId, ours);
  if (!theirs.ok) return <p className="text-sm text-muted">{t.problems[theirs.problem]}</p>;
  const { differences, totalDifference } = theirs.comparison;
  const theirTotal = ours.ret.total - totalDifference;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className={differences.length === 0 ? "text-muted" : "font-medium"}>
        {differences.length === 0 ? t.same : fillWords(t.differ, { theirs: amount(theirTotal), difference: amount(Math.abs(totalDifference)) })}
      </p>
      {differences.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 text-left font-medium">{w.code}</th>
                <th className={`${cell} font-medium`}>{`${w.base} · ${t.ours}`}</th>
                <th className={`${cell} font-medium`}>{`${w.base} · ${t.theirs}`}</th>
                <th className={`${cell} font-medium`}>{`${w.vat} · ${t.ours}`}</th>
                <th className={`${cell} font-medium`}>{`${w.vat} · ${t.theirs}`}</th>
              </tr>
            </thead>
            <tbody>
              {differences.map((d) => (
                <tr key={d.code} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 tabular-nums">{d.code}</td>
                  <td className={cell}>{money(d.oursBase)}</td>
                  <td className={cell}>{money(d.theirsBase)}</td>
                  <td className={cell}>{money(d.oursVat)}</td>
                  <td className={cell}>{money(d.theirsVat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {theirs.status ? (
        <p className="text-muted">
          {theirs.status.delivery ? (t.delivery[theirs.status.delivery] ?? theirs.status.delivery) : t.noStatus}
          {theirs.status.owedMinor !== null && <> {fillWords(t.owed, { amount: amount(theirs.status.owedMinor) })}</>}
        </p>
      ) : (
        <p className="text-muted">{t.noStatus}</p>
      )}
    </div>
  );
}

/**
 * The VAT return (B5, D496): Homer sees the term's amount to pay or get back, its due day and the lines to type into Skatteetaten's form
 * (or the file for the accountant); Lisa sees the comparison with Tripletex and the term length. Read by anyone who sees the Books.
 */
export default async function VatReturnPage({ params, searchParams }: PageProps<"/admin/[store]/settings/books/vat">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const books = adminText(lang, "books");
  const w = books.vatReturn;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const owner = memberCan(member, "owner");
  const today = todayIn(new Date(), store.timeZone);
  const book: LedgerBook | null = await openBookOf(store.id);
  const day = (d: string) => formatStoreDay(d, locale);
  const back = (
    <Link href={`/admin/${store.slug}/settings/books`} className="text-sm underline">
      {w.back}
    </Link>
  );
  if (!book) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <PageHeader title={w.title} description={books.open.text} />
      </div>
    );
  }

  const terms = vatTermsOf(book.vatTerm, book.openedOn, today);
  const asked = vatTermOfKey(book.vatTerm, (await searchParams).term);
  const term: VatTerm = asked && terms.some((t) => t.key === asked.key) ? asked : (terms[0] ?? vatTermOfDay(book.vatTerm, today));
  const [ours, tripletex, orgNumber] = await Promise.all([ourVatReturn(book, term), getTripletexConnection(store.id), vatReturnOrgNumber(book, store.id)]);
  const amount = (minor: number) => formatMoney(minor, book.currency, locale);
  const digits = minorUnitDigits(book.currency);
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const money = (minor: number) => number.format(minor / 10 ** digits);
  const termName = (t: VatTerm) => `${w.periods[t.period as keyof typeof w.periods] ?? t.period} ${t.year}`;
  const codeName = (code: string) => {
    const known = NO_TAX_CODES.find((c) => c.code === code);
    return known ? (lang === "nb" ? known.nb : known.en) : "";
  };
  const total = ours.ret.total;
  // To get back, nothing, or to pay, by the sign of what is owed.
  const totalWord = [w.toGetBack, w.nothing, w.toPay][Math.sign(total) + 1];

  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader title={w.title} description={w.lead} />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.term}
          <select name="term" defaultValue={term.key} className={`${field} min-w-56`}>
            {terms.map((t) => (
              <option key={t.key} value={t.key}>
                {termName(t)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="min-h-10 rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken">
          {w.show}
        </button>
      </form>

      <Card title={termName(term)}>
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-muted">{totalWord}</p>
            <p className="text-metric tabular-nums text-ink">{amount(Math.abs(total))}</p>
            <p className="mt-1 text-sm text-muted">{fillWords(w.due, { due: day(term.due) })}</p>
            {ours.partial && <p className="mt-2 text-sm">{fillWords(w.partial, { day: day(book.openedOn) })}</p>}
          </div>
          {ours.ret.lines.length === 0 ? (
            <p className="text-sm text-muted">{w.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 text-left font-medium">{w.code}</th>
                    <th className="px-3 py-2 text-left font-medium">{w.what}</th>
                    <th className={`${cell} font-medium`}>{w.base}</th>
                    <th className={`${cell} font-medium`}>{w.rate}</th>
                    <th className={`${cell} font-medium`}>{w.vat}</th>
                  </tr>
                </thead>
                <tbody>
                  {ours.ret.lines.map((l, i) => (
                    <tr key={`${l.code}-${l.side}-${i}`} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 tabular-nums">{l.code}</td>
                      <td className="px-3 py-2">{l.side === "deducted" ? `${w.deduction} · ${codeName(l.code)}` : codeName(l.code)}</td>
                      <td className={cell}>{l.base === null ? "" : money(l.base)}</td>
                      <td className={cell}>{l.rate === null ? "" : `${l.rate} %`}</td>
                      <td className={cell}>{money(l.vat)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ours.ret.unknown.length > 0 && <p className="text-sm">{countWords(ours.ret.unknown.length, w.unknown, { codes: ours.ret.unknown.join(", ") })}</p>}
          <p className="text-sm text-muted">{w.send}</p>
          {orgNumber ? (
            <div>
              <a
                href={`/admin/${store.slug}/settings/books/vat/xml?term=${term.key}`}
                className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken"
              >
                {w.download}
              </a>
            </div>
          ) : (
            // Skatteetaten takes no return without the business's organisation number: ask for it instead of offering a file it refuses.
            <p className="text-sm">
              {w.noOrgNumber}{" "}
              <Link href={`/admin/${store.slug}/settings/company`} className="underline">
                {w.company}
              </Link>
            </p>
          )}
        </div>
      </Card>

      {tripletex && (
        <Card title={w.tripletex.title} description={w.tripletex.lead}>
          <Suspense fallback={<p className="text-sm text-muted" role="status">{w.tripletex.reading}</p>}>
            <TripletexComparison storeId={store.id} ours={ours} w={w} money={money} amount={amount} />
          </Suspense>
        </Card>
      )}

      {owner && (
        <details className="rounded-lg border border-line bg-card p-5">
          <summary className="cursor-pointer text-title text-ink">{w.termSize}</summary>
          <p className="mt-2 mb-4 text-sm text-muted">{w.termSizeHelp}</p>
          <ActionForm action={setVatTermAction.bind(null, store.slug)} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              <span className="sr-only">{w.termSize}</span>
              <select name="size" defaultValue={book.vatTerm} className={field}>
                {VAT_TERM_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {w.sizes[s]}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton variant="secondary">{w.save}</SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
