import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { BooksMessages } from "@/lib/admin-messages/books.en";
import type { SpecLine, YearEndCheck } from "@/lib/year-end";
import type { YearEndView } from "@/server/year-end";

const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

/**
 * The year-end on Settings → Books (D506): the list of what must be done before the year is closed, each ticked or said; the year's result;
 * *Close {year}* once it is ready (what it does said first), and when closed, *Reopen {year}* one step away; and the year's figures by the
 * codes of the business specification, with the spreadsheet to download (Lisa's, folded away).
 */
export function YearEndCard({
  storeSlug,
  view,
  owner,
  lang,
  words: w,
  money,
  day,
  act,
}: {
  storeSlug: string;
  view: YearEndView;
  owner: boolean;
  lang: "en" | "nb";
  words: BooksMessages;
  money: (minor: number) => string;
  day: (d: string) => string;
  act: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const y = w.yearEnd;
  const year = view.year;
  const result = view.pl.result;
  const said = (c: YearEndCheck) => {
    const words = y.checks[c.key];
    const state = c.key === "bank_balance" && c.state === "todo" && c.amount !== undefined ? "off" : c.state;
    return fillWords(words[state] ?? words.todo ?? "", { n: c.count ?? 0, amount: money(Math.abs(c.amount ?? 0)), day: c.day ? day(c.day) : "" });
  };
  const mark = (c: YearEndCheck) => (c.state === "ok" ? "✓" : c.state === "todo" ? "•" : "i");
  const left = view.checks.filter((c) => c.state === "todo").length;
  const specRows = (lines: readonly SpecLine[]) =>
    lines.map((l) => (
      <tr key={l.code}>
        <td className="px-3 py-2 tabular-nums">{l.code}</td>
        <td className="px-3 py-2">{lang === "nb" ? l.nb : l.en}</td>
        <td className={cell}>{money(l.amount)}</td>
      </tr>
    ));
  const total = (label: string, amount: number) => (
    <tr className="font-medium">
      <td />
      <td className="px-3 py-2">{label}</td>
      <td className={cell}>{money(amount)}</td>
    </tr>
  );
  return (
    <Card
      title={fillWords(y.title, { year })}
      description={y.lead}
      aside={view.closed ? <Chip signal="positive">✓</Chip> : left > 0 ? <Chip signal="warning">{String(left)}</Chip> : undefined}
    >
      <div className="flex flex-col gap-4 text-sm">
        {view.closed ? (
          <p className="font-medium">{view.closed.result === 0 ? fillWords(y.closedEven, { year }) : fillWords(y.closed, { year, amount: money(view.closed.result) })}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.checks.map((c) => (
              <li key={c.key} className="flex gap-2">
                <span aria-hidden="true" className={`w-4 shrink-0 text-center ${c.state === "ok" ? "text-positive-text" : c.state === "todo" ? "text-warning-text" : "text-muted"}`}>
                  {mark(c)}
                </span>
                <span className={c.state === "ok" ? "text-muted" : undefined}>{said(c)}</span>
              </li>
            ))}
          </ul>
        )}
        <p>
          <span className="text-muted">{fillWords(result >= 0 ? y.profit : y.loss, { year })}: </span>
          <span className="font-medium tabular-nums">{money(Math.abs(result))}</span>
        </p>
        {owner && !view.closed && (
          <details>
            <summary className="w-fit cursor-pointer font-medium underline underline-offset-2">{fillWords(y.close, { year })}</summary>
            <div className="mt-2 flex flex-col gap-2">
              <p>{fillWords(y.closeText, { year, amount: money(result) })}</p>
              {view.ready ? (
                <ActionForm action={act}>
                  <SubmitButton name="close" value={String(year)}>
                    {fillWords(y.closeButton, { year })}
                  </SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-muted">{y.notReady}</p>
              )}
            </div>
          </details>
        )}
        {owner && view.closed && (
          <details>
            <summary className="w-fit cursor-pointer text-muted underline underline-offset-2">{fillWords(y.reopen, { year })}</summary>
            <div className="mt-2 flex flex-col gap-2">
              <p>{fillWords(y.reopenText, { year })}</p>
              <ActionForm action={act}>
                <SubmitButton variant="secondary" name="reopen" value={String(year)}>
                  {fillWords(y.reopenButton, { year })}
                </SubmitButton>
              </ActionForm>
            </div>
          </details>
        )}
        <details>
          <summary className="w-fit cursor-pointer font-medium underline underline-offset-2">{y.spec}</summary>
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-muted">{y.specLead}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse">
                <caption className="px-3 py-2 text-left font-medium">{y.specResult}</caption>
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="w-20 px-3 py-2 text-left font-normal">
                      {y.code}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-normal">
                      {y.item}
                    </th>
                    <th scope="col" className={`${cell} font-normal`}>
                      {y.amount}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">{specRows(view.spec.result)}</tbody>
                <tfoot className="border-t-2 border-line">
                  {total(y.income, view.spec.income)}
                  {total(y.costs, view.spec.costs)}
                  {total(y.resultTotal, view.spec.resultTotal)}
                </tfoot>
              </table>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse">
                <caption className="px-3 py-2 text-left font-medium">{y.specBalance}</caption>
                <tbody className="divide-y divide-line">{specRows(view.spec.balance)}</tbody>
                <tfoot className="border-t-2 border-line">
                  {total(y.assets, view.spec.assets)}
                  {total(y.equityAndLiabilities, view.spec.equityAndLiabilities)}
                </tfoot>
              </table>
            </div>
            <a href={`/admin/${storeSlug}/settings/books/naering/${year}`} className="w-fit underline underline-offset-2">
              {y.download}
            </a>
          </div>
        </details>
      </div>
    </Card>
  );
}
