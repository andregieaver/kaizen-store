import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { field } from "@/components/admin/data/ui";
import { Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { BooksMessages } from "@/lib/admin-messages/books.en";
import { MONTHS, type BudgetLine, type BudgetView } from "@/lib/budget";

const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

/**
 * Budget and forecast on Settings → Books (D505): for the year, each account with a budget, money or a subscription, its budget, what the
 * books hold so far and the forecast, and how far the forecast misses the budget; income, costs and the result below. The owner sets an
 * account's budget, one amount a month or month by month (Lisa's, one step away).
 */
export function BudgetCard({
  year,
  view,
  accounts,
  owner,
  currency,
  locale,
  words: w,
  money,
  save,
}: {
  year: number;
  view: BudgetView;
  /** The book's result accounts to set a budget on, by number and name. */
  accounts: readonly { number: number; name: string }[];
  owner: boolean;
  currency: string;
  locale: string;
  words: BooksMessages;
  money: (minor: number) => string;
  save: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const b = w.budget;
  const name = new Map(accounts.map((a) => [a.number, a.name]));
  const anyBudget = view.lines.some((l) => l.budget !== null);
  const off = (l: Pick<BudgetLine, "off" | "income">) => {
    if (l.off === null) return null;
    if (l.off === 0) return <Chip signal="positive">{b.onTrack}</Chip>;
    const words = l.income ? (l.off > 0 ? b.short : b.ahead) : l.off > 0 ? b.over : b.under;
    return <Chip signal={l.off > 0 ? "warning" : "positive"}>{fillWords(words, { amount: money(Math.abs(l.off)) })}</Chip>;
  };
  const total = (label: string, t: { budget: number; actual: number; forecast: number }, income: boolean, strong = false) => (
    <tr className={strong ? "font-medium" : undefined}>
      <th scope="row" className="px-3 py-2 text-left">
        {label}
      </th>
      <td className={cell}>{anyBudget ? money(t.budget) : ""}</td>
      <td className={cell}>{money(t.actual)}</td>
      <td className={cell}>{money(t.forecast)}</td>
      <td className="px-3 py-2 text-right">{anyBudget ? off({ income, off: income ? t.budget - t.forecast : t.forecast - t.budget }) : null}</td>
    </tr>
  );
  const monthName = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  return (
    <Card title={fillWords(b.title, { year })} description={b.lead}>
      <div className="flex flex-col gap-4 text-sm">
        {view.lines.length === 0 ? (
          <p className="text-muted">{b.none}</p>
        ) : (
          <>
            {!anyBudget && <p className="text-muted">{b.noBudget}</p>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="px-3 py-2 text-left font-normal">
                      {b.account}
                    </th>
                    <th scope="col" className={`${cell} font-normal`}>
                      {b.budget}
                    </th>
                    <th scope="col" className={`${cell} font-normal`}>
                      {b.actual}
                    </th>
                    <th scope="col" className={`${cell} font-normal`}>
                      {b.forecast}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">
                      {b.off}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {view.lines.map((l) => (
                    <tr key={l.account}>
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        {l.account} {name.get(l.account) ?? ""}
                        <span className="block text-caption text-muted">{b.sources[l.source]}</span>
                      </th>
                      <td className={cell}>{l.budget === null ? "" : money(l.budget)}</td>
                      <td className={cell}>{money(l.actual)}</td>
                      <td className={cell}>{money(l.forecast)}</td>
                      <td className="px-3 py-2 text-right">{off(l)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-line">
                  {total(b.income, view.income, true)}
                  {total(b.costs, view.costs, false)}
                  {total(b.result, view.result, true, true)}
                </tfoot>
              </table>
            </div>
            <p className="text-muted">{b.how}</p>
          </>
        )}
        {owner && accounts.length > 0 && (
          <details>
            <summary className="w-fit cursor-pointer font-medium underline underline-offset-2">{b.set}</summary>
            <ActionForm action={save} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="year" value={year} />
              <div className="flex flex-wrap gap-3">
                <label className="flex min-w-64 flex-1 flex-col gap-1 font-medium">
                  {b.account}
                  <select name="account" className={field} defaultValue={accounts.find((a) => a.number === 6553)?.number ?? accounts[0].number}>
                    {accounts.map((a) => (
                      <option key={a.number} value={a.number}>
                        {a.number} {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-56 flex-col gap-1 font-medium">
                  {fillWords(b.each, { currency })}
                  <input name="each" inputMode="decimal" className={field} />
                  <span className="font-normal text-muted">{b.removeHelp}</span>
                </label>
              </div>
              <details>
                <summary className="w-fit cursor-pointer text-muted underline underline-offset-2">{b.byMonth}</summary>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {Array.from({ length: MONTHS }, (_, i) => (
                    <label key={i} className="flex flex-col gap-1 font-medium">
                      {monthName.format(new Date(Date.UTC(year, i, 1)))}
                      <input name={`month-${i + 1}`} inputMode="decimal" className={field} />
                    </label>
                  ))}
                </div>
              </details>
              <div>
                <SubmitButton>{b.save}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        )}
      </div>
    </Card>
  );
}
