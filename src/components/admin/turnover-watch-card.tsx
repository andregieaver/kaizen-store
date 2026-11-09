import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { field } from "@/components/admin/data/ui";
import { Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { BooksMessages } from "@/lib/admin-messages/books.en";
import { isLimitedCompany, NEAR_SHARE, NO_THRESHOLDS, shortAmount, watchText, type OwnThreshold, type Watch } from "@/lib/turnover-watch";

/**
 * The threshold watch on Settings → Books (D514): the turnover over the last twelve months from the books, what the watch says now (the same
 * words the store home shows), the law's thresholds and the owner's own. A keeper adds a threshold of their own (an amount and what they will
 * do before it) and takes one away; others read.
 */
export function TurnoverWatchCard({
  turnoverMinor,
  currency,
  legalName,
  watches,
  own,
  keeper,
  locale,
  words: w,
  add,
  remove,
}: {
  turnoverMinor: number;
  currency: string;
  legalName: string;
  watches: readonly Watch[];
  own: readonly OwnThreshold[];
  keeper: boolean;
  locale: string;
  words: BooksMessages;
  add: (state: FormState, form: FormData) => Promise<FormState>;
  remove: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = w.watch;
  const short = (minor: number) => shortAmount(minor, currency, locale, t);
  // Where the turnover stands against a threshold: past it, near it (from 85 %), or below.
  const standing = (amount: number) =>
    turnoverMinor >= amount ? <Chip signal="warning">{t.past}</Chip> : turnoverMinor >= amount * NEAR_SHARE ? <Chip signal="warning">{t.near}</Chip> : null;
  const law = NO_THRESHOLDS.filter((l) => l.currency === currency && (!l.onlyAs || isLimitedCompany(legalName)));
  return (
    <Card title={t.title} description={t.description}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-body-strong">{fillWords(t.turnover, { turnover: short(turnoverMinor) })}</p>
        {watches.length > 0 && (
          <ul className="flex flex-col gap-1">
            {watches.map((watch) => (
              <li key={watch.kind === "own" ? watch.id : watch.key} className="rounded-md bg-warning-soft px-3 py-2 text-warning-text">
                {watchText(watch, t, locale)}
              </li>
            ))}
          </ul>
        )}
        {law.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-body-strong">{t.lawTitle}</h3>
            <ul className="flex flex-col gap-1">
              {law.map((l) => (
                <li key={l.key} className="flex flex-wrap items-center gap-2">
                  <span>{fillWords(l.key === "vat_registration" ? t.lawVat : t.lawAudit, { limit: short(l.amountMinor) })}</span>
                  {standing(l.amountMinor)}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <h3 className="text-body-strong">{t.ownTitle}</h3>
          {own.length === 0 ? (
            <p className="text-muted">{t.ownNone}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {own.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {short(o.amountMinor)}: {o.note}
                  </span>
                  {standing(o.amountMinor)}
                  {keeper && (
                    <ActionForm action={remove}>
                      <SubmitButton variant="secondary" name="id" value={o.id}>
                        {t.remove}
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
          {keeper && (
            <ActionForm action={add} className="mt-2 flex flex-wrap items-end gap-3">
              <label className="flex w-48 flex-col gap-1 font-medium">
                {fillWords(t.amount, { currency })}
                <input name="amount" inputMode="decimal" required className={field} />
              </label>
              <label className="flex min-w-64 flex-1 flex-col gap-1 font-medium">
                {t.note}
                <input name="note" maxLength={120} required placeholder={t.notePlaceholder} className={field} />
              </label>
              <SubmitButton variant="secondary">{t.add}</SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </Card>
  );
}
