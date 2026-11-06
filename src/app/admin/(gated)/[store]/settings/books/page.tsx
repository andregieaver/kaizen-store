import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { field } from "@/components/admin/data/ui";
import { Card, Chip, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { todayIn } from "@/lib/analytics-period";
import { isDay } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { formatStoreDay } from "@/lib/return-time";
import { ledgerTrialBalance, ledgerWaiting, openBookOf } from "@/server/ledger";
import { memberCan, requirePermission } from "@/server/permissions";
import { getTripletexConnection } from "@/server/tripletex";

import { lockBooksAction, openBooksAction } from "./actions";

export const metadata: Metadata = { title: "Books" };

const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

/**
 * Settings → Books (B2, D478): the store's own books. Homer opens them (the owner, from the day Tripletex started booking), then reads what
 * waits for him and the trial balance of this year, with its result; Lisa chooses the days and locks the books through a day. Members who may
 * read settings see them; only the owner opens and locks.
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
  const [waiting, tb] = await Promise.all([ledgerWaiting(book.id), ledgerTrialBalance(book.id, from, to)]);
  const money = (minor: number) => (minor === 0 ? "" : formatMoney(minor, book.currency, locale));
  const signed = (minor: number) => formatMoney(minor, book.currency, locale);

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
        {tb.rows.length > 0 && <p className="mt-3 text-sm font-medium">{fillWords(w.trial.result, { amount: signed(tb.result) })}</p>}
        {tb.totals.after !== 0 && (
          <p role="alert" className="mt-2 text-sm">
            {w.trial.unbalanced}
          </p>
        )}
      </Card>

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
    </div>
  );
}
