import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { field } from "@/components/admin/data/ui";
import { Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { BooksMessages } from "@/lib/admin-messages/books.en";
import { PURCHASE_KINDS, PURCHASE_VAT_RATES, type PurchaseKind } from "@/lib/purchases";
import type { RecurringCost } from "@/lib/recurring-costs";
import type { RecurringView } from "@/server/recurring-costs";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * Subscriptions on Settings → Books (D503): what the subscriptions cost a month and a year, each with its last charge in the bank and when the
 * next is due (one late is said), the charges the statements show coming back each month offered to add with one press, and a form to add
 * or change one. Only the owner adds, changes and ends; others read.
 */
export function RecurringCostsCard({
  view,
  owner,
  currency,
  today,
  words: w,
  amount,
  day,
  save,
  press,
}: {
  view: Pick<RecurringView, "rows" | "monthlyMinor" | "likely">;
  owner: boolean;
  currency: string;
  today: string;
  words: BooksMessages;
  amount: (minor: number) => string;
  day: (d: string) => string;
  save: Action;
  press: Action;
}) {
  const r = w.recurring;
  const lateCount = view.rows.filter((row) => row.late).length;
  const running = view.rows.filter((row) => row.running).length;
  return (
    <Card
      title={r.title}
      description={r.lead}
      aside={running > 0 ? <Chip signal={lateCount > 0 ? "warning" : "neutral"}>{lateCount > 0 ? `${lateCount}/${running}` : String(running)}</Chip> : undefined}
    >
      <div className="flex flex-col gap-4 text-sm">
        {view.rows.length === 0 ? (
          <p className="text-muted">{r.none}</p>
        ) : (
          <p className="font-medium">{fillWords(r.monthly, { amount: amount(view.monthlyMinor), year: amount(view.monthlyMinor * 12) })}</p>
        )}
        {view.rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {view.rows.map((row) => (
              <li key={row.cost.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className={`min-w-0 flex-1 font-medium ${row.running ? "" : "text-muted"}`}>
                    {row.cost.name} <span className="font-normal text-muted">· {r.every[row.cost.every]}</span>
                  </span>
                  <span className="tabular-nums">{amount(row.cost.amountMinor)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                  {row.late && row.lastDay ? (
                    <Chip signal="warning">{fillWords(r.late, { day: day(row.lastDay) })}</Chip>
                  ) : (
                    <span>
                      {row.lastDay && row.lastMinor !== null ? fillWords(r.last, { day: day(row.lastDay), amount: amount(row.lastMinor) }) : r.never}
                      {row.nextDay && row.lastDay && <>, {fillWords(r.next, { day: day(row.nextDay) })}</>}
                    </span>
                  )}
                  {!row.running && row.cost.endedOn && <span>{fillWords(r.endedOn, { day: day(row.cost.endedOn) })}</span>}
                </div>
                {owner && (
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <details className="min-w-0 flex-1">
                      <summary className="w-fit cursor-pointer text-muted underline underline-offset-2">
                        {r.change}
                        <span className="sr-only"> {row.cost.name}</span>
                      </summary>
                      <div className="mt-2">
                        <RecurringForm action={save} cost={row.cost} currency={currency} today={today} words={w} />
                      </div>
                    </details>
                    {row.running && (
                      <ActionForm action={press}>
                        <SubmitButton variant="secondary" name="end" value={row.cost.id}>
                          {r.end}
                          <span className="sr-only"> {row.cost.name}</span>
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {view.likely.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="font-medium">{r.likelyTitle}</p>
            <p className="text-muted">{r.likelyLead}</p>
            {(() => {
              const likely = (
                <ul className="flex flex-col divide-y divide-line">
                  {view.likely.map((l) => (
                    <li key={l.matchText} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                      <span className="min-w-0 flex-1">{fillWords(r.likely, { name: l.name, amount: amount(l.amountMinor), n: l.count, day: day(l.firstDay) })}</span>
                      {owner && (
                        <SubmitButton variant="secondary" name="likely" value={l.matchText}>
                          {r.addLikely}
                          <span className="sr-only"> {l.name}</span>
                        </SubmitButton>
                      )}
                    </li>
                  ))}
                </ul>
              );
              // The presses in one form, each button naming the charge it adds.
              return owner ? <ActionForm action={press}>{likely}</ActionForm> : likely;
            })()}
          </div>
        )}
        {owner && (
          <details>
            <summary className="w-fit cursor-pointer font-medium underline underline-offset-2">{r.add}</summary>
            <div className="mt-3">
              <RecurringForm action={save} cost={null} currency={currency} today={today} words={w} />
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

/** The fields of a subscription, empty to add one or filled to change it. */
function RecurringForm({ action, cost, currency, today, words: w }: { action: Action; cost: RecurringCost | null; currency: string; today: string; words: BooksMessages }) {
  const r = w.recurring;
  const vat = cost === null ? "usual" : cost.abroad ? "abroad" : String(cost.vatRate);
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {cost && <input type="hidden" name="id" value={cost.id} />}
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 font-medium">
          {r.name}
          <input name="name" required maxLength={80} defaultValue={cost?.name ?? ""} className={field} />
        </label>
        <label className="flex min-w-56 flex-1 flex-col gap-1 font-medium">
          {r.matchText}
          <input name="matchText" required maxLength={60} defaultValue={cost?.matchText ?? ""} className={field} />
          <span className="font-normal text-muted">{r.matchHelp}</span>
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 font-medium">
          {w.bank.what}
          <select name="kind" defaultValue={cost?.kind ?? "software"} className={field}>
            {(Object.keys(PURCHASE_KINDS) as PurchaseKind[]).map((k) => (
              <option key={k} value={k}>
                {w.bank.kinds[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-44 flex-col gap-1 font-medium">
          {w.bank.vatRate}
          <select name="vat" defaultValue={vat} className={field}>
            <option value="usual">{w.bank.vatUsual}</option>
            {PURCHASE_VAT_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate === 0 ? w.bank.vatNone : `${rate} %`}
              </option>
            ))}
            <option value="abroad">{w.bank.vatAbroad}</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex w-44 flex-col gap-1 font-medium">
          {r.howOften}
          <select name="every" defaultValue={cost?.every ?? "month"} className={field}>
            <option value="month">{r.everyMonth}</option>
            <option value="year">{r.everyYear}</option>
          </select>
        </label>
        <label className="flex w-56 flex-col gap-1 font-medium">
          {fillWords(r.amount, { currency })}
          <input name="amount" required inputMode="decimal" defaultValue={cost ? (cost.amountMinor / 100).toFixed(2) : ""} className={field} />
        </label>
        <label className="flex w-44 flex-col gap-1 font-medium">
          {r.startedOn}
          <input type="date" name="startedOn" required defaultValue={cost?.startedOn ?? today} max={today} className={field} />
        </label>
      </div>
      <div>
        <SubmitButton>{r.save}</SubmitButton>
      </div>
    </ActionForm>
  );
}
